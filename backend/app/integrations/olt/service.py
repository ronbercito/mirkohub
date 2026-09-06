"""
Archivo:
    backend/app/integrations/olt/service.py

Función:
    Capa de negocio para las OLT.

Responsabilidades:
    - Conectar con la OLT usando la configuración del Router.
    - Ejecutar acciones definidas en OLT_PROFILES.
    - Obtener resumen/versión de la OLT.
    - Consultar PON.
    - Consultar ONUs.
    - Buscar ONU por SN.
    - Obtener potencia óptica.
    - Autorizar, activar, desactivar, reiniciar y eliminar ONU.
    - Ejecutar comandos libres desde consola.
    - Actualizar estado de la OLT en la tabla routers.

Compatible con:
    backend/app/integrations/olt/vsol.py
    backend/app/models/router.py
    backend/app/integrations/mikrotik/client.py

Especialmente preparado para:
    VSOL V1600G / V1600G1-B / V1600G2 GPON
"""

import re
from typing import Any, Optional

from app.core.database import now_iso
from app.integrations.mikrotik.client import tcp_latency_ms
from app.integrations.olt.vsol import (
    OLT_PROFILES,
    OltClient,
    OltError,
    parse_key_values,
    parse_table,
)
from app.models.router import Router


# ============================================================
# UTILIDADES INTERNAS
# ============================================================

def _protocol(router: Router) -> str:
    """
    Devuelve el protocolo normalizado.
    """
    return (
        getattr(router, "protocol", None)
        or "telnet"
    ).strip().lower()


def _cli_port(router: Router) -> int:
    """
    Obtiene el puerto CLI de forma consistente para
    conexión y pruebas de latencia.

    Prioridad:
        1. cli_port
        2. ssh_port si SSH
        3. telnet_port si Telnet
        4. 22 SSH
        5. 23 Telnet
    """

    protocol = _protocol(router)

    cli_port = getattr(
        router,
        "cli_port",
        None,
    )

    if cli_port:
        return int(cli_port)

    if protocol == "ssh":

        ssh_port = getattr(
            router,
            "ssh_port",
            None,
        )

        return int(
            ssh_port or 22
        )

    telnet_port = getattr(
        router,
        "telnet_port",
        None,
    )

    return int(
        telnet_port or 23
    )


def _pon_count(router: Router) -> int:
    """
    Determina cuántos puertos PON tiene la OLT.

    La V1600G1-B de tu captura tiene 8 PON.
    """

    try:

        value = int(
            getattr(
                router,
                "pon_ports",
                8,
            )
            or 8
        )

    except (
        TypeError,
        ValueError,
    ):
        value = 8

    # Protección contra valores absurdos.
    if value < 1:
        value = 1

    if value > 128:
        value = 128

    return value


def _profile_key(router: Router) -> str:
    """
    Determina el perfil de OLT.
    """

    configured = (
        getattr(
            router,
            "olt_profile",
            None,
        )
        or ""
    ).strip()

    if configured in OLT_PROFILES:
        return configured

    pon_type = (
        getattr(
            router,
            "pon_type",
            None,
        )
        or ""
    ).upper().strip()

    if pon_type == "EPON":
        return "vsol_epon"

    return "vsol_gpon"


def profile_of(router: Router) -> dict:
    """
    Obtiene el perfil completo de la OLT.
    """

    key = _profile_key(router)

    profile = OLT_PROFILES.get(
        key
    )

    if not profile:

        raise OltError(
            f"No existe el perfil OLT '{key}'"
        )

    return profile


def connect(router: Router) -> OltClient:
    """
    Crea un cliente OltClient utilizando la configuración
    del Router.
    """

    protocol = _protocol(router)
    port = _cli_port(router)

    host = (
        getattr(
            router,
            "ip_address",
            None,
        )
        or ""
    ).strip()

    username = (
        getattr(
            router,
            "username",
            None,
        )
        or ""
    )

    password = (
        getattr(
            router,
            "password",
            None,
        )
        or ""
    )

    enable_password = (
        getattr(
            router,
            "enable_password",
            None,
        )
        or ""
    )

    if not host:
        raise OltError(
            "La OLT no tiene una dirección IP configurada"
        )

    if not username:
        raise OltError(
            "La OLT no tiene usuario CLI configurado"
        )

    return OltClient(
        host=host,
        username=username,
        password=password,
        port=port,
        protocol=protocol,
        enable_password=enable_password,
    )


# ============================================================
# NORMALIZACIÓN
# ============================================================

def _normalize(value: Any) -> str:
    """
    Convierte cualquier valor en texto normalizado
    para comparaciones.
    """

    if value is None:
        return ""

    text = str(value)

    text = re.sub(
        r"\s+",
        " ",
        text,
    )

    return text.strip().lower()


