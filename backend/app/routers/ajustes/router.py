"""
Archivo: backend/app/routers/ajustes/router.py
Función: Configuración general del ISP (/api/settings): lectura y actualización de razón
         social, RUC, contacto, cuentas de cobro (Yape/Plin/BCP/BBVA), días de gracia,
         corte automático y nombre de la address-list de morosos usada en MikroTik.
Trabaja con: backend/app/models/setting.py, frontend/src/modules/ajustes/Settings.jsx,
             backend/app/integrations/mikrotik/service.py (lista de corte)
"""
from typing import Any, Dict

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.setting import DEFAULT_SETTINGS, Setting

router = APIRouter(prefix="/settings", tags=["Ajustes"], dependencies=[Depends(get_current_user)])


async def _get(db: AsyncSession) -> Setting:
    s = await db.get(Setting, "system_config")
    if not s:
        s = Setting(id="system_config", data=dict(DEFAULT_SETTINGS))
        db.add(s)
        await db.commit()
    return s


@router.get("")
async def get_settings(db: AsyncSession = Depends(get_db)):
    s = await _get(db)
    return {"id": s.id, **DEFAULT_SETTINGS, **(s.data or {})}


@router.put("")
async def update_settings(data: Dict[str, Any], db: AsyncSession = Depends(get_db)):
    s = await _get(db)
    data.pop("id", None)
    s.data = {**(s.data or {}), **data}
    await db.commit()
    return {"id": s.id, **DEFAULT_SETTINGS, **s.data}
