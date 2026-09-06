"""
Archivo: backend/app/integrations/olt/__init__.py
Función: Paquete de integración con OLT (VSOL) por CLI Telnet/SSH.

Compatibilidad VSOL:
    Algunas V1600G1-B imprimen eventos asíncronos (por ejemplo "ONU Dying Gasp")
    incluso mientras muestran Login:, Password: o el prompt del CLI. El cliente base
    esperaba que esos textos fueran siempre la última línea y podía terminar enviando
    "enable" como usuario o quedarse esperando hasta que la OLT cerrara Telnet.

    Además, algunas revisiones de firmware V1600G aceptan varios comandos de consulta
    únicamente dentro de `configure terminal`. Este módulo adapta login/prompt, filtra
    eventos asíncronos y completa el resumen con CPU, memoria y tiempo encendido.
"""

import asyncio
import re

from . import vsol as _vsol


# ---------------------------------------------------------------------------
# Prompts de autenticación: MULTILINE es importante porque la OLT puede emitir
# una alarma inmediatamente después de "Login:" o "Password:".
# ---------------------------------------------------------------------------
_LOGIN_RE = re.compile(
    r"^\s*(?:login|username|user\s*name)\s*:\s*$",
    re.IGNORECASE | re.MULTILINE,
)

_PASS_RE = re.compile(
    r"^\s*(?:password|contraseña|contrasena)\s*:\s*$",
    re.IGNORECASE | re.MULTILINE,
)

# Ejemplo real de evento asíncrono VSOL:
# 2026/09/05 21:40:50   ONU Dying Gasp   PON 0/1 ONU 6 sn ...
_EVENT_RE = re.compile(
    r"^\s*\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}\s+",
    re.IGNORECASE,
)

# Sustituir los regex usados internamente por vsol.py.
_vsol.LOGIN_RE = _LOGIN_RE
_vsol.PASS_RE = _PASS_RE


def _last_prompt_line(text: str) -> str:
    """Devuelve el último prompt CLI aunque después hayan llegado alarmas."""
    if not text:
        return ""

    for line in reversed(text.replace("\r", "").split("\n")):
        stripped = line.strip()
        if not stripped:
            continue
        if _LOGIN_RE.fullmatch(stripped) or _PASS_RE.fullmatch(stripped):
            continue
        if re.search(r"[>#]\s*$", stripped):
            return stripped

    return ""


def _looks_like_prompt(cls, text: str) -> bool:
    return bool(_last_prompt_line(text))


# Guardamos el limpiador original antes de reemplazarlo.
_original_clean_command_output = _vsol.OltClient._clean_command_output.__func__


def _clean_command_output(cls, command: str, output: str) -> str:
    """Quita eventos asíncronos antes de parsear la respuesta del comando."""
    filtered_lines = []

    for line in (output or "").replace("\r", "").split("\n"):
        if _EVENT_RE.match(line):
            continue
        filtered_lines.append(line)

    filtered = "\n".join(filtered_lines)
    return _original_clean_command_output(cls, command, filtered)


async def _login(self):
    """
    Login tolerante a mensajes asíncronos de VSOL.

    A diferencia de la implementación original, si llega una alarma sin un prompt
    reconocido no envía comandos a ciegas. Esto evita que "enable" termine siendo
    interpretado como nombre de usuario.
    """

    username_sent = False
    password_sent = False
    enable_sent = False
    enable_password_sent = False

    # Las alarmas pueden intercalar varias lecturas; damos margen adicional.
    for _ in range(50):
        output = await self._read_initial()

        if not output:
            continue

        clean = self._clean_ansi(output)

        if _vsol.AUTH_ERROR_RE.search(clean):
            raise _vsol.OltError(
                "Usuario o contraseña rechazados por la OLT"
            )

        # Login del usuario normal.
        if _LOGIN_RE.search(clean):
            if not username_sent:
                self._write(self.username + "\r\n")
                await self._drain()
                username_sent = True
                await asyncio.sleep(0.15)
            continue

        # Password de usuario o del modo enable.
        if _PASS_RE.search(clean):
            if username_sent and not password_sent:
                self._write(self.password + "\r\n")
                await self._drain()
                password_sent = True
                await asyncio.sleep(0.15)
                continue

            if enable_sent and not enable_password_sent:
                self._write(self.enable_password + "\r\n")
                await self._drain()
                enable_password_sent = True
                await asyncio.sleep(0.15)
                continue

            # Algunos firmwares empiezan directamente preguntando Password.
            if not password_sent:
                self._write(self.password + "\r\n")
                await self._drain()
                password_sent = True
                await asyncio.sleep(0.15)
            continue

        # Buscar el prompt aunque una alarma haya llegado después.
        prompt = _last_prompt_line(clean)

        if prompt.endswith("#"):
            self._mode = "privileged"
            self._current_pon = None
            return

        if prompt.endswith(">"):
            if not enable_sent:
                self._write("enable\r\n")
                await self._drain()
                enable_sent = True
                await asyncio.sleep(0.15)
            continue

        # Banner o eventos asíncronos sin prompt: esperar más datos.
        # No enviar "enable" ni credenciales a ciegas.
        continue

    raise _vsol.OltError(
        "No se pudo completar el login o alcanzar el prompt privilegiado (#)"
    )