def _extract_digits(value: Any) -> Optional[int]:
    """
    Extrae un ID numérico de valores como:

        1
        ONU 1
        0/1/1
        1/1
        ONUID: 7

    Devuelve None si no encuentra un entero útil.
    """

    if value is None:
        return None

    text = str(value).strip()

    # Caso directo.
    if text.isdigit():

        try:
            return int(text)
        except ValueError:
            return None

    # Buscar entero aislado.
    match = re.search(
        r"\b(\d{1,3})\b",
        text,
    )

    if match:

        try:
            return int(
                match.group(1)
            )
        except ValueError:
            return None

    return None


def _find_onu_id(row: dict) -> Optional[int]:
    """
    Detecta el ONU ID dentro de una fila de parse_table().
    """

    if not row:
        return None

    # Prioridad por nombres conocidos.
    preferred_keys = [
        r"^onu$",
        r"onu\s*id",
        r"onu\s*index",
        r"onuid",
        r"onu\s*no",
        r"onu\s*number",
        r"index",
        r"^id$",
    ]

    for pattern in preferred_keys:

        for key, value in row.items():

            if re.search(
                pattern,
                str(key),
                re.IGNORECASE,
            ):

                result = _extract_digits(
                    value
                )

                if result is not None:
                    return result

    # Segundo intento: cualquier columna cuyo nombre
    # contenga ONU / INDEX / ID.
    for key, value in row.items():

        if re.search(
            r"onu|index|id",
            str(key),
            re.IGNORECASE,
        ):

            result = _extract_digits(
                value
            )

            if result is not None:
                return result

    return None


def _row_contains(
    row: dict,
    needle: str,
) -> bool:
    """
    Busca un texto dentro de todos los valores de una fila.
    """

    needle_normalized = _normalize(
        needle
    )

    if not needle_normalized:
        return False

    for value in row.values():

        if (
            needle_normalized
            in _normalize(value)
        ):
            return True

    return False


# ============================================================
# ESTADO ROUTER
# ============================================================

def _mark_online(router: Router):
    """
    Marca la OLT como online.
    """

    router.status = "online"
    router.last_error = ""
    router.last_sync = now_iso()


def _mark_offline(
    router: Router,
    error: str,
):
    """
    Marca la OLT como offline.
    """

    router.status = "offline"
    router.last_error = (
        str(error)[:250]
    )
    router.last_sync = now_iso()


# ============================================================
# EJECUTAR ACCIÓN DEL PERFIL
# ============================================================

