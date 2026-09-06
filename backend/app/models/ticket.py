"""
Archivo: backend/app/models/ticket.py
Función: Tabla `tickets` — tickets de soporte técnico (averías, lentitud, cambio de
         clave WiFi, facturación) con prioridad, estado, técnico asignado y resolución.
Trabaja con: backend/app/routers/tickets/router.py, backend/app/models/client.py,
             backend/app/routers/inicio/router.py (contador de tickets abiertos)
"""
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id, now_iso


class Ticket(Base):
    __tablename__ = "tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    ticket_number: Mapped[str] = mapped_column(String(40), index=True)
    client_id: Mapped[str] = mapped_column(String(36), index=True)
    client_name: Mapped[str] = mapped_column(String(150), default="")
    client_phone: Mapped[str] = mapped_column(String(30), default="")
    client_address: Mapped[str] = mapped_column(String(255), default="")
    category: Mapped[str] = mapped_column(String(60))
    priority: Mapped[str] = mapped_column(String(20), default="media")
    status: Mapped[str] = mapped_column(String(20), default="open")
    subject: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    assigned_to: Mapped[str] = mapped_column(String(150), default="")
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
    resolved_at: Mapped[str | None] = mapped_column(String(40), nullable=True)
    resolution_notes: Mapped[str] = mapped_column(Text, default="")
