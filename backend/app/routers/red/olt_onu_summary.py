"""
Archivo: backend/app/routers/red/olt_onu_summary.py
Pertenece a: Red > OLT > pestaña "ONUs" > contadores superiores.
Función: Obtiene SOLO los contadores del PON seleccionado (total, online y offline)
         usando comandos de estado propios de VSOL y una lectura óptica como respaldo.
Regla: Este archivo NO modifica inventario, tarjetas, detalle ONU, óptica, consola ni
       otras pestañas. Debe usar pocas consultas y una sola sesión CLI para no saturar
       Telnet. Si esta lectura auxiliar falla, NO marca la OLT como offline.

Comandos VSOL usados aquí:
  configure terminal
  interface gpon 0/X
  show onu state
  show pon onu all rx-power     (fallback)
  show pon onu all rx           (fallback para firmwares antiguos)
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


def _valid(raw: str) -> bool:
    return bool((raw or "").strip()) and not _BAD_RE.search(raw or "")


def _extract_onu_id(line: str, pon: int):
    """
    Extrae el ONU ID de los formatos habituales de la familia V1600G.

    Ejemplos aceptados:
      GPON0/8:12
      0/8:12
      0/8/12
      1/1/8:12
      ONU 12
      12   working ...       (cuando ya estamos dentro del PON)
    """
    value_text = line or ""

    patterns = (
        # GPON0/8:12 o 0/8:12
        rf"(?:GPON|EPON)?\s*0/{int(pon)}\s*[:/]\s*(\d{{1,3}})",
        # Algunos firmwares anteponen slot/chassis: 1/1/8:12
        rf"(?:\d+/)+{int(pon)}\s*:\s*(\d{{1,3}})",
        # ONU 12 / ONU-ID 12 / ONUIndex 12
        r"\bONU(?:\s*(?:ID|INDEX))?\s*[:=#-]?\s*(\d{1,3})\b",
    )

    for pattern in patterns:
        match = re.search(pattern, value_text, re.IGNORECASE)
        if match:
            value = int(match.group(1))
            if 1 <= value <= 128:
                return value

    # En modo interface gpon algunas versiones dejan sólo el ID al inicio.
    local = re.match(r"^\s*(\d{1,3})(?:\s+|\||$)", value_text)
    if local:
        value = int(local.group(1))
        if 1 <= value <= 128:
            return value

    return None


def _state_from_line(line: str):
    """Normaliza los estados que VSOL puede devolver en `show onu state`."""
    low = (line or "").lower()

    # offline primero para evitar coincidencias ambiguas.
    if re.search(r"\boffline\b|\blos\b|\bderegistered\b|\bdown\b", low):
        return "offline"

    # `working` es el estado operativo normal en varias revisiones V1600G.
    # `syncmib` ya implica ONU registrada, aunque esté sincronizando config.
    if re.search(r"\bworking\b|\bonline\b|\bregistered\b|\bsyncmib(?:-fail)?\b", low):
        return "online"

    return ""


def _parse_state_rows(raw: str, pon: int):
    """Devuelve IDs online/offline encontrados en `show onu state`."""
    online = set()
    offline = set()

    for original in (raw or "").replace("\r", "").splitlines():
        state = _state_from_line(original)
        if not state:
            continue

        onu_id = _extract_onu_id(original, pon)
        if not onu_id:
            continue

        if state == "online":
            online.add(onu_id)
            offline.discard(onu_id)
        else:
            offline.add(onu_id)
            online.discard(onu_id)

    return online, offline


def _parse_state_footer(raw: str):
    """
    Algunos firmwares incluyen un resumen como:
      Total Num: 4 (num of working: 3)
    o tablas resumen con Total ONUs / Online ONUs.
    """
    text = (raw or "").replace("\r", "")

    match = re.search(
        r"Total\s+Num\s*:\s*(\d+)\s*\([^\n]*?(?:working|online)\s*:\s*(\d+)",
        text,
        re.IGNORECASE,
    )
    if match:
        total = int(match.group(1))
        online = int(match.group(2))
        return total, online, max(0, total - online)

    # Variante tipo: GPON0/1   43   29 bajo cabecera Total ONUs / Online ONUs.
    match = re.search(
        r"(?:GPON|EPON)?\s*0/\d+\s+(\d+)\s+(\d+)\s*$",
        text,
        re.IGNORECASE | re.MULTILINE,
    )
    if match and re.search(r"Total\s+ONUs?.*Online\s+ONUs?", text, re.IGNORECASE | re.DOTALL):
        total = int(match.group(1))
        online = int(match.group(2))
        return total, online, max(0, total - online)

    return None


def _extract_rx_dbm(line: str):
    """Extrae RX dBm de una fila óptica sin confundir PON/ONU con potencia."""
    text = line or ""

    labelled = re.search(
        r"\b(?:rx(?:\s*power)?|rxpower)\b\s*[:=]?\s*(-?\d+(?:\.\d+)?)",
        text,
        re.IGNORECASE,
    )
    if labelled:
        try:
            return float(labelled.group(1))
        except ValueError:
            return None

    values = re.findall(r"-\d+(?:\.\d+)?", text)
    for value in reversed(values):
        try:
            number = float(value)
        except ValueError:
            continue
        if -100.0 <= number <= 10.0:
            return number

    return None


def _parse_optical_online(raw: str, pon: int):
    """Fallback: una RX válida identifica una ONU registrada/online."""
    online = set()

    for original in (raw or "").replace("\r", "").splitlines():
        onu_id = _extract_onu_id(original, pon)
        if not onu_id:
            continue

        rx = _extract_rx_dbm(original)
        if rx is not None and -38.0 < rx < 10.0:
            online.add(onu_id)

    return online


@router.get("/{router_id}/olt/onu-summary")
async def onu_summary(
    router_id: str,
    pon: int = 1,
    total: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """
    Resumen ligero de los indicadores superiores de la pestaña ONUs.

    Prioridad:
      1) `show onu state` en el PON actual.
      2) Si el firmware no lo devuelve, potencia óptica global del PON.

    El contador "con nombre" se mantiene separado porque el HTML de AdminOLT demuestra
    que ese producto sirve esos datos desde su backend/base de datos; no existe en el HTML
    entregado un comando CLI global fiable para obtener todas las descripciones de VSOL.
    """
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    pon = max(1, min(int(pon or 1), int(getattr(olt, "pon_ports", 8) or 8)))
    total = max(0, int(total or 0))

    commands = []
    state_raw = ""
    optical_raw = ""
    source = "none"

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

            # Este es el comando de estado que usan las V-SOL GPON de esta familia.
            raw = await cli.run("show onu state", raise_on_error=False)
            commands.append("show onu state")
            if _valid(raw):
                rows_online, rows_offline = _parse_state_rows(raw, pon)
                footer = _parse_state_footer(raw)
                if rows_online or rows_offline or footer:
                    state_raw = raw
                    source = "show onu state"

            # Sólo usar óptica si el comando de estado no produjo datos parseables.
            if not state_raw:
                for command in ("show pon onu all rx-power", "show pon onu all rx"):
                    raw = await cli.run(command, raise_on_error=False)
                    commands.append(command)
                    if not _valid(raw):
                        continue
                    online_ids = _parse_optical_online(raw, pon)
                    if online_ids:
                        optical_raw = raw
                        source = command
                        break

    except Exception as exc:
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
        }

    online_count = 0
    offline_count = 0

    if state_raw:
        online_ids, offline_ids = _parse_state_rows(state_raw, pon)
        footer = _parse_state_footer(state_raw)

        if online_ids or offline_ids:
            online_count = len(online_ids)
            offline_count = len(offline_ids)

            # El inventario `show onuinfo` ya aporta el total exacto del PON.
            # Si show onu state omite estados transitorios, se contabilizan como no-online.
            known = online_count + offline_count
            if total > known:
                offline_count += total - known
        elif footer:
            state_total, online_count, offline_count = footer
            if not total:
                total = state_total

    elif optical_raw:
        online_ids = _parse_optical_online(optical_raw, pon)
        online_count = len(online_ids)
        offline_count = max(0, total - online_count) if total else 0

    return {
        "ok": True,
        "total": total,
        "online": online_count,
        "offline": offline_count,
        "named": None,
        "named_supported": False,
        "source": source,
        "commands": commands,
        # Diagnóstico limitado: permite saber qué devolvió este firmware sin tocar otras pestañas.
        "state_preview": state_raw[:4000],
        "optical_preview": optical_raw[:4000],
    }