async def run_action(
    router: Router,
    action: str,
    **params,
) -> dict:
    """
    Ejecuta una acción OLT.

    Para las lecturas VSOL se usan los métodos especializados de
    OltClient, ya que ahí se manejan las diferencias entre firmwares
    (por ejemplo show onuinfo / show onu info y rx-power / rx).
    Para el resto de acciones se usa el perfil OLT_PROFILES.
    """

    try:
        profile_name = _profile_key(router)
        profile = profile_of(router)
    except OltError as exc:
        return {
            "ok": False,
            "error": str(exc),
            "message": str(exc),
            "rows": [],
            "info": {},
            "raw": "",
            "commands": [],
        }

    supported = {
        "system",
        "version",
        "pon_optical",
        "pon_stats",
        "onu_list",
        "onu_autofind",
        "onu_optical",
        "onu_detail",
        "onu_authorize",
        "onu_reboot",
        "onu_deactivate",
        "onu_activate",
        "onu_delete",
    }

    commands = profile.get(action)

    if action not in supported and not commands:
        error = (
            f"La acción '{action}' no existe en el perfil "
            f"{profile_name}"
        )
        return {
            "ok": False,
            "error": error,
            "message": error,
            "rows": [],
            "info": {},
            "raw": "",
            "commands": [],
        }

    params = dict(params)

    # PON es obligatorio para todas las operaciones que trabajan
    # dentro de una interfaz GPON/EPON.
    pon_required = action not in ("system", "version")
    if pon_required and params.get("pon") is None:
        error = f"La acción '{action}' requiere el parámetro 'pon'"
        return {
            "ok": False,
            "error": error,
            "message": error,
            "rows": [],
            "info": {},
            "raw": "",
            "commands": [],
        }

    try:
        if commands:
            rendered_commands = [
                command.format(**params)
                for command in commands
            ]
        else:
            rendered_commands = []
    except KeyError as exc:
        error = (
            f"Falta el parámetro '{exc.args[0]}' "
            f"para la acción '{action}'"
        )
        return {
            "ok": False,
            "error": error,
            "message": error,
            "rows": [],
            "info": {},
            "raw": "",
            "commands": [],
        }

    try:
        async with connect(router) as olt:
            pon = int(params.get("pon", 1) or 1)
            onu = int(params.get("onu", 0) or 0)

            # ------------------------------------------------
            # Lecturas VSOL: métodos especializados
            # ------------------------------------------------
            if action in ("system", "version"):
                raw = await olt.get_version()

            elif action == "pon_optical":
                raw = await olt.get_pon_optical(pon)

            elif action == "pon_stats":
                raw = await olt.get_pon_statistics(pon)

            elif action == "onu_list":
                raw = await olt.get_onus(pon, raise_on_error=True)

            elif action == "onu_autofind":
                raw = await olt.get_onu_autofind(
                    pon,
                    raise_on_error=True,
                )

            elif action == "onu_optical":
                raw = await olt.get_onu_optical(
                    pon,
                    raise_on_error=True,
                )

            elif action == "onu_detail":
                raw = await olt.get_onu_info(
                    pon,
                    onu,
                    raise_on_error=True,
                )

            # ------------------------------------------------
            # Acciones ONU
            # ------------------------------------------------
            elif action == "onu_authorize":
                raw = await olt.authorize_onu(
                    pon=pon,
                    onu=onu,
                    profile=str(params.get("profile", "default") or "default"),
                    sn=str(params.get("sn", "") or ""),
                    save=True,
                    raise_on_error=True,
                )

            elif action == "onu_reboot":
                raw = await olt.reboot_onu(
                    pon,
                    onu,
                    raise_on_error=True,
                )

            elif action == "onu_deactivate":
                raw = await olt.deactivate_onu(
                    pon,
                    onu,
                    raise_on_error=True,
                )

            elif action == "onu_activate":
                raw = await olt.activate_onu(
                    pon,
                    onu,
                    raise_on_error=True,
                )

            elif action == "onu_delete":
                raw = await olt.delete_onu(
                    pon,
                    onu,
                    save=True,
                    raise_on_error=True,
                )

            # ------------------------------------------------
            # Acción genérica futura del perfil
            # ------------------------------------------------
            else:
                raw = await olt.run_many(
                    commands or [],
                    raise_on_error=True,
                    **params,
                )

            connection_log = list(
                getattr(olt, "log", [])
            )

    except OltError as exc:
        _mark_offline(router, str(exc))
        return {
            "ok": False,
            "error": str(exc),
            "message": str(exc),
            "rows": [],
            "info": {},
            "raw": "",
            "commands": rendered_commands,
        }

    except Exception as exc:
        _mark_offline(router, str(exc))
        error = f"Error inesperado en OLT: {exc}"
        return {
            "ok": False,
            "error": error,
            "message": error,
            "rows": [],
            "info": {},
            "raw": "",
            "commands": rendered_commands,
        }

    _mark_online(router)

    rows = parse_table(raw)
    info = parse_key_values(raw)

    return {
        "ok": True,
        "message": f"Acción '{action}' ejecutada correctamente",
        "error": "",
        "raw": raw,
        "rows": rows,
        "info": info,
        "commands": rendered_commands,
        "log": connection_log,
    }


# ============================================================
# CONSOLA LIBRE
# ============================================================

async def run_console(
    router: Router,
    command: str,
) -> dict:
    """
    Ejecuta un comando libre enviado desde la consola
    del panel.

    La sesión inicia en modo privilegiado (#).
    """

    command = (
        command or ""
    ).strip()

    if not command:

        return {
            "ok": False,
            "error": "Comando vacío",
            "message": "Debes ingresar un comando",
            "raw": "",
            "rows": [],
            "info": {},
        }

    try:

        async with connect(
            router
        ) as olt:

            raw = await olt.run(
                command
            )

            logs = list(
                getattr(
                    olt,
                    "log",
                    [],
                )
            )

    except OltError as exc:

        _mark_offline(
            router,
            str(exc),
        )

        return {
            "ok": False,
            "error": str(exc),
            "message": str(exc),
            "raw": "",
            "rows": [],
            "info": {},
        }

    except Exception as exc:

        _mark_offline(
            router,
            str(exc),
        )

        error = (
            f"Error ejecutando consola: "
            f"{exc}"
        )

        return {
            "ok": False,
            "error": error,
            "message": error,
            "raw": "",
            "rows": [],
            "info": {},
        }

    _mark_online(
        router
    )

    return {
        "ok": True,
        "error": "",
        "message": "Comando ejecutado",
        "raw": raw,
        "rows": parse_table(raw),
        "info": parse_key_values(raw),
        "command": command,
        "log": logs,
    }


# ============================================================
# SNAPSHOT / RESUMEN DE OLT
# ============================================================

