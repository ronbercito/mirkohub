"""
Archivo: backend/app/routers/red/router.py
Función: Gestión de equipos de red (/api/routers): CRUD de MikroTik / OLT y lectura en
         vivo del RouterOS a través de la API:
           POST /{id}/test-connection  -> conecta, lee identidad/versión/CPU/RAM y actualiza estado
           POST /{id}/ping             -> latencia TCP al puerto API + ping ICMP desde el router
           GET  /{id}/interfaces       -> interfaces con tráfico RX/TX en tiempo real
           (las lecturas GET responden siempre 200 con {ok, data} o {ok:false, error})
           GET  /{id}/pppoe/active | /pppoe/secrets | /pppoe/profiles
           GET  /{id}/queues | /dhcp-leases | /address-list | /hotspot/users | /hotspot/active
           POST /{id}/sync-plans       -> crea/actualiza PPP profiles de todos los planes
           POST /{id}/pppoe/secrets/{name}/toggle, POST /{id}/address-list (add/remove)
           POST /sync-cuts             -> aplica corte real a todos los clientes con deuda vencida
           GET  /{id}/olt/{system|pon_optical|pon_stats|onu_list|onu_autofind|onu_optical|onu_detail}?pon=&onu=
           POST /{id}/olt/onu/{authorize|reboot|deactivate|activate|delete}, POST /{id}/olt/command (consola)
Trabaja con: backend/app/models/router.py, client.py, plan.py, invoice.py,
             backend/app/integrations/olt/service.py, vsol.py,
             backend/app/integrations/mikrotik/client.py, service.py,
             frontend/src/modules/red/Network.jsx y sus componentes
"""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import apply_updates, get_or_404
from app.integrations.mikrotik import service as mt
from app.integrations.mikrotik.client import MikroTikError, tcp_latency_ms
from app.integrations.olt import service as olt
from app.integrations.olt.vsol import OLT_PROFILES
from app.models.client import Client
from app.models.invoice import Invoice
from app.models.plan import Plan
from app.models.router import Router
from app.models.setting import Setting
from app.routers.red.schemas import AddressListIn, OltCommandIn, OltOnuIn, RouterIn

router = APIRouter(prefix="/routers", tags=["Red / MikroTik"], dependencies=[Depends(get_current_user)])


async def _router(db: AsyncSession, router_id: str) -> Router:
    r = await get_or_404(db, Router, router_id, "Router")
    if r.device_type != "mikrotik":
        raise HTTPException(status_code=400, detail="Este equipo no es un MikroTik (la lectura por API solo aplica a RouterOS)")
    return r


async def _read(db: AsyncSession, router_id: str, reader):
    """Abre la conexión al MikroTik, ejecuta `reader(mt_client)` y lanza MikroTikError si falla."""
    r = await _router(db, router_id)
    try:
        async with mt.connect(r) as client:
            data = await reader(client)
        r.status, r.last_error = "online", ""
    except MikroTikError as e:
        r.status, r.last_error = "offline", str(e)[:250]
        await db.commit()
        raise
    await db.commit()
    return data


async def _live(db: AsyncSession, router_id: str, reader):
    """Respuesta uniforme de lectura en vivo: {ok, data} o {ok:false, error} (siempre HTTP 200)."""
    try:
        return {"ok": True, "data": await _read(db, router_id, reader)}
    except MikroTikError as e:
        return {"ok": False, "error": str(e), "data": []}


# ---------- CRUD ----------
@router.get("")
async def list_routers(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(Router).order_by(Router.name))).scalars().all()
    return [r.public_dict() for r in rows]


def _normalize_olt(r: Router):
    if r.device_type == "olt":
        r.olt_profile = "vsol_epon" if (r.pon_type or "").upper() == "EPON" else "vsol_gpon"
        r.port = r.cli_port


@router.post("")
async def create_router(data: RouterIn, check: bool = True, db: AsyncSession = Depends(get_db)):
    r = Router(**data.model_dump())
    _normalize_olt(r)
    db.add(r)
    await db.flush()
    result = None
    if check:
        result = await (mt.snapshot_router(r) if r.device_type == "mikrotik" else olt.snapshot_olt(r))
    await db.commit()
    return {**r.public_dict(), "connection": result}


