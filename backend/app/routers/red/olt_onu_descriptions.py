"""
Archivo: backend/app/routers/red/olt_onu_descriptions.py
Pertenece a: Red > OLT > ONUs v2 > columna "Descripción".
Función: Lee directamente de la VSOL la descripción/nombre configurado en cada ONU.
Regla: Este archivo SOLO resuelve descripciones. No modifica el inventario, estados,
       perfiles, modelos, óptica ni otras pestañas de la OLT.

Estrategia:
1) Recibe los ONU ID ya validados por ONUs v2.
2) Hace una sola lectura `show running-config` dentro del PON y extrae líneas
   `onu <id> desc <texto>`. Este firmware no usa la palabra `description`.
"""

import re
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import get_or_404
from app.integrations.olt import service as olt_service
from app.models.router import Router

router = APIRouter(dependencies=[Depends(get_current_user)])

_ANSI_RE = re.compile(r"\x1b\[[0-?]*[ -/]*[@-~]")
_CURSOR_RE = re.compile(r"(?:12|27|41|56)C")
_BAD_RE = re.compile(
    r"(?:%\s*(?:unknown|invalid|incomplete|ambiguous)\s+command|"
    r"unknown\s+command|invalid\s+command|command\s+not\s+found)",
    re.IGNORECASE,
)


def _clean(text: str) -> str:
    value = _ANSI_RE.sub("", text or "")
    value = value.replace("\r", "").replace("\x00", "")
    return value


def _parse_ids(ids: str) -> list[int]:
    found = []
    for part in (ids or "").split(","):
        part = part.strip()
        if not part.isdigit():
            continue
        onu_id = int(part)
        if 1 <= onu_id <= 128 and onu_id not in found:
            found.append(onu_id)
    return sorted(found)


def _parse_running_config(raw: str, allowed: set[int]) -> dict[int, str]:
    """Extrae `onu N desc TEXTO` de la configuración del PON."""
    result: dict[int, str] = {}
    text = _clean(raw)

    for original in text.splitlines():
        line = _CURSOR_RE.sub(" ", original).strip()
        if not line:
            continue

        match = re.search(r"\bonu\s+(\d{1,3})\s+desc\s+(.+?)\s*$", line, re.IGNORECASE)
        if not match:
            continue

        onu_id = int(match.group(1))
        if onu_id not in allowed:
            continue

        description = match.group(2).strip().strip('"').strip("'")
        if description:
            result[onu_id] = description

    return result


def _parse_single_description(raw: str, onu_id: int) -> str:
    """Tolera varias formas de respuesta de `show onu <id> description`."""
    text = _clean(raw)
    if not text.strip() or _BAD_RE.search(text):
        return ""

    lines = []
    for original in text.splitlines():
        line = _CURSOR_RE.sub(" ", original).strip()
        if not line:
            continue
        if re.search(r"^show\s+onu\s+\d+\s+description$", line, re.IGNORECASE):
            continue
        if re.search(r"^(?:gpon-olt|epon-olt)[^#>]*[#>]", line, re.IGNORECASE):
            continue
        lines.append(line)

    # Formatos como `Description: NOMBRE` / `ONU Description : NOMBRE`.
    for line in lines:
        match = re.search(r"(?:onu\s+)?description\s*[:=]\s*(.+)$", line, re.IGNORECASE)
        if match:
            value = match.group(1).strip().strip('"').strip("'")
            if value:
                return value

    # Formato de configuración devuelto por algunos firmwares.
    for line in lines:
        match = re.search(
            rf"\bonu\s+{int(onu_id)}\s+description\s+(.+?)\s*$",
            line,
            re.IGNORECASE,
        )
        if match:
            value = match.group(1).strip().strip('"').strip("'")
            if value:
                return value

    # Si el comando devuelve únicamente el texto, usar la última línea útil.
    ignored = re.compile(r"^(?:onu\s*id|description|[-=]+)$", re.IGNORECASE)
    candidates = [line for line in lines if not ignored.match(line)]
    if len(candidates) == 1:
        return candidates[0].strip().strip('"').strip("'")

    return ""


@router.get("/{router_id}/olt/onu-descriptions")
async def onu_descriptions(
    router_id: str,
    pon: int = 1,
    ids: str = Query(default=""),
    db: AsyncSession = Depends(get_db),
):
    """Devuelve `{ONU_ID: descripcion}` leyendo el nombre directamente de la VSOL."""
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    max_pon = int(getattr(olt, "pon_ports", 8) or 8)
    pon = max(1, min(int(pon or 1), max_pon))
    onu_ids = _parse_ids(ids)

    if not onu_ids:
        return {"ok": True, "pon": pon, "descriptions": {}, "source": "sin_ids", "raw": ""}

    allowed = set(onu_ids)
    descriptions: dict[int, str] = {}
    running_raw = ""

    try:
        async with olt_service.connect(olt) as cli:
            # Una sola lectura puede contener todas las descripciones del PON.
            running_raw = await cli.run_pon(pon, "show running-config", raise_on_error=False)
            if running_raw and not _BAD_RE.search(running_raw):
                descriptions.update(_parse_running_config(running_raw, allowed))

    except Exception as exc:
        return {
            "ok": False,
            "pon": pon,
            "descriptions": descriptions,
            "error": str(exc),
            "source": "parcial",
            "raw": {"running_config": running_raw},
        }

    return {
        "ok": True,
        "pon": pon,
        "descriptions": {str(key): value for key, value in descriptions.items()},
        "found": len(descriptions),
        "requested": len(onu_ids),
        "source": "running-config: onu <id> desc",
        "raw": {"running_config": running_raw},
    }