async def snapshot_olt(
    router: Router,
) -> dict:
    """
    Obtiene información general de la OLT:

        - Latencia TCP
        - Versión
        - Hostname
        - Modelo
        - Uptime
        - Estado

    Actualiza los campos correspondientes del Router.
    """

    port = _cli_port(
        router
    )

    try:

        latency = await tcp_latency_ms(
            router.ip_address,
            port,
        )

    except Exception:

        latency = None

    # --------------------------------------------------------
    # Obtener versión
    # --------------------------------------------------------

    result = await run_action(
        router,
        "version",
    )

    # Guardar latencia aunque la conexión CLI falle.
    router.ping_ms = (
        float(latency or 0.0)
    )

    if not result.get("ok"):

        return {
            "ok": False,
            "message": result.get(
                "error",
                "No se pudo conectar a la OLT",
            ),
            "error": result.get(
                "error",
                "No se pudo conectar a la OLT",
            ),
            "latency": latency or 0.0,
        }

    info = (
        result.get("info")
        or {}
    )

    raw = (
        result.get("raw")
        or ""
    )

    # --------------------------------------------------------
    # Buscar identidad
    # --------------------------------------------------------

    identity = (
        info.get("Hostname")
        or info.get("hostname")
        or info.get("Device name")
        or info.get("Device Name")
        or info.get("System name")
        or info.get("System Name")
        or info.get("Name")
        or ""
    )

    if identity:

        router.identity = identity

    # --------------------------------------------------------
    # Versión
    # --------------------------------------------------------

    version = (
        info.get("Software version")
        or info.get("Software Version")
        or info.get("Version")
        or info.get("Firmware version")
        or info.get("Firmware Version")
        or ""
    )

    if version:

        # Mantener compatibilidad con la UI que utiliza
        # software_version para mostrar el firmware OLT.
        router.ros_version = version
        router.software_version = version

    # --------------------------------------------------------
    # Modelo
    # --------------------------------------------------------

    board_name = (
        info.get("Product name")
        or info.get("Product Name")
        or info.get("Device type")
        or info.get("Device Type")
        or info.get("Hardware version")
        or info.get("Hardware Version")
        or info.get("Model")
        or info.get("MODEL")
        or ""
    )

    if board_name:

        router.board_name = board_name
        router.olt_model = board_name

    # --------------------------------------------------------
    # Uptime
    # --------------------------------------------------------

    uptime = (
        info.get("Uptime")
        or info.get("uptime")
        or info.get("System uptime")
        or info.get("System Uptime")
        or info.get("Running time")
        or info.get("Running Time")
        or ""
    )

    if uptime:

        router.uptime = uptime

    _mark_online(
        router
    )

    # --------------------------------------------------------
    # Nombre mostrado
    # --------------------------------------------------------

    visible_name = (
        getattr(
            router,
            "name",
            None,
        )
        or getattr(
            router,
            "ip_address",
            "",
        )
    )

    detected_model = (
        getattr(
            router,
            "board_name",
            None,
        )
        or _profile_key(router)
    )

    return {
        "ok": True,
        "message": (
            f"Conectado a la OLT "
            f"{visible_name} "
            f"({detected_model})"
        ),
        "info": info,
        "raw": raw,
        "latency": latency or 0.0,
        "profile": _profile_key(
            router
        ),
    }


# ============================================================
# LISTA DE ONUS
# ============================================================

async def get_onus(
    router: Router,
    pon: int,
) -> dict:
    """
    Obtiene las ONUs autorizadas de un PON.

    Devuelve:
        rows
        raw
        info
    """

    try:

        pon = int(pon)

    except (
        TypeError,
        ValueError,
    ):

        return {
            "ok": False,
            "error": "PON inválido",
            "message": "El puerto PON debe ser numérico",
            "rows": [],
            "raw": "",
            "info": {},
        }

    if pon < 1 or pon > _pon_count(
        router
    ):

        return {
            "ok": False,
            "error": (
                f"PON {pon} fuera de rango"
            ),
            "message": (
                f"La OLT tiene {_pon_count(router)} PON"
            ),
            "rows": [],
            "raw": "",
            "info": {},
        }

    result = await run_action(
        router,
        "onu_list",
        pon=pon,
    )

    if not result.get("ok"):

        return {
            **result,
            "pon": pon,
        }

    return {
        **result,
        "pon": pon,
        "rows": result.get(
            "rows",
            [],
        ),
    }


# ============================================================
# AUTO-FIND
# ============================================================

