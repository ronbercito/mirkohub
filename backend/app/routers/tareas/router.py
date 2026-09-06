"""
Archivo: backend/app/routers/tareas/router.py
Función: CRUD de tareas técnicas de campo (/api/tasks): instalaciones, mantenimientos,
         reconexiones; con técnico asignado, fecha programada, estado y potencia óptica.
Trabaja con: backend/app/models/task.py, backend/app/models/client.py,
             frontend/src/modules/tareas/Tasks.jsx
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import apply_updates, get_or_404
from app.models.client import Client
from app.models.task import Task

router = APIRouter(prefix="/tasks", tags=["Tareas"], dependencies=[Depends(get_current_user)])


class TaskIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    title: str
    task_type: str
    client_id: str = ""
    client_name: str = ""
    address: str = ""
    technician_name: str
    scheduled_date: str
    status: str = "pending"
    notes: str = ""
    optical_power_dbm: Optional[float] = None


async def _fill_client(db: AsyncSession, t: Task):
    if t.client_id:
        c = await db.get(Client, t.client_id)
        if c:
            t.client_name = c.full_name
            t.address = t.address or c.address


@router.get("")
async def list_tasks(status: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    q = select(Task)
    if status and status != "all":
        q = q.where(Task.status == status)
    rows = (await db.execute(q.order_by(Task.scheduled_date))).scalars().all()
    return [t.to_dict() for t in rows]


@router.post("")
async def create_task(data: TaskIn, db: AsyncSession = Depends(get_db)):
    t = Task(**data.model_dump())
    await _fill_client(db, t)
    db.add(t)
    await db.commit()
    return t.to_dict()


@router.put("/{task_id}")
async def update_task(task_id: str, data: TaskIn, db: AsyncSession = Depends(get_db)):
    t = await get_or_404(db, Task, task_id, "Tarea")
    apply_updates(t, data.model_dump())
    await _fill_client(db, t)
    await db.commit()
    return t.to_dict()


@router.delete("/{task_id}")
async def delete_task(task_id: str, db: AsyncSession = Depends(get_db)):
    t = await get_or_404(db, Task, task_id, "Tarea")
    await db.delete(t)
    await db.commit()
    return {"message": "Tarea eliminada"}
