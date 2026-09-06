"""
Archivo: backend/app/models/user.py
Función: Tabla `users` — usuarios del panel (admin, tecnico, cobrador) con su
         contraseña cifrada (bcrypt) y rol para el control de acceso.
Trabaja con: backend/app/core/security.py, backend/app/routers/auth/router.py,
             backend/app/core/seed.py
"""
from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id, now_iso


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    email: Mapped[str] = mapped_column(String(190), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(150))
    role: Mapped[str] = mapped_column(String(30), default="admin")
    phone: Mapped[str] = mapped_column(String(30), default="")
    created_at: Mapped[str] = mapped_column(String(40), default=now_iso)
