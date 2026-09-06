"""
Archivo: backend/app/integrations/mikrotik/client.py
Función: Cliente de bajo nivel para la API binaria de RouterOS (MikroTik v6 y v7) usando
         la librería `librouteros` en modo asíncrono. Abre la conexión (puerto 8728 API o
         8729 API-SSL), inicia sesión (método plain para v6.43+/v7 y token para v6 antiguo)
         y expone operaciones de lectura/escritura: recursos del sistema, interfaces y su
         tráfico en vivo, PPPoE (secrets/activos), colas simples, address-list del firewall,
         concesiones DHCP, usuarios Hotspot y perfiles PPP.
Trabaja con: backend/app/integrations/mikrotik/service.py, backend/app/routers/red/router.py,
             backend/app/models/router.py (credenciales del equipo)
"""
import asyncio
import re
import ssl
import time

from librouteros import async_connect
from librouteros.exceptions import TrapError
from librouteros.login import async_plain, async_token

from app.core.config import MIKROTIK_TIMEOUT


class MikroTikError(Exception):
    """Error de comunicación o de comando con el MikroTik."""


def _parse_ros_time_ms(value: str) -> float | None:
    """Convierte tiempos RouterOS ("12ms", "1ms234us", "456us", "00:00:00.012") a milisegundos."""
    m = re.fullmatch(r"(?:(\d+)ms)?(?:(\d+)us)?", value.strip())
    if m and (m.group(1) or m.group(2)):
        return round(int(m.group(1) or 0) + int(m.group(2) or 0) / 1000, 3)
    m = re.fullmatch(r"(\d+):(\d+):(\d+)(?:\.(\d+))?", value.strip())
    if m:
        h, mi, s, frac = m.groups()
        return round(((int(h) * 3600 + int(mi) * 60 + int(s)) * 1000) + float(f"0.{frac or 0}") * 1000, 3)
    return None


