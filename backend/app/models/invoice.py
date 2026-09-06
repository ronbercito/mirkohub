"""
Archivo: backend/app/models/invoice.py
Función: Tabla `invoices` — facturas / recibos mensuales de cada abonado con su
         estado (unpaid, paid, overdue, canceled) y los datos del pago registrado
         (método Yape/Plin/BCP/Efectivo, referencia, operador).
Trabaja con: backend/app/routers/facturacion/router.py, backend/app/models/client.py,
             backend/app/routers/inicio/router.py (KPIs del dashboard)
"""
from sqlalchemy import Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    invoice_number: Mapped[str] = mapped_column(String(40), index=True)
    client_id: Mapped[str] = mapped_column(String(36), index=True)
    client_name: Mapped[str] = mapped_column(String(150), default="")
    client_dni_ruc: Mapped[str] = mapped_column(String(20), default="")
    client_address: Mapped[str] = mapped_column(String(255), default="")
    client_phone: Mapped[str] = mapped_column(String(30), default="")
    plan_name: Mapped[str] = mapped_column(String(120), default="")
    amount: Mapped[float] = mapped_column(Float)
    month_period: Mapped[str] = mapped_column(String(40))
    issue_date: Mapped[str] = mapped_column(String(20))
    due_date: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="unpaid")
    payment_method: Mapped[str | None] = mapped_column(String(60), nullable=True)
    payment_date: Mapped[str | None] = mapped_column(String(40), nullable=True)
    paid_amount: Mapped[float] = mapped_column(Float, default=0.0)
    operator_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    operation_reference: Mapped[str | None] = mapped_column(String(80), nullable=True)
    notes: Mapped[str] = mapped_column(Text, default="")