async def _ensure_config(self):
    """Deja la sesión en modo global `(config)#`."""
    await self.ensure_privileged()

    if self._mode != "config":
        await self.run(
            "configure terminal",
            raise_on_error=True,
        )


async def _get_version(self) -> str:
    """Lee `show version` desde modo configuración."""
    await _ensure_config(self)

    return await self.run(
        "show version",
        raise_on_error=True,
    )


async def _get_system_metrics(self) -> dict:
    """
    Lee métricas del sistema sin convertir un comando opcional en fallo total.

    Comandos documentados para la familia V1600G:
        show sys cpu-usage
        show sys mem
        show sys running-time
    """
    await _ensure_config(self)

    outputs = {}

    for key, command in (
        ("cpu", "show sys cpu-usage"),
        ("memory", "show sys mem"),
        ("uptime", "show sys running-time"),
    ):
        try:
            outputs[key] = await self.run(
                command,
                raise_on_error=False,
            )
        except Exception as exc:
            outputs[key] = f"Error: {exc}"

    return outputs


# Aplicar los métodos compatibles a la clase que ya usa service.py.
_vsol.OltClient._last_prompt_line = staticmethod(_last_prompt_line)
_vsol.OltClient._looks_like_prompt = classmethod(_looks_like_prompt)
_vsol.OltClient._clean_command_output = classmethod(_clean_command_output)
_vsol.OltClient._login = _login
_vsol.OltClient.get_version = _get_version
_vsol.OltClient.get_system_metrics = _get_system_metrics


# ---------------------------------------------------------------------------
# Completar service.py sin duplicar toda su implementación.
# Se importa al final para evitar interferir con la carga inicial de vsol.py.
# ---------------------------------------------------------------------------
from . import service as _service  # noqa: E402

_original_run_action = _service.run_action
_original_snapshot_olt = _service.snapshot_olt


def _valid_metric_output(text: str) -> bool:
    if not text:
        return False
    return not _vsol.CLI_ERROR_RE.search(text)


def _parse_cpu_usage(text: str):
    """Devuelve uso de CPU (0..100) a partir de la columna %idle."""
    if not _valid_metric_output(text):
        return None

    lines = [line.strip() for line in text.replace("\r", "").splitlines() if line.strip()]

    # Formato sar de VSOL:
    # Average: all  2.10 ... 74.41
    # El último valor es %idle -> uso = 100 - idle.
    for line in reversed(lines):
        match = re.search(r"(?:Average:\s*)?\ball\b\s+(.+)$", line, re.IGNORECASE)
        if not match:
            continue
        numbers = re.findall(r"-?\d+(?:\.\d+)?", match.group(1))
        if not numbers:
            continue
        try:
            idle = float(numbers[-1])
            if 0.0 <= idle <= 100.0:
                return max(0, min(100, round(100.0 - idle)))
        except ValueError:
            pass

    # Fallback para salidas tipo "CPU usage: 23%".
    match = re.search(
        r"cpu[^\n%]{0,40}(?:usage|utilization)?[^\n%]{0,20}(\d+(?:\.\d+)?)\s*%",
        text,
        re.IGNORECASE,
    )
    if match:
        return max(0, min(100, round(float(match.group(1)))))

    return None