async def get_onu_autofind(
    router: Router,
    pon: int,
) -> dict:
    """
    Obtiene las ONUs detectadas/pedientes de autorizar
    en un puerto PON.
    """

    try:

        pon = int(pon)

    except (
        TypeError,
        ValueError,
    ):

        return {
            "ok": False,
            "error": "PON inválido",
            "message": "El puerto PON debe ser numérico",
            "rows": [],
            "raw": "",
            "info": {},
        }

    if pon < 1 or pon > _pon_count(
        router
    ):

        return {
            "ok": False,
            "error": (
                f"PON {pon} fuera de rango"
            ),
            "message": (
                f"La OLT tiene {_pon_count(router)} PON"
            ),
            "rows": [],
            "raw": "",
            "info": {},
        }

    result = await run_action(
        router,
        "onu_autofind",
        pon=pon,
    )

    return {
        **result,
        "pon": pon,
    }


# ============================================================
# POTENCIA ÓPTICA
# ============================================================

async def get_onu_optical(
    router: Router,
    pon: int,
) -> dict:
    """
    Obtiene la potencia óptica RX de todas las ONUs
    de un PON.

    El fallback de los comandos VSOL se realiza dentro
    de OltClient.
    """

    try:

        pon = int(pon)

    except (
        TypeError,
        ValueError,
    ):

        return {
            "ok": False,
            "error": "PON inválido",
            "message": "El puerto PON debe ser numérico",
            "rows": [],
            "raw": "",
            "info": {},
        }

    if pon < 1 or pon > _pon_count(
        router
    ):

        return {
            "ok": False,
            "error": (
                f"PON {pon} fuera de rango"
            ),
            "message": (
                f"La OLT tiene {_pon_count(router)} PON"
            ),
            "rows": [],
            "raw": "",
            "info": {},
        }

    try:

        async with connect(
            router
        ) as olt:

            raw = await olt.get_onu_optical(
                pon
            )

            logs = list(
                getattr(
                    olt,
                    "log",
                    [],
                )
            )

    except OltError as exc:

        _mark_offline(
            router,
            str(exc),
        )

        return {
            "ok": False,
            "error": str(exc),
            "message": str(exc),
            "pon": pon,
            "rows": [],
            "raw": "",
            "info": {},
        }

    except Exception as exc:

        _mark_offline(
            router,
            str(exc),
        )

        error = (
            f"Error obteniendo "
            f"potencia óptica: {exc}"
        )

        return {
            "ok": False,
            "error": error,
            "message": error,
            "pon": pon,
            "rows": [],
            "raw": "",
            "info": {},
        }

    _mark_online(
        router
    )

    return {
        "ok": True,
        "message": (
            f"Potencia óptica obtenida "
            f"del PON {pon}"
        ),
        "error": "",
        "pon": pon,
        "raw": raw,
        "rows": parse_table(raw),
        "info": parse_key_values(raw),
        "log": logs,
    }


# ============================================================
# ESTADÍSTICAS PON
# ============================================================

async def get_pon_statistics(
    router: Router,
    pon: int,
) -> dict:
    """
    Obtiene estadísticas del puerto PON.
    """

    try:

        pon = int(pon)

    except (
        TypeError,
        ValueError,
    ):

        return {
            "ok": False,
            "error": "PON inválido",
            "message": "El puerto PON debe ser numérico",
            "rows": [],
            "raw": "",
            "info": {},
        }

    if pon < 1 or pon > _pon_count(
        router
    ):

        return {
            "ok": False,
            "error": (
                f"PON {pon} fuera de rango"
            ),
            "message": (
                f"La OLT tiene {_pon_count(router)} PON"
            ),
            "rows": [],
            "raw": "",
            "info": {},
        }

    result = await run_action(
        router,
        "pon_stats",
        pon=pon,
    )

    return {
        **result,
        "pon": pon,
    }


# ============================================================
# INFORMACIÓN ÓPTICA DEL PON
# ============================================================

async def get_pon_optical(
    router: Router,
    pon: int,
) -> dict:
    """
    Obtiene información del transceiver PON.
    """

    try:

        pon = int(pon)

    except (
        TypeError,
        ValueError,
    ):

        return {
            "ok": False,
            "error": "PON inválido",
            "message": "El puerto PON debe ser numérico",
            "rows": [],
            "raw": "",
            "info": {},
        }

    if pon < 1 or pon > _pon_count(
        router
    ):

        return {
            "ok": False,
            "error": (
                f"PON {pon} fuera de rango"
            ),
            "message": (
                f"La OLT tiene {_pon_count(router)} PON"
            ),
            "rows": [],
            "raw": "",
            "info": {},
        }

    result = await run_action(
        router,
        "pon_optical",
        pon=pon,
    )

    return {
        **result,
        "pon": pon,
    }


# ============================================================
# DETALLE ONU
# ============================================================

