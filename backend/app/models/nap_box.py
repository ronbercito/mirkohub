"""
Archivo: backend/app/models/nap_box.py
Función: Tabla `nap_boxes` — cajas NAP de la red de fibra con ubicación, coordenadas,
         capacidad de puertos y detalle operativo.
Alcance: inventario físico y vínculo con clientes; no configura OLT ni MikroTik.
Trabaja con: routers/red/nap_boxes.py, models/client.py,
             frontend/modules/red/NapBoxes.jsx.
"""
from sqlalchemy import Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id, now_iso


class NapBox(Base):
    __tablename__ = "nap_boxes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    location: Mapped[str] = mapped_column(String(255), default="")
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    ports: Mapped[int] = mapped_column(Integer, default=8)
    details: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
