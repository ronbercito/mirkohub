"""
Archivo: backend/app/models/__init__.py
Función: Registra todos los modelos (tablas SQL) para que SQLAlchemy los conozca
         al crear la base de datos. Importar este paquete = importar todas las tablas.
Trabaja con: backend/app/core/database.py (init_db), backend/app/models/*.py
"""
from .user import User
from .plan import Plan
from .router import Router
from .client import Client
from .invoice import Invoice
from .ticket import Ticket
from .inventory import InventoryItem
from .hotspot import HotspotVoucher
from .task import Task
from .setting import Setting

__all__ = [
    "User", "Plan", "Router", "Client", "Invoice", "Ticket",
    "InventoryItem", "HotspotVoucher", "Task", "Setting",
]
