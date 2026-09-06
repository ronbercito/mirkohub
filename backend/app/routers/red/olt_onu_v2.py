"""
Archivo: backend/app/routers/red/olt_onu_v2.py
Pertenece a: Red > OLT > pestaña "ONUs" recreada desde cero.
Función: Lee inventario/estado/autorización/óptica de ONUs del PON seleccionado.
Regla: Este archivo es INDEPENDIENTE. No usa parse_table() ni el inventario antiguo.
       El ONU ID siempre sale de `show onu state`; nunca se fabrican IDs como 101/111/121.

Formato REAL observado en esta VSOL V1600G1-B:
    GPON0/1:112Cenable27Cenable41Cworking56CMSTC8cb4fdc9

Los textos 12C/27C/41C/56C son restos de secuencias ANSI de posicionamiento de cursor
que el cliente Telnet actual dejó en la salida. En esa fila significan:
    GPON0/1:1 | enable | enable | working | MSTC8cb4fdc9

Este módulo corrige SOLO esa salida para ONUs, sin tocar el limpiador CLI general ni
las pestañas Resumen, Puertos PON, Auto-find, Óptica ONU o Consola.
"""

import re
from typing import Optional

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
    r"unknown\s+command|invalid\s+command|command\s+not\s+found)",
    re.IGNORECASE,
)

_ONLINE_RE = re.compile(r"\b(?:working|online|registered|active|operation|syncmib|up)\b", re.I)
_OFFLINE_RE = re.compile(r"\b(?:offline|los|down|inactive|deregistered|dying[-\s]?gasp)\b", re.I)
_MODE_RE = re.compile(r"^(?:sn|loid|mac|password|sn-password)$", re.I)
_DBM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _valid(raw: str) -> bool:
    return bool((raw or "").strip()) and not _BAD_RE.search(raw or "")


def _clean_line(line: str) -> str:
    value = (line or "").replace("\r", "").replace("\x00", "").strip()
    value = re.sub(
        r"^(?:gpon-olt|epon-olt|v1600[^\s#>]*)[^#>]*[#>]\s*",
        "",
        value,
        flags=re.I,
    )
    return value.strip()


def _path_prefix(line: str, pon: int) -> Optional[tuple[int, str]]:
    """Extrae ONU ID y resto de una fila con índice GPON0/PON:ONU."""
    text = _clean_line(line)

    # Caso limpio con separador visible después del ID.
    m = re.match(
        rf"^(?:GPON|EPON)0/{int(pon)}:(\d{{1,3}})(?:\s+|\||,)(.*)$",
        text,
        re.I,
    )
    if m:
        onu_id = int(m.group(1))
        if 1 <= onu_id <= 128:
            return onu_id, m.group(2).strip()

    # Formato REAL visto en esta OLT. El primer salto de cursor es 12C.
    # Ejemplo: GPON0/1:112Cenable...  => ONU 1 + 12C.
    marker = re.match(
        rf"^(?:GPON|EPON)0/{int(pon)}:(\d{{1,3}})12C(.*)$",
        text,
        re.I,
    )
    if marker:
        onu_id = int(marker.group(1))
        if 1 <= onu_id <= 128:
            return onu_id, "12C" + marker.group(2)

    # Variantes chassis/slot/PON:ONU.
    m = re.match(rf"^(?:\d+/)+{int(pon)}:(\d{{1,3}})(?:\s+|\||,)(.*)$", text, re.I)
    if m:
        onu_id = int(m.group(1))
        if 1 <= onu_id <= 128:
            return onu_id, m.group(2).strip()

    # Dentro de interface gpon 0/X algunos firmwares usan solo ONU ID como primera columna.
    m = re.match(r"^(\d{1,3})\s+(.+)$", text)
    if m:
        onu_id = int(m.group(1))
        if 1 <= onu_id <= 128:
            return onu_id, m.group(2).strip()

    return None


