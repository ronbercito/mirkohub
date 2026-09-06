"""
Archivo: backend/app/routers/red/olt_onu_v2.py
Pertenece a: Red > OLT > pestaña "ONUs" recreada desde cero.
Función: Lee inventario/estado/autorización/óptica de ONUs del PON seleccionado.
Regla: Este archivo es INDEPENDIENTE. No usa parse_table() ni el inventario antiguo.
       El ONU ID siempre sale de `show onu state`; nunca se fabrican IDs como 101/111/121.

Formato REAL observado en esta VSOL V1600G1-B:
    GPON0/1:112Cenable27Cenable41Cworking56CMSTC8cb4fdc9

Los textos 12C/27C/41C/56C son restos de secuencias ANSI de posicionamiento de cursor.
En esa fila significan:
    GPON0/1:1 | enable | enable | working | MSTC8cb4fdc9

IMPORTANTE PARA `show onu info`:
- El primer marcador de cursor puede variar y puede quedar pegado al ONU ID.
- Por eso Description/Model/Profile/Mode NO se enlazan usando el índice corruptible.
- Se enlazan por el Serial/AuthInfo que ya fue obtenido de `show onu state`.
  Esto evita volver a generar IDs falsos y permite recuperar las demás columnas.

Este módulo corrige SOLO ONUs v2. No toca Resumen, Puertos PON, Auto-find,
Óptica ONU, Consola ni el limpiador Telnet general.
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
_CURSOR_RE = re.compile(r"\d{1,3}C", re.I)


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


def _norm_token(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]", "", str(value or "")).lower()


def _path_prefix(line: str, pon: int) -> Optional[tuple[int, str]]:
    """Extrae ONU ID y resto de una fila de `show onu state`."""
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

    # Formato real de show onu state en esta OLT: ONU ID + 12C.
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

    # Dentro de interface gpon 0/X algunos firmwares usan solo ONU ID.
    m = re.match(r"^(\d{1,3})\s+(.+)$", text)
    if m:
        onu_id = int(m.group(1))
        if 1 <= onu_id <= 128:
            return onu_id, m.group(2).strip()

    return None


def _cursor_fields(rest: str) -> list[str]:
    """Separa columnas cuando quedaron marcadores ANSI NNC dentro del texto."""
    value = (rest or "").strip()
    if not value:
        return []

    value = re.sub(r"^12C", "", value, count=1, flags=re.I)

    if _CURSOR_RE.search(value):
        parts = [part.strip() for part in _CURSOR_RE.split(value) if part.strip()]
        if parts:
            return parts

    return [part.strip() for part in re.split(r"\s{2,}|\|", value) if part.strip()]


def _all_cursor_columns(line: str) -> list[str]:
    """
    Separa una fila completa sin intentar interpretar el ONU ID.

    Esto es especialmente útil para `show onu info`, porque el primer marcador ANSI
    puede quedar pegado al índice y hacer que un ONU 1 parezca 111. El enlace de esa
    fila se hará después por Serial/AuthInfo, no por el índice textual.
    """
    text = _clean_line(line)
    if not text or not _CURSOR_RE.search(text):
        return []

    parts = [part.strip() for part in _CURSOR_RE.split(text) if part.strip()]

    # El primer fragmento suele contener GPON0/PON:ONU. No es una columna de datos.
    if parts and re.search(r"(?:GPON|EPON)\s*0/\d+:\d+", parts[0], re.I):
        parts = parts[1:]

    return parts


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
            "serial": serial,
            "auth_info": serial,
        }

    return result


def _find_onu_by_serial(line: str, state: dict[int, dict]) -> Optional[int]:
    """Relaciona una fila de show onu info con una ONU usando Serial/AuthInfo."""
    line_norm = _norm_token(line)
    if not line_norm:
        return None

    # Seriales más largos primero para evitar coincidencias parciales.
    candidates = []
    for onu_id, row in state.items():
        serial = _norm_token(row.get("serial") or row.get("auth_info") or "")
        if len(serial) >= 4:
            candidates.append((len(serial), onu_id, serial))

    for _, onu_id, serial in sorted(candidates, reverse=True):
        if serial in line_norm:
            return onu_id

    return None


def _parse_info(raw: str, pon: int, state: dict[int, dict]) -> dict[int, dict]:
    """
    Complementa Description/Model/Profile/Mode/AuthInfo SIN confiar en el índice de
    `show onu info`. Cada fila se relaciona por Serial/AuthInfo proveniente de state.
    """
    result: dict[int, dict] = {}
    allowed_ids = set(state)

    for original in (raw or "").splitlines():
        line = _clean_line(original)
        if not line:
            continue

        # Método principal: Serial/AuthInfo ya confirmado por show onu state.
        onu_id = _find_onu_by_serial(line, state)

        # Fallback solo para formatos limpios; nunca acepta un ID que no exista en state.
        rest = ""
        if onu_id is None:
            found = _path_prefix(line, pon)
            if found and found[0] in allowed_ids:
                onu_id, rest = found

        if onu_id is None or onu_id not in allowed_ids:
            continue

        serial = state[onu_id].get("serial") or state[onu_id].get("auth_info") or ""

        # Primero intenta reconstruir columnas por marcadores ANSI.
        fields = _all_cursor_columns(line)

        description = model = profile = mode = auth_info = info_status = ""

        if fields:
            # Localiza la columna que contiene el serial de esta ONU.
            serial_norm = _norm_token(serial)
            serial_pos = None
            if serial_norm:
                for i, field in enumerate(fields):
                    if serial_norm in _norm_token(field):
                        serial_pos = i
                        break

            # VSOL típico desde la derecha:
            # Status | Description | Model | Profile | Mode | Info
            if serial_pos is not None:
                auth_info = serial
                before = fields[:serial_pos]

                if before:
                    mode = before[-1] if len(before) >= 1 else ""
                    profile = before[-2] if len(before) >= 2 else ""
                    model = before[-3] if len(before) >= 3 else ""
                    description = before[-4] if len(before) >= 4 else ""
                    info_status = before[-5] if len(before) >= 5 else ""

                    # Si no encontramos un Mode reconocido, intenta buscar Sn/Loid/Mac.
                    if mode and not _MODE_RE.match(mode):
                        mode_idx = next(
                            (i for i in range(len(before) - 1, -1, -1) if _MODE_RE.match(before[i])),
                            None,
                        )
                        if mode_idx is not None:
                            mode = before[mode_idx]
                            profile = before[mode_idx - 1] if mode_idx >= 1 else profile
                            model = before[mode_idx - 2] if mode_idx >= 2 else model
                            description = before[mode_idx - 3] if mode_idx >= 3 else description
                            info_status = before[mode_idx - 4] if mode_idx >= 4 else info_status

            elif len(fields) >= 6:
                # Último recurso si el serial sufrió alguna variación visual.
                info_status, description, model, profile, mode, auth_info = fields[-6:]

        # Fallback para salida realmente separada por espacios.
        if not any((description, model, profile, mode)):
            if not rest:
                found = _path_prefix(line, pon)
                rest = found[1] if found and found[0] == onu_id else ""

            tokens = rest.split() if rest else line.split()
            mode_idx = next((i for i, token in enumerate(tokens) if _MODE_RE.match(token)), None)
            if mode_idx is not None:
                mode = tokens[mode_idx]
                auth_info = serial or (tokens[mode_idx + 1] if mode_idx + 1 < len(tokens) else "")
                profile = tokens[mode_idx - 1] if mode_idx >= 1 else ""
                model = tokens[mode_idx - 2] if mode_idx >= 2 else ""
                prefix = tokens[:max(0, mode_idx - 2)]
                if prefix:
                    if _ONLINE_RE.search(prefix[0]) or _OFFLINE_RE.search(prefix[0]):
                        info_status = prefix[0]
                        description = " ".join(prefix[1:])
                    else:
                        description = " ".join(prefix)

        result[onu_id] = {
            "description": description,
            "model": model,
            "profile": profile,
            "auth_mode": mode,
            "auth_info": auth_info or serial,
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

        clean = _CURSOR_RE.sub(" ", rest)
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
            # 1) Estado: de aquí salen los ONU ID reales y el Serial/AuthInfo.
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

            # 2) Complementos. show onu info se relaciona por Serial, no por su índice visual.
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

    info = _parse_info(info_raw, pon, state) if _valid(info_raw) else {}
    optical = _parse_optical(optical_raw, pon, allowed_ids) if _valid(optical_raw) else {}

    onus = []
    for onu_id in sorted(state):
        row = dict(state[onu_id])

        # No reemplazar datos correctos de state por valores vacíos.
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
