"""
Archivo: backend/app/routers/clientes/schemas.py
Función: Esquemas Pydantic del módulo Clientes (datos de entrada para crear/editar abonados).
Trabaja con: backend/app/routers/clientes/router.py, backend/app/models/client.py
"""
from typing import Optional

from pydantic import BaseModel, ConfigDict


class ClientIn(BaseModel):
    model_config = ConfigDict(extra="ignore")

    full_name: str
    dni_ruc: str
    phone: str = ""
    email: str = ""
    address: str = ""
    reference: str = ""
    latitude: float = 0.0
    longitude: float = 0.0
    ip_address: str = ""
    mac_address: str = ""
    onu_sn: str = ""
    connection_type: str = "PPPoE"  # PPPoE | IP Estática | DHCP
    pppoe_user: str = ""
    pppoe_password: str = ""
    plan_id: str = ""
    router_id: str = ""
    ipv4_network_id: str = ""
    nap_box: str = ""
    nap_box_id: str = ""
    nap_port: Optional[int] = None
    optical_power_dbm: Optional[float] = None
    status: str = "active"
    billing_day: int = 5
    create_first_invoice: bool = True
