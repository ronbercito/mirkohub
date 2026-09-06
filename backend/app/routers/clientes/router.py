"""
Archivo: backend/app/routers/clientes/router.py
Función: CRUD de abonados (/api/clients): listar con búsqueda y filtro, detalle con
         facturas y tickets, crear (aprovisiona PPPoE/cola en el MikroTik y emite la
         primera factura), editar (re-aprovisiona), eliminar (limpia el MikroTik) y
         corte / reactivación de servicio real vía API RouterOS. GET /{id}/onu-status busca la ONU
         del abonado (onu_sn) en las OLT VSOL registradas y devuelve estado y potencia óptica.
Trabaja con: backend/app/models/client.py, plan.py, router.py, invoice.py, ticket.py,
             backend/app/integrations/mikrotik/service.py, backend/app/routers/ajustes/router.py,
             frontend/src/modules/clientes/Clients.jsx
"""
from datetime import datetime, timedelta, timezone
import ipaddress
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, now_iso
from app.core.security import get_current_user
from app.core.utils import apply_updates, correlative, current_period, get_or_404
from app.integrations.mikrotik import service as mt
from app.integrations.olt import service as olt
from app.models.client import Client
from app.models.invoice import Invoice
from app.models.nap_box import NapBox
from app.models.ipv4_network import IPv4Network
from app.models.plan import Plan
from app.models.router import Router
from app.models.setting import Setting
from app.models.ticket import Ticket
from app.routers.clientes.schemas import ClientIn

router = APIRouter(prefix="/clients", tags=["Clientes"], dependencies=[Depends(get_current_user)])


async def _cut_list(db: AsyncSession) -> str:
    s = await db.get(Setting, "system_config")
    return (s.data or {}).get("mikrotik_cut_list") or "morosos"


async def _attach_plan_router(db: AsyncSession, c: Client):
    """Valida el plan y el MikroTik antes de aprovisionar al abonado."""
    if not c.plan_id:
        raise HTTPException(status_code=422, detail="Selecciona un plan de internet activo.")
    plan = await db.get(Plan, c.plan_id)
    if not plan:
        raise HTTPException(status_code=422, detail="El plan seleccionado ya no existe.")
    if not plan.is_active:
        raise HTTPException(status_code=422, detail="El plan seleccionado está inactivo.")

    if not c.router_id:
        raise HTTPException(status_code=422, detail="Selecciona el MikroTik donde se registrará el abonado.")
    rtr = await db.get(Router, c.router_id)
    if not rtr:
        raise HTTPException(status_code=422, detail="El MikroTik seleccionado ya no existe.")
    if rtr.device_type != "mikrotik":
        raise HTTPException(status_code=422, detail="El equipo seleccionado no es un MikroTik.")
    if not rtr.password:
        raise HTTPException(status_code=422, detail="El MikroTik seleccionado no tiene credenciales API configuradas.")

    ipv4_network = await db.get(IPv4Network, c.ipv4_network_id) if c.ipv4_network_id else None
    if ipv4_network:
        if ipv4_network.router_id != rtr.id:
            raise HTTPException(status_code=422, detail="La red IPv4 seleccionada pertenece a otro MikroTik.")
        if c.ip_address:
            try:
                address = ipaddress.ip_address(c.ip_address.strip())
                network = ipaddress.ip_network(ipv4_network.cidr)
            except ValueError as error:
                raise HTTPException(status_code=422, detail="La IP del cliente no es válida.") from error
            if address not in network or address in (network.network_address, network.broadcast_address):
                raise HTTPException(status_code=422, detail=f"La IP debe ser un host válido dentro de {ipv4_network.cidr}.")
    elif c.connection_type in ("IP Estática", "DHCP") and c.ip_address:
        raise HTTPException(status_code=422, detail="Selecciona la red IPv4 correspondiente a la IP del cliente.")

    nap_box = await db.get(NapBox, c.nap_box_id) if c.nap_box_id else None
    if nap_box:
        if c.nap_port is not None and not 1 <= c.nap_port <= nap_box.ports:
            raise HTTPException(status_code=422, detail=f"El puerto NAP debe estar entre 1 y {nap_box.ports}.")
        if c.nap_port is not None:
            occupied_query = select(Client.id).where(Client.nap_box_id == nap_box.id, Client.nap_port == c.nap_port)
            if c.id:
                occupied_query = occupied_query.where(Client.id != c.id)
            occupied = await db.scalar(occupied_query)
            if occupied:
                raise HTTPException(status_code=422, detail=f"El puerto {c.nap_port} de {nap_box.name} ya está ocupado.")
        c.nap_box = nap_box.name
    elif c.nap_port is not None:
        raise HTTPException(status_code=422, detail="Selecciona una caja NAP antes de indicar el puerto.")

    c.plan_name, c.plan_price = plan.name, plan.price
    c.router_name = rtr.name
    return plan, rtr


