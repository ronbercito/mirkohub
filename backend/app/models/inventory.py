"""
Archivo: backend/app/models/inventory.py
Función: Tabla `inventory` — almacén de equipos y materiales del ISP (ONUs, routers
         WiFi, cable drop, splitters, conectores, herramientas) con stock y costo.
Trabaja con: backend/app/routers/almacen/router.py
"""
from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id


class InventoryItem(Base):
    __tablename__ = "inventory"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    item_code: Mapped[str] = mapped_column(String(40), index=True)
    name: Mapped[str] = mapped_column(String(150))
    category: Mapped[str] = mapped_column(String(60))
    brand_model: Mapped[str] = mapped_column(String(120), default="")
    serial_number: Mapped[str] = mapped_column(String(80), default="")
    mac_address: Mapped[str] = mapped_column(String(40), default="")
    stock: Mapped[int] = mapped_column(Integer, default=0)
    unit: Mapped[str] = mapped_column(String(20), default="Unidad")
    unit_cost: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(20), default="in_stock")
    location: Mapped[str] = mapped_column(String(120), default="Almacén Central")
