"""
Archivo: backend/app/core/seed.py
Función: Datos iniciales mínimos al arrancar: crea (o actualiza la clave de) el usuario
         administrador definido en .env y la fila de configuración por defecto.
         No inserta clientes, planes ni routers de ejemplo: el sistema inicia vacío.
Trabaja con: backend/server.py (startup), backend/app/models/user.py,
             backend/app/models/setting.py, backend/app/core/security.py
"""
import logging

from sqlalchemy import select

from app.core.config import ADMIN_EMAIL, ADMIN_PASSWORD
from app.core.database import SessionLocal
from app.core.security import hash_password, verify_password
from app.models.setting import DEFAULT_SETTINGS, Setting
from app.models.user import User

logger = logging.getLogger("fibraz.seed")


async def seed_initial_data():
    async with SessionLocal() as db:
        admin = (await db.execute(select(User).where(User.email == ADMIN_EMAIL.lower()))).scalar_one_or_none()
        if not admin:
            db.add(User(email=ADMIN_EMAIL.lower(), password_hash=hash_password(ADMIN_PASSWORD),
                        name="Administrador Principal", role="admin"))
            logger.info("Usuario administrador creado: %s", ADMIN_EMAIL)
        elif not verify_password(ADMIN_PASSWORD, admin.password_hash):
            admin.password_hash = hash_password(ADMIN_PASSWORD)
            logger.info("Contraseña del administrador actualizada desde .env")

        if not await db.get(Setting, "system_config"):
            db.add(Setting(id="system_config", data=dict(DEFAULT_SETTINGS)))
        await db.commit()
