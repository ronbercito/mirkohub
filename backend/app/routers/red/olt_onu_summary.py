"""
Archivo: backend/app/routers/red/olt_onu_summary.py
Pertenece a: Red > OLT > pestaña "ONUs" > contadores superiores.
Función: Obtiene SOLO los contadores del PON seleccionado (total, online y offline)
         usando `show onu state` en una sola sesión CLI.
Regla: Este archivo NO modifica inventario, tarjetas, detalle ONU, óptica, consola ni
       otras pestañas. Debe seguir siendo ligero para no saturar Telnet.

Formato confirmado para esta familia VSOL:
  gpon-olt(config-pon-0/1)# show onu state
  OnuIndex    Admin State    OMCC State    Phase State    Config State    Channel
  1/1/1:1     enable         enable        working        succeeded       1(GPON)

IMPORTANTE:
  El índice real puede venir como `1/1/PON:ONU`, no como `GPON0/PON:ONU`.
  Por eso este parser reconoce ambos formatos y considera ONLINE cuando Phase State
  contiene `working`/`online`/`registered`; el resto de ONUs detectadas se cuenta como
  no-online para que Online + Offline coincida con el inventario del PON.
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

_ONLINE_RE = re.compile(
    r"\b(?:working|online|registered|operation|up|syncmib|syncmib-fail)\b",
    re.IGNORECASE,
)

_EXPLICIT_OFFLINE_RE = re.compile(
    r"\b(?:offline|los|deregistered|down|dying[-\s]?gasp)\b",
    re.IGNORECASE,
)


def _valid(raw: str) -> bool:
    return bool((raw or "").strip()) and not _BAD_RE.search(raw or "")


def _extract_onu_id(line: str, pon: int):
    """
    Extrae ONU ID de los formatos observados en VSOL.

    Ejemplos:
      1/1/1:1      -> PON 1, ONU 1
      1/1/8:26     -> PON 8, ONU 26
      GPON0/8:26   -> PON 8, ONU 26
      0/8:26       -> PON 8, ONU 26
    """
    text = (line or "").strip()

    patterns = (
        # Formato mostrado por manuales/firmwares VSOL: chassis/slot/pon:onu
        rf"^\s*(?:\d+/)+{int(pon)}\s*:\s*(\d{{1,3}})\b",
        # Formato GPON0/8:26 o 0/8:26
        rf"(?:GPON|EPON)?\s*0/{int(pon)}\s*:\s*(\d{{1,3}})\b",
        # Variante 0/8/26
        rf"(?:GPON|EPON)?\s*0/{int(pon)}/(\d{{1,3}})\b",
    )

    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            value = int(match.group(1))
            if 1 <= value <= 128:
                return value

    return None


def _parse_state_table(raw: str, pon: int, inventory_total: int):
    """
    Parsea la tabla de `show onu state`.

    Se considera una fila ONU si contiene un índice válido del PON actual.
    ONLINE = Phase State operativo (`working`, `online`, etc.).
    OFFLINE = fila ONU no operativa. Si el inventario contiene más ONUs que la tabla,
              la diferencia se cuenta como offline/no-online.
    """
    all_ids = set()
    online_ids = set()
    explicit_offline_ids = set()

    for original in (raw or "").replace("\r", "").splitlines():
        onu_id = _extract_onu_id(original, pon)
        if not onu_id:
            continue

        all_ids.add(onu_id)
        low = original.lower()

        if _EXPLICIT_OFFLINE_RE.search(low):
            explicit_offline_ids.add(onu_id)
            online_ids.discard(onu_id)
        elif _ONLINE_RE.search(low):
            online_ids.add(onu_id)
            explicit_offline_ids.discard(onu_id)

    detected_total = len(all_ids)
    online = len(online_ids)

    # El total visible de la pestaña ya viene del inventario ONU del PON y es la fuente
    # más fiable para cantidad autorizada. Si no está disponible, usamos la tabla state.
    total = inventory_total or detected_total

    if total:
        offline = max(0, total - online)
    else:
        offline = max(0, detected_total - online)

    return {
        "total": total,
        "online": online,
        "offline": offline,
        "detected_rows": detected_total,
        "explicit_offline": len(explicit_offline_ids),
    }


@router.get("/{router_id}/olt/onu-summary")
async def onu_summary(
    router_id: str,
    pon: int = 1,
    total: int = 0,
    db: AsyncSession = Depends(get_db),
):
    """Resumen aislado de Online/Offline usando únicamente `show onu state`."""
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    pon = max(1, min(int(pon or 1), int(getattr(olt, "pon_ports", 8) or 8)))
    total = max(0, int(total or 0))
    commands = []
    state_raw = ""

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

            state_raw = await cli.run("show onu state", raise_on_error=False)
            commands.append("show onu state")

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
            "state_preview": state_raw[:8000],
        }

    if not _valid(state_raw):
        return {
            "ok": False,
            "error": "`show onu state` no devolvió una tabla válida",
            "total": total,
            "online": 0,
            "offline": 0,
            "named": None,
            "named_supported": False,
            "source": "show onu state:invalid",
            "commands": commands,
            "state_preview": state_raw[:8000],
        }

    counts = _parse_state_table(state_raw, pon, total)

    # Si no detectamos ni una fila, devolver ok=false para no presentar un 0 como si
    # fuera una lectura correcta. El preview queda disponible para diagnóstico.
    ok = counts["detected_rows"] > 0

    return {
        "ok": ok,
        "error": "" if ok else "No se reconoció ninguna fila ONU en `show onu state`",
        "total": counts["total"],
        "online": counts["online"],
        "offline": counts["offline"],
        "named": None,
        "named_supported": False,
        "source": "show onu state:1/1/pon:onu" if ok else "show onu state:unparsed",
        "commands": commands,
        "detected_rows": counts["detected_rows"],
        "explicit_offline": counts["explicit_offline"],
        "state_preview": state_raw[:8000],
    }