def _cursor_fields(rest: str) -> list[str]:
    """
    Convierte restos como `12Cenable27Cenable41Cworking56CSERIAL` en campos.
    No interpreta números normales del contenido; solo marcadores NNC delante de columnas.
    """
    value = (rest or "").strip()
    if not value:
        return []

    # El primer 12C pertenece al inicio de la primera columna y se elimina.
    value = re.sub(r"^12C", "", value, count=1, flags=re.I)

    if re.search(r"\d{1,3}C", value):
        parts = [part.strip() for part in re.split(r"\d{1,3}C", value) if part.strip()]
        if parts:
            return parts

    # Tabla normal con espacios.
    return [part for part in re.split(r"\s{2,}|\|", value) if part.strip()]


def _status_from(*values: str) -> str:
    text = " ".join(str(v or "") for v in values)
    if _OFFLINE_RE.search(text):
        return "offline"
    if _ONLINE_RE.search(text):
        return "online"
    return "unknown"


def _parse_state(raw: str, pon: int) -> dict[int, dict]:
    """Parsea `show onu state`; es la fuente autoritativa de ONU ID y estado."""
    result: dict[int, dict] = {}

    for original in (raw or "").splitlines():
        found = _path_prefix(original, pon)
        if not found:
            continue

        onu_id, rest = found
        fields = _cursor_fields(rest)
        if len(fields) < 3:
            # Fallback por palabras si la tabla vino con espacios simples.
            tokens = rest.split()
            if len(tokens) < 3:
                continue
            fields = tokens

        admin = fields[0] if len(fields) > 0 else ""
        omcc = fields[1] if len(fields) > 1 else ""
        phase = fields[2] if len(fields) > 2 else ""
        serial = fields[3] if len(fields) > 3 else ""

        result[onu_id] = {
            "pon_id": int(pon),
            "onu_id": onu_id,
            "system_state": admin,
            "omcc_state": omcc,
            "phase_state": phase,
            "status": _status_from(phase, admin, omcc),
            # show onu state de esta VSOL ya entrega Serial Number en la última columna.
            "serial": serial,
            "auth_info": serial,
        }

    return result


def _parse_info(raw: str, pon: int, allowed_ids: set[int]) -> dict[int, dict]:
    """Complementa Description/Model/Profile/Mode/AuthInfo sin alterar ONU ID."""
    result: dict[int, dict] = {}

    for original in (raw or "").splitlines():
        found = _path_prefix(original, pon)
        if not found:
            continue
        onu_id, rest = found
        if onu_id not in allowed_ids:
            continue

        fields = _cursor_fields(rest)
        if not fields:
            continue

        description = model = profile = mode = auth_info = info_status = ""

        # Forma típica VSOL: Status | Description | Model | Profile | Mode | Info
        if len(fields) >= 6:
            info_status, description, model, profile, mode, auth_info = fields[:6]
        elif len(fields) == 5:
            description, model, profile, mode, auth_info = fields
        elif len(fields) == 4:
            model, profile, mode, auth_info = fields
        else:
            # Si no hay columnas de cursor, intenta ubicar Mode desde la derecha.
            tokens = rest.split()
            mode_idx = next((i for i, token in enumerate(tokens) if _MODE_RE.match(token)), None)
            if mode_idx is not None:
                mode = tokens[mode_idx]
                auth_info = tokens[mode_idx + 1] if mode_idx + 1 < len(tokens) else ""
                profile = tokens[mode_idx - 1] if mode_idx >= 1 else ""
                model = tokens[mode_idx - 2] if mode_idx >= 2 else ""
                description = " ".join(tokens[:max(0, mode_idx - 2)])

        result[onu_id] = {
            "description": description,
            "model": model,
            "profile": profile,
            "auth_mode": mode,
            "auth_info": auth_info,
            "info_status": info_status,
        }

    return result


