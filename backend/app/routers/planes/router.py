"""
Archivo: backend/app/routers/planes/router.py
Función: CRUD de planes de internet (/api/plans) y sincronización de un plan como
         PPP Profile (rate-limit) hacia un MikroTik: POST /api/plans/{id}/sync/{router_id}.
Trabaja con: backend/app/models/plan.py, backend/app/models/router.py,
             backend/app/integrations/mikrotik/service.py, frontend/src/modules/planes/Plans.jsx
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import apply_updates, get_or_404
from app.integrations.mikrotik import service as mt
from app.models.plan import Plan
from app.models.router import Router

router = APIRouter(prefix="/plans", tags=["Planes"], dependencies=[Depends(get_current_user)])


class PlanIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    download_speed_mbps: int
    upload_speed_mbps: int
    price: float
    type: str = "Fibra Óptica"
    description: str = ""
    burst_limit: str = ""
    priority: int = 8
    is_active: bool = True
    mikrotik_profile: str = ""


@router.get("")
async def list_plans(db: AsyncSession = Depends(get_db)):
    plans = (await db.execute(select(Plan).order_by(Plan.price))).scalars().all()
    return [{**p.to_dict(), "rate_limit": mt.plan_rate_limit(p), "profile_name": mt.plan_profile_name(p)} for p in plans]


@router.post("")
async def create_plan(data: PlanIn, db: AsyncSession = Depends(get_db)):
    p = Plan(**data.model_dump())
    db.add(p)
    await db.commit()
    return p.to_dict()


@router.put("/{plan_id}")
async def update_plan(plan_id: str, data: PlanIn, db: AsyncSession = Depends(get_db)):
    p = await get_or_404(db, Plan, plan_id, "Plan")
    apply_updates(p, data.model_dump())
    await db.commit()
    return p.to_dict()


@router.delete("/{plan_id}")
async def delete_plan(plan_id: str, db: AsyncSession = Depends(get_db)):
    p = await get_or_404(db, Plan, plan_id, "Plan")
    await db.delete(p)
    await db.commit()
    return {"message": "Plan eliminado"}


@router.post("/{plan_id}/sync/{router_id}")
async def sync_plan(plan_id: str, router_id: str, db: AsyncSession = Depends(get_db)):
    p = await get_or_404(db, Plan, plan_id, "Plan")
    r = await get_or_404(db, Router, router_id, "Router")
    return await mt.sync_plans(r, [p])