async def get_onu_detail(
    router: Router,
    pon: int,
    onu: int,
) -> dict:
    """
    Obtiene información detallada de una ONU.
    """

    try:

        pon = int(pon)
        onu = int(onu)

    except (
        TypeError,
        ValueError,
    ):

        return {
            "ok": False,
            "error": "PON/ONU inválido",
            "message": (
                "PON y ONU deben ser numéricos"
            ),
            "rows": [],
            "raw": "",
            "info": {},
        }

    if pon < 1 or pon > _pon_count(
        router
    ):

        return {
            "ok": False,
            "error": f"PON {pon} fuera de rango",
            "rows": [],
            "raw": "",
            "info": {},
        }

    if onu < 1 or onu > 128:

        return {
            "ok": False,
            "error": f"ONU {onu} fuera de rango",
            "rows": [],
            "raw": "",
            "info": {},
        }

    result = await run_action(
        router,
        "onu_detail",
        pon=pon,
        onu=onu,
    )

    return {
        **result,
        "pon": pon,
        "onu_id": onu,
    }


# ============================================================
# BUSCAR ONU POR SERIAL
# ============================================================

async def find_onu(
    router: Router,
    sn: str,
) -> dict:
    """
    Busca una ONU por número de serie en todos los PON
    de la OLT.

    Ejemplo:
        GPON12345678

    El flujo es:

        PON 1
            show onuinfo
            ↓
            buscar SN
            ↓
            obtener ONU ID
            ↓
            obtener óptica

        PON 2
        ...
        PON 8
    """

    needle = (
        str(sn or "")
        .strip()
    )

    if not needle:

        return {
            "ok": False,
            "found": False,
            "error": "Serial ONU vacío",
            "message": (
                "Debes indicar el serial de la ONU"
            ),
        }

    try:

        async with connect(
            router
        ) as olt:

            # ------------------------------------------------
            # Recorrer todos los PON
            # ------------------------------------------------

            for pon in range(
                1,
                _pon_count(router) + 1,
            ):

                # --------------------------------------------
                # Obtener ONUs autorizadas
                # --------------------------------------------

                raw = await olt.get_onus(
                    pon
                )

                rows = parse_table(
                    raw
                )

                # --------------------------------------------
                # Buscar coincidencia
                # --------------------------------------------

                match = next(
                    (
                        row
                        for row in rows
                        if _row_contains(
                            row,
                            needle,
                        )
                    ),
                    None,
                )

                if not match:

                    # ------------------------------------------------
                    # Fallback: buscar el SN directamente
                    # en el texto bruto.
                    #
                    # Esto ayuda cuando la tabla de VSOL
                    # no es reconocida por parse_table().
                    # ------------------------------------------------

                    if (
                        needle.lower()
                        not in raw.lower()
                    ):
                        continue

                    # Intentar localizar una fila
                    # aproximada con el SN.
                    candidate_lines = [
                        line.strip()
                        for line
                        in raw.splitlines()
                        if needle.lower()
                        in line.lower()
                    ]

                    if candidate_lines:

                        match = {
                            "raw_line":
                                candidate_lines[0],
                        }

                if not match:
                    continue

                # --------------------------------------------
                # Obtener ONU ID
                # --------------------------------------------

                onu_id = _find_onu_id(
                    match
                )

                # Si no se pudo obtener mediante
                # la tabla, intentar leer el texto.
                if onu_id is None:

                    raw_line = (
                        match.get(
                            "raw_line",
                            "",
                        )
                    )

                    # Patrones comunes:
                    #
                    # ONU 1
                    # ONUID 1
                    # ID 1
                    # 1/1
                    #
                    id_match = re.search(
                        r"(?:"
                        r"onu\s*id"
                        r"|onuid"
                        r"|onu"
                        r"|id"
                        r")"
                        r"\s*[:#=\-]?\s*"
                        r"(\d{1,3})",
                        raw_line,
                        re.IGNORECASE,
                    )

                    if id_match:

                        onu_id = int(
                            id_match.group(1)
                        )

                # --------------------------------------------
                # Si todavía no hay ONU ID
                # --------------------------------------------

                if onu_id is None:

                    return {
                        "ok": True,
                        "found": True,
                        "olt": getattr(
                            router,
                            "name",
                            None,
                        ) or router.ip_address,
                        "pon": pon,
                        "onu_id": None,
                        "onu": match,
                        "optical": {},
                        "raw": raw,
                        "message": (
                            f"ONU {sn} encontrada "
                            f"en PON {pon}, "
                            f"pero no se pudo determinar "
                            f"el ONU ID"
                        ),
                    }

                # --------------------------------------------
                # Obtener potencia óptica
                # --------------------------------------------

                optical_raw = ""

                try:

                    optical_raw = (
                        await olt.get_onu_optical(
                            pon
                        )
                    )

                except Exception:
                    optical_raw = ""

                optical_rows = (
                    parse_table(
                        optical_raw
                    )
                    if optical_raw
                    else []
                )

                # --------------------------------------------
                # Buscar fila óptica correspondiente
                # --------------------------------------------

                optical_match = None

                for row in optical_rows:

                    row_id = _find_onu_id(
                        row
                    )

                    if (
                        row_id is not None
                        and row_id == onu_id
                    ):

                        optical_match = row
                        break

                    if _row_contains(
                        row,
                        str(onu_id),
                    ):

                        optical_match = row
                        break

                # --------------------------------------------
                # Si no existe fila, usar información key/value
                # --------------------------------------------

                optical = (
                    optical_match
                    if optical_match
                    else (
                        parse_key_values(
                            optical_raw
                        )
                        if optical_raw
                        else {}
                    )
                )

                _mark_online(
                    router
                )

                return {
                    "ok": True,
                    "found": True,
                    "olt": (
                        getattr(
                            router,
                            "name",
                            None,
                        )
                        or router.ip_address
                    ),
                    "pon": pon,
                    "onu_id": onu_id,
                    "onu": match,
                    "optical": optical,
                    "raw": (
                        optical_raw
                        or raw
                    ),
                    "onu_raw": raw,
                    "optical_raw": optical_raw,
                    "message": (
                        f"ONU {sn} encontrada "
                        f"en PON {pon}/ONU {onu_id}"
                    ),
                }

    except OltError as exc:

        _mark_offline(
            router,
            str(exc),
        )

        return {
            "ok": False,
            "found": False,
            "error": str(exc),
            "message": str(exc),
        }

    except Exception as exc:

        _mark_offline(
            router,
            str(exc),
        )

        error = (
            f"Error buscando ONU {sn}: "
            f"{exc}"
        )

        return {
            "ok": False,
            "found": False,
            "error": error,
            "message": error,
        }

    _mark_online(
        router
    )

    return {
        "ok": True,
        "found": False,
        "olt": (
            getattr(
                router,
                "name",
                None,
            )
            or router.ip_address
        ),
        "message": (
            f"ONU {sn} no encontrada "
            f"en {getattr(router, 'name', None) or router.ip_address}"
        ),
    }


