"""
Archivo: backend/app/core/utils.py
Función: Utilidades compartidas por todas las rutas: obtener un registro o responder 404,
         aplicar cambios de un dict a un modelo, generar correlativos (REC-/TCK-),
         y nombre del mes en español para los periodos de facturación.
Trabaja con: backend/app/routers/*/router.py, backend/app/core/database.py
"""
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
         "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]


async def get_or_404(db: AsyncSession, model, obj_id: str, name: str = "Registro"):
    obj = await db.get(model, obj_id)
    if not obj:
        raise HTTPException(status_code=404, detail=f"{name} no encontrado")
    return obj


def apply_updates(obj, data: dict, skip: tuple = ("id",)):
    for key, value in data.items():
        if key not in skip and hasattr(obj, key):
            setattr(obj, key, value)
    return obj


def correlative(prefix: str) -> str:
    now = datetime.now(timezone.utc)
    return f"{prefix}-{now.year}{now.month:02d}-{str(uuid.uuid4())[:4].upper()}"


def current_period() -> str:
    now = datetime.now(timezone.utc)
    return f"{MESES[now.month - 1]} {now.year}"
