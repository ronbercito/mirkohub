"""
Archivo: backend/app/routers/facturacion/schemas.py
Función: Esquemas Pydantic del módulo Facturación: creación de facturas y registro de pagos.
Trabaja con: backend/app/routers/facturacion/router.py, backend/app/models/invoice.py
"""
from typing import Optional

from pydantic import BaseModel, ConfigDict


class InvoiceIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    client_id: str
    invoice_number: str = ""
    plan_name: str = ""
    amount: Optional[float] = None
    month_period: str = ""
    issue_date: str = ""
    due_date: str = ""
    status: str = "unpaid"
    notes: str = ""


class PaymentIn(BaseModel):
    invoice_id: str
    amount: float
    payment_method: str  # Efectivo, Yape, Plin, Transferencia BCP, BBVA, Interbank
    operation_reference: str = ""
    notes: str = ""
