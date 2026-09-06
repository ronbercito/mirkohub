"""
Archivo: backend/app/models/setting.py
Función: Tabla `settings` — configuración general del ISP en una sola fila
         (id = "system_config") guardada como JSON: razón social, RUC, teléfono,
         cuentas Yape/Plin/BCP, días de gracia, corte automático y lista de corte MikroTik.
Trabaja con: backend/app/routers/ajustes/router.py, backend/app/integrations/mikrotik/service.py
"""
from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

DEFAULT_SETTINGS = {
    "company_name": "",
    "logo_data": "",
    "ruc": "",
    "phone": "",
    "email": "",
    "address": "",
    "currency": "PEN",
    "currency_symbol": "S/.",
    "auto_cut_enabled": True,
    "grace_days": 3,
    "billing_day": 5,
    "yape_number": "",
    "plin_number": "",
    "bcp_account": "",
    "bbva_account": "",
    "mikrotik_cut_list": "morosos",
}


class Setting(Base):
    __tablename__ = "settings"

    id: Mapped[str] = mapped_column(String(40), primary_key=True, default="system_config")
    data: Mapped[dict] = mapped_column(JSON, default=dict)