# ============================================================
# AUTORIZAR ONU
# ============================================================

async def authorize_onu(
    router: Router,
    pon: int,
    onu: int,
    profile: str,
    sn: str,
) -> dict:
    """
    Autoriza una ONU en VSOL GPON.
    """

    try:

        pon = int(pon)
        onu = int(onu)

    except (
        TypeError,
        ValueError,
    ):

        return {
            "ok": False,
            "error": "PON/ONU inválido",
            "message": (
                "PON y ONU deben ser numéricos"
            ),
            "rows": [],
            "raw": "",
        }

    profile = str(
        profile or ""
    ).strip()

    sn = str(
        sn or ""
    ).strip()

    if not profile:

        return {
            "ok": False,
            "error": "Perfil ONU vacío",
            "message": (
                "Debes indicar el perfil de la ONU"
            ),
            "rows": [],
            "raw": "",
        }

    if not sn:

        return {
            "ok": False,
            "error": "SN vacío",
            "message": (
                "Debes indicar el serial de la ONU"
            ),
            "rows": [],
            "raw": "",
        }

    try:

        async with connect(
            router
        ) as olt:

            raw = await olt.authorize_onu(
                pon=pon,
                onu=onu,
                profile=profile,
                sn=sn,
                save=True,
            )

            logs = list(
                getattr(
                    olt,
                    "log",
                    [],
                )
            )

    except OltError as exc:

        _mark_offline(
            router,
            str(exc),
        )

        return {
            "ok": False,
            "error": str(exc),
            "message": str(exc),
            "pon": pon,
            "onu_id": onu,
            "rows": [],
            "raw": "",
        }

    except Exception as exc:

        _mark_offline(
            router,
            str(exc),
        )

        error = (
            f"Error autorizando ONU: {exc}"
        )

        return {
            "ok": False,
            "error": error,
            "message": error,
            "pon": pon,
            "onu_id": onu,
            "rows": [],
            "raw": "",
        }

    _mark_online(
        router
    )

    return {
        "ok": True,
        "error": "",
        "message": (
            f"ONU {onu} autorizada "
            f"en PON {pon}"
        ),
        "pon": pon,
        "onu_id": onu,
        "sn": sn,
        "profile": profile,
        "raw": raw,
        "rows": parse_table(raw),
        "info": parse_key_values(raw),
        "log": logs,
    }


# ============================================================
# REINICIAR ONU
# ============================================================

async def reboot_onu(
    router: Router,
    pon: int,
    onu: int,
) -> dict:
    """
    Reinicia una ONU.
    """

    return await _onu_action(
        router,
        pon,
        onu,
        "reboot",
    )


# ============================================================
# ACTIVAR ONU
# ============================================================

