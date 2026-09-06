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
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.setting import DEFAULT_SETTINGS, Setting

router = APIRouter(prefix="/settings", tags=["Ajustes"], dependencies=[Depends(get_current_user)])
public_router = APIRouter(prefix="/settings", tags=["Ajustes públicos"])


class SystemNotificationsIn(BaseModel):
    system_alert_emails: list[str] = Field(default_factory=list)
    system_alert_phones: list[str] = Field(default_factory=list)
    payment_report_emails: list[str] = Field(default_factory=list)


def _recipients(values: list[str]) -> list[str]:
    """Normaliza destinatarios, elimina vacíos y evita duplicados."""
    result: list[str] = []
    for value in values:
        item = str(value).strip()
        if item and item not in result:
            result.append(item)
    return result


async def _get(db: AsyncSession) -> Setting:
    s = await db.get(Setting, "system_config")
    if not s:
        s = Setting(id="system_config", data=dict(DEFAULT_SETTINGS))
        db.add(s)
        await db.commit()
    return s


@public_router.get("/public")
async def get_public_branding(db: AsyncSession = Depends(get_db)):
    """Datos visuales necesarios antes de iniciar sesión; no expone datos fiscales."""
    s = await _get(db)
    data = {**DEFAULT_SETTINGS, **(s.data or {})}
    return {
        "company_name": (data.get("company_name") or "MikroHub").strip() or "MikroHub",
        "logo_data": data.get("logo_data") or "",
    }


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


@router.get("/system-notifications")
async def get_system_notifications(db: AsyncSession = Depends(get_db)):
    """Destinatarios usados por alertas de equipos y reportes de pago."""
    s = await _get(db)
    data = {**DEFAULT_SETTINGS, **(s.data or {})}
    return {
        "system_alert_emails": _recipients(data.get("system_alert_emails") or []),
        "system_alert_phones": _recipients(data.get("system_alert_phones") or []),
        "payment_report_emails": _recipients(data.get("payment_report_emails") or []),
    }


@router.put("/system-notifications")
async def update_system_notifications(data: SystemNotificationsIn, db: AsyncSession = Depends(get_db)):
    """Actualiza únicamente los destinatarios de notificaciones operativas."""
    s = await _get(db)
    s.data = {
        **(s.data or {}),
        "system_alert_emails": _recipients(data.system_alert_emails),
        "system_alert_phones": _recipients(data.system_alert_phones),
        "payment_report_emails": _recipients(data.payment_report_emails),
    }
    await db.commit()
    return await get_system_notifications(db)
