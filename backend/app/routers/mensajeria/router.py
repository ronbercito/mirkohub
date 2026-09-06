"""
Archivo: backend/app/routers/mensajeria/router.py
Función: Plantillas de mensajes WhatsApp (/api/messaging/templates) para recordatorio de
         pago, aviso de corte, confirmación de pago y mantenimiento. Los datos del ISP
         (teléfono, Yape, razón social) se toman de la configuración guardada en Ajustes.
Trabaja con: backend/app/models/setting.py, frontend/src/modules/mensajeria/Messaging.jsx
"""
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.setting import Setting

router = APIRouter(prefix="/messaging", tags=["Mensajería"], dependencies=[Depends(get_current_user)])


@router.get("/templates")
async def templates(db: AsyncSession = Depends(get_db)):
    s = await db.get(Setting, "system_config")
    cfg = (s.data if s else {}) or {}
    isp = cfg.get("company_name") or "su proveedor de internet"
    phone = cfg.get("phone") or cfg.get("yape_number") or ""
    yape = cfg.get("yape_number") or ""
    return [
        {"id": "tpl_reminder", "name": "Recordatorio de Pago Mensual", "type": "payment_reminder",
         "text": f"Hola {{cliente}}, le saludamos de {isp}. Le recordamos que su recibo por S/. {{monto}} del plan {{plan}} vence el {{vencimiento}}. Puede pagar por Yape/Plin al {yape} o transferencia bancaria. ¡Gracias por preferirnos!"},
        {"id": "tpl_cut_warning", "name": "Aviso de Corte Inminente", "type": "cut_warning",
         "text": f"Estimado(a) {{cliente}}, {isp} le informa que su servicio presenta facturas vencidas por S/. {{monto}}. Para evitar el corte automático, regularice su pago hoy. Soporte: {phone}."},
        {"id": "tpl_payment_confirmation", "name": "Confirmación de Pago Recibido", "type": "payment_receipt",
         "text": f"¡Pago recibido! Estimado(a) {{cliente}}, {isp} confirma el cobro de S/. {{monto}} con comprobante {{recibo}}. Su servicio se encuentra ACTIVO. Gracias por su puntualidad."},
        {"id": "tpl_maintenance", "name": "Aviso de Mantenimiento", "type": "general",
         "text": f"Estimado cliente de {isp}: realizaremos trabajos de mantenimiento en la red el día {{fecha}} de {{hora_inicio}} a {{hora_fin}}. Agradecemos su comprensión."},
    ]
