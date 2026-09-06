"""
Archivo: backend/app/routers/red/olt_onu_summary.py
Pertenece a: Red > OLT > pestaña "ONUs" > contadores superiores.
Función: Obtiene SOLO los contadores del PON seleccionado (total, online y offline).
Regla: Este archivo NO modifica inventario, tarjetas, detalle ONU, óptica, consola ni
       otras pestañas. Debe usar pocas consultas y una sola sesión CLI para no saturar
       Telnet. Si esta lectura auxiliar falla, NO marca la OLT como offline.

CLI confirmado directamente en la V-SOL V1600G1-B del usuario:
  configure terminal
  interface gpon 0/X
  show onu state

Ayuda confirmada en ese mismo modo:
  show onu ?  -> state, info, auto-find, auto-learn, detail-info, time-stamp
  show pon ?  -> info, onu, optical, rx_power, state, transceiver-info, ...

IMPORTANTE:
  `show onuinfo` NO existe en este firmware dentro de config-pon.
  `show pon onu all rx-power` tampoco corresponde a la sintaxis mostrada por esta OLT.
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import get_or_404
from app.integrations.olt import service as olt_service
from app.models.router import Router


router = APIRouter(dependencies=[Depends(get_current_user)])

_BAD_RE = re.compile(
    r"(?:%\s*(?:unknown|invalid|incomplete|ambiguous)\s+command|"
    r"unknown\s+command|invalid\s+command|command\s+not\s+found|"
    r"no\s+related\s+information)",
    re.IGNORECASE,
)

_ONLINE_RE = re.compile(
    r"\b(?:working|online|registered|up|syncmib|syncmib-fail)\b",
    re.IGNORECASE,
)
_OFFLINE_RE = re.compile(
    r"\b(?:offline|los|deregistered|down|dying[-\s]?gasp)\b",
    re.IGNORECASE,
)


def _valid(raw: str) -> bool:
    return bool((raw or "").strip()) and not _BAD_RE.search(raw or "")


def _extract_onu_id(line: str, pon: int):
    """Extrae ONU ID cuando el firmware lo imprime; para contadores no es obligatorio."""
    text = line or ""
    patterns = (
        rf"(?:GPON|EPON)?\s*0/{int(pon)}\s*[:/]\s*(\d{{1,3}})",
        r"\bONU(?:\s*(?:ID|INDEX))?\s*[:=#-]?\s*(\d{1,3})\b",
    )
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = int(match.group(1))
            if 1 <= value <= 128:
                return value

    # Dentro de interface gpon 0/X muchas VSOL muestran sólo el ID al inicio.
    local = re.match(r"^\s*(\d{1,3})(?:\s+|\||$)", text)
    if local:
        value = int(local.group(1))
        if 1 <= value <= 128:
            return value
    return None


def _parse_footer(raw: str):
    """Reconoce resúmenes globales que algunas revisiones añaden al final."""
    text = (raw or "").replace("\r", "")

    patterns = (
        # Total Num: 52 (num of working: 49)
        r"Total\s+Num\s*:\s*(\d+)\s*\([^\n]*?(?:num\s+of\s+)?working\s*:\s*(\d+)",
        # Total: 52  Working: 49
        r"Total(?:\s+ONU(?:s)?)?\s*[:=]\s*(\d+)[^\n]*?(?:Working|Online)\s*[:=]\s*(\d+)",
        # ONU Total 52 Online 49
        r"(?:ONU\s+)?Total\s+(\d+)[^\n]*?(?:Working|Online)\s+(\d+)",
    )

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            total = int(match.group(1))
            online = int(match.group(2))
            return total, online, max(0, total - online)

    return None


def _parse_state(raw: str, pon: int, inventory_total: int):
    """
    Convierte la salida real de `show onu state` a contadores.

    Estrategia:
      1. Usa el resumen del propio CLI si existe.
      2. Cuenta filas por ONU ID cuando el ID está presente.
      3. Si el firmware no imprime ID en cada fila, cuenta líneas que contienen estados.

    El paso 3 es deliberado: para estos cuadros sólo necesitamos cantidades, no asociar
    todavía cada estado con una tarjeta ONU. Así evitamos que un formato de columnas
    distinto vuelva a dejar los contadores en cero.
    """
    footer = _parse_footer(raw)
    if footer:
        state_total, online, offline = footer
        return {
            "total": inventory_total or state_total,
            "online": online,
            "offline": offline if not inventory_total else max(0, inventory_total - online),
            "mode": "footer",
        }

    online_ids = set()
    offline_ids = set()
    online_lines = 0
    offline_lines = 0

    for original in (raw or "").replace("\r", "").splitlines():
        line = original.strip()
        if not line:
            continue

        # No contar cabeceras ni el eco del comando.
        low = line.lower()
        if low == "show onu state" or low.startswith("gpon-olt("):
            continue
        if ("onu" in low and "state" in low and not _ONLINE_RE.search(line) and not _OFFLINE_RE.search(line)):
            continue

        is_offline = bool(_OFFLINE_RE.search(line))
        is_online = bool(_ONLINE_RE.search(line)) and not is_offline
        if not is_online and not is_offline:
            continue

        onu_id = _extract_onu_id(line, pon)
        if onu_id:
            if is_online:
                online_ids.add(onu_id)
                offline_ids.discard(onu_id)
            else:
                offline_ids.add(onu_id)
                online_ids.discard(onu_id)
        else:
            if is_online:
                online_lines += 1
            else:
                offline_lines += 1

    if online_ids or offline_ids:
        online = len(online_ids)
        offline = len(offline_ids)
        known = online + offline
        if inventory_total and known < inventory_total:
            # Estados no reconocidos/transitorios se muestran como offline para que
            # Online + Offline siempre cuadre con el inventario visible del PON.
            offline += inventory_total - known
        return {
            "total": inventory_total or known,
            "online": online,
            "offline": offline,
            "mode": "ids",
        }

    if online_lines or offline_lines:
        online = online_lines
        offline = offline_lines
        known = online + offline
        if inventory_total and known < inventory_total:
            offline += inventory_total - known
        return {
            "total": inventory_total or known,
            "online": online,
            "offline": offline,
            "mode": "lines",
        }

    return {
        "total": inventory_total,
        "online": 0,
        "offline": 0,
        "mode": "none",
    }


@router.get("/{router_id}/olt/onu-summary")
async def onu_summary(
    router_id: str,
    pon: int = 1,
    total: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Resumen aislado de Online/Offline usando únicamente `show onu state`."""
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    pon = max(1, min(int(pon or 1), int(getattr(olt, "pon_ports", 8) or 8)))
    total = max(0, int(total or 0))
    commands = []
    state_raw = ""

    try:
        async with olt_service.connect(olt) as cli:
            cfg = await cli.run("configure terminal", raise_on_error=False)
            commands.append("configure terminal")
            if _BAD_RE.search(cfg or ""):
                raise RuntimeError("La OLT no aceptó 'configure terminal'")

            iface = f"interface gpon 0/{pon}"
            iface_raw = await cli.run(iface, raise_on_error=False)
            commands.append(iface)
            if _BAD_RE.search(iface_raw or ""):
                raise RuntimeError(f"La OLT no aceptó '{iface}'")

            state_raw = await cli.run("show onu state", raise_on_error=False)
            commands.append("show onu state")

    except Exception as exc:
        # Es un endpoint auxiliar: no cambiar status de la OLT ni tocar otras pestañas.
        return {
            "ok": False,
            "error": str(exc),
            "total": total,
            "online": 0,
            "offline": 0,
            "named": None,
            "named_supported": False,
            "source": "error",
            "commands": commands,
            "state_preview": state_raw[:8000],
        }

    if not _valid(state_raw):
        return {
            "ok": False,
            "error": "`show onu state` no devolvió una tabla de estados válida",
            "total": total,
            "online": 0,
            "offline": 0,
            "named": None,
            "named_supported": False,
            "source": "show onu state:invalid",
            "commands": commands,
            "state_preview": state_raw[:8000],
        }

    counts = _parse_state(state_raw, pon, total)

    return {
        "ok": counts["mode"] != "none",
        "error": "" if counts["mode"] != "none" else "No se reconocieron estados en la salida de `show onu state`",
        "total": counts["total"],
        "online": counts["online"],
        "offline": counts["offline"],
        "named": None,
        "named_supported": False,
        "source": f"show onu state:{counts['mode']}",
        "commands": commands,
        # Diagnóstico temporal para adaptar este parser al formato exacto del firmware
        # sin tocar vsol.py ni ninguna otra pestaña.
        "state_preview": state_raw[:8000],
    }
