"""
Archivo: backend/app/models/ipv4_network.py
Función: Tabla `ipv4_networks` — inventario de subredes IPv4 del ISP, vinculadas
         a un MikroTik. Guarda únicamente la planificación; no crea direcciones,
         pools ni DHCP en RouterOS.
Trabaja con: backend/app/routers/red/ipv4_networks.py, models/client.py,
             frontend/src/modules/red/IPv4Networks.jsx.
"""
from sqlalchemy import Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id, now_iso


class IPv4Network(Base):
    __tablename__ = "ipv4_networks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    cidr: Mapped[str] = mapped_column(String(43), index=True)
    network_address: Mapped[str] = mapped_column(String(45), index=True)
    prefix_length: Mapped[int] = mapped_column(Integer)
    router_id: Mapped[str] = mapped_column(String(36), index=True)
    router_name: Mapped[str] = mapped_column(String(120), default="")
    usage_type: Mapped[str] = mapped_column(String(30), default="static")  # static | dhcp | pppoe_pool
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
