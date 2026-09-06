"""
Archivo: backend/app/routers/almacen/router.py
Función: CRUD del almacén / inventario (/api/inventory): equipos y materiales con stock,
         costo unitario, serie/MAC y ubicación. Genera código INV- si no se indica.
Trabaja con: backend/app/models/inventory.py, frontend/src/modules/almacen/Inventory.jsx
"""
from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import apply_updates, correlative, get_or_404
from app.models.inventory import InventoryItem

router = APIRouter(prefix="/inventory", tags=["Almacén"], dependencies=[Depends(get_current_user)])


class ItemIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    item_code: str = ""
    name: str
    category: str
    brand_model: str = ""
    serial_number: str = ""
    mac_address: str = ""
    stock: int = 0
    unit: str = "Unidad"
    unit_cost: float = 0.0
    status: str = "in_stock"
    location: str = "Almacén Central"


@router.get("")
async def list_items(db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(InventoryItem).order_by(InventoryItem.name))).scalars().all()
    return [i.to_dict() for i in rows]


@router.post("")
async def create_item(data: ItemIn, db: AsyncSession = Depends(get_db)):
    item = InventoryItem(**data.model_dump())
    item.item_code = item.item_code or correlative("INV")
    db.add(item)
    await db.commit()
    return item.to_dict()


@router.put("/{item_id}")
async def update_item(item_id: str, data: ItemIn, db: AsyncSession = Depends(get_db)):
    item = await get_or_404(db, InventoryItem, item_id, "Artículo")
    apply_updates(item, data.model_dump())
    await db.commit()
    return item.to_dict()


@router.delete("/{item_id}")
async def delete_item(item_id: str, db: AsyncSession = Depends(get_db)):
    item = await get_or_404(db, InventoryItem, item_id, "Artículo")
    await db.delete(item)
    await db.commit()
    return {"message": "Artículo de almacén eliminado"}
