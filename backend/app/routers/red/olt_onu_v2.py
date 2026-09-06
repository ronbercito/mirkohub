"""
Archivo: backend/app/routers/red/olt_onu_v2.py
Pertenece a: Red > OLT > pestaña "ONUs".
Función: Lee la lista real de ONUs del PON desde VSOL y combina estado, descripción,
         modelo, perfil, autorización y potencia sin usar el parser genérico antiguo.
Alcance: Orquesta inventario y estados; delega nombres al módulo de descripciones.
Regla: Este archivo es INDEPENDIENTE. No modificar Resumen, Puertos PON, Auto-find,
       Óptica ONU ni Consola desde aquí. `show onu info` es la autoridad para ONU ID.

Notas de esta VSOL V1600G1-B:
- El Telnet deja restos de cursor como 12C/27C/41C/56C pegados a las columnas.
- Ejemplo real: GPON0/1:112Cenable27Cenable41Cworking56CMSTC8cb4fdc9
  significa: ONU 1 | enable | enable | working | MSTC8cb4fdc9.
- Para evitar IDs falsos (101/111/121/128), los dígitos ONU+cursor se separan usando
  el orden real de las filas. Así `128C...` en la fila 12 se interpreta como ONU 12
  + cursor 8C, no como ONU 128.
- `show onu state` solo complementa el estado de las ONUs autorizadas.
- La descripción se extrae de `onu <id> desc ...` con un solo `show running-config`.
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
from app.routers.red.olt_onu_descriptions import _parse_running_config

router = APIRouter(dependencies=[Depends(get_current_user)])

_BAD_RE = re.compile(
    r"(?:%\s*(?:unknown|invalid|incomplete|ambiguous)\s+command|"
    r"unknown\s+command|invalid\s+command|command\s+not\s+found)", re.I
)
_ONLINE_RE = re.compile(r"\b(?:working|online|registered|active|operation|syncmib|up)\b", re.I)
_OFFLINE_RE = re.compile(r"\b(?:offline|los|down|inactive|deregistered|deactivated|disable|dying[-\s]?gasp)\b", re.I)
_MODE_RE = re.compile(r"^(?:sn|loid|mac|password|sn-password)$", re.I)
# Posiciones de columna observadas en la salida real de esta VSOL. No usar
# `\d+C`: rompería valores legítimos como GPT-...V6 seguido de 27C, o el SN
# MSTC8cb4fdc9 al confundir `8c` con un movimiento de cursor.
_CURSOR_RE = re.compile(r"(?:12|27|41|56)C")
_DBM_RE = re.compile(r"-?\d+(?:\.\d+)?")


def _valid(raw: str) -> bool:
    return bool((raw or "").strip()) and not _BAD_RE.search(raw or "")


def _clean_line(line: str) -> str:
    value = (line or "").replace("\r", "").replace("\x00", "").strip()
    value = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", value)
    value = re.sub(r"^(?:gpon-olt|epon-olt|v1600[^\s#>]*)[^#>]*[#>]\s*", "", value, flags=re.I)
    return value.strip()


def _norm(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9]", "", str(value or "")).lower()


def _compact_id(digits: str, previous: int, used: set[int]) -> Optional[tuple[int, str]]:
    """Separa ONU ID + desplazamiento de cursor cuando llegan pegados antes de C."""
    expected = previous + 1 if previous else 1
    options = []
    for cut in range(1, min(3, len(digits) - 1) + 1):
        onu_text = digits[:cut]
        cursor_text = digits[cut:]
        if not cursor_text:
            continue
        onu_id = int(onu_text)
        cursor = int(cursor_text)
        if not (1 <= onu_id <= 128 and 1 <= cursor <= 200):
            continue
        duplicate_penalty = 1000 if onu_id in used else 0
        # Las filas vienen ordenadas por ONU ID; esto resuelve 112C=>1+12C,
        # 1212C=>12+12C y 128C en la posición 12=>12+8C.
        score = duplicate_penalty + abs(onu_id - expected)
        options.append((score, onu_id, cursor_text))
    if not options:
        return None
    _, onu_id, cursor_text = min(options, key=lambda item: item[0])
    return onu_id, cursor_text


def _state_prefix(line: str, pon: int, previous: int, used: set[int]) -> Optional[tuple[int, str]]:
    """Extrae ONU ID real y resto de una fila de `show onu state`."""
    text = _clean_line(line)
    prefix = re.match(rf"^(?:GPON|EPON)0/{int(pon)}:(.*)$", text, re.I)
    if not prefix:
        return None
    tail = prefix.group(1)

    # Salida limpia: GPON0/1:12  enable ...
    clean = re.match(r"^(\d{1,3})(?:\s+|\||,)(.*)$", tail)
    if clean:
        onu_id = int(clean.group(1))
        if 1 <= onu_id <= 128 and onu_id not in used:
            return onu_id, clean.group(2).strip()

    # Salida real con ONU ID + cursor pegados: 112Cenable..., 128Cenable...
    compact = re.match(r"^(\d{2,6})C(.*)$", tail, re.I)
    if compact:
        separated = _compact_id(compact.group(1), previous, used)
        if separated:
            onu_id, cursor_digits = separated
            return onu_id, f"{cursor_digits}C{compact.group(2)}"

    return None


def _cursor_fields(rest: str) -> list[str]:
    value = (rest or "").strip()
    if not value:
        return []
    # Quita el cursor que posiciona la primera columna.
    value = re.sub(r"^\d{1,3}C", "", value, count=1, flags=re.I)
    if _CURSOR_RE.search(value):
        return [p.strip() for p in _CURSOR_RE.split(value) if p.strip()]
    fields = [p.strip() for p in re.split(r"\s{2,}|\|", value) if p.strip()]
    return fields if len(fields) > 1 else value.split()


def _status(*values: str) -> str:
    text = " ".join(str(v or "") for v in values)
    if re.search(r"\bdying[-\s]?gasp\b", text, re.I):
        return "dyinggasp"
    if re.search(r"\bdeactivated\b", text, re.I):
        return "deactivated"
    if _OFFLINE_RE.search(text):
        return "offline"
    if _ONLINE_RE.search(text):
        return "online"
    return "unknown"


def _parse_state(raw: str, pon: int) -> dict[int, dict]:
    result: dict[int, dict] = {}
    previous = 0
    used: set[int] = set()

    for original in (raw or "").splitlines():
        found = _state_prefix(original, pon, previous, used)
        if not found:
            continue
        onu_id, rest = found
        fields = _cursor_fields(rest)
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
            "status": _status(phase, admin, omcc),
            "serial": serial,
            "auth_info": serial,
        }
        used.add(onu_id)
        previous = onu_id

    return result


def _info_records(raw: str, pon: int) -> list[str]:
    """Une las líneas partidas de cada registro de `show onu info`."""
    records: list[str] = []
    current: list[str] = []
    start = re.compile(rf"^(?:GPON|EPON)0/{int(pon)}:", re.I)

    for original in (raw or "").splitlines():
        line = _clean_line(original)
        if not line:
            continue
        if start.match(line):
            if current:
                records.append("".join(current))
            current = [line]
            continue
        if current:
            low = line.lower()
            if set(line) <= {"-", "=", "+", "|"}:
                continue
            if "onuindex" in low or ("description" in low and "model" in low):
                continue
            current.append(line)
    if current:
        records.append("".join(current))
    return records


def _find_by_serial(record: str, state: dict[int, dict]) -> Optional[int]:
    record_norm = _norm(record)
    candidates = []
    for onu_id, row in state.items():
        serial = _norm(row.get("serial") or row.get("auth_info") or "")
        if len(serial) >= 4:
            candidates.append((len(serial), onu_id, serial))
    for _, onu_id, serial in sorted(candidates, reverse=True):
        if serial in record_norm:
            return onu_id
    return None


def _info_fields(record: str, pon: int, onu_id: int) -> list[str]:
    """Quita EXACTAMENTE el índice conocido y después separa las columnas ANSI."""
    text = _clean_line(record)
    # Fundamental: no usar \d+C aquí, porque consumiría ONU ID + cursor juntos.
    text = re.sub(
        rf"^(?:GPON|EPON)0/{int(pon)}:{int(onu_id)}",
        "",
        text,
        count=1,
        flags=re.I,
    ).strip()
    if not text:
        return []
    text = re.sub(r"^\d{1,3}C", "", text, count=1, flags=re.I)
    if _CURSOR_RE.search(text):
        return [p.strip() for p in _CURSOR_RE.split(text) if p.strip()]
    fields = [p.strip() for p in re.split(r"\s{2,}|\|", text) if p.strip()]
    return fields if len(fields) > 1 else text.split()


def _clean_description(parts: list[str]) -> str:
    values = [str(x or "").strip() for x in parts if str(x or "").strip()]
    if values and (
        _ONLINE_RE.fullmatch(values[0])
        or _OFFLINE_RE.fullmatch(values[0])
        or values[0].lower() in {"enable", "disable", "deactivated"}
    ):
        values = values[1:]
    return "".join(values).strip()


def _parse_info(raw: str, pon: int, state: Optional[dict[int, dict]] = None) -> dict[int, dict]:
    """Parsea el inventario autorizado: Onuindex | Model | Profile | Mode | AuthInfo."""
    result: dict[int, dict] = {}
    previous = 0
    used: set[int] = set()
    for record in _info_records(raw, pon):
        found = _state_prefix(record, pon, previous, used)
        if not found:
            continue
        onu_id, rest = found
        fields = _cursor_fields(rest)
        if not fields:
            continue

        mode_idx = next(
            (i for i in range(len(fields) - 1, -1, -1) if _MODE_RE.fullmatch(fields[i])),
            None,
        )
        if mode_idx is None or mode_idx < 2:
            continue

        # Orden REAL confirmado: Model | Profile | Mode | AuthInfo.
        mode = fields[mode_idx]
        profile = fields[mode_idx - 1]
        model = fields[mode_idx - 2]
        auth_info = "".join(fields[mode_idx + 1:]).strip()

        result[onu_id] = {
            "pon_id": int(pon),
            "onu_id": onu_id,
            "model": model,
            "profile": profile,
            "auth_mode": mode,
            "auth_info": auth_info,
            "serial": auth_info,
        }
        used.add(onu_id)
        previous = onu_id
    return result


def _optical_prefix(line: str, pon: int, allowed: set[int]) -> Optional[tuple[int, str]]:
    """Extrae un ID óptico solo si ya existe en el inventario real."""
    text = _clean_line(line)
    for onu_id in sorted(allowed, key=lambda x: len(str(x)), reverse=True):
        m = re.match(rf"^(?:GPON|EPON)0/{int(pon)}:{onu_id}(.*)$", text, re.I)
        if m:
            return onu_id, m.group(1)
    return None


def _parse_optical(raw: str, pon: int, allowed: set[int]) -> dict[int, dict]:
    result: dict[int, dict] = {}
    for original in (raw or "").splitlines():
        found = _optical_prefix(original, pon, allowed)
        if not found:
            continue
        onu_id, rest = found
        clean = _CURSOR_RE.sub(" ", rest)
        values = []
        for match in _DBM_RE.finditer(clean):
            try:
                value = float(match.group(0))
            except ValueError:
                continue
            if -50 <= value <= 20:
                values.append(value)
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
        "offline": sum(1 for row in onus if row.get("status") in {"offline", "dyinggasp", "deactivated"}),
        "unknown": sum(1 for row in onus if row.get("status") == "unknown"),
    }


@router.get("/{router_id}/olt/onus-v2")
async def onus_v2(router_id: str, pon: int = 1, db: AsyncSession = Depends(get_db)):
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    max_pon = int(getattr(olt, "pon_ports", 8) or 8)
    pon = max(1, min(int(pon or 1), max_pon))
    state_raw = info_raw = running_raw = ""

    try:
        async with olt_service.connect(olt) as cli:
            # Inventario autorizado: esta es la única fuente que decide qué ONUs existen.
            info_raw = await cli.run_pon(pon, "show onu info", raise_on_error=False)
            info = _parse_info(info_raw, pon) if _valid(info_raw) else {}
            if not info:
                return {
                    "ok": False,
                    "error": "No se pudieron interpretar las ONUs autorizadas de `show onu info`.",
                    "pon": pon,
                    "onus": [],
                    "counts": {"total": 0, "online": 0, "offline": 0, "unknown": 0},
                    "raw": {"state": "", "info": info_raw, "running_config": "", "optical": ""},
                }

            # Estado complementario: nunca agrega ONUs que no estén en `show onu info`.
            state_raw = await cli.run_pon(pon, "show onu state", raise_on_error=False)
            state = _parse_state(state_raw, pon) if _valid(state_raw) else {}
            # Una sola consulta para todas las descripciones del PON.
            running_raw = await cli.run_pon(pon, "show running-config", raise_on_error=False)
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "pon": pon,
            "onus": [],
            "counts": {"total": 0, "online": 0, "offline": 0, "unknown": 0},
            "raw": {"state": state_raw, "info": info_raw, "running_config": running_raw, "optical": ""},
        }

    descriptions = _parse_running_config(running_raw, set(info), pon) if _valid(running_raw) else {}

    onus = []
    for onu_id in sorted(info):
        row = dict(info[onu_id])
        for key in ("status", "system_state", "omcc_state", "phase_state"):
            if key in state.get(onu_id, {}):
                row[key] = state[onu_id][key]
        row["description"] = descriptions.get(onu_id, "")
        row.setdefault("status", "unknown")
        row.setdefault("system_state", "")
        row.setdefault("omcc_state", "")
        row.setdefault("phase_state", "")
        onus.append(row)

    return {
        "ok": True,
        "error": "",
        "pon": pon,
        "onus": onus,
        "counts": _counts(onus),
        "sources": {
            "inventory_model_profile_auth": "show onu info",
            "state": "show onu state",
            "description": "show running-config: onu <id> desc",
            "optical": None,
        },
        "raw": {"state": state_raw, "info": info_raw, "running_config": running_raw, "optical": ""},
    }
