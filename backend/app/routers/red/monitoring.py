"""
Archivo: backend/app/routers/red/monitoring.py
Función: CRUD del inventario de equipos inalámbricos para Monitoreo.
Trabaja con: models/monitoring_equipment.py, frontend/modules/red/monitoring/Monitoring.jsx.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import get_or_404
from app.models.monitoring_equipment import MonitoringEquipment

router = APIRouter(prefix="/monitoring-equipment", tags=["Red / Monitoreo"], dependencies=[Depends(get_current_user)])

class EquipmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    ip_address: str = ""
    equipment_type: str = ""
    location: str = ""
    details: str = ""

@router.get("")
async def list_equipment(db: AsyncSession = Depends(get_db)):
    return [row.to_dict() for row in (await db.execute(select(MonitoringEquipment).order_by(MonitoringEquipment.name))).scalars().all()]

@router.post("")
async def create_equipment(data: EquipmentIn, db: AsyncSession = Depends(get_db)):
    if await db.scalar(select(MonitoringEquipment.id).where(func.lower(MonitoringEquipment.name) == data.name.strip().lower())):
        raise HTTPException(status_code=422, detail="Ya existe un equipo con ese nombre.")
    row = MonitoringEquipment(**{**data.model_dump(), "name": data.name.strip()})
    db.add(row); await db.commit()
    return row.to_dict()

@router.put("/{equipment_id}")
async def update_equipment(equipment_id: str, data: EquipmentIn, db: AsyncSession = Depends(get_db)):
    row = await get_or_404(db, MonitoringEquipment, equipment_id, "Equipo")
    for key, value in data.model_dump().items(): setattr(row, key, value.strip() if isinstance(value, str) else value)
    await db.commit()
    return row.to_dict()

@router.delete("/{equipment_id}")
async def delete_equipment(equipment_id: str, db: AsyncSession = Depends(get_db)):
    row = await get_or_404(db, MonitoringEquipment, equipment_id, "Equipo")
    await db.delete(row); await db.commit()
    return {"message": "Equipo eliminado"}