def _parse_optical(raw: str, pon: int, allowed_ids: set[int]) -> dict[int, dict]:
    """Extrae potencia de filas pertenecientes a ONU ID confirmados por show onu state."""
    result: dict[int, dict] = {}

    for original in (raw or "").splitlines():
        found = _path_prefix(original, pon)
        if not found:
            continue
        onu_id, rest = found
        if onu_id not in allowed_ids:
            continue

        # Quita marcadores de cursor antes de extraer números.
        clean = re.sub(r"\d{1,3}C", " ", rest)
        values = []
        for match in _DBM_RE.finditer(clean):
            try:
                number = float(match.group(0))
            except ValueError:
                continue
            if -50.0 <= number <= 20.0:
                values.append(number)

        if values:
            result[onu_id] = {
                "rx_power": f"{values[0]:g} dBm",
                "tx_power": f"{values[1]:g} dBm" if len(values) > 1 else "",
            }

    return result


def _counts(onus: list[dict]) -> dict:
    return {
        "total": len(onus),
        "online": sum(1 for row in onus if row.get("status") == "online"),
        "offline": sum(1 for row in onus if row.get("status") == "offline"),
        "unknown": sum(1 for row in onus if row.get("status") == "unknown"),
    }


@router.get("/{router_id}/olt/onus-v2")
async def onus_v2(
    router_id: str,
    pon: int = 1,
    db: AsyncSession = Depends(get_db),
):
    """Inventario ONU v2 aislado, usando la salida real observada de la VSOL."""
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    max_pon = int(getattr(olt, "pon_ports", 8) or 8)
    pon = max(1, min(int(pon or 1), max_pon))

    state_raw = info_raw = optical_raw = ""
    commands: list[str] = []

    try:
        async with olt_service.connect(olt) as cli:
            # 1) Primero estado: de aquí salen los ONU ID reales.
            state_raw = await cli.run_pon(pon, "show onu state", raise_on_error=False)
            commands.append("show onu state")
            state = _parse_state(state_raw, pon) if _valid(state_raw) else {}

            if not state:
                return {
                    "ok": False,
                    "error": "La OLT respondió, pero no se pudieron separar las columnas de `show onu state`.",
                    "pon": pon,
                    "onus": [],
                    "counts": {"total": 0, "online": 0, "offline": 0, "unknown": 0},
                    "commands": commands,
                    "raw": {"state": state_raw, "info": "", "optical": ""},
                }

            allowed_ids = set(state)

            # 2) Solo después de tener IDs reales se consultan los complementos.
            info_raw = await cli.run_pon(pon, "show onu info", raise_on_error=False)
            commands.append("show onu info")

            optical_raw = await cli.run_pon(pon, "show pon rx_power", raise_on_error=False)
            commands.append("show pon rx_power")

    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "pon": pon,
            "onus": [],
            "counts": {"total": 0, "online": 0, "offline": 0, "unknown": 0},
            "commands": commands,
            "raw": {"state": state_raw, "info": info_raw, "optical": optical_raw},
        }

    info = _parse_info(info_raw, pon, allowed_ids) if _valid(info_raw) else {}
    optical = _parse_optical(optical_raw, pon, allowed_ids) if _valid(optical_raw) else {}

    onus = []
    for onu_id in sorted(state):
        row = dict(state[onu_id])

        # No reemplazar el serial real obtenido de show onu state por un campo vacío.
        extra = info.get(onu_id, {})
        if extra:
            for key, value in extra.items():
                if value:
                    row[key] = value

        row.update(optical.get(onu_id, {}))
        onus.append(row)

    return {
        "ok": True,
        "error": "",
        "pon": pon,
        "onus": onus,
        "counts": _counts(onus),
        "commands": commands,
        "sources": {
            "identity_and_state": "show onu state",
            "authorization": "show onu info" if info else None,
            "optical": "show pon rx_power" if optical else None,
        },
        "raw": {
            "state": state_raw,
            "info": info_raw,
            "optical": optical_raw,
        },
    }
