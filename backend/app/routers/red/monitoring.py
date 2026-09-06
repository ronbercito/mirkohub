"""
Archivo: backend/app/routers/red/monitoring.py
Función: Inventario y monitoreo de nodos inalámbricos. Ejecuta ping seguro sobre
         cada IP registrada y resume abonados online, activos y suspendidos.
Trabaja con: models/monitoring_equipment.py, models/client.py,
             frontend/modules/red/monitoring/Monitoring.jsx.
"""
import asyncio
import ipaddress
import time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, now_iso
from app.core.security import get_current_user
from app.core.utils import get_or_404
from app.models.client import Client
from app.models.monitoring_equipment import MonitoringEquipment

router = APIRouter(prefix="/monitoring-equipment", tags=["Red / Monitoreo"], dependencies=[Depends(get_current_user)])


class EquipmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    ip_address: str = ""
    equipment_type: str = ""
    manufacturer: str = ""
    model_name: str = ""
    location: str = ""
    details: str = ""


def _stats(rows):
    data = {}
    for client in rows:
        if not client.monitoring_equipment_id:
            continue
        value = data.setdefault(client.monitoring_equipment_id, {
            "clients_total": 0, "clients_online": 0, "clients_active": 0, "clients_suspended": 0,
        })
        value["clients_total"] += 1
        if client.is_online:
            value["clients_online"] += 1
        if client.status == "active":
            value["clients_active"] += 1
        if client.status == "suspended":
            value["clients_suspended"] += 1
    return data


async def _rows_with_stats(db: AsyncSession):
    equipment = (await db.execute(select(MonitoringEquipment).order_by(MonitoringEquipment.name))).scalars().all()
    clients = (await db.execute(select(Client).where(Client.monitoring_equipment_id != ""))).scalars().all()
    stats = _stats(clients)
    empty = {"clients_total": 0, "clients_online": 0, "clients_active": 0, "clients_suspended": 0}
    return [{**row.to_dict(), **stats.get(row.id, empty)} for row in equipment]


async def _ping(row: MonitoringEquipment):
    """Ejecuta un único ping, sin interpolar comandos ni aceptar direcciones inválidas."""
    try:
        address = str(ipaddress.ip_address(row.ip_address.strip()))
    except ValueError:
        row.status, row.last_ping_at, row.last_latency_ms = "unknown", now_iso(), None
        return {"online": False, "message": "El equipo no tiene una dirección IP válida.", "latency_ms": None}

    started = time.perf_counter()
    try:
        process = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", "1", address,
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(process.communicate(), timeout=3)
        online = process.returncode == 0
    except (asyncio.TimeoutError, FileNotFoundError):
        online = False
    latency = round((time.perf_counter() - started) * 1000, 1) if online else None
    row.status = "online" if online else "offline"
    row.last_ping_at, row.last_latency_ms = now_iso(), latency
    return {
        "online": online,
        "message": "Equipo responde al ping." if online else "No responde al ping.",
        "latency_ms": latency,
    }


@router.get("")
async def list_equipment(db: AsyncSession = Depends(get_db)):
    return await _rows_with_stats(db)


@router.post("")
async def create_equipment(data: EquipmentIn, db: AsyncSession = Depends(get_db)):
    name = data.name.strip()
    if await db.scalar(select(MonitoringEquipment.id).where(func.lower(MonitoringEquipment.name) == name.lower())):
        raise HTTPException(status_code=422, detail="Ya existe un equipo con ese nombre.")
    values = {key: value.strip() if isinstance(value, str) else value for key, value in data.model_dump().items()}
    row = MonitoringEquipment(**{**values, "name": name})
    db.add(row)
    await db.commit()
    return row.to_dict()


@router.put("/{equipment_id}")
async def update_equipment(equipment_id: str, data: EquipmentIn, db: AsyncSession = Depends(get_db)):
    row = await get_or_404(db, MonitoringEquipment, equipment_id, "Equipo")
    for key, value in data.model_dump().items():
        setattr(row, key, value.strip() if isinstance(value, str) else value)
    await db.commit()
    return row.to_dict()


@router.post("/{equipment_id}/ping")
async def ping_equipment(equipment_id: str, db: AsyncSession = Depends(get_db)):
    row = await get_or_404(db, MonitoringEquipment, equipment_id, "Equipo")
    ping = await _ping(row)
    await db.commit()
    return {**row.to_dict(), "ping": ping}


@router.post("/ping-all")
async def ping_all_equipment(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(MonitoringEquipment))).scalars().all()
    await asyncio.gather(*[_ping(row) for row in rows])
    await db.commit()
    return await _rows_with_stats(db)


@router.delete("/{equipment_id}")
async def delete_equipment(equipment_id: str, db: AsyncSession = Depends(get_db)):
    row = await get_or_404(db, MonitoringEquipment, equipment_id, "Equipo")
    await db.delete(row)
    await db.commit()
    return {"message": "Equipo eliminado"}
