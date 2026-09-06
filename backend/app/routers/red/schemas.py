"""
Archivo: backend/app/routers/red/schemas.py
Función: Esquemas Pydantic del módulo Red: datos para registrar/editar un MikroTik u OLT
         y para agregar/quitar IPs de una address-list del firewall.
Trabaja con: backend/app/routers/red/router.py, backend/app/models/router.py
"""
from pydantic import BaseModel, ConfigDict


class RouterIn(BaseModel):
    model_config = ConfigDict(extra="ignore")
    name: str
    device_type: str = "mikrotik"  # mikrotik | olt
    ip_address: str
    port: int = 8728
    use_ssl: bool = False
    username: str = "admin"
    password: str = ""
    model: str = ""
    location: str = ""
    protocol: str = "telnet"
    enable_password: str = ""
    olt_profile: str = "vsol_gpon"
    pon_ports: int = 8
    snmp_community: str = ""
    snmp_community_rw: str = ""
    private_ip: str = ""
    olt_model: str = ""
    software_version: str = "1.x"
    pon_type: str = "GPON"
    ssh_port: int = 22
    telnet_port: int = 23
    snmp_port: int = 161


class OltOnuIn(BaseModel):
    pon: int = 1
    onu: int = 1
    sn: str = ""
    profile: str = "default"


class OltCommandIn(BaseModel):
    command: str


class AddressListIn(BaseModel):
    action: str  # add | remove
    list: str = "morosos"
    address: str
    comment: str = ""
