"""
Archivo: backend/app/models/monitoring_equipment.py
Función: Inventario de equipos/nodos inalámbricos que pueden asignarse a abonados.
Trabaja con: routers/red/monitoring.py, models/client.py.
"""
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base, new_id, now_iso

class MonitoringEquipment(Base):
    __tablename__ = "monitoring_equipment"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    ip_address: Mapped[str] = mapped_column(String(60), default="")
    equipment_type: Mapped[str] = mapped_column(String(80), default="")
    location: Mapped[str] = mapped_column(String(160), default="")
    details: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
