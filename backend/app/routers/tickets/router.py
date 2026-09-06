"""
Archivo: backend/app/routers/tickets/router.py
Función: CRUD de tickets de soporte técnico (/api/tickets): listar por estado, crear
         (autocompleta datos del cliente y genera correlativo TCK-), editar (marca fecha
         de resolución) y eliminar.
Trabaja con: backend/app/models/ticket.py, backend/app/models/client.py,
             frontend/src/modules/tickets/Tickets.jsx
"""
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, now_iso
from app.core.security import get_current_user
from app.core.utils import apply_updates, correlative, get_or_404
from app.models.client import Client
from app.models.ticket import Ticket

router = APIRouter(prefix="/tickets", tags=["Tickets"], dependencies=[Depends(get_current_user)])


class TicketIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    client_id: str
    category: str
    subject: str
    description: str = ""
    priority: str = "media"
    status: str = "open"
    assigned_to: str = ""
    resolution_notes: str = ""


@router.get("")
async def list_tickets(status: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    q = select(Ticket)
    if status and status != "all":
        q = q.where(Ticket.status == status)
    rows = (await db.execute(q.order_by(Ticket.created_at.desc()))).scalars().all()
    return [t.to_dict() for t in rows]


@router.post("")
async def create_ticket(data: TicketIn, db: AsyncSession = Depends(get_db)):
    c = await get_or_404(db, Client, data.client_id, "Cliente")
    t = Ticket(**data.model_dump(), ticket_number=correlative("TCK"), client_name=c.full_name,
               client_phone=c.phone, client_address=c.address)
    db.add(t)
    await db.commit()
    return t.to_dict()


@router.put("/{ticket_id}")
async def update_ticket(ticket_id: str, data: TicketIn, db: AsyncSession = Depends(get_db)):
    t = await get_or_404(db, Ticket, ticket_id, "Ticket")
    apply_updates(t, data.model_dump())
    if t.status in ("resolved", "closed") and not t.resolved_at:
        t.resolved_at = now_iso()
    await db.commit()
    return t.to_dict()


@router.delete("/{ticket_id}")
async def delete_ticket(ticket_id: str, db: AsyncSession = Depends(get_db)):
    t = await get_or_404(db, Ticket, ticket_id, "Ticket")
    await db.delete(t)
    await db.commit()
    return {"message": "Ticket eliminado"}
