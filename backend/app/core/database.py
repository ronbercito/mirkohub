"""
Archivo: backend/app/core/database.py
Función: Motor de base de datos SQL (MariaDB/MySQL vía SQLAlchemy async + aiomysql).
         Define la clase Base para todos los modelos, la sesión por petición (get_db)
         y la creación automática de tablas al arrancar (init_db).
         Si MariaDB no responde el arranque falla (en producción); solo con DB_FALLBACK_SQLITE=true
         usa SQLite local (backend/data/) como respaldo de desarrollo.
Trabaja con: backend/app/core/config.py, backend/app/models/*.py, backend/server.py
"""
import logging
import os
import uuid
from datetime import datetime, timezone

from sqlalchemy import inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import DATABASE_URL

logger = logging.getLogger("fibraz.database")


class Base(DeclarativeBase):
    def to_dict(self, exclude: tuple = ()) -> dict:
        return {
            c.key: getattr(self, c.key)
            for c in inspect(self).mapper.column_attrs
            if c.key not in exclude
        }


def new_id() -> str:
    return str(uuid.uuid4())


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


engine = create_async_engine(DATABASE_URL, pool_pre_ping=True, pool_recycle=3600)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db():
    async with SessionLocal() as session:
        yield session


async def init_db():
    global engine, SessionLocal
    from app import models  # noqa: F401  (registra todas las tablas)

    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.run_sync(_add_missing_columns)
            await conn.run_sync(_add_missing_columns)
        logger.info("Base de datos conectada: %s", DATABASE_URL.split("@")[-1])
    except Exception as e:
        if os.environ.get("DB_FALLBACK_SQLITE", "false").lower() != "true":
            logger.error("No se pudo conectar a la base de datos: %s", e)
            raise
        os.makedirs("data", exist_ok=True)
        logger.error("No se pudo conectar a MariaDB (%s). Usando SQLite local de respaldo (solo desarrollo).", e)
        engine = create_async_engine("sqlite+aiosqlite:///./data/fibraz_local.db")
        SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.run_sync(_add_missing_columns)


def _add_missing_columns(conn):
    """Migración ligera: agrega columnas nuevas de los modelos a tablas ya existentes."""
    insp = inspect(conn)
    for table in Base.metadata.sorted_tables:
        existing = {c["name"] for c in insp.get_columns(table.name)}
        for col in table.columns:
            if col.name not in existing:
                ddl = col.type.compile(conn.dialect)
                default = col.default.arg if col.default is not None and not callable(col.default.arg) else None
                default_sql = "" if default is None else f" DEFAULT {repr(default) if isinstance(default, str) else int(default) if isinstance(default, bool) else default}"
                conn.execute(text(f"ALTER TABLE {table.name} ADD COLUMN {col.name} {ddl}{default_sql}"))
                logger.info("Columna agregada: %s.%s", table.name, col.name)
