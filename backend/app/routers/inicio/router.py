"""
Archivo: backend/app/routers/inicio/router.py
Función: GET /api/dashboard/summary — indicadores del panel de inicio calculados con
         datos reales de la base de datos: clientes online/activos/suspendidos, cobros
         de hoy y del mes, facturas impagas/vencidas, tickets abiertos, estado de routers,
         recaudación de los últimos 7 días, tráfico agregado leído de los MikroTik
         (última sincronización) y últimos pagos / abonados conectados.
Trabaja con: backend/app/models/client.py, invoice.py, router.py, ticket.py, plan.py,
             frontend/src/modules/inicio/Dashboard.jsx
"""
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.client import Client
from app.models.invoice import Invoice
from app.models.plan import Plan
from app.models.router import Router
from app.models.ticket import Ticket

router = APIRouter(prefix="/dashboard", tags=["Inicio"], dependencies=[Depends(get_current_user)])


@router.get("/summary")
async def dashboard_summary(db: AsyncSession = Depends(get_db)):
    clients = (await db.execute(select(Client))).scalars().all()
    invoices = (await db.execute(select(Invoice))).scalars().all()
    routers = (await db.execute(select(Router))).scalars().all()
    tickets = (await db.execute(select(Ticket))).scalars().all()
    active_plans = (await db.execute(select(Plan).where(Plan.is_active == True))).scalars().all()  # noqa: E712

    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d")
    month = now.strftime("%Y-%m")

    active = [c for c in clients if c.status == "active"]
    suspended = [c for c in clients if c.status == "suspended"]
    online = [c for c in active if c.is_online]

    unpaid = [i for i in invoices if i.status in ("unpaid", "overdue")]
    paid = sorted([i for i in invoices if i.status == "paid"], key=lambda i: i.payment_date or "", reverse=True)

    today_collected = sum(i.paid_amount for i in paid if (i.payment_date or "").startswith(today))
    month_collected = sum(i.paid_amount for i in paid if (i.payment_date or "").startswith(month))

    last_7_days = []
    for d in range(6, -1, -1):
        day = now - timedelta(days=d)
        key = day.strftime("%Y-%m-%d")
        day_paid = [i for i in paid if (i.payment_date or "").startswith(key)]
        last_7_days.append({
            "date": day.strftime("%d/%m"),
            "collected_pen": round(sum(i.paid_amount for i in day_paid), 2),
            "payments": len(day_paid),
        })

    routers_online = [r for r in routers if r.status == "online"]
    live_down = round(sum(r.total_download_mbps for r in routers_online), 2)
    live_up = round(sum(r.total_upload_mbps for r in routers_online), 2)
    total_live = live_down + live_up

    return {
        "kpi": {
            "clients_online": len(online),
            "total_clients": len(clients),
            "active_clients": len(active),
            "suspended_clients": len(suspended),
            "today_collected_pen": round(today_collected, 2),
            "month_collected_pen": round(month_collected, 2),
            "unpaid_invoices_count": len(unpaid),
            "overdue_invoices_count": sum(1 for i in unpaid if i.status == "overdue"),
            "unpaid_total_pen": round(sum(i.amount for i in unpaid), 2),
            "open_tickets": sum(1 for t in tickets if t.status in ("open", "in_progress")),
        },
        "system_status": {
            "routers_active": len(routers_online),
            "routers_offline": len(routers) - len(routers_online),
            "clients_active": len(active),
            "clients_suspended": len(suspended),
            "active_services": len(active_plans),
            "monitoring_up": len(routers_online) + len(online),
            "monitoring_down": (len(routers) - len(routers_online)) + (len(active) - len(online)),
        },
        "bandwidth_gauge": {
            "live_download_mbps": live_down,
            "live_upload_mbps": live_up,
            "download_pct": round(live_down * 100 / total_live) if total_live else 0,
            "upload_pct": round(live_up * 100 / total_live) if total_live else 0,
            "active_pppoe": sum(r.active_pppoe_count for r in routers_online),
            "active_queues": sum(r.active_queues_count for r in routers_online),
            "last_sync": max((r.last_sync for r in routers_online), default=""),
        },
        "last_7_days": last_7_days,
        "recent_payments": [{
            "id": i.id, "client_name": i.client_name, "amount": i.paid_amount,
            "operator": i.operator_name or "", "payment_method": i.payment_method or "",
            "invoice_number": i.invoice_number, "payment_date": i.payment_date, "period": i.month_period,
        } for i in paid[:8]],
        "recent_connected": [{
            "id": c.id, "name": c.full_name, "ip_address": c.ip_address, "mac_address": c.mac_address,
            "plan_name": c.plan_name, "status": c.status, "connection_type": c.connection_type,
            "last_connection_time": c.last_connection_time,
        } for c in sorted(online, key=lambda c: c.last_connection_time or "", reverse=True)[:10]],
    }