@router.put("/{router_id}")
async def update_router(router_id: str, data: RouterIn, check: bool = False, db: AsyncSession = Depends(get_db)):
    r = await get_or_404(db, Router, router_id, "Router")
    payload = data.model_dump()
    if not payload.get("password"):
        payload.pop("password")
    if not payload.get("enable_password"):
        payload.pop("enable_password")
    apply_updates(r, payload)
    _normalize_olt(r)
    result = None
    if check:
        result = await (mt.snapshot_router(r) if r.device_type == "mikrotik" else olt.snapshot_olt(r))
    await db.commit()
    return {**r.public_dict(), "connection": result}


@router.delete("/{router_id}")
async def delete_router(router_id: str, db: AsyncSession = Depends(get_db)):
    r = await get_or_404(db, Router, router_id, "Router")
    await db.delete(r)
    await db.commit()
    return {"message": "Equipo eliminado"}


# ---------- Conexión y estado ----------
@router.get("/olt-profiles")
async def olt_profiles():
    return [{"id": k, "label": v["label"]} for k, v in OLT_PROFILES.items()]


@router.post("/{router_id}/test-connection")
async def test_connection(router_id: str, db: AsyncSession = Depends(get_db)):
    r = await get_or_404(db, Router, router_id, "Router")
    result = await (mt.snapshot_router(r) if r.device_type == "mikrotik" else olt.snapshot_olt(r))
    await db.commit()
    return {**result, "router": r.public_dict()}


@router.post("/{router_id}/ping")
async def ping_router(router_id: str, target: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    r = await get_or_404(db, Router, router_id, "Router")
    latency = await tcp_latency_ms(r.ip_address, r.cli_port)
    r.ping_ms = latency or 0.0
    r.status = "online" if latency is not None else "offline"
    icmp = None
    if r.device_type == "mikrotik" and latency is not None and target:
        try:
            async with mt.connect(r) as client:
                icmp = await client.ping(target)
        except MikroTikError as e:
            icmp = {"error": str(e)}
    await db.commit()
    return {"router": r.name, "ip": r.ip_address, "port": r.cli_port, "latency_ms": latency,
            "status": r.status, "remote_ping": icmp,
            "packet_loss": "0%" if latency is not None else "100%"}


@router.get("/{router_id}/resources")
async def resources(router_id: str, db: AsyncSession = Depends(get_db)):
    return await _live(db, router_id, lambda c: c.system_resource())


@router.get("/{router_id}/interfaces")
async def interfaces(router_id: str, db: AsyncSession = Depends(get_db)):
    res = await _live(db, router_id, lambda c: c.interfaces())
    return {**res, "interfaces": res["data"]}


@router.get("/{router_id}/pppoe/active")
async def pppoe_active(router_id: str, db: AsyncSession = Depends(get_db)):
    return await _live(db, router_id, lambda c: c.ppp_active())


@router.get("/{router_id}/pppoe/secrets")
async def pppoe_secrets(router_id: str, db: AsyncSession = Depends(get_db)):
    return await _live(db, router_id, lambda c: c.ppp_secrets())


@router.get("/{router_id}/pppoe/profiles")
async def pppoe_profiles(router_id: str, db: AsyncSession = Depends(get_db)):
    return await _live(db, router_id, lambda c: c.ppp_profiles())


@router.post("/{router_id}/pppoe/secrets/{name}/toggle")
async def toggle_secret(router_id: str, name: str, disabled: bool, db: AsyncSession = Depends(get_db)):
    try:
        found = await _read(db, router_id, lambda c: c.set_ppp_secret_disabled(name, disabled))
    except MikroTikError as e:
        raise HTTPException(status_code=502, detail=str(e))
    if not found:
        raise HTTPException(status_code=404, detail=f"Secret '{name}' no existe en el router")
    return {"message": f"Secret '{name}' {'deshabilitado' if disabled else 'habilitado'}"}


@router.get("/{router_id}/queues")
async def queues(router_id: str, db: AsyncSession = Depends(get_db)):
    return await _live(db, router_id, lambda c: c.simple_queues())


@router.get("/{router_id}/dhcp-leases")
async def dhcp_leases(router_id: str, db: AsyncSession = Depends(get_db)):
    return await _live(db, router_id, lambda c: c.dhcp_leases())


@router.post("/{router_id}/dhcp-leases/{lease_id}/make-static")
async def make_static(router_id: str, lease_id: str, db: AsyncSession = Depends(get_db)):
    try:
        await _read(db, router_id, lambda c: c.make_lease_static(lease_id))
    except MikroTikError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"message": "Concesión DHCP convertida en estática"}


