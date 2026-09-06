"""
Archivo: backend/app/routers/red/olt_onu_inventory.py
Pertenece a: Red > OLT > pestaña "ONUs" > Lista de ONU.
Función: Obtiene una lista canónica de ONUs del PON seleccionado usando como fuente
         autoritativa `show onu state` para ONU ID, Admin State, OMCC State y Phase State.
         Luego complementa, cuando es posible, con `show onu info` para perfil, modo,
         información de autorización y modelo.
Regla: Este archivo SOLO pertenece a la lista de ONUs. No modifica Resumen, Puertos PON,
       Auto-find, Óptica ONU, Consola ni acciones de otras pestañas. Debe usar una sola
       sesión CLI y pocas consultas para no saturar Telnet.

Motivo de este módulo:
- El parser genérico de tablas puede desplazar columnas en algunas VSOL y convertir
  ONU 1, 2, 3... en valores falsos como 111, 101, 121.
- `show onu state` devuelve el índice real en formato 1/1/PON:ONU, por ejemplo:
    1/1/1:1  enable  enable  working  succeeded  1(GPON)
  Por eso este archivo NO toma el ONU ID desde la tabla genérica.
"""

import re

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import get_or_404
from app.integrations.olt import service as olt_service
from app.integrations.olt.vsol import parse_table
from app.models.router import Router


router = APIRouter(dependencies=[Depends(get_current_user)])

_BAD_RE = re.compile(
    r"(?:%\s*(?:unknown|invalid|incomplete|ambiguous)\s+command|"
    r"unknown\s+command|invalid\s+command|command\s+not\s+found)",
    re.IGNORECASE,
)


def _pick(row: dict, patterns: tuple[str, ...]) -> str:
    if not row:
        return ""
    for pattern in patterns:
        rx = re.compile(pattern, re.IGNORECASE)
        for key, value in row.items():
            if rx.search(str(key)):
                out = str(value or "").strip()
                if out:
                    return out
    return ""


def _parse_state_rows(raw: str, pon: int) -> list[dict]:
    """Parsea únicamente filas reales de `show onu state`."""
    rows: list[dict] = []

    # Formato confirmado para esta familia:
    # 1/1/1:1 enable enable working succeeded 1(GPON)
    index_re = re.compile(
        rf"^\s*(?P<chassis>\d+)\/(?P<slot>\d+)\/(?P<pon>{int(pon)})\s*:\s*(?P<onu>\d{{1,3}})\s+(?P<rest>.+?)\s*$",
        re.IGNORECASE,
    )

    for original in (raw or "").replace("\r", "").splitlines():
        match = index_re.match(original)
        if not match:
            continue

        onu_id = int(match.group("onu"))
        if not 1 <= onu_id <= 128:
            continue

        parts = re.split(r"\s+", match.group("rest").strip())
        if len(parts) < 3:
            continue

        admin_state = parts[0] if len(parts) >= 1 else ""
        omcc_state = parts[1] if len(parts) >= 2 else ""
        phase_state = parts[2] if len(parts) >= 3 else ""

        # Algunos firmwares incluyen Config State y otros no.
        config_state = ""
        channel = ""
        if len(parts) >= 5:
            config_state = parts[3]
            channel = parts[4]
        elif len(parts) >= 4:
            channel = parts[3]

        low_phase = phase_state.lower()
        status = "online" if low_phase in {"working", "online", "registered", "up"} else "offline"

        rows.append({
            "ONUIndex": f"1/1/{pon}:{onu_id}",
            "PON": f"0/{pon}",
            "PON ID": pon,
            "ONU ID": onu_id,
            "Status": status,
            "Admin State": admin_state,
            "OMCC State": omcc_state,
            "Phase State": phase_state,
            "Config State": config_state,
            "Channel": channel,
            "Description": "",
            "Profile": "",
            "Mode": "",
            "Info": "",
            "Model": "",
        })

    # El CLI normalmente ya sale ordenado, pero ordenamos para evitar saltos visuales.
    rows.sort(key=lambda item: int(item.get("ONU ID") or 0))
    return rows


def _merge_auth_rows(state_rows: list[dict], auth_raw: str) -> list[dict]:
    """
    Complementa datos de autorización sin volver a confiar en el ONU ID parseado por
    `parse_table`. La unión se hace por posición porque ambas tablas VSOL salen ordenadas
    por ONU ID. El ID/estado siempre conserva el valor de `show onu state`.
    """
    if not auth_raw or _BAD_RE.search(auth_raw):
        return state_rows

    auth_rows = parse_table(auth_raw)
    if not auth_rows:
        return state_rows

    for index, state in enumerate(state_rows):
        if index >= len(auth_rows):
            break
        auth = auth_rows[index]

        state["Description"] = _pick(auth, (r"^description$", r"descripcion", r"^name$"))
        state["Profile"] = _pick(auth, (r"^profile$", r"perfil"))
        state["Mode"] = _pick(auth, (r"^mode$", r"modo"))
        state["Info"] = _pick(auth, (r"^info$", r"authinfo", r"serial", r"^sn$"))
        state["Model"] = _pick(auth, (r"^model$", r"modelo"))

    return state_rows


@router.get("/{router_id}/olt/onu-inventory")
async def onu_inventory(
    router_id: str,
    pon: int = 1,
    db: AsyncSession = Depends(get_db),
):
    """Lista canónica de ONUs del PON usando IDs reales de `show onu state`."""
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt":
        raise HTTPException(status_code=400, detail="Este equipo no es una OLT")

    pon = max(1, min(int(pon or 1), int(getattr(olt, "pon_ports", 8) or 8)))
    state_raw = ""
    auth_raw = ""
    commands: list[str] = []

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

            # Fuente autoritativa de ONU ID y estados.
            state_raw = await cli.run("show onu state", raise_on_error=False)
            commands.append("show onu state")

            # Fuente complementaria. Este comando fue confirmado por la ayuda CLI
            # del firmware del usuario dentro de config-pon.
            auth_raw = await cli.run("show onu info", raise_on_error=False)
            commands.append("show onu info")

    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
            "rows": [],
            "commands": commands,
            "state_raw": state_raw[:12000],
            "auth_raw": auth_raw[:12000],
        }

    if not state_raw or _BAD_RE.search(state_raw):
        return {
            "ok": False,
            "error": "`show onu state` no devolvió una tabla válida",
            "rows": [],
            "commands": commands,
            "state_raw": state_raw[:12000],
            "auth_raw": auth_raw[:12000],
        }

    rows = _parse_state_rows(state_raw, pon)
    rows = _merge_auth_rows(rows, auth_raw)

    online = sum(1 for row in rows if row.get("Status") == "online")
    offline = sum(1 for row in rows if row.get("Status") == "offline")

    return {
        "ok": bool(rows),
        "error": "" if rows else "No se reconocieron filas ONU en `show onu state`",
        "rows": rows,
        "total": len(rows),
        "online": online,
        "offline": offline,
        "commands": commands,
        "source": "show onu state + show onu info",
        # Se conserva para diagnóstico sin tocar otros módulos.
        "state_raw": state_raw[:12000],
        "auth_raw": auth_raw[:12000],
    }