@router.get("")
async def list_clients(search: Optional[str] = None, status: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    q = select(Client)
    if status and status != "all":
        q = q.where(Client.status == status)
    if search:
        like = f"%{search}%"
        q = q.where(or_(Client.full_name.ilike(like), Client.dni_ruc.ilike(like), Client.ip_address.ilike(like),
                        Client.phone.ilike(like), Client.address.ilike(like), Client.pppoe_user.ilike(like)))
    rows = (await db.execute(q.order_by(Client.created_at.desc()))).scalars().all()
    return [c.to_dict() for c in rows]


@router.get("/{client_id}")
async def get_client(client_id: str, db: AsyncSession = Depends(get_db)):
    c = await get_or_404(db, Client, client_id, "Cliente")
    invoices = (await db.execute(select(Invoice).where(Invoice.client_id == client_id).order_by(Invoice.issue_date.desc()))).scalars().all()
    tickets = (await db.execute(select(Ticket).where(Ticket.client_id == client_id).order_by(Ticket.created_at.desc()))).scalars().all()
    data = c.to_dict()
    data["invoices"] = [i.to_dict() for i in invoices]
    data["tickets"] = [t.to_dict() for t in tickets]
    return data


@router.get("/{client_id}/onu-status")
async def onu_status(client_id: str, db: AsyncSession = Depends(get_db)):
    c = await get_or_404(db, Client, client_id, "Cliente")
    if not c.onu_sn:
        raise HTTPException(status_code=400, detail="El cliente no tiene ONU SN registrado")
    olts = (await db.execute(select(Router).where(Router.device_type == "olt"))).scalars().all()
    if not olts:
        raise HTTPException(status_code=400, detail="No hay ninguna OLT registrada en Gestión de Red")
    results = []
    for r in olts:
        res = await olt.find_onu(r, c.onu_sn)
        results.append(res)
        if res.get("found"):
            await db.commit()
            return {**res, "client": c.full_name, "onu_sn": c.onu_sn}
    await db.commit()
    return {"ok": True, "found": False, "client": c.full_name, "onu_sn": c.onu_sn,
            "message": f"ONU {c.onu_sn} no encontrada en {len(olts)} OLT(s)", "details": results}


@router.post("")
async def create_client(data: ClientIn, db: AsyncSession = Depends(get_db)):
    c = Client(**data.model_dump(exclude={"create_first_invoice"}))
    c.last_connection_time = ""
    plan, rtr = await _attach_plan_router(db, c)
    db.add(c)
    await db.flush()

    result = await mt.provision_client(c, rtr, plan)
    if not result["ok"]:
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"No se pudo registrar el abonado en MikroTik: {result['message']}")

    if data.create_first_invoice:
        now = datetime.now(timezone.utc)
        db.add(Invoice(invoice_number=correlative("REC"), client_id=c.id, client_name=c.full_name,
                       client_dni_ruc=c.dni_ruc, client_address=c.address, client_phone=c.phone,
                       plan_name=c.plan_name, amount=c.plan_price, month_period=current_period(),
                       issue_date=now.strftime("%Y-%m-%d"), due_date=(now + timedelta(days=10)).strftime("%Y-%m-%d"),
                       status="unpaid", notes="Factura inicial de instalación / servicio mensual"))
        c.unpaid_invoices_count, c.balance_due = 1, c.plan_price

    await db.commit()
    return {**c.to_dict(), "mikrotik": result}


@router.put("/{client_id}")
async def update_client(client_id: str, data: ClientIn, db: AsyncSession = Depends(get_db)):
    c = await get_or_404(db, Client, client_id, "Cliente")
    apply_updates(c, data.model_dump(exclude={"create_first_invoice"}))
    plan, rtr = await _attach_plan_router(db, c)
    result = await mt.provision_client(c, rtr, plan)
    if not result["ok"]:
        await db.rollback()
        raise HTTPException(status_code=502, detail=f"No se pudo actualizar el abonado en MikroTik: {result['message']}")
    await db.commit()
    return {**c.to_dict(), "mikrotik": result}


@router.delete("/{client_id}")
async def delete_client(client_id: str, db: AsyncSession = Depends(get_db)):
    c = await get_or_404(db, Client, client_id, "Cliente")
    rtr = await db.get(Router, c.router_id) if c.router_id else None
    result = await mt.remove_client(c, rtr, await _cut_list(db))
    await db.delete(c)
    await db.commit()
    return {"message": "Cliente eliminado correctamente", "mikrotik": result}


@router.post("/{client_id}/toggle-status")
async def toggle_status(client_id: str, db: AsyncSession = Depends(get_db)):
    c = await get_or_404(db, Client, client_id, "Cliente")
    rtr = await db.get(Router, c.router_id) if c.router_id else None
    cut_list = await _cut_list(db)
    if c.status == "active":
        c.status, c.is_online = "suspended", False
        result = await mt.cut_client(c, rtr, cut_list)
    else:
        c.status, c.is_online = "active", True
        c.last_connection_time = now_iso()
        result = await mt.restore_client(c, rtr, cut_list)
    await db.commit()
    return {"id": c.id, "status": c.status, "is_online": c.is_online, "message": result["message"], "mikrotik": result}
