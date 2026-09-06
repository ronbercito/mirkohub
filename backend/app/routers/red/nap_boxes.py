"""
Archivo: backend/app/routers/red/nap_boxes.py
Función: API de Cajas NAP (/api/nap-boxes): administra el inventario físico y muestra
         ocupación por puerto usando los clientes vinculados.
Alcance: no ejecuta comandos en OLT o MikroTik.
Trabaja con: models/nap_box.py, models/client.py, frontend/modules/red/NapBoxes.jsx.
"""
from hashlib import sha256

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import get_or_404
from app.models.client import Client
from app.models.nap_box import NapBox
from app.models.zone import Zone

router = APIRouter(prefix="/nap-boxes", tags=["Red / Cajas NAP"], dependencies=[Depends(get_current_user)])


class NapBoxIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    location: str = ""
    latitude: float | None = None
    longitude: float | None = None
    ports: int = Field(ge=1, le=128)
    details: str = ""
    zone_id: str = Field(min_length=1)


async def _rows(db: AsyncSession):
    boxes = (await db.execute(select(NapBox))).scalars().all()
    boxes.sort(key=lambda box: ((box.zone_name or "").casefold(), (box.display_name or box.name).casefold()))
    client_rows = (await db.execute(
        select(Client.nap_box_id, Client.nap_port, Client.id, Client.full_name)
        .where(Client.nap_box_id != "")
    )).all()
    assigned = {}
    for box_id, port, client_id, name in client_rows:
        assigned.setdefault(box_id, {})[port] = {"client_id": client_id, "client_name": name}
    return [{**box.to_dict(), "name": box.display_name or box.name, "assigned_ports": assigned.get(box.id, {}),
             "used_ports": len(assigned.get(box.id, {}))} for box in boxes]


@router.get("")
async def list_nap_boxes(db: AsyncSession = Depends(get_db)):
    return await _rows(db)


@router.post("")
async def create_nap_box(data: NapBoxIn, db: AsyncSession = Depends(get_db)):
    zone = await db.get(Zone, data.zone_id)
    if not zone:
        raise HTTPException(status_code=422, detail="La zona seleccionada ya no existe.")
    display_name = data.name.strip()
    internal_name = sha256(f"{zone.id}:{display_name.lower()}".encode()).hexdigest()
    exists = await db.scalar(select(NapBox.id).where(NapBox.zone_id == zone.id, func.lower(func.coalesce(func.nullif(NapBox.display_name, ""), NapBox.name)) == display_name.lower()))
    if exists:
        raise HTTPException(status_code=422, detail="Ya existe una caja NAP con ese nombre en esta zona.")
    box = NapBox(**{**data.model_dump(), "name": internal_name, "display_name": display_name, "zone_name": zone.name})
    db.add(box)
    await db.commit()
    return {**box.to_dict(), "name": box.display_name or box.name, "assigned_ports": {}, "used_ports": 0}


@router.put("/{box_id}")
async def update_nap_box(box_id: str, data: NapBoxIn, db: AsyncSession = Depends(get_db)):
    box = await get_or_404(db, NapBox, box_id, "Caja NAP")
    used = await db.scalar(select(func.count(Client.id)).where(Client.nap_box_id == box.id))
    if used and data.ports < used:
        raise HTTPException(status_code=422, detail=f"No puedes reducir los puertos: hay {used} cliente(s) asignado(s).")
    zone = await db.get(Zone, data.zone_id)
    if not zone:
        raise HTTPException(status_code=422, detail="La zona seleccionada ya no existe.")
    display_name = data.name.strip()
    internal_name = f"{zone.id}:{display_name}".lower()
    exists = await db.scalar(select(NapBox.id).where(NapBox.zone_id == zone.id, func.lower(NapBox.display_name) == display_name.lower(), NapBox.id != box.id))
    if exists:
        raise HTTPException(status_code=422, detail="Ya existe una caja NAP con ese nombre en esta zona.")
    box.name, box.display_name, box.location = internal_name, display_name, data.location.strip()
    box.zone_id, box.zone_name = zone.id, zone.name
    box.latitude, box.longitude = data.latitude, data.longitude
    box.ports, box.details = data.ports, data.details.strip()
    await db.commit()
    return {**box.to_dict(), "name": box.display_name or box.name, "used_ports": used, "assigned_ports": {}}


@router.delete("/{box_id}")
async def delete_nap_box(box_id: str, db: AsyncSession = Depends(get_db)):
    box = await get_or_404(db, NapBox, box_id, "Caja NAP")
    used = await db.scalar(select(func.count(Client.id)).where(Client.nap_box_id == box.id))
    if used:
        raise HTTPException(status_code=409, detail=f"No puedes eliminar la NAP: tiene {used} cliente(s) asignado(s).")
    await db.delete(box)
    await db.commit()
    return {"message": "Caja NAP eliminada"}
