"""
Archivo: backend/app/models/monitoring_equipment.py
Función: Inventario de equipos/nodos inalámbricos, su estado de ping y datos de
         identificación no sensibles para monitoreo.
Trabaja con: routers/red/monitoring.py, models/client.py.
"""
from sqlalchemy import Float, String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base, new_id, now_iso


class MonitoringEquipment(Base):
    __tablename__ = "monitoring_equipment"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    ip_address: Mapped[str] = mapped_column(String(60), default="")
    equipment_type: Mapped[str] = mapped_column(String(80), default="")
    manufacturer: Mapped[str] = mapped_column(String(80), default="")
    model_name: Mapped[str] = mapped_column(String(120), default="")
    location: Mapped[str] = mapped_column(String(160), default="")
    latitude: Mapped[float] = mapped_column(Float, default=0.0)
    longitude: Mapped[float] = mapped_column(Float, default=0.0)
    details: Mapped[str] = mapped_column(String(255), default="")
    status: Mapped[str] = mapped_column(String(20), default="unknown")
    last_ping_at: Mapped[str] = mapped_column(String(40), default="")
    last_latency_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
