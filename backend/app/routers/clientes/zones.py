"""
Archivo: backend/app/routers/clientes/zones.py
Función: CRUD de zonas para clasificar abonados.
Trabaja con: models/zone.py, frontend/modules/clientes/zonas/Zones.jsx.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import get_or_404
from app.models.zone import Zone

router = APIRouter(prefix="/zones", tags=["Clientes / Zonas"], dependencies=[Depends(get_current_user)])

class ZoneIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    description: str = ""

@router.get("")
async def list_zones(db: AsyncSession = Depends(get_db)):
    return [row.to_dict() for row in (await db.execute(select(Zone).order_by(Zone.name))).scalars().all()]

@router.post("")
async def create_zone(data: ZoneIn, db: AsyncSession = Depends(get_db)):
    if await db.scalar(select(Zone.id).where(func.lower(Zone.name) == data.name.strip().lower())):
        raise HTTPException(status_code=422, detail="Ya existe una zona con ese nombre.")
    row = Zone(name=data.name.strip(), description=data.description.strip())
    db.add(row); await db.commit()
    return row.to_dict()

@router.put("/{zone_id}")
async def update_zone(zone_id: str, data: ZoneIn, db: AsyncSession = Depends(get_db)):
    row = await get_or_404(db, Zone, zone_id, "Zona")
    row.name, row.description = data.name.strip(), data.description.strip()
    await db.commit()
    return row.to_dict()

@router.delete("/{zone_id}")
async def delete_zone(zone_id: str, db: AsyncSession = Depends(get_db)):
    row = await get_or_404(db, Zone, zone_id, "Zona")
    await db.delete(row); await db.commit()
    return {"message": "Zona eliminada"}
