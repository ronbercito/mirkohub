"""
Archivo: backend/app/models/hotspot.py
Función: Tabla `hotspot_vouchers` — fichas / pines prepago Hotspot generadas por lote,
         con perfil, duración, precio, estado (available, sold, used) y, si se eligió
         un router, el usuario Hotspot creado en el MikroTik (/ip/hotspot/user).
Trabaja con: backend/app/routers/hotspot/router.py, backend/app/integrations/mikrotik/service.py
"""
from sqlalchemy import Boolean, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id, now_iso


class HotspotVoucher(Base):
    __tablename__ = "hotspot_vouchers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    pin_code: Mapped[str] = mapped_column(String(20), index=True)
    profile_name: Mapped[str] = mapped_column(String(80))
    duration_hours: Mapped[int] = mapped_column(Integer)
    price: Mapped[float] = mapped_column(Float)
    download_mbps: Mapped[int] = mapped_column(Integer, default=10)
    upload_mbps: Mapped[int] = mapped_column(Integer, default=5)
    status: Mapped[str] = mapped_column(String(20), default="available")
    comment: Mapped[str] = mapped_column(String(150), default="")
    router_id: Mapped[str] = mapped_column(String(36), default="")
    synced_to_router: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    sold_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    first_used_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
