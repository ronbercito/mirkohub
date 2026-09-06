"""
Archivo: backend/app/routers/red/olt_onu_v2.py
Pertenece a: Red > OLT > pestaña "ONUs" (versión 2 recreada desde cero).
Función: Construye el inventario de ONUs del PON seleccionado usando únicamente
         comandos confirmados en la CLI VSOL: `show onu state`, `show onu info`
         y `show pon rx_power`.
Regla: Este archivo es independiente. NO reutiliza parse_table() ni el inventario
       antiguo. `show onu state` manda sobre el ONU ID. Si no se reconoce un ID real,
       no se inventan valores como 101/111/121. No modificar otras pestañas desde aquí.

Compatibilidad de índices observados/documentados:
    1/1/1:1
    0/1:1
    GPON0/1:1
    0/1/1
    1/1/1/1
    1                 (cuando ya estamos dentro de interface gpon 0/1)

Además, si el firmware no entrega una tabla utilizable dentro de la interfaz PON,
se prueban de forma ligera variantes globales de `show onu state` en la MISMA sesión.
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

_ONLINE_RE = re.compile(
    r"\b(?:working|online|registered|active|operation|syncmib|syncmib-fail|up)\b",
    re.IGNORECASE,
)
_OFFLINE_RE = re.compile(
    r"\b(?:offline|los|down|inactive|deregistered|dying[-\s]?gasp)\b",
    re.IGNORECASE,
)
_STATE_RE = re.compile(
    r"\b(?:working|online|registered|active|operation|syncmib|syncmib-fail|up|"
    r"offline|los|down|inactive|deregistered|dying[-\s]?gasp|processing|ranging)\b",
    re.IGNORECASE,
)
_MODE_RE = re.compile(r"^(?:sn|loid|mac|password|sn-password)$", re.IGNORECASE)
_DBM_RE = re.compile(r"^(-?\d+(?:\.\d+)?)\s*(?:dbm)?$", re.IGNORECASE)


def _valid(raw: str) -> bool:
    return bool((raw or "").strip()) and not _BAD_RE.search(raw or "")


def _clean_line(line: str) -> str:
    """Normaliza una línea sin destruir separadores útiles del índice ONU."""
    value = (line or "").replace("\r", "").replace("\x00", "").strip()

    # Algunos firmwares dejan el prompt delante del eco o de la primera línea.
    value = re.sub(
        r"^(?:gpon-olt|epon-olt|v1600[^\s#>]*)[^#>]*[#>]\s*",
        "",
        value,
        flags=re.IGNORECASE,
    )
    return value.strip()


def _extract_path_id(line: str, selected_pon: int) -> Optional[int]:
    """Busca un índice con PON+ONU en cualquier parte de la línea."""
    text = _clean_line(line)
    pon = int(selected_pon)

    # GPON0/1:7, 0/1:7, GPON0/1/7, 0/1/7
    for match in re.finditer(
        r"(?:(?:GPON|EPON)\s*)?0\s*/\s*(?P<pon>\d+)\s*[:/]\s*(?P<onu>\d+)",
        text,
        re.IGNORECASE,
    ):
        if int(match.group("pon")) == pon:
            onu = int(match.group("onu"))
            if 1 <= onu <= 128:
                return onu

    # 1/1/1:7, 1/1/8:26, y variantes con / en vez de : al final.
    for match in re.finditer(
        r"(?P<path>(?:\d+\s*/\s*){2,4}\d+)(?:\s*[:/]\s*)(?P<onu>\d+)",
        text,
        re.IGNORECASE,
    ):
        path_numbers = [int(x) for x in re.findall(r"\d+", match.group("path"))]
        if not path_numbers:
            continue
        # En VSOL el número inmediatamente anterior al ONU suele ser el PON.
        if path_numbers[-1] != pon:
            continue
        onu = int(match.group("onu"))
        if 1 <= onu <= 128:
            return onu

    # Variante 1/1/1/7: los dos últimos números son PON/ONU.
    for match in re.finditer(r"(?:\d+\s*/\s*){3,5}\d+", text):
        nums = [int(x) for x in re.findall(r"\d+", match.group(0))]
        if len(nums) >= 2 and nums[-2] == pon and 1 <= nums[-1] <= 128:
            return nums[-1]

    return None


def _extract_local_id(line: str) -> Optional[int]:
    """
    Extrae el ID local cuando ya estamos dentro del PON.
    Solo se acepta en una línea que también parezca una fila de estado/información.
    """
    text = _clean_line(line)

    # ONU 7 / ONU-ID 7 / OnuIndex 7 (si aparece en una fila de datos).
    m = re.match(r"^\s*(?:onu(?:[-_ ]?(?:id|index))?\s*[:#-]?\s*)?(\d{1,3})\b", text, re.I)
    if m:
        onu = int(m.group(1))
        if 1 <= onu <= 128:
            return onu

    # 1/7 dentro del PON: se toma el último número como ONU local.
    m = re.match(r"^\s*\d+\s*/\s*(\d{1,3})\b", text)
    if m:
        onu = int(m.group(1))
        if 1 <= onu <= 128:
            return onu

    return None


def _extract_onu_id(line: str, pon: int, *, allow_local: bool = False) -> Optional[int]:
    onu = _extract_path_id(line, pon)
    if onu:
        return onu
    if allow_local:
        return _extract_local_id(line)
    return None


def _state_status(line: str) -> str:
    low = _clean_line(line).lower()
    if _OFFLINE_RE.search(low):
        return "offline"
    if _ONLINE_RE.search(low):
        return "online"
    return "unknown"


def _parse_state(raw: str, pon: int) -> dict[int, dict]:
    """
    Parsea `show onu state` sin depender de anchos fijos.

    Admite dos familias de salida habituales:
      1/1/1:1 enable enable working succeeded 1(GPON)
      0/1:1 GPONxxxxxxxx working
      1 enable enable working succeeded
    """
    result: dict[int, dict] = {}

    for original in (raw or "").splitlines():
        line = _clean_line(original)
        if not line or set(line) <= {"-", "=", "+", "|"}:
            continue

        low = line.lower()
        if any(h in low for h in ("onuindex", "onu-id", "admin state", "phase state", "total num")):
            continue

        # Una fila de estado debe contener un estado reconocible o varios campos.
        if not _STATE_RE.search(line) and len(line.split()) < 3:
            continue

        onu_id = _extract_onu_id(line, pon, allow_local=True)
        if not onu_id:
            continue

        status = _state_status(line)
        tokens = line.replace("|", " ").split()

        # Eliminar de forma conservadora el fragmento de índice para leer estados.
        rest = tokens[:]
        for i, token in enumerate(tokens):
            if _extract_onu_id(token, pon, allow_local=True) == onu_id:
                rest = tokens[i + 1:]
                break

        # Layout largo: enable enable working succeeded 1(GPON)
        state_words = [x for x in rest if re.fullmatch(r"enable|disable", x, re.I)]
        phase_match = next((x for x in rest if _STATE_RE.fullmatch(x)), "")
        config_match = next(
            (x for x in rest if re.fullmatch(r"succeeded|failed|success|configuring|initial", x, re.I)),
            "",
        )
        channel_match = next((x for x in rest if re.search(r"GPON|EPON", x, re.I)), "")

        # Layout corto global: 0/1:1 GPONxxxx working
        sn_candidate = ""
        if rest:
            for token in rest:
                if _STATE_RE.fullmatch(token) or re.fullmatch(r"enable|disable", token, re.I):
                    continue
                if re.search(r"GPON|EPON", token, re.I) and re.search(r"\d", token):
                    sn_candidate = token
                    break

        result[onu_id] = {
            "pon_id": int(pon),
            "onu_id": onu_id,
            "system_state": state_words[0] if state_words else "",
            "omcc_state": state_words[1] if len(state_words) > 1 else "",
            "phase_state": phase_match or ("working" if status == "online" else "offline" if status == "offline" else ""),
            "config_state": config_match,
            "channel": channel_match,
            "state_sn": sn_candidate,
            "status": status,
        }

    return result


def _parse_info(raw: str, pon: int, allowed_ids: set[int]) -> dict[int, dict]:
    """Complementa autorización/modelo sin modificar los ONU ID confirmados por state."""
    result: dict[int, dict] = {}

    for original in (raw or "").splitlines():
        line = _clean_line(original)
        if not line or set(line) <= {"-", "=", "+", "|"}:
            continue

        onu_id = _extract_onu_id(line, pon, allow_local=True)
        if not onu_id or onu_id not in allowed_ids:
            continue

        tokens = line.replace("|", " ").split()
        # Quitar el índice encontrado al inicio/cerca del inicio.
        consumed_at = None
        for i, token in enumerate(tokens):
            if _extract_onu_id(token, pon, allow_local=True) == onu_id:
                consumed_at = i
                break
        rest = tokens[(consumed_at + 1) if consumed_at is not None else 1:]
        if not rest:
            continue

        mode_index = next((i for i, token in enumerate(rest) if _MODE_RE.fullmatch(token)), None)
        model = profile = mode = auth_info = description = info_status = ""

        if mode_index is not None:
            mode = rest[mode_index]
            auth_info = rest[mode_index + 1] if mode_index + 1 < len(rest) else ""
            profile = rest[mode_index - 1] if mode_index >= 1 else ""
            model = rest[mode_index - 2] if mode_index >= 2 else ""
            prefix = rest[:max(0, mode_index - 2)]
        else:
            prefix = []
            # No forzar campos si la estructura no es reconocible.
            if len(rest) >= 4:
                model, profile, mode, auth_info = rest[-4:]
                prefix = rest[:-4]

        if prefix:
            if _STATE_RE.fullmatch(prefix[0]):
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


def _parse_optical(raw: str, pon: int, allowed_ids: set[int]) -> dict[int, dict]:
    """Extrae RX/TX solo para IDs previamente confirmados por `show onu state`."""
    result: dict[int, dict] = {}

    for original in (raw or "").splitlines():
        line = _clean_line(original)
        if not line:
            continue

        onu_id = _extract_onu_id(line, pon, allow_local=True)
        if not onu_id or onu_id not in allowed_ids:
            continue

        numbers = []
        for token in line.replace("|", " ").split():
            clean = token.strip().rstrip(",;")
            m = _DBM_RE.fullmatch(clean)
            if not m:
                continue
            try:
                value = float(m.group(1))
            except ValueError:
                continue
            if -50.0 <= value <= 20.0:
                numbers.append(value)

        if numbers:
            result[onu_id] = {
                "rx_power": f"{numbers[0]:g} dBm",
                "tx_power": f"{numbers[1]:g} dBm" if len(numbers) > 1 else "",
            }

    return result


async def _read_state(cli, pon: int):
    """
    Lee estado con pocas consultas y devuelve (raw, parsed, source, attempts).
    Primero usa el comando confirmado dentro del PON; solo si no se reconoce ninguna
    fila prueba variantes globales documentadas para otros firmwares VSOL.
    """
    attempts = []

    raw = await cli.run_pon(pon, "show onu state", raise_on_error=False)
    attempts.append(("show onu state [PON]", raw))
    parsed = _parse_state(raw, pon) if _valid(raw) else {}
    if parsed:
        return raw, parsed, "show onu state [PON]", attempts

    # Volver de interface gpon al modo config, sin cerrar la sesión Telnet.
    try:
        await cli.run("exit", raise_on_error=False)
    except Exception:
        pass

    candidates = [
        f"show onu state gpon-olt 0/{pon}",
        f"show onu state 0/{pon}",
        "show onu state",
    ]

    for command in candidates:
        candidate_raw = await cli.run(command, raise_on_error=False)
        attempts.append((command, candidate_raw))
        if not _valid(candidate_raw):
            continue
        parsed = _parse_state(candidate_raw, pon)
        if parsed:
            return candidate_raw, parsed, command, attempts

    # Unir intentos para que Salida cruda muestre exactamente qué recibió la OLT.
    diagnostic = "\n\n".join(
        f"===== {command} =====\n{body or '(sin salida)'}"
        for command, body in attempts
    )
    return diagnostic, {}, "unparsed", attempts


@router.get("/{router_id}/olt/onus-v2")
async def onus_v2(
    router_id: str,
    pon: int = 1,
    db: AsyncSession = Depends(get_db),
):
    """Inventario ONU v2: IDs reales, sin parser genérico antiguo."""
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    max_pon = int(getattr(olt, "pon_ports", 8) or 8)
    pon = max(1, min(int(pon or 1), max_pon))

    state_raw = info_raw = optical_raw = ""
    state_source = ""
    commands = []

    try:
        async with olt_service.connect(olt) as cli:
            state_raw, state, state_source, attempts = await _read_state(cli, pon)
            commands.extend(command for command, _ in attempts)

            if not state:
                return {
                    "ok": False,
                    "error": "La OLT respondió, pero todavía no se reconoció el formato de `show onu state`. Activa Salida cruda: ahora mostrará todos los intentos reales del CLI.",
                    "pon": pon,
                    "onus": [],
                    "counts": {"total": 0, "online": 0, "offline": 0, "unknown": 0},
                    "commands": commands,
                    "state_source": state_source,
                    "raw": {"state": state_raw, "info": "", "optical": ""},
                }

            # Ya tenemos IDs reales. Reentrar al PON y complementar los datos.
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
            "state_source": state_source,
            "raw": {"state": state_raw, "info": info_raw, "optical": optical_raw},
        }

    allowed_ids = set(state)
    info = _parse_info(info_raw, pon, allowed_ids) if _valid(info_raw) else {}
    optical = _parse_optical(optical_raw, pon, allowed_ids) if _valid(optical_raw) else {}

    onus = []
    for onu_id in sorted(state):
        row = dict(state[onu_id])
        row.update(info.get(onu_id, {}))
        row.update(optical.get(onu_id, {}))

        # Si el state global devolvió un SN y `show onu info` no lo hizo, conservarlo.
        if not row.get("auth_info") and row.get("state_sn"):
            row["auth_info"] = row["state_sn"]

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
        "state_source": state_source,
        "sources": {
            "identity_and_state": state_source,
            "authorization": "show onu info" if info else None,
            "optical": "show pon rx_power" if optical else None,
        },
        "raw": {
            "state": state_raw,
            "info": info_raw,
            "optical": optical_raw,
        },
    }