@router.get("/{router_id}/address-list")
async def address_list(router_id: str, list: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    return await _live(db, router_id, lambda c: c.address_list(list))


@router.post("/{router_id}/address-list")
async def address_list_change(router_id: str, data: AddressListIn, db: AsyncSession = Depends(get_db)):
    try:
        if data.action == "add":
            res = await _read(db, router_id, lambda c: c.address_list_add(data.list, data.address, data.comment))
            return {"message": f"IP {data.address} {'ya estaba' if res == 'exists' else 'agregada'} en '{data.list}'"}
        n = await _read(db, router_id, lambda c: c.address_list_remove(data.list, data.address))
    except MikroTikError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"message": f"{n} entrada(s) de {data.address} eliminadas de '{data.list}'"}


@router.get("/{router_id}/hotspot/users")
async def hotspot_users(router_id: str, db: AsyncSession = Depends(get_db)):
    return await _live(db, router_id, lambda c: c.hotspot_users())


@router.get("/{router_id}/hotspot/active")
async def hotspot_active(router_id: str, db: AsyncSession = Depends(get_db)):
    return await _live(db, router_id, lambda c: c.hotspot_active())


@router.post("/{router_id}/sync-plans")
async def sync_plans(router_id: str, db: AsyncSession = Depends(get_db)):
    r = await _router(db, router_id)
    plans = (await db.execute(select(Plan).where(Plan.is_active == True))).scalars().all()  # noqa: E712
    return await mt.sync_plans(r, plans)


# ---------- OLT (VSOL) por CLI ----------
async def _olt(db: AsyncSession, router_id: str) -> Router:
    r = await get_or_404(db, Router, router_id, "Router")
    if r.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")
    return r


@router.get("/{router_id}/olt/{action}")
async def olt_read(router_id: str, action: str, pon: int = 1, onu: int = 0, db: AsyncSession = Depends(get_db)):
    if action not in ("system", "pon_optical", "pon_stats", "onu_list", "onu_autofind", "onu_optical", "onu_detail"):
        raise HTTPException(status_code=400, detail="Acción de lectura no válida")
    r = await _olt(db, router_id)
    res = await olt.run_action(r, action, pon=pon, onu=onu)
    await db.commit()
    return res


@router.post("/{router_id}/olt/onu/{action}")
async def olt_onu_action(router_id: str, action: str, data: OltOnuIn, db: AsyncSession = Depends(get_db)):
    if action not in ("authorize", "reboot", "deactivate", "activate", "delete"):
        raise HTTPException(status_code=400, detail="Acción de ONU no válida")
    r = await _olt(db, router_id)
    res = await olt.run_action(r, f"onu_{action}", pon=data.pon, onu=data.onu, sn=data.sn, profile=data.profile)
    await db.commit()
    if not res["ok"]:
        raise HTTPException(status_code=502, detail=res["error"])
    return {"message": f"ONU {data.onu} (PON {data.pon}): {action} ejecutado", **res}


@router.post("/{router_id}/olt/command")
async def olt_command(router_id: str, data: OltCommandIn, db: AsyncSession = Depends(get_db)):
    if data.command.strip().lower().startswith(("reboot", "reload", "erase", "format")):
        raise HTTPException(status_code=400, detail="Comando bloqueado por seguridad desde el panel")
    r = await _olt(db, router_id)
    result = await olt.run_console(r, data.command.strip())
    await db.commit()
    return result


# ---------- Cortes masivos ----------
@router.post("/sync-cuts")
async def sync_cuts(db: AsyncSession = Depends(get_db)):
    s = await db.get(Setting, "system_config")
    cut_list = (s.data or {}).get("mikrotik_cut_list") or "morosos"
    overdue = (await db.execute(select(Invoice).where(Invoice.status == "overdue"))).scalars().all()
    client_ids = {i.client_id for i in overdue}
    routers_cache: dict[str, Router | None] = {}
    affected, details = 0, []
    for cid in client_ids:
        c = await db.get(Client, cid)
        if not c or c.status != "active":
            continue
        if c.router_id not in routers_cache:
            routers_cache[c.router_id] = await db.get(Router, c.router_id) if c.router_id else None
        c.status, c.is_online = "suspended", False
        res = await mt.cut_client(c, routers_cache[c.router_id], cut_list)
        details.append({"client": c.full_name, **res})
        affected += 1
    await db.commit()
    return {"message": f"Cortes aplicados: {affected} cliente(s) con facturas vencidas suspendidos.",
            "clients_affected": affected, "routers_synced": len([r for r in routers_cache.values() if r]),
            "details": details}
