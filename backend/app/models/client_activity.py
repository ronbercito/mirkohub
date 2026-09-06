"""
Archivo: backend/app/models/client_activity.py
Función: Historial persistente de acciones realizadas sobre cada cliente.
Trabaja con: routers/clientes/router.py, frontend/modules/clientes/ClientDetail.jsx.
"""
from sqlalchemy import String, Text
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base, new_id, now_iso

class ClientActivity(Base):
    __tablename__ = "client_activities"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    client_id: Mapped[str] = mapped_column(String(36), index=True)
    action: Mapped[str] = mapped_column(String(80))
    detail: Mapped[str] = mapped_column(Text, default="")
    operator_name: Mapped[str] = mapped_column(String(120), default="Sistema")
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
