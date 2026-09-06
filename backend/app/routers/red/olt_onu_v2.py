"""
Archivo: backend/app/routers/red/olt_onu_v2.py
Pertenece a: Red > OLT > pestaña "ONUs" recreada desde cero.
Función: Lee inventario, estado, autorización y óptica de ONUs del PON seleccionado.
Regla: Este archivo es INDEPENDIENTE. No usa parse_table() ni el inventario antiguo.
       El ONU ID siempre sale de `show onu state`; nunca se fabrican IDs como 101/111/121.

Formato REAL observado en esta VSOL V1600G1-B para `show onu state`:
    GPON0/1:112Cenable27Cenable41Cworking56CMSTC8cb4fdc9

Los textos 12C/27C/41C/56C son restos de posicionamiento ANSI. Esa fila significa:
    GPON0/1:1 | enable | enable | working | MSTC8cb4fdc9

IMPORTANTE PARA `show onu info`:
- Description es el nombre configurado directamente en la VSOL.
- El índice visual de esa tabla puede quedar contaminado por los marcadores ANSI.
- Por eso cada registro de `show onu info` se enlaza con la ONU REAL usando Serial/AuthInfo
  obtenido previamente de `show onu state`.
- Las líneas partidas por el terminal se vuelven a unir antes de separar las columnas.
- Nunca se reemplaza el Serial correcto de `show onu state` por una lectura parcial.

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
_ROW_START_RE = re.compile(r"^(?:GPON|EPON)0/\d+:", re.I)


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

    m = re.match(
        rf"^(?:GPON|EPON)0/{int(pon)}:(\d{{1,3}})(?:\s+|\||,)(.*)$",
        text,
        re.I,
    )
    if m:
        onu_id = int(m.group(1))
        if 1 <= onu_id <= 128:
            return onu_id, m.group(2).strip()

    # Formato real observado: GPON0/1:1 + 12C + primera columna.
    marker = re.match(
        rf"^(?:GPON|EPON)0/{int(pon)}:(\d{{1,3}})12C(.*)$",
        text,
        re.I,
    )
    if marker:
        onu_id = int(marker.group(1))
        if 1 <= onu_id <= 128:
            return onu_id, "12C" + marker.group(2)

    m = re.match(rf"^(?:\d+/)+{int(pon)}:(\d{{1,3}})(?:\s+|\||,)(.*)$", text, re.I)
    if m:
        onu_id = int(m.group(1))
        if 1 <= onu_id <= 128:
            return onu_id, m.group(2).strip()

    m = re.match(r"^(\d{1,3})\s+(.+)$", text)
    if m:
        onu_id = int(m.group(1))
        if 1 <= onu_id <= 128:
            return onu_id, m.group(2).strip()

    return None


def _cursor_fields(rest: str) -> list[str]:
    """Separa columnas de una fila ANSI de `show onu state`."""
    value = (rest or "").strip()
    if not value:
        return []

    value = re.sub(r"^12C", "", value, count=1, flags=re.I)
    if _CURSOR_RE.search(value):
        fields = [part.strip() for part in _CURSOR_RE.split(value) if part.strip()]
        if fields:
            return fields

    return [part.strip() for part in re.split(r"\s{2,}|\|", value) if part.strip()]


def _status_from(*values: str) -> str:
    text = " ".join(str(v or "") for v in values)
    if _OFFLINE_RE.search(text):
        return "offline"
    if _ONLINE_RE.search(text):
        return "online"
    return "unknown"


def _parse_state(raw: str, pon: int) -> dict[int, dict]:
    """`show onu state` es la fuente autoritativa de ONU ID, estado y Serial."""
    result: dict[int, dict] = {}

    for original in (raw or "").splitlines():
        found = _path_prefix(original, pon)
        if not found:
            continue

        onu_id, rest = found
        fields = _cursor_fields(rest)
        if len(fields) < 3:
            fields = rest.split()
        if len(fields) < 3:
            continue

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


def _info_records(raw: str, pon: int) -> list[str]:
    """
    Reconstruye registros de `show onu info`.

    La VSOL puede partir una Description larga en varias líneas. Cada registro nuevo empieza
    por GPON0/PON:ONU; cualquier línea posterior se agrega al mismo registro hasta detectar
    el siguiente índice. Se concatenan sin espacios para no alterar nombres con guiones bajos.
    """
    records: list[str] = []
    current: list[str] = []
    expected = re.compile(rf"^(?:GPON|EPON)0/{int(pon)}:", re.I)

    for original in (raw or "").splitlines():
        line = _clean_line(original)
        if not line:
            continue

        if expected.match(line):
            if current:
                records.append("".join(current))
            current = [line]
            continue

        if current:
            # Ignora encabezados/separadores que puedan aparecer por paginación.
            low = line.lower()
            if set(line) <= {"-", "=", "+", "|"}:
                continue
            if "onuindex" in low or ("description" in low and "model" in low):
                continue
            current.append(line)

    if current:
        records.append("".join(current))

    return records


def _find_onu_by_serial(record: str, state: dict[int, dict]) -> Optional[int]:
    """Relaciona un registro de `show onu info` con una ONU mediante Serial/AuthInfo."""
    record_norm = _norm_token(record)
    if not record_norm:
        return None

    candidates = []
    for onu_id, row in state.items():
        serial = _norm_token(row.get("serial") or row.get("auth_info") or "")
        if len(serial) >= 4:
            candidates.append((len(serial), onu_id, serial))

    for _, onu_id, serial in sorted(candidates, reverse=True):
        if serial in record_norm:
            return onu_id

    return None


def _strip_info_index(record: str, pon: int) -> str:
    """Quita índice ONU y el PRIMER marcador ANSI sin intentar leer el ONU ID."""
    text = _clean_line(record)

    # Caso ANSI real: GPON0/1:<id><posición>C...
    text2 = re.sub(
        rf"^(?:GPON|EPON)0/{int(pon)}:\d+C",
        "",
        text,
        count=1,
        flags=re.I,
    )
    if text2 != text:
        return text2.strip()

    # Caso limpio con espacios.
    text2 = re.sub(
        rf"^(?:GPON|EPON)0/{int(pon)}:\d{{1,3}}\s+",
        "",
        text,
        count=1,
        flags=re.I,
    )
    if text2 != text:
        return text2.strip()

    # Variante chassis/slot/PON:ONU.
    return re.sub(
        rf"^(?:\d+/)+{int(pon)}:\d{{1,3}}(?:\d{{1,3}}C|\s+)",
        "",
        text,
        count=1,
        flags=re.I,
    ).strip()


def _info_fields(record: str, pon: int) -> list[str]:
    """Devuelve columnas de `show onu info` ya sin el índice visual."""
    body = _strip_info_index(record, pon)
    if not body:
        return []

    if _CURSOR_RE.search(body):
        return [part.strip() for part in _CURSOR_RE.split(body) if part.strip()]

    # Salida sin secuencias ANSI: conserva Description como una sola columna cuando
    # la OLT usa dos o más espacios para separar campos.
    fields = [part.strip() for part in re.split(r"\s{2,}|\|", body) if part.strip()]
    if len(fields) > 1:
        return fields

    return body.split()


def _clean_description(parts: list[str]) -> str:
    """Limpia residuos de estado/índice y devuelve exactamente la Description de VSOL."""
    values = [str(part or "").strip() for part in parts if str(part or "").strip()]
    if not values:
        return ""

    # Status puede venir como primera columna antes de Description.
    if values and (
        _ONLINE_RE.fullmatch(values[0])
        or _OFFLINE_RE.fullmatch(values[0])
        or values[0].lower() in {"enable", "disable", "deactivated"}
    ):
        values = values[1:]

    # Nunca mostrar residuos del índice como Description.
    values = [v for v in values if not re.fullmatch(r"(?:GPON|EPON)0/\d+:?", v, re.I)]

    # Si el terminal partió visualmente el nombre, concatenar restaura el texto original.
    return "".join(values).strip()


def _parse_info(raw: str, pon: int, state: dict[int, dict]) -> dict[int, dict]:
    """
    Recupera Description/Model/Profile/Mode desde `show onu info`.

    La ONU se identifica por el Serial REAL de `show onu state`; después la fila se analiza
    desde la derecha: ... Description | Model | Profile | Mode | AuthInfo.
    """
    result: dict[int, dict] = {}

    for record in _info_records(raw, pon):
        onu_id = _find_onu_by_serial(record, state)
        if onu_id is None:
            continue

        serial = state[onu_id].get("serial") or state[onu_id].get("auth_info") or ""
        serial_norm = _norm_token(serial)
        fields = _info_fields(record, pon)
        if not fields:
            continue

        # Busca Mode (Sn/Loid/Mac...) desde la derecha. Esto fija Model y Profile sin
        # depender de la longitud de Description.
        mode_idx = next(
            (i for i in range(len(fields) - 1, -1, -1) if _MODE_RE.fullmatch(fields[i])),
            None,
        )

        description = ""
        model = ""
        profile = ""
        mode = ""
        info_status = ""

        if mode_idx is not None:
            mode = fields[mode_idx]
            profile = fields[mode_idx - 1] if mode_idx >= 1 else ""
            model = fields[mode_idx - 2] if mode_idx >= 2 else ""
            description = _clean_description(fields[:max(0, mode_idx - 2)])

            # Si la primera columna era Status, conservarla aparte.
            if fields and (_ONLINE_RE.fullmatch(fields[0]) or _OFFLINE_RE.fullmatch(fields[0])):
                info_status = fields[0]
        else:
            # Fallback: localizar la columna del Serial y tomar desde la derecha.
            serial_pos = next(
                (i for i, field in enumerate(fields) if serial_norm and serial_norm in _norm_token(field)),
                None,
            )
            if serial_pos is not None:
                before = fields[:serial_pos]
                if len(before) >= 3:
                    profile = before[-1]
                    model = before[-2]
                    description = _clean_description(before[:-2])

        result[onu_id] = {
            "description": description,
            "model": model,
            "profile": profile,
            "auth_mode": mode,
            # El serial de state es la autoridad: nunca usar una lectura truncada de info.
            "auth_info": serial,
            "info_status": info_status,
        }

    return result


def _parse_optical(raw: str, pon: int, allowed_ids: set[int]) -> dict[int, dict]:
    """Extrae potencia para ONU ID ya confirmados por `show onu state`."""
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
    """Inventario ONU v2 aislado usando la salida real de la VSOL."""
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    max_pon = int(getattr(olt, "pon_ports", 8) or 8)
    pon = max(1, min(int(pon or 1), max_pon))

    state_raw = info_raw = optical_raw = ""
    commands: list[str] = []

    try:
        async with olt_service.connect(olt) as cli:
            # 1) ONU ID, estado y serial reales.
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

            # 2) Description, Model, Profile, Mode y autorización configurados en VSOL.
            info_raw = await cli.run_pon(pon, "show onu info", raise_on_error=False)
            commands.append("show onu info")

            # 3) Potencia óptica global del PON.
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

        extra = info.get(onu_id, {})
        if extra:
            for key, value in extra.items():
                # Serial/AuthInfo correcto de state nunca se reemplaza por otra fuente.
                if key == "auth_info":
                    continue
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
            "description_and_authorization": "show onu info" if info else None,
            "optical": "show pon rx_power" if optical else None,
        },
        "raw": {
            "state": state_raw,
            "info": info_raw,
            "optical": optical_raw,
        },
    }
