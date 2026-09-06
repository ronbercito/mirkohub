"""
Archivo: backend/app/models/router.py
Función: Tabla `routers` — equipos de red (MikroTik / OLT) con sus credenciales de
         API RouterOS o CLI Telnet/SSH (OLT: protocol, enable_password, olt_profile, pon_ports) y los últimos datos leídos del equipo (CPU, memoria, versión,
         uptime, sesiones PPPoE, colas, tráfico). La contraseña nunca se devuelve al frontend.
Trabaja con: backend/app/routers/red/router.py, backend/app/integrations/mikrotik/client.py,
             backend/app/integrations/mikrotik/service.py, backend/app/models/client.py
"""
from sqlalchemy import Boolean, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base, new_id


class Router(Base):
    __tablename__ = "routers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(120))
    device_type: Mapped[str] = mapped_column(String(30), default="mikrotik")  # mikrotik | olt
    ip_address: Mapped[str] = mapped_column(String(60))
    port: Mapped[int] = mapped_column(Integer, default=8728)
    use_ssl: Mapped[bool] = mapped_column(Boolean, default=False)
    username: Mapped[str] = mapped_column(String(80), default="admin")
    password: Mapped[str] = mapped_column(String(255), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    location: Mapped[str] = mapped_column(String(150), default="")
    # Solo OLT: acceso CLI
    protocol: Mapped[str] = mapped_column(String(10), default="telnet")  # telnet | ssh
    enable_password: Mapped[str] = mapped_column(String(255), default="")
    olt_profile: Mapped[str] = mapped_column(String(30), default="vsol_gpon")  # ver OLT_PROFILES
    pon_ports: Mapped[int] = mapped_column(Integer, default=8)
    snmp_community: Mapped[str] = mapped_column(String(80), default="")
    snmp_community_rw: Mapped[str] = mapped_column(String(80), default="")
    private_ip: Mapped[str] = mapped_column(String(60), default="")
    olt_model: Mapped[str] = mapped_column(String(60), default="")
    software_version: Mapped[str] = mapped_column(String(20), default="1.x")
    pon_type: Mapped[str] = mapped_column(String(10), default="GPON")  # GPON | EPON
    ssh_port: Mapped[int] = mapped_column(Integer, default=22)
    telnet_port: Mapped[int] = mapped_column(Integer, default=23)
    snmp_port: Mapped[int] = mapped_column(Integer, default=161)

    @property
    def cli_port(self) -> int:
        if self.device_type != "olt":
            return self.port
        return self.ssh_port if self.protocol == "ssh" else self.telnet_port

    status: Mapped[str] = mapped_column(String(20), default="unknown")  # online | offline | unknown
    identity: Mapped[str] = mapped_column(String(120), default="")
    ros_version: Mapped[str] = mapped_column(String(60), default="")
    board_name: Mapped[str] = mapped_column(String(80), default="")
    uptime: Mapped[str] = mapped_column(String(60), default="")
    ping_ms: Mapped[float] = mapped_column(Float, default=0.0)
    cpu_usage_pct: Mapped[int] = mapped_column(Integer, default=0)
    memory_usage_pct: Mapped[int] = mapped_column(Integer, default=0)
    active_pppoe_count: Mapped[int] = mapped_column(Integer, default=0)
    active_queues_count: Mapped[int] = mapped_column(Integer, default=0)
    total_download_mbps: Mapped[float] = mapped_column(Float, default=0.0)
    total_upload_mbps: Mapped[float] = mapped_column(Float, default=0.0)
    last_sync: Mapped[str] = mapped_column(String(40), default="")
    last_error: Mapped[str] = mapped_column(String(255), default="")

    def public_dict(self) -> dict:
        d = self.to_dict(exclude=("password", "enable_password"))
        d["has_password"] = bool(self.password)
        d["has_enable_password"] = bool(self.enable_password)
        return d