class MikroTikClient:
    def __init__(self, host: str, username: str, password: str, port: int = 8728, use_ssl: bool = False):
        self.host, self.username, self.password = host, username, password
        self.port, self.use_ssl = port, use_ssl
        self.api = None

    async def __aenter__(self):
        kwargs = dict(host=self.host, username=self.username, password=self.password,
                      port=self.port, timeout=MIKROTIK_TIMEOUT, encoding="utf-8")
        if self.use_ssl:
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            ctx.set_ciphers("ADH:@SECLEVEL=0:ALL")
            kwargs["ssl_wrapper"] = ctx
        try:
            try:
                self.api = await asyncio.wait_for(async_connect(login_method=async_plain, **kwargs), MIKROTIK_TIMEOUT + 2)
            except TrapError:
                self.api = await asyncio.wait_for(async_connect(login_method=async_token, **kwargs), MIKROTIK_TIMEOUT + 2)
        except TrapError as e:
            raise MikroTikError(f"Credenciales rechazadas por el MikroTik: {e}")
        except (asyncio.TimeoutError, OSError) as e:
            raise MikroTikError(f"No se pudo conectar a {self.host}:{self.port} ({str(e) or 'tiempo de espera agotado'})")
        return self

    async def __aexit__(self, *exc):
        if self.api:
            try:
                await self.api.close()
            except Exception:
                pass

    # ---------- primitivas ----------
    async def rows(self, *path: str, **params) -> list[dict]:
        try:
            return [r async for r in self.api.path(*path)("print", **params)]
        except TrapError as e:
            raise MikroTikError(f"/{'/'.join(path)}: {e}")

    async def find(self, *path: str, **where) -> list[dict]:
        rows = await self.rows(*path)
        return [r for r in rows if all(str(r.get(k)) == str(v) for k, v in where.items())]

    async def add(self, *path: str, **kw) -> str:
        try:
            return await self.api.path(*path).add(**kw)
        except TrapError as e:
            raise MikroTikError(f"add /{'/'.join(path)}: {e}")

    async def set(self, *path: str, **kw) -> None:
        try:
            await self.api.path(*path).update(**kw)
        except TrapError as e:
            raise MikroTikError(f"set /{'/'.join(path)}: {e}")

    async def remove(self, *path: str, ids: list[str]) -> None:
        if not ids:
            return
        try:
            await self.api.path(*path).remove(*ids)
        except TrapError as e:
            raise MikroTikError(f"remove /{'/'.join(path)}: {e}")

    async def command(self, cmd: str, **kw) -> list[dict]:
        try:
            return [r async for r in self.api(cmd, **kw)]
        except TrapError as e:
            raise MikroTikError(f"{cmd}: {e}")

    # ---------- sistema ----------
    async def system_resource(self) -> dict:
        res = (await self.rows("system", "resource"))[0]
        ident = (await self.rows("system", "identity"))[0]
        total = int(res.get("total-memory", 0) or 0)
        free = int(res.get("free-memory", 0) or 0)
        return {
            "identity": ident.get("name", ""),
            "version": res.get("version", ""),
            "board_name": res.get("board-name", ""),
            "architecture": res.get("architecture-name", ""),
            "uptime": res.get("uptime", ""),
            "cpu_load": int(res.get("cpu-load", 0) or 0),
            "cpu_count": res.get("cpu-count", ""),
            "memory_total_mb": round(total / 1048576, 1),
            "memory_free_mb": round(free / 1048576, 1),
            "memory_used_pct": round((total - free) * 100 / total) if total else 0,
            "hdd_total_mb": round(int(res.get("total-hdd-space", 0) or 0) / 1048576, 1),
            "hdd_free_mb": round(int(res.get("free-hdd-space", 0) or 0) / 1048576, 1),
        }

    # ---------- interfaces ----------
    async def interfaces(self) -> list[dict]:
        ifaces = await self.rows("interface")
        addresses = await self.rows("ip", "address")
        ip_by_iface = {}
        for a in addresses:
            ip_by_iface.setdefault(a.get("interface"), a.get("address"))
        out = []
        for i in ifaces:
            name = i.get("name")
            rx_bps = tx_bps = 0
            try:
                mon = await self.command("/interface/monitor-traffic", interface=name, once=True)
                if mon:
                    rx_bps = int(mon[0].get("rx-bits-per-second", 0) or 0)
                    tx_bps = int(mon[0].get("tx-bits-per-second", 0) or 0)
            except MikroTikError:
                pass
            out.append({
                "id": i.get(".id"),
                "name": name,
                "type": i.get("type", ""),
                "mac_address": i.get("mac-address", ""),
                "mtu": i.get("mtu", ""),
                "running": bool(i.get("running", False)),
                "disabled": bool(i.get("disabled", False)),
                "status": "up" if i.get("running") else ("disabled" if i.get("disabled") else "down"),
                "ip": ip_by_iface.get(name, ""),
                "rx_mbps": round(rx_bps / 1_000_000, 2),
                "tx_mbps": round(tx_bps / 1_000_000, 2),
                "rx_bytes": int(i.get("rx-byte", 0) or 0),
                "tx_bytes": int(i.get("tx-byte", 0) or 0),
                "comment": i.get("comment", ""),
            })
        return out

    # ---------- PPPoE ----------
    async def ppp_active(self) -> list[dict]:
        return [{
            "id": r.get(".id"), "name": r.get("name"), "service": r.get("service"),
            "address": r.get("address"), "caller_id": r.get("caller-id"),
            "uptime": r.get("uptime"), "encoding": r.get("encoding", ""),
        } for r in await self.rows("ppp", "active")]

    async def ppp_secrets(self) -> list[dict]:
        return [{
            "id": r.get(".id"), "name": r.get("name"), "service": r.get("service"),
            "profile": r.get("profile"), "remote_address": r.get("remote-address", ""),
            "disabled": bool(r.get("disabled", False)), "comment": r.get("comment", ""),
            "last_logged_out": r.get("last-logged-out", ""),
        } for r in await self.rows("ppp", "secret")]

    async def ppp_profiles(self) -> list[dict]:
        return [{
            "id": r.get(".id"), "name": r.get("name"), "rate_limit": r.get("rate-limit", ""),
            "local_address": r.get("local-address", ""), "remote_address": r.get("remote-address", ""),
        } for r in await self.rows("ppp", "profile")]

    async def upsert_ppp_profile(self, name: str, rate_limit: str) -> str:
        found = await self.find("ppp", "profile", name=name)
        if found:
            await self.set("ppp", "profile", **{".id": found[0][".id"], "rate-limit": rate_limit})
            return "updated"
        await self.add("ppp", "profile", name=name, **{"rate-limit": rate_limit})
        return "created"

    async def upsert_ppp_secret(self, name: str, password: str, profile: str, comment: str = "",
                                remote_address: str = "", disabled: bool = False) -> str:
        data = {"name": name, "password": password, "service": "pppoe", "profile": profile,
                "comment": comment, "disabled": disabled}
        if remote_address:
            data["remote-address"] = remote_address
        found = await self.find("ppp", "secret", name=name)
        if found:
            await self.set("ppp", "secret", **{".id": found[0][".id"], **data})
            return "updated"
        await self.add("ppp", "secret", **data)
        return "created"

    async def set_ppp_secret_disabled(self, name: str, disabled: bool) -> bool:
        found = await self.find("ppp", "secret", name=name)
        if not found:
            return False
        await self.set("ppp", "secret", **{".id": found[0][".id"], "disabled": disabled})
        if disabled:
            active = await self.find("ppp", "active", name=name)
            await self.remove("ppp", "active", ids=[a[".id"] for a in active])
        return True

    async def remove_ppp_secret(self, name: str) -> None:
        found = await self.find("ppp", "secret", name=name)
        await self.remove("ppp", "secret", ids=[f[".id"] for f in found])

    # ---------- Colas simples ----------
    async def simple_queues(self) -> list[dict]:
        out = []
        for r in await self.rows("queue", "simple"):
            rate = str(r.get("rate", "0/0")).split("/")
            out.append({
                "id": r.get(".id"), "name": r.get("name"), "target": r.get("target", ""),
                "max_limit": r.get("max-limit", ""), "burst_limit": r.get("burst-limit", ""),
                "disabled": bool(r.get("disabled", False)), "comment": r.get("comment", ""),
                "rate_up_mbps": round(int(rate[0] or 0) / 1_000_000, 2) if rate[0].isdigit() else 0,
                "rate_down_mbps": round(int(rate[1] or 0) / 1_000_000, 2) if len(rate) > 1 and rate[1].isdigit() else 0,
            })
        return out

    async def upsert_simple_queue(self, name: str, target: str, max_limit: str, comment: str = "",
                                  burst_limit: str = "") -> str:
        data = {"name": name, "target": target, "max-limit": max_limit, "comment": comment}
        if burst_limit:
            data["burst-limit"] = burst_limit
        found = await self.find("queue", "simple", name=name)
        if found:
            await self.set("queue", "simple", **{".id": found[0][".id"], **data})
            return "updated"
        await self.add("queue", "simple", **data)
        return "created"

    async def remove_simple_queue(self, name: str) -> None:
        found = await self.find("queue", "simple", name=name)
        await self.remove("queue", "simple", ids=[f[".id"] for f in found])

    # ---------- Firewall address-list (corte de servicio) ----------
    async def address_list(self, list_name: str | None = None) -> list[dict]:
        rows = await self.rows("ip", "firewall", "address-list")
        return [{
            "id": r.get(".id"), "list": r.get("list"), "address": r.get("address"),
            "comment": r.get("comment", ""), "disabled": bool(r.get("disabled", False)),
            "dynamic": bool(r.get("dynamic", False)),
        } for r in rows if not list_name or r.get("list") == list_name]

    async def address_list_add(self, list_name: str, address: str, comment: str = "") -> str:
        found = [r for r in await self.address_list(list_name) if r["address"] == address]
        if found:
            return "exists"
        await self.add("ip", "firewall", "address-list", list=list_name, address=address, comment=comment)
        return "created"

    async def address_list_remove(self, list_name: str, address: str) -> int:
        found = [r for r in await self.address_list(list_name) if r["address"] == address]
        await self.remove("ip", "firewall", "address-list", ids=[f["id"] for f in found])
        return len(found)

    # ---------- DHCP ----------
    async def dhcp_leases(self) -> list[dict]:
        return [{
            "id": r.get(".id"), "address": r.get("address"), "mac_address": r.get("mac-address"),
            "host_name": r.get("host-name", ""), "status": r.get("status", ""),
            "server": r.get("server", ""), "comment": r.get("comment", ""),
            "dynamic": bool(r.get("dynamic", False)), "expires_after": r.get("expires-after", ""),
        } for r in await self.rows("ip", "dhcp-server", "lease")]

    async def make_lease_static(self, lease_id: str) -> None:
        await self.command("/ip/dhcp-server/lease/make-static", **{".id": lease_id})

    # ---------- Hotspot ----------
    async def hotspot_users(self) -> list[dict]:
        return [{
            "id": r.get(".id"), "name": r.get("name"), "profile": r.get("profile", ""),
            "limit_uptime": r.get("limit-uptime", ""), "uptime": r.get("uptime", ""),
            "disabled": bool(r.get("disabled", False)), "comment": r.get("comment", ""),
        } for r in await self.rows("ip", "hotspot", "user")]

    async def hotspot_active(self) -> list[dict]:
        return [{
            "id": r.get(".id"), "user": r.get("user"), "address": r.get("address"),
            "mac_address": r.get("mac-address"), "uptime": r.get("uptime"),
            "bytes_in": int(r.get("bytes-in", 0) or 0), "bytes_out": int(r.get("bytes-out", 0) or 0),
        } for r in await self.rows("ip", "hotspot", "active")]

    async def add_hotspot_user(self, name: str, password: str, limit_uptime: str, comment: str = "",
                               profile: str = "default") -> str:
        return await self.add("ip", "hotspot", "user", name=name, password=password,
                              **{"limit-uptime": limit_uptime, "comment": comment, "profile": profile})

    # ---------- Latencia ----------
    async def ping(self, address: str, count: int = 3) -> dict:
        rows = await self.command("/ping", address=address, count=count)
        times = []
        for r in rows:
            ms = _parse_ros_time_ms(str(r.get("time", "")))
            if ms is not None and not r.get("status"):
                times.append(ms)
        sent, received = count, len(times)
        return {
            "sent": sent, "received": received,
            "packet_loss": f"{round((sent - received) * 100 / sent)}%",
            "avg_ms": round(sum(times) / len(times), 2) if times else None,
        }


async def tcp_latency_ms(host: str, port: int, timeout: float = 3.0) -> float | None:
    """Mide el tiempo de conexión TCP al puerto API como latencia aproximada (sin ICMP)."""
    start = time.perf_counter()
    try:
        _, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout)
        writer.close()
        return round((time.perf_counter() - start) * 1000, 2)
    except Exception:
        return None
