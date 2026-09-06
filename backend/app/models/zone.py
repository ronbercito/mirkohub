"""
Archivo: backend/app/models/zone.py
Función: Catálogo de zonas comerciales/técnicas para la asignación de abonados.
Trabaja con: routers/clientes/zones.py, models/client.py.
"""
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base, new_id, now_iso

class Zone(Base):
    __tablename__ = "zones"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    description: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
