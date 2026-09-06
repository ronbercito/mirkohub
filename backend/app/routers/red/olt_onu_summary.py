"""
Archivo: backend/app/routers/red/olt_onu_summary.py
Pertenece a: Red > OLT > pestaña "ONUs" > contadores superiores.
Función: Obtiene SOLO el resumen del PON seleccionado (online, offline y ONUs con nombre)
         usando pocas consultas CLI en una sola sesión Telnet/SSH.
Regla: Este archivo no modifica el inventario ONU, óptica, consola ni otras pestañas.
       Si una consulta auxiliar falla, NO marca la OLT como offline.
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.utils import get_or_404
from app.integrations.olt import service as olt_service
from app.models.router import Router


router = APIRouter()

_INDEX_RE_TEMPLATE = r"(?:GPON|EPON)?\s*0/{pon}\s*[:/]\s*(\d{{1,3}})"
_BAD_RE = re.compile(
    r"(?:%\s*(?:unknown|invalid|incomplete|ambiguous)\s+command|"
    r"unknown\s+command|invalid\s+command|command\s+not\s+found|"
    r"no\s+related\s+information)",
    re.IGNORECASE,
)


def _valid(raw: str) -> bool:
    return bool((raw or "").strip()) and not _BAD_RE.search(raw or "")


def _onu_id(line: str, pon: int):
    match = re.search(_INDEX_RE_TEMPLATE.format(pon=int(pon)), line or "", re.IGNORECASE)
    if not match:
        return None
    value = int(match.group(1))
    return value if 1 <= value <= 128 else None


def _parse_status(raw: str, pon: int):
    """Devuelve sets de ONU IDs online/offline encontrados en una tabla de estado."""
    online = set()
    offline = set()

    for original in (raw or "").replace("\r", "").splitlines():
        onu_id = _onu_id(original, pon)
        if not onu_id:
            continue

        low = original.lower()
        # Online/offline tienen prioridad sobre palabras como active/inactive,
        # porque algunos firmwares muestran ambas columnas en la misma fila.
        if re.search(r"\bonline\b|\bregistered\b|\bworking\b", low):
            online.add(onu_id)
            offline.discard(onu_id)
        elif re.search(r"\boffline\b|\blos\b|\bderegistered\b|\bdown\b", low):
            offline.add(onu_id)
            online.discard(onu_id)
        elif re.search(r"\bup\b", low):
            online.add(onu_id)
            offline.discard(onu_id)

    return online, offline


def _parse_optical_online(raw: str, pon: int):
    """Fallback: una ONU con lectura RX válida se considera registrada/online."""
    online = set()
    for original in (raw or "").replace("\r", "").splitlines():
        onu_id = _onu_id(original, pon)
        if not onu_id:
            continue
        # Exige una lectura numérica razonable, normalmente expresada en dBm.
        if re.search(r"-?\d+(?:\.\d+)?\s*(?:dBm)?\b", original, re.IGNORECASE):
            online.add(onu_id)
    return online


def _parse_named(raw: str, pon: int):
    """Cuenta ONUs con descripción en la salida global `show onu description`."""
    named = set()
    index_re = re.compile(_INDEX_RE_TEMPLATE.format(pon=int(pon)), re.IGNORECASE)

    for original in (raw or "").replace("\r", "").splitlines():
        match = index_re.search(original)
        if not match:
            continue

        onu_id = int(match.group(1))
        tail = original[match.end():].strip(" \t|:-")
        tail = re.sub(r"^description\s*[:=]?\s*", "", tail, flags=re.IGNORECASE).strip()

        if tail and tail not in {"-", "--", "---"} and not re.fullmatch(r"(?:none|null|n/a)", tail, re.IGNORECASE):
            named.add(onu_id)

    return named


@router.get("/{router_id}/olt/onu-summary")
async def onu_summary(
    router_id: str,
    pon: int = 1,
    total: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """
    Resumen ligero para los cuatro indicadores de la pestaña ONUs.

    Se evita consultar ONU por ONU. Como máximo se ejecutan unas pocas consultas
    globales dentro de UNA sola sesión CLI para no saturar Telnet de la VSOL.
    """
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    pon = max(1, min(int(pon or 1), int(getattr(olt, "pon_ports", 8) or 8)))
    total = max(0, int(total or 0))

    status_raw = ""
    description_raw = ""
    optical_raw = ""
    commands = []

    try:
        async with olt_service.connect(olt) as cli:
            # Global config: algunos firmwares VSOL exponen aquí estado y descripción.
            cfg = await cli.run("configure terminal", raise_on_error=False)
            commands.append("configure terminal")

            if _valid(cfg) or not _BAD_RE.search(cfg or ""):
                status_all = await cli.run("show onu status all", raise_on_error=False)
                commands.append("show onu status all")
                if _valid(status_all):
                    status_raw = status_all

                desc_all = await cli.run("show onu description", raise_on_error=False)
                commands.append("show onu description")
                if _valid(desc_all):
                    description_raw = desc_all

            # PON seleccionado: comando documentado para V1600G GPON.
            iface = f"interface gpon 0/{pon}"
            iface_raw = await cli.run(iface, raise_on_error=False)
            commands.append(iface)

            if not _BAD_RE.search(iface_raw or ""):
                status_pon = await cli.run("show onu info", raise_on_error=False)
                commands.append("show onu info")
                if _valid(status_pon):
                    # Preferimos el estado del PON específico si realmente trae estados.
                    on, off = _parse_status(status_pon, pon)
                    if on or off:
                        status_raw = status_pon

                optical = await cli.run("show pon onu all rx-power", raise_on_error=False)
                commands.append("show pon onu all rx-power")
                if _valid(optical):
                    optical_raw = optical

    except Exception as exc:
        # Esta lectura es auxiliar; no debe tumbar el estado general de la OLT.
        return {
            "ok": False,
            "error": str(exc),
            "total": total,
            "online": 0,
            "offline": 0,
            "named": 0,
            "source": "error",
            "commands": commands,
        }

    online_ids, offline_ids = _parse_status(status_raw, pon)
    source = "status" if (online_ids or offline_ids) else ""

    if not online_ids and not offline_ids:
        online_ids = _parse_optical_online(optical_raw, pon)
        if online_ids:
            source = "optical"

    named_ids = _parse_named(description_raw, pon)

    online_count = len(online_ids)
    if offline_ids:
        offline_count = len(offline_ids)
    elif total and online_count <= total:
        offline_count = total - online_count
    else:
        offline_count = 0

    return {
        "ok": True,
        "total": total,
        "online": online_count,
        "offline": offline_count,
        "named": len(named_ids),
        "source": source or "none",
        "commands": commands,
    }
