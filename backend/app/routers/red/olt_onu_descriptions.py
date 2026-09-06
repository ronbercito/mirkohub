"""
Archivo: backend/app/routers/red/olt_onu_descriptions.py
Pertenece a: Red > OLT > ONUs v2 > columna "Descripción".
Función: Lee directamente de la VSOL la descripción/nombre configurado en cada ONU.
Alcance: Parser compartido y endpoint de nombres; una lectura por sesión.
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


def _parse_running_config(raw: str, allowed: set[int], pon: int = 1) -> dict[int, str]:
    """Lee desc exclusivamente del bloque GPON seleccionado, sin consultas por ONU."""
    text = _clean(raw)
    # Sin cabeceras, la respuesta está limitada al contexto PON de run_pon.
    has_interfaces = bool(re.search(r"^\s*interface\s+", text, re.M | re.I))
    selected = not has_interfaces
    result: dict[int, str] = {}
    for original in text.splitlines():
        line = original.strip()
        if re.match(r"^interface\s+", line, re.I):
            selected = bool(re.fullmatch(rf"interface\s+gpon\s+0/{int(pon)}", line, re.I))
            continue
        if has_interfaces and line.lower() in {"exit", "end", "!"}:
            selected = False
            continue
        if not selected:
            continue
        match = re.match(r"^onu\s+(\d{1,3})\s+desc\s+(.+?)\s*$", line, re.I)
        if match and int(match[1]) in allowed:
            # No borrar secuencias como 12C dentro de un nombre legítimo.
            result[int(match[1])] = match[2].strip().strip('"').strip("'")
    return result


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
                descriptions.update(_parse_running_config(running_raw, allowed, pon))

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
