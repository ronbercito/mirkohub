"""
Archivo: backend/app/routers/hotspot/router.py
Función: Fichas Hotspot prepago (/api/hotspot): listar, generar lote de pines y, si se
         indica un router MikroTik, crear cada ficha como usuario Hotspot real
         (/ip/hotspot/user con limit-uptime); marcar ficha vendida y eliminar.
Trabaja con: backend/app/models/hotspot.py, backend/app/models/router.py,
             backend/app/integrations/mikrotik/client.py, frontend/src/modules/hotspot/Hotspot.jsx
"""
import random

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, now_iso
from app.core.security import get_current_user
from app.core.utils import get_or_404
from app.integrations.mikrotik import service as mt
from app.integrations.mikrotik.client import MikroTikError
from app.models.hotspot import HotspotVoucher
from app.models.router import Router

router = APIRouter(prefix="/hotspot", tags=["Hotspot"], dependencies=[Depends(get_current_user)])


class BatchIn(BaseModel):
    profile_name: str
    duration_hours: int
    price: float
    download_mbps: int = 10
    upload_mbps: int = 5
    quantity: int = 10
    comment: str = ""
    router_id: str = ""
    hotspot_profile: str = "default"


@router.get("/vouchers")
async def list_vouchers(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(HotspotVoucher).order_by(HotspotVoucher.created_at.desc()))).scalars().all()
    return [v.to_dict() for v in rows]


@router.post("/generate-batch")
async def generate_batch(batch: BatchIn, db: AsyncSession = Depends(get_db)):
    rtr = await db.get(Router, batch.router_id) if batch.router_id else None
    vouchers = [HotspotVoucher(pin_code=f"{random.randint(1000, 9999)}-{random.randint(1000, 9999)}",
                               profile_name=batch.profile_name, duration_hours=batch.duration_hours, price=batch.price,
                               download_mbps=batch.download_mbps, upload_mbps=batch.upload_mbps, comment=batch.comment,
                               router_id=batch.router_id) for _ in range(max(1, min(batch.quantity, 500)))]
    db.add_all(vouchers)

    mikrotik = {"ok": False, "message": "Fichas generadas solo en el panel (sin router seleccionado)."}
    if rtr:
        try:
            async with mt.connect(rtr) as client:
                for v in vouchers:
                    await client.add_hotspot_user(v.pin_code, v.pin_code, f"{v.duration_hours}h",
                                                 comment=f"{v.profile_name} | {v.comment}", profile=batch.hotspot_profile)
                    v.synced_to_router = True
            mikrotik = {"ok": True, "message": f"{len(vouchers)} usuarios Hotspot creados en {rtr.name}"}
        except MikroTikError as e:
            mikrotik = {"ok": False, "message": f"Fichas guardadas, pero MikroTik no respondió: {e}"}
    await db.commit()
    return {"message": f"Se generaron {len(vouchers)} fichas de {batch.profile_name}", "vouchers": [v.to_dict() for v in vouchers], "mikrotik": mikrotik}


@router.post("/vouchers/{voucher_id}/mark-sold")
async def mark_sold(voucher_id: str, db: AsyncSession = Depends(get_db)):
    v = await get_or_404(db, HotspotVoucher, voucher_id, "Ficha")
    v.status, v.sold_at = "sold", now_iso()
    await db.commit()
    return {"message": "Ficha marcada como vendida"}


@router.delete("/vouchers/{voucher_id}")
async def delete_voucher(voucher_id: str, db: AsyncSession = Depends(get_db)):
    v = await get_or_404(db, HotspotVoucher, voucher_id, "Ficha")
    await db.delete(v)
    await db.commit()
    return {"message": "Ficha eliminada"}
