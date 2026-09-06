"""
Archivo: backend/app/integrations/olt/__init__.py
Función: Paquete de integración con OLT (VSOL) por CLI Telnet/SSH.

Compatibilidad VSOL:
    Algunas V1600G1-B imprimen eventos asíncronos (por ejemplo "ONU Dying Gasp")
    incluso mientras muestran Login:, Password: o el prompt del CLI. El cliente base
    esperaba que esos textos fueran siempre la última línea y podía terminar enviando
    "enable" como usuario o quedarse esperando hasta que la OLT cerrara Telnet.

    Este módulo aplica un parche de compatibilidad al cargar el paquete para reconocer
    Login/Password/prompt aunque existan alarmas después, y evita mezclar esas alarmas
    con la salida de los comandos.
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


# Aplicar los métodos compatibles a la clase que ya usa service.py.
_vsol.OltClient._last_prompt_line = staticmethod(_last_prompt_line)
_vsol.OltClient._looks_like_prompt = classmethod(_looks_like_prompt)
_vsol.OltClient._clean_command_output = classmethod(_clean_command_output)
_vsol.OltClient._login = _login