def _parse_memory_usage(text: str):
    """Devuelve porcentaje de RAM usada aceptando varios formatos Linux/VSOL."""
    if not _valid_metric_output(text):
        return None

    # /proc/meminfo o salida equivalente.
    def value_of(name: str):
        match = re.search(
            rf"^\s*{re.escape(name)}\s*:\s*(\d+(?:\.\d+)?)",
            text,
            re.IGNORECASE | re.MULTILINE,
        )
        return float(match.group(1)) if match else None

    total = value_of("MemTotal")
    available = value_of("MemAvailable")
    free = value_of("MemFree")
    buffers = value_of("Buffers") or 0.0
    cached = value_of("Cached") or 0.0

    if total and total > 0:
        if available is not None:
            used = total - available
        elif free is not None:
            used = total - free - buffers - cached
        else:
            used = None

        if used is not None:
            return max(0, min(100, round((used / total) * 100.0)))

    # Formato de `free`: Mem: TOTAL USED FREE ...
    match = re.search(
        r"^\s*Mem:\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+",
        text,
        re.IGNORECASE | re.MULTILINE,
    )
    if match:
        total = float(match.group(1))
        used = float(match.group(2))
        if total > 0:
            return max(0, min(100, round((used / total) * 100.0)))

    # Fallback directo en porcentaje.
    match = re.search(
        r"(?:mem|memory)[^\n%]{0,50}(?:used|usage|utilization)?[^\n%]{0,20}(\d+(?:\.\d+)?)\s*%",
        text,
        re.IGNORECASE,
    )
    if match:
        return max(0, min(100, round(float(match.group(1)))))

    return None


def _parse_uptime(text: str):
    """Extrae el tiempo encendido de la respuesta de `show sys running-time`."""
    if not _valid_metric_output(text):
        return None

    clean = text.replace("\r", "").strip()

    match = re.search(
        r"(?:system\s+)?(?:running[- ]time|uptime)\s*(?::|=)?\s*(.+)$",
        clean,
        re.IGNORECASE | re.MULTILINE,
    )
    if match:
        value = match.group(1).strip()
        if value:
            return value

    # En algunos firmwares la respuesta es únicamente el valor.
    lines = [line.strip() for line in clean.splitlines() if line.strip()]
    for line in lines:
        if line.lower().startswith("show sys running-time"):
            continue
        if _vsol.CLI_ERROR_RE.search(line):
            continue
        return line

    return None


async def _read_system_metrics(router):
    """Abre una sola sesión adicional y obtiene CPU/RAM/Uptime."""
    try:
        async with _service.connect(router) as olt:
            raw = await olt.get_system_metrics()
    except Exception as exc:
        return {
            "cpu": None,
            "memory": None,
            "uptime": None,
            "raw": {},
            "error": str(exc),
        }

    return {
        "cpu": _parse_cpu_usage(raw.get("cpu", "")),
        "memory": _parse_memory_usage(raw.get("memory", "")),
        "uptime": _parse_uptime(raw.get("uptime", "")),
        "raw": raw,
        "error": "",
    }


def _apply_metrics(router, metrics: dict):
    cpu = metrics.get("cpu")
    memory = metrics.get("memory")
    uptime = metrics.get("uptime")

    if cpu is not None:
        router.cpu_usage_pct = int(cpu)

    if memory is not None:
        router.memory_usage_pct = int(memory)

    if uptime:
        router.uptime = str(uptime)[:60]


def _augment_result(result: dict, metrics: dict) -> dict:
    if not isinstance(result, dict):
        return result

    info = dict(result.get("info") or {})

    if metrics.get("cpu") is not None:
        info["CPU Usage"] = f"{metrics['cpu']}%"

    if metrics.get("memory") is not None:
        info["Memory Usage"] = f"{metrics['memory']}%"

    if metrics.get("uptime"):
        info["Uptime"] = metrics["uptime"]

    result["info"] = info

    raw_sections = []
    if result.get("raw"):
        raw_sections.append(result["raw"])

    metric_raw = metrics.get("raw") or {}
    for key, title in (
        ("cpu", "show sys cpu-usage"),
        ("memory", "show sys mem"),
        ("uptime", "show sys running-time"),
    ):
        value = (metric_raw.get(key) or "").strip()
        if value:
            raw_sections.append(f"$ {title}\n{value}")

    if raw_sections:
        result["raw"] = "\n\n".join(raw_sections)

    if metrics.get("error"):
        result["metrics_warning"] = metrics["error"]

    return result


async def _run_action_with_system_metrics(router, action: str, **params):
    result = await _original_run_action(router, action, **params)

    if action != "system" or not result.get("ok"):
        return result

    metrics = await _read_system_metrics(router)
    _apply_metrics(router, metrics)
    return _augment_result(result, metrics)


async def _snapshot_olt_with_metrics(router):
    result = await _original_snapshot_olt(router)

    if not result.get("ok"):
        return result

    metrics = await _read_system_metrics(router)
    _apply_metrics(router, metrics)
    return _augment_result(result, metrics)


_service.run_action = _run_action_with_system_metrics
_service.snapshot_olt = _snapshot_olt_with_metrics
