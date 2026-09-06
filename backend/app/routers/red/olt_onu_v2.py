"""
Archivo: backend/app/routers/red/olt_onu_v2.py
Pertenece a: Red > OLT > pestaña "ONUs" (versión 2, recreada desde cero).
Función: Construye un inventario canónico de ONUs del PON seleccionado usando SOLO
         comandos confirmados por el CLI de la VSOL: `show onu state`, `show onu info`
         y `show pon rx_power`. `show onu state` es la fuente autoritativa del ONU ID.
Regla: Este archivo NO reutiliza `parse_table()` ni el inventario antiguo, porque ese
       parser desplazaba columnas y generaba IDs falsos como 101/111/121. Si no se
       reconoce `show onu state`, se devuelve error y NUNCA se inventan ONU IDs.
       Mantener este módulo aislado de Resumen, Puertos PON, Auto-find y Consola.
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

_ONLINE_WORDS = {"working", "online", "registered", "active", "up", "operation"}
_OFFLINE_WORDS = {"offline", "los", "down", "inactive", "deregistered", "dying-gasp", "dyinggasp"}
_MODE_RE = re.compile(r"^(?:sn|loid|mac|password|sn-password)$", re.IGNORECASE)
_DBM_RE = re.compile(r"^(-?\d+(?:\.\d+)?)\s*(?:dbm)?$", re.IGNORECASE)


def _valid(raw: str) -> bool:
    return bool((raw or "").strip()) and not _BAD_RE.search(raw or "")


def _parse_index_token(token: str, selected_pon: int) -> Optional[int]:
    """Devuelve SOLO el ONU ID si el token pertenece al PON seleccionado."""
    value = (token or "").strip().strip("|,;")
    pon = int(selected_pon)

    # 1/1/1:7, 1/1/8:26, etc.
    m = re.fullmatch(r"(?:\d+/)+(?P<pon>\d+):(?P<onu>\d+)", value, re.IGNORECASE)
    if m and int(m.group("pon")) == pon:
        onu = int(m.group("onu"))
        return onu if 1 <= onu <= 128 else None

    # GPON0/1:7, EPON0/1:7 o 0/1:7.
    m = re.fullmatch(r"(?:(?:GPON|EPON))?0/(?P<pon>\d+):(?P<onu>\d+)", value, re.IGNORECASE)
    if m and int(m.group("pon")) == pon:
        onu = int(m.group("onu"))
        return onu if 1 <= onu <= 128 else None

    # GPON0/1/7 o 0/1/7.
    m = re.fullmatch(r"(?:(?:GPON|EPON))?0/(?P<pon>\d+)/(?P<onu>\d+)", value, re.IGNORECASE)
    if m and int(m.group("pon")) == pon:
        onu = int(m.group("onu"))
        return onu if 1 <= onu <= 128 else None

    return None


def _line_index(tokens: list[str], pon: int):
    """Retorna (onu_id, cantidad_de_tokens_consumidos) o (None, 0)."""
    if not tokens:
        return None, 0

    onu = _parse_index_token(tokens[0], pon)
    if onu:
        return onu, 1

    # Variante de tabla con PON ID y ONU ID en columnas separadas: `1  7  ...`.
    if len(tokens) >= 2 and tokens[0].isdigit() and tokens[1].isdigit():
        if int(tokens[0]) == int(pon):
            onu = int(tokens[1])
            if 1 <= onu <= 128:
                return onu, 2

    return None, 0


def _parse_state(raw: str, pon: int) -> dict[int, dict]:
    """Parsea `show onu state`; esta tabla manda sobre los ONU ID."""
    result: dict[int, dict] = {}

    for line in (raw or "").replace("\r", "").splitlines():
        stripped = line.strip()
        if not stripped or set(stripped) <= {"-", "=", "+", "|"}:
            continue

        tokens = stripped.replace("|", " ").split()
        onu_id, consumed = _line_index(tokens, pon)
        if not onu_id:
            continue

        rest = tokens[consumed:]
        admin = rest[0] if len(rest) > 0 else ""
        omcc = rest[1] if len(rest) > 1 else ""
        phase = rest[2] if len(rest) > 2 else ""
        config = rest[3] if len(rest) > 3 else ""
        channel = " ".join(rest[4:]) if len(rest) > 4 else ""

        phase_low = phase.lower()
        row_low = " ".join(rest).lower()
        if phase_low in _ONLINE_WORDS or any(re.search(rf"\b{re.escape(w)}\b", row_low) for w in _ONLINE_WORDS):
            status = "online"
        elif phase_low in _OFFLINE_WORDS or any(re.search(rf"\b{re.escape(w)}\b", row_low) for w in _OFFLINE_WORDS):
            status = "offline"
        else:
            status = "unknown"

        result[onu_id] = {
            "pon_id": int(pon),
            "onu_id": onu_id,
            "system_state": admin,
            "omcc_state": omcc,
            "phase_state": phase,
            "config_state": config,
            "channel": channel,
            "status": status,
        }

    return result


def _parse_info(raw: str, pon: int) -> dict[int, dict]:
    """
    Parsea `show onu info` sin usar anchos de columna.

    Se interpreta desde la derecha cuando aparece el modo de autorización (Sn/Loid/Mac):
      IDX [estado] [descripción] MODELO PERFIL MODO INFO
    De esta forma una descripción con guiones/guiones bajos no desplaza el resto.
    """
    result: dict[int, dict] = {}

    for line in (raw or "").replace("\r", "").splitlines():
        stripped = line.strip()
        if not stripped or set(stripped) <= {"-", "=", "+", "|"}:
            continue

        tokens = stripped.replace("|", " ").split()
        onu_id, consumed = _line_index(tokens, pon)
        if not onu_id:
            continue

        rest = tokens[consumed:]
        if not rest:
            continue

        mode_index = next((i for i, token in enumerate(rest) if _MODE_RE.match(token)), None)
        model = profile = mode = auth_info = description = info_status = ""

        if mode_index is not None:
            mode = rest[mode_index]
            auth_info = rest[mode_index + 1] if mode_index + 1 < len(rest) else ""
            profile = rest[mode_index - 1] if mode_index >= 1 else ""
            model = rest[mode_index - 2] if mode_index >= 2 else ""
            prefix = rest[:max(0, mode_index - 2)]
        else:
            # Fallback conservador: solo usa los últimos campos si hay estructura suficiente.
            prefix = []
            if len(rest) >= 4:
                model, profile, mode, auth_info = rest[-4:]
                prefix = rest[:-4]
            elif len(rest) >= 2:
                model = rest[0]
                profile = rest[1]
                prefix = rest[2:]

        if prefix:
            if prefix[0].lower() in {"online", "offline", "working", "enable", "disable", "up", "down"}:
                info_status = prefix[0]
                description = " ".join(prefix[1:])
            else:
                description = " ".join(prefix)

        result[onu_id] = {
            "description": description,
            "model": model,
            "profile": profile,
            "auth_mode": mode,
            "auth_info": auth_info,
            "info_status": info_status,
        }

    return result


def _parse_optical(raw: str, pon: int) -> dict[int, dict]:
    """Extrae RX/TX únicamente cuando la línea contiene valores ópticos reconocibles."""
    result: dict[int, dict] = {}

    for line in (raw or "").replace("\r", "").splitlines():
        stripped = line.strip()
        if not stripped:
            continue

        tokens = stripped.replace("|", " ").split()
        onu_id, consumed = _line_index(tokens, pon)
        if not onu_id:
            continue

        numeric = []
        for token in tokens[consumed:]:
            clean = token.strip().rstrip(",;")
            m = _DBM_RE.match(clean)
            if not m:
                continue
            try:
                value = float(m.group(1))
            except ValueError:
                continue
            # Potencias ópticas típicas; evita confundir IDs, distancia, etc.
            if -50.0 <= value <= 20.0:
                numeric.append(value)

        if numeric:
            result[onu_id] = {
                "rx_power": f"{numeric[0]:g} dBm",
                "tx_power": f"{numeric[1]:g} dBm" if len(numeric) > 1 else "",
            }

    return result


@router.get("/{router_id}/olt/onus-v2")
async def onus_v2(
    router_id: str,
    pon: int = 1,
    db: AsyncSession = Depends(get_db),
):
    """Inventario ONU v2: sin parser antiguo y sin IDs inferidos."""
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    max_pon = int(getattr(olt, "pon_ports", 8) or 8)
    pon = max(1, min(int(pon or 1), max_pon))

    state_raw = info_raw = optical_raw = ""
    commands = []

    try:
        async with olt_service.connect(olt) as cli:
            state_raw = await cli.run_pon(pon, "show onu state", raise_on_error=False)
            commands.append("show onu state")

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

    if not _valid(state_raw):
        return {
            "ok": False,
            "error": "La OLT no devolvió una tabla válida para `show onu state`.",
            "pon": pon,
            "onus": [],
            "counts": {"total": 0, "online": 0, "offline": 0, "unknown": 0},
            "commands": commands,
            "raw": {"state": state_raw, "info": info_raw, "optical": optical_raw},
        }

    state = _parse_state(state_raw, pon)
    if not state:
        return {
            "ok": False,
            "error": "No se reconocieron ONU ID reales en `show onu state`. No se usarán datos del parser antiguo.",
            "pon": pon,
            "onus": [],
            "counts": {"total": 0, "online": 0, "offline": 0, "unknown": 0},
            "commands": commands,
            "raw": {"state": state_raw, "info": info_raw, "optical": optical_raw},
        }

    info = _parse_info(info_raw, pon) if _valid(info_raw) else {}
    optical = _parse_optical(optical_raw, pon) if _valid(optical_raw) else {}

    onus = []
    for onu_id in sorted(state):
        row = dict(state[onu_id])
        row.update(info.get(onu_id, {}))
        row.update(optical.get(onu_id, {}))
        onus.append(row)

    counts = {
        "total": len(onus),
        "online": sum(1 for row in onus if row.get("status") == "online"),
        "offline": sum(1 for row in onus if row.get("status") == "offline"),
        "unknown": sum(1 for row in onus if row.get("status") == "unknown"),
    }

    return {
        "ok": True,
        "error": "",
        "pon": pon,
        "onus": onus,
        "counts": counts,
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
