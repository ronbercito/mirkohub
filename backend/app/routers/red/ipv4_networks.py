"""
Archivo: backend/app/routers/red/ipv4_networks.py
Función: API de inventario IPv4 (/api/ipv4-networks): crea, lista, edita y elimina
         redes vinculadas a MikroTiks, y calcula los clientes registrados por red.
Alcance: administra planificación y validación de direcciones; no altera /ip address,
         pools, DHCP ni rutas de RouterOS.
Trabaja con: models/ipv4_network.py, models/client.py, models/router.py,
             routers/clientes/router.py, frontend/modules/red/IPv4Networks.jsx.
"""
import ipaddress

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import get_or_404
from app.models.client import Client
from app.models.ipv4_network import IPv4Network
from app.models.router import Router

router = APIRouter(prefix="/ipv4-networks", tags=["Red / IPv4"], dependencies=[Depends(get_current_user)])


class IPv4NetworkIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    network_address: str
    prefix_length: int = Field(ge=8, le=30)
    router_id: str = Field(min_length=1)
    usage_type: str = "static"


def _network(data: IPv4NetworkIn) -> ipaddress.IPv4Network:
    try:
        value = ipaddress.ip_network(f"{data.network_address.strip()}/{data.prefix_length}", strict=False)
    except ValueError as error:
        raise HTTPException(status_code=422, detail="Ingresa una red IPv4 válida.") from error
    if value.version != 4:
        raise HTTPException(status_code=422, detail="Solo se admiten redes IPv4.")
    return value


async def _router(db: AsyncSession, router_id: str) -> Router:
    rtr = await get_or_404(db, Router, router_id, "MikroTik")
    if rtr.device_type != "mikrotik":
        raise HTTPException(status_code=422, detail="La red IPv4 debe vincularse a un MikroTik.")
    return rtr


async def _ensure_no_overlap(db: AsyncSession, value: ipaddress.IPv4Network, router_id: str, exclude_id: str = ""):
    rows = (await db.execute(select(IPv4Network).where(IPv4Network.router_id == router_id))).scalars().all()
    for row in rows:
        if row.id == exclude_id:
            continue
        if value.overlaps(ipaddress.ip_network(row.cidr)):
            raise HTTPException(status_code=422, detail=f"La red se superpone con '{row.name}' ({row.cidr}) en este MikroTik.")


async def _public_rows(db: AsyncSession):
    counts = dict((await db.execute(
        select(Client.ipv4_network_id, func.count(Client.id)).where(Client.ipv4_network_id != "").group_by(Client.ipv4_network_id)
    )).all())
    rows = (await db.execute(select(IPv4Network).order_by(IPv4Network.router_name, IPv4Network.network_address))).scalars().all()
    result = []
    for row in rows:
        network = ipaddress.ip_network(row.cidr)
        used = counts.get(row.id, 0)
        hosts = max(network.num_addresses - 2, 0)
        result.append({**row.to_dict(), "usable_hosts": hosts, "used_ips": used,
                       "usage_percent": round((used / hosts * 100) if hosts else 0, 1)})
    return result


@router.get("")
async def list_ipv4_networks(db: AsyncSession = Depends(get_db)):
    return await _public_rows(db)


@router.post("")
async def create_ipv4_network(data: IPv4NetworkIn, db: AsyncSession = Depends(get_db)):
    value = _network(data)
    rtr = await _router(db, data.router_id)
    await _ensure_no_overlap(db, value, rtr.id)
    row = IPv4Network(name=data.name.strip(), cidr=str(value), network_address=str(value.network_address),
                      prefix_length=value.prefixlen, router_id=rtr.id, router_name=rtr.name,
                      usage_type=data.usage_type)
    db.add(row)
    await db.commit()
    return {**row.to_dict(), "usable_hosts": max(value.num_addresses - 2, 0), "used_ips": 0, "usage_percent": 0}


@router.put("/{network_id}")
async def update_ipv4_network(network_id: str, data: IPv4NetworkIn, db: AsyncSession = Depends(get_db)):
    row = await get_or_404(db, IPv4Network, network_id, "Red IPv4")
    assigned = await db.scalar(select(func.count(Client.id)).where(Client.ipv4_network_id == row.id))
    value = _network(data)
    rtr = await _router(db, data.router_id)
    await _ensure_no_overlap(db, value, rtr.id, row.id)
    if assigned and (row.cidr != str(value) or row.router_id != rtr.id):
        raise HTTPException(status_code=409, detail="No puedes cambiar la red o MikroTik mientras tenga clientes asignados.")
    row.name, row.cidr = data.name.strip(), str(value)
    row.network_address, row.prefix_length = str(value.network_address), value.prefixlen
    row.router_id, row.router_name, row.usage_type = rtr.id, rtr.name, data.usage_type
    await db.commit()
    return {**row.to_dict(), "usable_hosts": max(value.num_addresses - 2, 0), "used_ips": assigned or 0,
            "usage_percent": round(((assigned or 0) / max(value.num_addresses - 2, 1)) * 100, 1)}


@router.delete("/{network_id}")
async def delete_ipv4_network(network_id: str, db: AsyncSession = Depends(get_db)):
    row = await get_or_404(db, IPv4Network, network_id, "Red IPv4")
    assigned = await db.scalar(select(func.count(Client.id)).where(Client.ipv4_network_id == row.id))
    if assigned:
        raise HTTPException(status_code=409, detail=f"No puedes eliminar la red: tiene {assigned} cliente(s) asignado(s).")
    await db.delete(row)
    await db.commit()
    return {"message": "Red IPv4 eliminada"}
