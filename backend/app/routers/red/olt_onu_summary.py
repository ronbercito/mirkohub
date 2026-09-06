"""
Archivo: backend/app/routers/red/olt_onu_summary.py
Pertenece a: Red > OLT > pestaña "ONUs" > contadores superiores.
Función: Obtiene SOLO los contadores del PON seleccionado sin tocar inventario, tarjetas,
         óptica, consola ni otras pestañas. Para Online/Offline usa la lectura óptica global
         del PON, probando las variantes CLI `rx-power` y `rx` según firmware VSOL.
Regla: Este archivo debe seguir siendo ligero: pocas consultas, una sola sesión CLI y nunca
       consultar ONU por ONU. Si esta lectura auxiliar falla, NO marca la OLT como offline.
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
    """Reconoce formatos habituales de VSOL dentro del PON seleccionado."""
    patterns = (
        rf"(?:GPON|EPON)?\s*0/{int(pon)}\s*[:/]\s*(\d{{1,3}})",
        r"\bONU(?:\s*(?:ID|INDEX))?\s*[:=#-]?\s*(\d{1,3})\b",
    )
    for pattern in patterns:
        match = re.search(pattern, line or "", re.IGNORECASE)
        if match:
            value = int(match.group(1))
            if 1 <= value <= 128:
                return value

    # En modo `interface gpon 0/X` varias versiones imprimen sólo el ID local.
    local = re.match(r"^\s*(\d{1,3})(?:\s+|\||$)", line or "")
    if local:
        value = int(local.group(1))
        if 1 <= value <= 128:
            return value

    return None


def _extract_rx_dbm(line: str):
    """Extrae la potencia RX sin confundir el número de PON/ONU con la lectura."""
    text = line or ""

    # Preferir valores etiquetados como RX/RxPower.
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

    # Tablas VSOL normalmente muestran la potencia como número negativo.
    values = re.findall(r"-\d+(?:\.\d+)?", text)
    for value in reversed(values):
        try:
            number = float(value)
        except ValueError:
            continue
        if -100.0 <= number <= 10.0:
            return number

    return None


def _parse_optical_state(raw: str, pon: int):
    """
    Devuelve IDs online/offline a partir de UNA tabla óptica global.

    - Si la fila dice online/offline/los, se respeta el estado explícito.
    - Si no hay estado, una RX razonable (-38 < RX < 10 dBm) se toma como online.
    - Valores típicos de ausencia de señal (-40, -99, etc.) se toman como offline.
    """
    online = set()
    offline = set()

    for original in (raw or "").replace("\r", "").splitlines():
        line = original.strip()
        if not line:
            continue

        onu_id = _extract_onu_id(line, pon)
        if not onu_id:
            continue

        low = line.lower()
        if re.search(r"\bonline\b|\bregistered\b|\bworking\b|\bup\b", low):
            online.add(onu_id)
            offline.discard(onu_id)
            continue
        if re.search(r"\boffline\b|\blos\b|\bderegistered\b|\bdown\b", low):
            offline.add(onu_id)
            online.discard(onu_id)
            continue

        rx = _extract_rx_dbm(line)
        if rx is None:
            continue

        if -38.0 < rx < 10.0:
            online.add(onu_id)
            offline.discard(onu_id)
        elif rx <= -38.0:
            offline.add(onu_id)
            online.discard(onu_id)

    return online, offline


@router.get("/{router_id}/olt/onu-summary")
async def onu_summary(
    router_id: str,
    pon: int = 1,
    total: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """
    Resumen ligero para los indicadores superiores de ONUs.

    Importante: esta etapa sólo corrige Online/Offline. El contador de nombres se deja
    como no disponible hasta implementar una fuente global fiable, evitando nuevamente
    26/52/128 consultas `show onu <id> description` que pueden saturar Telnet.
    """
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    pon = max(1, min(int(pon or 1), int(getattr(olt, "pon_ports", 8) or 8)))
    total = max(0, int(total or 0))

    commands = []
    optical_raw = ""
    optical_command = ""

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

            # V1.5.x suele usar rx-power; revisiones anteriores del V1600G usan rx.
            for command in ("show pon onu all rx-power", "show pon onu all rx"):
                raw = await cli.run(command, raise_on_error=False)
                commands.append(command)
                if not _valid(raw):
                    continue

                on, off = _parse_optical_state(raw, pon)
                if on or off:
                    optical_raw = raw
                    optical_command = command
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

    online_ids, offline_ids = _parse_optical_state(optical_raw, pon)
    online_count = len(online_ids)

    # Si la tabla óptica identifica explícitamente offline, usarla. Si no, el total
    # ya viene del inventario `show onuinfo`, por lo que el resto se considera offline.
    if offline_ids:
        offline_count = len(offline_ids)
        known = online_count + offline_count
        if total > known:
            offline_count += total - known
    elif total and online_count <= total:
        offline_count = total - online_count
    else:
        offline_count = 0

    return {
        "ok": True,
        "total": total,
        "online": online_count,
        "offline": offline_count,
        "named": None,
        "named_supported": False,
        "source": f"optical:{optical_command}" if optical_command else "none",
        "commands": commands,
    }
