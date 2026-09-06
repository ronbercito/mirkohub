"""
Archivo: backend/app/routers/red/olt_onu_power.py
Área: Red > OLT > ONUs > Lista de ONU > RX.
Función: Lee optical_info de una ONU bajo demanda, con caché breve y tiempo límite.
Alcance: Solo lectura óptica; una consulta por petición, sin barrido de todas las ONUs.
No modifica inventario, estados, descripciones, configuración OLT ni otras pestañas.
"""
import asyncio
import re
import time
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.database import get_db
from app.core.security import get_current_user
from app.core.utils import get_or_404
from app.integrations.olt import service as olt_service
from app.models.router import Router

router = APIRouter(dependencies=[Depends(get_current_user)])
# Protección local a cada worker; el frontend solo sigue una ONU por vista.
_busy = set()
_cache = {}


def parse_optical_info(raw: str) -> dict:
    text = re.sub(r"\x1b\[[0-?]*[ -/]*[@-~]", "", raw or "").replace("\r", "")
    fields = {
        "rx_dbm": r"Rx optical level\(ONU\)",
        "tx_dbm": r"Tx optical level",
        "temperature_c": r"Temperature",
        "voltage_v": r"Power feed voltage",
        "bias_ma": r"Laser bias current",
    }
    result = {}
    for key, label in fields.items():
        match = re.search(rf"^\s*{label}\s*:\s*([-+]?\d+(?:\.\d+)?)\s*(?:\([^)\n]*\)|dBm)?\s*$", text, re.M | re.I)
        result[key] = float(match[1]) if match else None
    return result


@router.get("/{router_id}/olt/onu-power")
async def onu_power(
    router_id: str,
    pon: int = Query(ge=1, le=16),
    onu: int = Query(ge=1, le=128),
    db: AsyncSession = Depends(get_db),
):
    olt = await get_or_404(db, Router, router_id, "Router")
    if olt.device_type != "olt" or pon > int(olt.pon_ports or 8):
        raise HTTPException(400, "OLT o PON no válido")
    now = time.monotonic()
    for expired in [k for k, (ts, _) in _cache.items() if now - ts >= 30]:
        del _cache[expired]
    key = (router_id, pon, onu)
    if key in _cache:
        return {**_cache[key][1], "cached": True}
    if router_id in _busy:
        raise HTTPException(429, "Consulta óptica en curso; espere al siguiente ciclo")
    _busy.add(router_id)
    try:
        async def read():
            async with olt_service.connect(olt) as cli:
                return await cli.run_pon(pon, f"show onu {onu} optical_info", raise_on_error=False)
        raw = await asyncio.wait_for(read(), timeout=25)
        values = parse_optical_info(raw)
        if values["rx_dbm"] is None:
            return {"ok": False, "pon": pon, "onu_id": onu,
                    "error": "La ONU no devolvió una lectura RX válida", "rx_dbm": None}
        result = {"ok": True, "pon": pon, "onu_id": onu, **values,
                  "measured_at": datetime.now(timezone.utc).isoformat(),
                  "cached": False, "source": f"show onu {onu} optical_info"}
        _cache[key] = (time.monotonic(), result)
        return result
    except asyncio.TimeoutError:
        raise HTTPException(504, "La consulta óptica agotó el tiempo de espera")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(502, "No se pudo consultar la óptica de la ONU")
    finally:
        _busy.discard(router_id)
