"""
Archivo: backend/app/models/plan.py
Función: Tabla `plans` — planes de internet (velocidad bajada/subida, precio en S/.,
         burst, prioridad). Cada plan se sincroniza como PPP Profile en MikroTik
         con rate-limit "subida/bajada".
Trabaja con: backend/app/routers/planes/router.py, backend/app/models/client.py,
             backend/app/integrations/mikrotik/service.py
"""
from sqlalchemy import Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id


class Plan(Base):
    __tablename__ = "plans"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    download_speed_mbps: Mapped[int] = mapped_column(Integer)
    upload_speed_mbps: Mapped[int] = mapped_column(Integer)
    price: Mapped[float] = mapped_column(Float)
    type: Mapped[str] = mapped_column(String(60), default="Fibra Óptica")
    description: Mapped[str] = mapped_column(Text, default="")
    burst_limit: Mapped[str] = mapped_column(String(60), default="")
    priority: Mapped[int] = mapped_column(Integer, default=8)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    mikrotik_profile: Mapped[str] = mapped_column(String(120), default="")
