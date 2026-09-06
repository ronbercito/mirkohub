"""
Archivo: backend/app/models/client.py
Función: Tabla `clients` — abonados del ISP: datos personales (DNI/RUC, teléfono,
         dirección), datos técnicos (IP, MAC, ONU, NAP, potencia óptica), tipo de
         conexión (PPPoE / IP Estática / DHCP), plan y router asignado, estado de
         servicio y deuda acumulada.
Trabaja con: backend/app/routers/clientes/router.py, backend/app/models/plan.py,
             backend/app/models/router.py, backend/app/models/invoice.py,
             backend/app/integrations/mikrotik/service.py (corte / reactivación)
"""
from sqlalchemy import Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id, now_iso


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    full_name: Mapped[str] = mapped_column(String(150), index=True)
    dni_ruc: Mapped[str] = mapped_column(String(20), index=True)
    phone: Mapped[str] = mapped_column(String(30), default="")
    email: Mapped[str] = mapped_column(String(190), default="")
    address: Mapped[str] = mapped_column(String(255), default="")
    reference: Mapped[str] = mapped_column(String(255), default="")
    latitude: Mapped[float] = mapped_column(Float, default=0.0)
    longitude: Mapped[float] = mapped_column(Float, default=0.0)

    ip_address: Mapped[str] = mapped_column(String(60), default="", index=True)
    mac_address: Mapped[str] = mapped_column(String(40), default="")
    onu_sn: Mapped[str] = mapped_column(String(60), default="")
    connection_type: Mapped[str] = mapped_column(String(30), default="PPPoE")  # PPPoE | IP Estática | DHCP
    pppoe_user: Mapped[str] = mapped_column(String(80), default="")
    pppoe_password: Mapped[str] = mapped_column(String(80), default="")

    plan_id: Mapped[str] = mapped_column(String(36), default="")
    plan_name: Mapped[str] = mapped_column(String(120), default="")
    plan_price: Mapped[float] = mapped_column(Float, default=0.0)
    router_id: Mapped[str] = mapped_column(String(36), default="")
    router_name: Mapped[str] = mapped_column(String(120), default="")
    ipv4_network_id: Mapped[str] = mapped_column(String(36), default="", index=True)
    nap_box: Mapped[str] = mapped_column(String(80), default="")
    optical_power_dbm: Mapped[float | None] = mapped_column(Float, nullable=True)

    status: Mapped[str] = mapped_column(String(30), default="active")  # active | suspended | canceled | pending_install
    billing_day: Mapped[int] = mapped_column(Integer, default=5)
    unpaid_invoices_count: Mapped[int] = mapped_column(Integer, default=0)
    balance_due: Mapped[float] = mapped_column(Float, default=0.0)
    is_online: Mapped[bool] = mapped_column(Boolean, default=False)
    last_connection_time: Mapped[str] = mapped_column(String(40), default="")
    mikrotik_status: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
