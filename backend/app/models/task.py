"""
Archivo: backend/app/models/task.py
Función: Tabla `tasks` — órdenes de trabajo técnico en campo (instalaciones,
         mantenimiento óptico, reconexiones, retiros) con técnico, fecha y potencia óptica.
Trabaja con: backend/app/routers/tareas/router.py, backend/app/models/client.py
"""
from sqlalchemy import Float, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    title: Mapped[str] = mapped_column(String(200))
    task_type: Mapped[str] = mapped_column(String(60))
    client_id: Mapped[str] = mapped_column(String(36), default="")
    client_name: Mapped[str] = mapped_column(String(150), default="")
    address: Mapped[str] = mapped_column(String(255), default="")
    technician_name: Mapped[str] = mapped_column(String(150))
    scheduled_date: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(String(20), default="pending")
    notes: Mapped[str] = mapped_column(Text, default="")
    optical_power_dbm: Mapped[float | None] = mapped_column(Float, nullable=True)