async def activate_onu(
    router: Router,
    pon: int,
    onu: int,
) -> dict:
    """
    Activa una ONU.
    """

    return await _onu_action(
        router,
        pon,
        onu,
        "activate",
    )


# ============================================================
# DESACTIVAR ONU
# ============================================================

async def deactivate_onu(
    router: Router,
    pon: int,
    onu: int,
) -> dict:
    """
    Desactiva una ONU.
    """

    return await _onu_action(
        router,
        pon,
        onu,
        "deactivate",
    )


# ============================================================
# ELIMINAR ONU
# ============================================================

async def delete_onu(
    router: Router,
    pon: int,
    onu: int,
) -> dict:
    """
    Elimina una ONU de la configuración.
    """

    try:

        pon = int(pon)
        onu = int(onu)

    except (
        TypeError,
        ValueError,
    ):

        return {
            "ok": False,
            "error": "PON/ONU inválido",
            "message": (
                "PON y ONU deben ser numéricos"
            ),
            "raw": "",
        }

    try:

        async with connect(
            router
        ) as olt:

            raw = await olt.delete_onu(
                pon=pon,
                onu=onu,
                save=True,
            )

            logs = list(
                getattr(
                    olt,
                    "log",
                    [],
                )
            )

    except OltError as exc:

        _mark_offline(
            router,
            str(exc),
        )

        return {
            "ok": False,
            "error": str(exc),
            "message": str(exc),
            "pon": pon,
            "onu_id": onu,
            "raw": "",
        }

    except Exception as exc:

        _mark_offline(
            router,
            str(exc),
        )

        error = (
            f"Error eliminando ONU: {exc}"
        )

        return {
            "ok": False,
            "error": error,
            "message": error,
            "pon": pon,
            "onu_id": onu,
            "raw": "",
        }

    _mark_online(
        router
    )

    return {
        "ok": True,
        "error": "",
        "message": (
            f"ONU {onu} eliminada "
            f"del PON {pon}"
        ),
        "pon": pon,
        "onu_id": onu,
        "raw": raw,
        "rows": parse_table(raw),
        "info": parse_key_values(raw),
        "log": logs,
    }


# ============================================================
# ACCIONES GENERALES SOBRE ONU
# ============================================================

async def _onu_action(
    router: Router,
    pon: int,
    onu: int,
    action: str,
) -> dict:
    """
    Función interna para:

        reboot
        activate
        deactivate
    """

    try:

        pon = int(pon)
        onu = int(onu)

    except (
        TypeError,
        ValueError,
    ):

        return {
            "ok": False,
            "error": "PON/ONU inválido",
            "message": (
                "PON y ONU deben ser numéricos"
            ),
            "raw": "",
        }

    if action not in (
        "reboot",
        "activate",
        "deactivate",
    ):

        return {
            "ok": False,
            "error": (
                f"Acción ONU no permitida: {action}"
            ),
            "message": (
                "Acción ONU no permitida"
            ),
            "raw": "",
        }

    profile_action = (
        f"onu_{action}"
    )

    try:

        async with connect(
            router
        ) as olt:

            raw = ""

            if action == "reboot":

                raw = await olt.reboot_onu(
                    pon=pon,
                    onu=onu,
                )

            elif action == "activate":

                raw = await olt.activate_onu(
                    pon=pon,
                    onu=onu,
                )

            elif action == "deactivate":

                raw = await olt.deactivate_onu(
                    pon=pon,
                    onu=onu,
                )

            logs = list(
                getattr(
                    olt,
                    "log",
                    [],
                )
            )

    except OltError as exc:

        _mark_offline(
            router,
            str(exc),
        )

        return {
            "ok": False,
            "error": str(exc),
            "message": str(exc),
            "pon": pon,
            "onu_id": onu,
            "action": action,
            "profile_action": profile_action,
            "raw": "",
        }

    except Exception as exc:

        _mark_offline(
            router,
            str(exc),
        )

        error = (
            f"Error ejecutando "
            f"{action} ONU: {exc}"
        )

        return {
            "ok": False,
            "error": error,
            "message": error,
            "pon": pon,
            "onu_id": onu,
            "action": action,
            "profile_action": profile_action,
            "raw": "",
        }

    _mark_online(
        router
    )

    action_message = {
        "reboot": "reiniciada",
        "activate": "activada",
        "deactivate": "desactivada",
    }.get(
        action,
        action,
    )

    return {
        "ok": True,
        "error": "",
        "message": (
            f"ONU {onu} "
            f"{action_message} "
            f"en PON {pon}"
        ),
        "pon": pon,
        "onu_id": onu,
        "action": action,
        "profile_action": profile_action,
        "raw": raw,
        "rows": parse_table(raw),
        "info": parse_key_values(raw),
        "log": logs,
    }
