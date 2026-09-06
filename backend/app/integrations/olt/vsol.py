"""
Archivo:
    backend/app/integrations/olt/vsol.py

Función:
    Cliente CLI para OLT VSOL por Telnet/SSH.

Principalmente probado/estructurado para:
    VSOL V1600G / V1600G1-B / V1600G2 GPON

Flujo GPON:
    enable
    configure terminal
    interface gpon 0/{pon}
    <comando>

Compatibilidad:
    - OltClient
    - OLT_PROFILES
    - parse_table()
    - parse_key_values()

"""

import asyncio
import re
from typing import Optional

import asyncssh

from app.core.config import MIKROTIK_TIMEOUT as TIMEOUT


# ============================================================
# EXCEPCIÓN
# ============================================================

class OltError(Exception):
    """Error de conexión o de ejecución de comandos en la OLT."""


# ============================================================
# PERFILES DE OLT
# ============================================================

OLT_PROFILES = {
    # ========================================================
    # VSOL GPON
    # ========================================================
    "vsol_gpon": {
        "label": (
            "VSOL GPON "
            "(V1600G1/G2, V1600G1-B, V1600GS, "
            "V2801/V2804, V1600X)"
        ),

        "iface": "interface gpon 0/{pon}",

        # ----------------------------------------------------
        # SISTEMA
        # ----------------------------------------------------

        "version": [
            "show version",
        ],

        "system": [
            "show version",
        ],

        # ----------------------------------------------------
        # PON
        # ----------------------------------------------------

        "pon_optical": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "show pon optical transceiver",
        ],

        "pon_stats": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "show pon statistics",
        ],

        # ----------------------------------------------------
        # ONU
        # ----------------------------------------------------

        # ONU autorizadas
        "onu_list": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "show onuinfo",
        ],

        # ONU pendientes de autorizar
        "onu_autofind": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "show onu auto-find",
        ],

        # Potencia óptica ONU
        "onu_optical": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "show pon onu all rx-power",
        ],

        # Detalle ONU
        "onu_detail": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "show onu detail-info {onu}",
        ],

        # ----------------------------------------------------
        # ACCIONES ONU
        # ----------------------------------------------------

        # Autorizar ONU
        "onu_authorize": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "onu add {onu} profile {profile} sn {sn}",
            "write",
        ],

        # Reiniciar ONU
        "onu_reboot": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "onu {onu} reboot",
        ],

        # Desactivar ONU
        "onu_deactivate": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "onu {onu} deactivate",
        ],

        # Activar ONU
        "onu_activate": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "onu {onu} activate",
        ],

        # Eliminar ONU
        "onu_delete": [
            "configure terminal",
            "interface gpon 0/{pon}",
            "no onu {onu}",
            "write",
        ],
    },

    # ========================================================
    # VSOL EPON
    # Se conserva para no romper compatibilidad del panel.
    # ========================================================
    "vsol_epon": {
        "label": "VSOL EPON (V1600D4-L / V1600D8 EPON / GEPON)",

        "iface": "interface epon 0/{pon}",

        "version": [
            "show version",
        ],

        "system": [
            "show version",
        ],

        "pon_optical": [
            "configure terminal",
            "interface epon 0/{pon}",
            "show pon optical transceiver",
        ],

        "pon_stats": [
            "configure terminal",
            "interface epon 0/{pon}",
            "show pon statistics",
        ],

        "onu_list": [
            "configure terminal",
            "interface epon 0/{pon}",
            "show onu auth-info",
        ],

        "onu_autofind": [
            "configure terminal",
            "interface epon 0/{pon}",
            "show onu auto-find",
        ],

        "onu_optical": [
            "configure terminal",
            "interface epon 0/{pon}",
            "show onu {onu} ctc opm_diag",
        ],

        "onu_detail": [
            "configure terminal",
            "interface epon 0/{pon}",
            "show onu {onu} ctc onu_info",
        ],

        "onu_authorize": [
            "configure terminal",
            "interface epon 0/{pon}",
            "onu mac-auth add {sn}",
            "write",
        ],

        "onu_reboot": [
            "configure terminal",
            "interface epon 0/{pon}",
            "reset onu auth onuid {onu}",
        ],

        "onu_deactivate": [
            "configure terminal",
            "interface epon 0/{pon}",
            "deregister onu auth onuid {onu}",
        ],

        "onu_activate": [
            "configure terminal",
            "interface epon 0/{pon}",
            "reset onu auth onuid {onu}",
        ],

        "onu_delete": [
            "configure terminal",
            "interface epon 0/{pon}",
            "no onu auth onuid {onu}",
            "write",
        ],
    },
}


# ============================================================
# REGEX
# ============================================================

ANSI_RE = re.compile(
    r"\x1B(?:[@-_]|\[[0-?]*[ -/]*[@-~])"
)

LOGIN_RE = re.compile(
    r"(?:login|username|user\s*name)\s*:\s*$",
    re.IGNORECASE,
)

PASS_RE = re.compile(
    r"(?:password|contraseña|contrasena)\s*:\s*$",
    re.IGNORECASE,
)

MORE_RE = re.compile(
    r"(?:"
    r"--\s*more\s*--"
    r"|--More--"
    r"|\[current\s*page\]"
    r"|press\s+any\s+key"
    r")",
    re.IGNORECASE,
)

AUTH_ERROR_RE = re.compile(
    r"(?:"
    r"login incorrect"
    r"|access denied"
    r"|authentication failed"
    r"|bad password"
    r"|invalid password"
    r"|invalid username"
    r"|login failed"
    r"|incorrect password"
    r")",
    re.IGNORECASE,
)

CLI_ERROR_RE = re.compile(
    r"(?:"
    r"%\s*(?:unknown|invalid|incomplete|ambiguous)\s+command"
    r"|unknown\s+command"
    r"|invalid\s+command"
    r"|incomplete\s+command"
    r"|ambiguous\s+command"
    r"|command\s+not\s+found"
    r"|error:"
    r")",
    re.IGNORECASE,
)


# ============================================================
# CLIENTE OLT
# ============================================================

class OltClient:
    """
    Cliente asíncrono para VSOL por Telnet o SSH.

    El estado del CLI se controla internamente para evitar
    volver a ejecutar innecesariamente configure terminal
    e interface gpon.
    """

    def __init__(
        self,
        host: str,
        username: str,
        password: str,
        port: int = 23,
        protocol: str = "telnet",
        enable_password: str = "",
    ):
        self.host = host
        self.port = int(port)

        self.protocol = (
            protocol or "telnet"
        ).strip().lower()

        self.username = username
        self.password = password

        # En muchas VSOL la contraseña de enable es igual
        # a la contraseña del usuario.
        self.enable_password = (
            enable_password or password
        )

        # ----------------------------------------------------
        # Conexión
        # ----------------------------------------------------

        self._reader = None
        self._writer = None

        # SSH
        self._ssh = None
        self._proc = None

        # ----------------------------------------------------
        # Estado CLI
        # ----------------------------------------------------

        self._mode = "unknown"

        # PON actual.
        # Ejemplo:
        #   1
        #   2
        #   8
        self._current_pon: Optional[int] = None

        # ----------------------------------------------------
        # Telnet
        # ----------------------------------------------------

        self._telnet_pending = bytearray()

        # ----------------------------------------------------
        # Logs
        # ----------------------------------------------------

        self.log: list[str] = []

    # ========================================================
    # ENTER
    # ========================================================

    async def __aenter__(self):
        try:

            # ------------------------------------------------
            # SSH
            # ------------------------------------------------

            if self.protocol == "ssh":

                self._ssh = await asyncio.wait_for(
                    asyncssh.connect(
                        self.host,
                        port=self.port,
                        username=self.username,
                        password=self.password,
                        known_hosts=None,
                        connect_timeout=TIMEOUT,
                    ),
                    TIMEOUT + 2,
                )

                self._proc = await self._ssh.create_process(
                    term_type="vt100",
                    term_size=(200, 1000),
                )

            # ------------------------------------------------
            # TELNET
            # ------------------------------------------------

            elif self.protocol == "telnet":

                self._reader, self._writer = (
                    await asyncio.wait_for(
                        asyncio.open_connection(
                            self.host,
                            self.port,
                        ),
                        TIMEOUT,
                    )
                )

            else:
                raise OltError(
                    f"Protocolo no soportado: {self.protocol}"
                )

            # Login
            await self._login()

            return self

        except OltError:
            raise

        except (
            asyncio.TimeoutError,
            OSError,
            asyncssh.Error,
        ) as exc:

            message = str(exc).strip()

            if not message:
                message = "tiempo de espera agotado"

            raise OltError(
                f"No se pudo conectar a "
                f"{self.host}:{self.port} "
                f"({message})"
            ) from exc

        except Exception as exc:

            raise OltError(
                f"Error inicializando conexión con "
                f"{self.host}:{self.port}: {exc}"
            ) from exc

    # ========================================================
    # EXIT
    # ========================================================

    async def __aexit__(self, *exc):

        try:

            # SSH
            if self._proc is not None:
                try:
                    self._proc.stdin.write(
                        "exit\r\n"
                    )
                except Exception:
                    pass

            # Cerrar SSH
            if self._ssh is not None:

                try:
                    self._ssh.close()
                except Exception:
                    pass

                try:
                    await self._ssh.wait_closed()
                except Exception:
                    pass

            # Cerrar Telnet
            elif self._writer is not None:

                try:
                    self._writer.close()
                except Exception:
                    pass

                try:
                    await self._writer.wait_closed()
                except Exception:
                    pass

        except Exception:
            pass

        finally:

            self._reader = None
            self._writer = None

            self._ssh = None
            self._proc = None

            self._mode = "unknown"
            self._current_pon = None

    # ========================================================
    # UTILIDADES DE TEXTO
    # ========================================================

    @staticmethod
    def _clean_ansi(text: str) -> str:

        return ANSI_RE.sub(
            "",
            text or "",
        )

    @staticmethod
    def _last_non_empty_line(
        text: str,
    ) -> str:

        lines = (
            text
            .replace("\r", "")
            .split("\n")
        )

        for line in reversed(lines):

            line = line.strip()

            if line:
                return line

        return ""

    @classmethod
    def _looks_like_prompt(
        cls,
        text: str,
    ) -> bool:

        last = cls._last_non_empty_line(
            text
        )

        if not last:
            return False

        if LOGIN_RE.search(last):
            return False

        if PASS_RE.search(last):
            return False

        # VSOL puede utilizar:
        #
        # V1600G1-B>
        # V1600G1-B#
        # V1600G1-B(config)#
        # V1600G1-B(config-gpon-0/1)#
        #
        # También se acepta un prompt sin hostname.

        return bool(
            re.search(
                r"[>#]\s*$",
                last,
            )
        )

    # ========================================================
    # TELNET
    # ========================================================

    def _process_telnet_bytes(
        self,
        data: bytes,
    ):

        """
        Elimina comandos Telnet IAC y construye
        las respuestas de negociación.

        Soporta:
            IAC WILL
            IAC WONT
            IAC DO
            IAC DONT
            IAC SB ... IAC SE
        """

        clean = bytearray()
        responses = bytearray()

        i = 0

        while i < len(data):

            # Byte normal
            if data[i] != 255:

                clean.append(data[i])
                i += 1

                continue

            # IAC incompleto
            if i + 1 >= len(data):

                self._telnet_pending.extend(
                    data[i:]
                )

                break

            command = data[i + 1]

            # IAC IAC
            if command == 255:

                clean.append(255)
                i += 2

                continue

            # WILL
            if command == 251:

                if i + 2 >= len(data):

                    self._telnet_pending.extend(
                        data[i:]
                    )

                    break

                option = data[i + 2]

                # WILL -> DONT
                responses.extend(
                    (255, 254, option)
                )

                i += 3
                continue

            # WONT
            if command == 252:

                if i + 2 >= len(data):

                    self._telnet_pending.extend(
                        data[i:]
                    )

                    break

                i += 3
                continue

            # DO
            if command == 253:

                if i + 2 >= len(data):

                    self._telnet_pending.extend(
                        data[i:]
                    )

                    break

                option = data[i + 2]

                # DO -> WONT
                responses.extend(
                    (255, 252, option)
                )

                i += 3
                continue

            # DONT
            if command == 254:

                if i + 2 >= len(data):

                    self._telnet_pending.extend(
                        data[i:]
                    )

                    break

                i += 3
                continue

            # Subnegociación
            if command == 250:

                end = data.find(
                    b"\xff\xf0",
                    i + 2,
                )

                if end == -1:

                    self._telnet_pending.extend(
                        data[i:]
                    )

                    break

                i = end + 2

                continue

            # Otros comandos Telnet
            i += 2

        return bytes(clean), bytes(responses)

    # ========================================================
    # READ CHUNK
    # ========================================================

    async def _read_chunk(self) -> str:

        # ----------------------------------------------------
        # SSH
        # ----------------------------------------------------

        if self._ssh:

            try:

                data = await asyncio.wait_for(
                    self._proc.stdout.read(4096),
                    TIMEOUT,
                )

            except asyncio.TimeoutError:
                raise

            if not data:

                raise OltError(
                    "La OLT cerró la sesión SSH"
                )

            if isinstance(data, bytes):

                return data.decode(
                    "utf-8",
                    "ignore",
                )

            return str(data)

        # ----------------------------------------------------
        # TELNET
        # ----------------------------------------------------

        if not self._reader:

            raise OltError(
                "Canal Telnet no inicializado"
            )

        try:

            raw = await asyncio.wait_for(
                self._reader.read(4096),
                TIMEOUT,
            )

        except asyncio.TimeoutError:
            raise

        if not raw:

            raise OltError(
                "La OLT cerró la conexión Telnet"
            )

        # Unir posibles bytes incompletos
        if self._telnet_pending:

            raw = bytes(
                self._telnet_pending
            ) + raw

            self._telnet_pending.clear()

        clean, responses = (
            self._process_telnet_bytes(raw)
        )

        # Responder a negociación Telnet
        if responses and self._writer:

            try:

                self._writer.write(
                    responses
                )

                await self._writer.drain()

            except Exception:
                pass

        return clean.decode(
            "utf-8",
            "ignore",
        )

    # ========================================================
    # WRITE
    # ========================================================

    def _write(self, text: str):

        if self._ssh:

            self._proc.stdin.write(text)
            return

        if not self._writer:

            raise OltError(
                "Canal Telnet no inicializado"
            )

        self._writer.write(
            text.encode()
        )

    # ========================================================
    # DRAIN
    # ========================================================

    async def _drain(self):

        if self._writer:

            try:

                await self._writer.drain()

            except Exception:
                pass

    # ========================================================
    # READ LOGIN / PROMPT
    # ========================================================

    async def _read_initial(self) -> str:

        buffer = ""

        for _ in range(25):

            try:

                chunk = await self._read_chunk()

            except asyncio.TimeoutError:

                if buffer:
                    return buffer

                raise OltError(
                    "La OLT no respondió durante "
                    "el inicio de sesión"
                )

            if not chunk:
                continue

            chunk = self._clean_ansi(
                chunk
            )

            buffer += chunk

            if LOGIN_RE.search(buffer):
                return buffer

            if PASS_RE.search(buffer):
                return buffer

            if self._looks_like_prompt(
                buffer
            ):
                return buffer

        return buffer

    # ========================================================
    # READ UNTIL PROMPT
    # ========================================================

    async def _read_until_prompt(self) -> str:

        buffer = ""

        max_buffer = 1024 * 1024

        while True:

            try:

                chunk = await self._read_chunk()

            except asyncio.TimeoutError:

                if buffer:
                    return buffer

                raise OltError(
                    "La OLT no respondió "
                    "(timeout esperando prompt)"
                )

            if not chunk:
                continue

            chunk = self._clean_ansi(
                chunk
            )

            buffer += chunk

            # Evitar buffer infinito
            if len(buffer) > max_buffer:

                buffer = buffer[
                    -max_buffer:
                ]

            # ------------------------------------------------
            # PAGINACIÓN
            # ------------------------------------------------

            if MORE_RE.search(buffer):

                # VSOL normalmente avanza con espacio.
                self._write(" ")

                await self._drain()

                await asyncio.sleep(
                    0.08
                )

                # Eliminar marcador
                buffer = MORE_RE.sub(
                    "",
                    buffer,
                )

                continue

            # ------------------------------------------------
            # LOGIN
            # ------------------------------------------------

            if LOGIN_RE.search(buffer):

                return buffer

            # ------------------------------------------------
            # PASSWORD
            # ------------------------------------------------

            if PASS_RE.search(buffer):

                return buffer

            # ------------------------------------------------
            # PROMPT
            # ------------------------------------------------

            if self._looks_like_prompt(
                buffer
            ):

                return buffer

    # ========================================================
    # LOGIN
    # ========================================================

    async def _login(self):

        username_sent = False
        password_sent = False
        enable_sent = False

        for _ in range(25):

            output = await self._read_initial()

            if not output:
                continue

            clean = self._clean_ansi(
                output
            )

            last_line = (
                self._last_non_empty_line(
                    clean
                )
            )

            # ------------------------------------------------
            # AUTENTICACIÓN INCORRECTA
            # ------------------------------------------------

            if AUTH_ERROR_RE.search(
                clean
            ):

                raise OltError(
                    "Usuario o contraseña "
                    "rechazados por la OLT"
                )

            # ------------------------------------------------
            # LOGIN
            # ------------------------------------------------

            if LOGIN_RE.search(
                clean
            ):

                self._write(
                    self.username + "\r\n"
                )

                await self._drain()

                username_sent = True

                await asyncio.sleep(
                    0.15
                )

                continue

            # ------------------------------------------------
            # PASSWORD
            # ------------------------------------------------

            if PASS_RE.search(
                clean
            ):

                if (
                    username_sent
                    and not password_sent
                ):

                    self._write(
                        self.password
                        + "\r\n"
                    )

                    await self._drain()

                    password_sent = True

                    await asyncio.sleep(
                        0.15
                    )

                    continue

                if enable_sent:

                    self._write(
                        self.enable_password
                        + "\r\n"
                    )

                    await self._drain()

                    await asyncio.sleep(
                        0.15
                    )

                    continue

                # Caso en que la OLT empieza
                # directamente preguntando Password.
                self._write(
                    self.password + "\r\n"
                )

                await self._drain()

                password_sent = True

                await asyncio.sleep(
                    0.15
                )

                continue

            # ------------------------------------------------
            # PROMPT
            # ------------------------------------------------

            if self._looks_like_prompt(
                clean
            ):

                # Privilegiado
                if last_line.endswith("#"):

                    self._mode = (
                        "privileged"
                    )

                    self._current_pon = None

                    return

                # Usuario
                if last_line.endswith(">"):

                    if not enable_sent:

                        self._write(
                            "enable\r\n"
                        )

                        await self._drain()

                        enable_sent = True

                        await asyncio.sleep(
                            0.15
                        )

                        continue

            # ------------------------------------------------
            # ÚLTIMO RECURSO
            # ------------------------------------------------

            if not enable_sent:

                self._write(
                    "enable\r\n"
                )

                await self._drain()

                enable_sent = True

                await asyncio.sleep(
                    0.15
                )

        raise OltError(
            "No se pudo completar el login "
            "o alcanzar el prompt privilegiado (#)"
        )

    # ========================================================
    # LIMPIAR OUTPUT
    # ========================================================

    @classmethod
    def _clean_command_output(
        cls,
        command: str,
        output: str,
    ) -> str:

        output = cls._clean_ansi(
            output or ""
        )

        lines = output.replace(
            "\r",
            "",
        ).split("\n")

        command_normalized = re.sub(
            r"\s+",
            " ",
            command.strip().lower(),
        )

        # ----------------------------------------------------
        # Eliminar echo del comando
        # ----------------------------------------------------

        cleaned_echo = []

        echo_removed = False

        for line in lines:

            line_normalized = re.sub(
                r"\s+",
                " ",
                line.strip().lower(),
            )

            if (
                not echo_removed
                and line_normalized
                == command_normalized
            ):

                echo_removed = True
                continue

            cleaned_echo.append(line)

        lines = cleaned_echo

        # ----------------------------------------------------
        # Procesar líneas
        # ----------------------------------------------------

        cleaned = []

        for line in lines:

            stripped = line.strip()

            if not stripped:
                cleaned.append("")
                continue

            # Prompt final
            if cls._looks_like_prompt(
                stripped
            ):
                continue

            # Paginación
            if MORE_RE.search(
                stripped
            ):

                stripped = MORE_RE.sub(
                    "",
                    stripped,
                ).strip()

                if not stripped:
                    continue

            cleaned.append(
                stripped
            )

        # ----------------------------------------------------
        # Unir
        # ----------------------------------------------------

        text = "\n".join(
            cleaned
        ).strip()

        # Si el echo quedó todavía
        text_lines = text.splitlines()

        if text_lines:

            first_normalized = re.sub(
                r"\s+",
                " ",
                text_lines[0].strip().lower(),
            )

            if first_normalized == command_normalized:

                text = "\n".join(
                    text_lines[1:]
                ).strip()

        return text

    # ========================================================
    # DETECTAR ERROR CLI
    # ========================================================

    @staticmethod
    def _has_cli_error(
        text: str,
    ) -> bool:

        return bool(
            CLI_ERROR_RE.search(
                text or ""
            )
        )

    # ========================================================
    # RUN
    # ========================================================

    async def run(
        self,
        command: str,
        *,
        raise_on_error: bool = False,
    ) -> str:

        command = (
            command or ""
        ).strip()

        if not command:
            return ""

        try:

            # Enviar comando
            self._write(
                command + "\r\n"
            )

            await self._drain()

            # Pequeño margen para eco/respuesta
            await asyncio.sleep(
                0.12
            )

            # Leer respuesta
            raw_output = (
                await self._read_until_prompt()
            )

            # Limpiar
            text = self._clean_command_output(
                command,
                raw_output,
            )

            normalized = (
                command.lower().strip()
            )

            # ------------------------------------------------
            # ACTUALIZAR ESTADO
            # ------------------------------------------------

            if normalized in (
                "enable",
            ):

                self._mode = (
                    "privileged"
                )

                self._current_pon = None

            elif normalized in (
                "configure terminal",
                "conf t",
            ):

                self._mode = "config"

                self._current_pon = None

            elif normalized.startswith(
                "interface gpon "
            ):

                self._mode = "pon"

                match = re.search(
                    r"interface\s+gpon\s+0/(\d+)",
                    normalized,
                )

                if match:
                    self._current_pon = (
                        int(match.group(1))
                    )

            elif normalized.startswith(
                "interface epon "
            ):

                self._mode = "pon"

                match = re.search(
                    r"interface\s+epon\s+0/(\d+)",
                    normalized,
                )

                if match:
                    self._current_pon = (
                        int(match.group(1))
                    )

            elif normalized in (
                "exit",
                "quit",
            ):

                if self._mode == "pon":

                    self._mode = "config"

                    self._current_pon = None

                elif self._mode == "config":

                    self._mode = (
                        "privileged"
                    )

                    self._current_pon = None

            elif normalized == "end":

                self._mode = (
                    "privileged"
                )

                self._current_pon = None

            # ------------------------------------------------
            # LOG
            # ------------------------------------------------

            self.log.append(
                f"# {command}\n{text}"
            )

            # ------------------------------------------------
            # ERROR
            # ------------------------------------------------

            if (
                raise_on_error
                and self._has_cli_error(text)
            ):

                raise OltError(
                    f"Error ejecutando "
                    f"'{command}': {text}"
                )

            return text

        except OltError:
            raise

        except Exception as exc:

            message = (
                f"Error ejecutando "
                f"'{command}': {exc}"
            )

            self.log.append(
                f"# {command}\n{message}"
            )

            if raise_on_error:

                raise OltError(
                    message
                ) from exc

            return message

    # ========================================================
    # RUN MANY
    # ========================================================

    async def run_many(
        self,
        commands: list[str],
        *,
        raise_on_error: bool = False,
        **params,
    ) -> str:

        outputs = []

        for command_template in commands:

            try:

                command = (
                    command_template.format(
                        **params
                    )
                )

            except KeyError as exc:

                raise OltError(
                    f"Falta parámetro "
                    f"'{exc.args[0]}' "
                    f"para el comando: "
                    f"{command_template}"
                ) from exc

            result = await self.run(
                command,
                raise_on_error=(
                    raise_on_error
                ),
            )

            if result:
                outputs.append(result)

            await asyncio.sleep(
                0.05
            )

        return "\n".join(
            outputs
        )

    # ========================================================
    # ASEGURAR MODO PRIVILEGIADO
    # ========================================================

    async def ensure_privileged(self):

        if self._mode == "privileged":
            return ""

        # PON -> config
        if self._mode == "pon":

            await self.run(
                "exit"
            )

        # config -> privileged
        if self._mode == "config":

            await self.run(
                "exit"
            )

        # Si sigue sin estar privilegiado
        if self._mode != "privileged":

            return await self.run(
                "enable"
            )

        return ""

    # ========================================================
    # ENTRAR A GPON
    # ========================================================

    async def enter_pon(
        self,
        pon: int,
        *,
        raise_on_error: bool = True,
    ) -> str:

        pon = int(pon)

        # La V1600G utiliza PON 1...8 en equipos
        # de 8 puertos.
        if pon < 1 or pon > 128:

            raise OltError(
                f"PON fuera de rango: {pon}"
            )

        await self.ensure_privileged()

        # Entrar a configuración
        if self._mode != "config":

            await self.run(
                "configure terminal",
                raise_on_error=(
                    raise_on_error
                ),
            )

        # Entrar al PON
        if (
            self._mode != "pon"
            or self._current_pon != pon
        ):

            await self.run(
                f"interface gpon 0/{pon}",
                raise_on_error=(
                    raise_on_error
                ),
            )

        return (
            f"interface gpon 0/{pon}"
        )

    # ========================================================
    # ENTRAR A EPON
    # ========================================================

    async def enter_epon(
        self,
        pon: int,
        *,
        raise_on_error: bool = True,
    ) -> str:

        pon = int(pon)

        if pon < 1 or pon > 128:

            raise OltError(
                f"PON fuera de rango: {pon}"
            )

        await self.ensure_privileged()

        if self._mode != "config":

            await self.run(
                "configure terminal",
                raise_on_error=(
                    raise_on_error
                ),
            )

        if (
            self._mode != "pon"
            or self._current_pon != pon
        ):

            await self.run(
                f"interface epon 0/{pon}",
                raise_on_error=(
                    raise_on_error
                ),
            )

        return (
            f"interface epon 0/{pon}"
        )

    # ========================================================
    # RUN DENTRO DE GPON
    # ========================================================

    async def run_pon(
        self,
        pon: int,
        command: str,
        *,
        raise_on_error: bool = True,
    ) -> str:

        await self.enter_pon(
            pon,
            raise_on_error=(
                raise_on_error
            ),
        )

        return await self.run(
            command,
            raise_on_error=(
                raise_on_error
            ),
        )

    # ========================================================
    # RUN DENTRO DE EPON
    # ========================================================

    async def run_epon(
        self,
        pon: int,
        command: str,
        *,
        raise_on_error: bool = True,
    ) -> str:

        await self.enter_epon(
            pon,
            raise_on_error=(
                raise_on_error
            ),
        )

        return await self.run(
            command,
            raise_on_error=(
                raise_on_error
            ),
        )

    # ========================================================
    # EJECUTAR PERFIL
    # ========================================================

    async def run_profile(
        self,
        profile_name: str,
        action: str,
        *,
        pon: Optional[int] = None,
        raise_on_error: bool = True,
        **params,
    ) -> str:
        """
        Ejecuta una acción de OLT_PROFILES.

        Las operaciones VSOL sensibles a diferencias de firmware se
        desvían a los métodos especializados para conservar los fallbacks.
        """
        profile = OLT_PROFILES.get(profile_name)

        if not profile:
            raise OltError(
                f"Perfil OLT no encontrado: {profile_name}"
            )

        if pon is not None:
            params["pon"] = pon

        if action == "system":
            return await self.get_version()

        if action == "pon_optical":
            return await self.get_pon_optical(
                int(params.get("pon", 1)),
                raise_on_error=raise_on_error,
            )

        if action == "pon_stats":
            return await self.get_pon_statistics(
                int(params.get("pon", 1)),
                raise_on_error=raise_on_error,
            )

        if action == "onu_list":
            return await self.get_onus(
                int(params.get("pon", 1)),
                raise_on_error=raise_on_error,
            )

        if action == "onu_autofind":
            return await self.get_onu_autofind(
                int(params.get("pon", 1)),
                raise_on_error=raise_on_error,
            )

        if action == "onu_optical":
            return await self.get_onu_optical(
                int(params.get("pon", 1)),
                raise_on_error=raise_on_error,
            )

        if action == "onu_detail":
            return await self.get_onu_info(
                int(params.get("pon", 1)),
                int(params.get("onu", 0)),
                raise_on_error=raise_on_error,
            )

        if action == "onu_authorize":
            return await self.authorize_onu(
                pon=int(params.get("pon", 1)),
                onu=int(params.get("onu", 0)),
                profile=str(params.get("profile", "default") or "default"),
                sn=str(params.get("sn", "") or ""),
                save=True,
                raise_on_error=raise_on_error,
            )

        if action == "onu_reboot":
            return await self.reboot_onu(
                int(params.get("pon", 1)),
                int(params.get("onu", 0)),
                raise_on_error=raise_on_error,
            )

        if action == "onu_deactivate":
            return await self.deactivate_onu(
                int(params.get("pon", 1)),
                int(params.get("onu", 0)),
                raise_on_error=raise_on_error,
            )

        if action == "onu_activate":
            return await self.activate_onu(
                int(params.get("pon", 1)),
                int(params.get("onu", 0)),
                raise_on_error=raise_on_error,
            )

        if action == "onu_delete":
            return await self.delete_onu(
                int(params.get("pon", 1)),
                int(params.get("onu", 0)),
                save=True,
                raise_on_error=raise_on_error,
            )

        commands = profile.get(action)
        if not commands:
            raise OltError(
                f"Acción '{action}' no existe en el perfil '{profile_name}'"
            )

        return await self.run_many(
            commands,
            raise_on_error=raise_on_error,
            **params,
        )


    # ========================================================
    # SHOW VERSION
    # ========================================================

    async def get_version(self) -> str:

        await self.ensure_privileged()

        return await self.run(
            "show version",
            raise_on_error=True,
        )

    # ========================================================
    # LISTAR ONU AUTORIZADAS
    # ========================================================

    async def get_onus(
        self,
        pon: int,
        *,
        raise_on_error: bool = False,
    ) -> str:

        # Comando principal documentado
        result = await self.run_pon(
            pon,
            "show onuinfo",
            raise_on_error=False,
        )

        # Fallback para firmware que utiliza
        # "show onu info"
        if self._has_cli_error(
            result
        ):

            result = await self.run_pon(
                pon,
                "show onu info",
                raise_on_error=False,
            )

        if (
            raise_on_error
            and self._has_cli_error(result)
        ):

            raise OltError(
                f"No se pudo obtener "
                f"el listado ONU en PON "
                f"{pon}: {result}"
            )

        return result

    # ========================================================
    # ONU AUTO FIND
    # ========================================================

    async def get_onu_autofind(
        self,
        pon: int,
        *,
        detail: bool = False,
        raise_on_error: bool = False,
    ) -> str:

        command = (
            "show onu auto-find"
        )

        if detail:

            command = (
                "show onu auto-find "
                "detail-info"
            )

        result = await self.run_pon(
            pon,
            command,
            raise_on_error=False,
        )

        if (
            raise_on_error
            and self._has_cli_error(
                result
            )
        ):

            raise OltError(
                f"Error obteniendo "
                f"ONU auto-find PON "
                f"{pon}: {result}"
            )

        return result

    # ========================================================
    # DETALLE ONU
    # ========================================================

    async def get_onu_info(
        self,
        pon: int,
        onu: int,
        *,
        raise_on_error: bool = True,
    ) -> str:

        # Sintaxis documentada en V1600G: show onu detail-info <id>
        result = await self.run_pon(
            pon,
            f"show onu detail-info {int(onu)}",
            raise_on_error=False,
        )

        # Compatibilidad con firmwares/CLI más antiguos.
        if self._has_cli_error(result):
            result = await self.run_pon(
                pon,
                f"show onu {int(onu)} detail-info",
                raise_on_error=False,
            )

        if raise_on_error and self._has_cli_error(result):
            raise OltError(
                f"No se pudo obtener el detalle de ONU {onu} "
                f"en PON {pon}: {result}"
            )

        return result

    # ========================================================
    # POTENCIA ÓPTICA ONU
    # ========================================================

    async def get_onu_optical(
        self,
        pon: int,
        *,
        raise_on_error: bool = False,
    ) -> str:

        # ----------------------------------------------------
        # Primer comando
        # ----------------------------------------------------

        # Sintaxis actual/documentada.
        candidates = (
            "show pon onu all rx-power",
            # Algunas revisiones usan rx.
            "show pon onu all rx",
            # Se conserva para equipos con CLI antiguo.
            "show pon onu all rx transceiver",
        )

        last_result = ""

        for command in candidates:
            result = await self.run_pon(
                pon,
                command,
                raise_on_error=False,
            )
            last_result = result

            if not self._has_cli_error(result):
                return result

        if raise_on_error:
            raise OltError(
                "La OLT no aceptó ningún comando de potencia "
                f"RX. Última respuesta: {last_result}"
            )

        return last_result

    # ========================================================
    # POTENCIA PON
    # ========================================================

    async def get_pon_optical(
        self,
        pon: int,
        *,
        raise_on_error: bool = True,
    ) -> str:

        return await self.run_pon(
            pon,
            "show pon optical transceiver",
            raise_on_error=(
                raise_on_error
            ),
        )

    # ========================================================
    # ESTADÍSTICAS PON
    # ========================================================

    async def get_pon_statistics(
        self,
        pon: int,
        *,
        raise_on_error: bool = True,
    ) -> str:

        return await self.run_pon(
            pon,
            "show pon statistics",
            raise_on_error=(
                raise_on_error
            ),
        )

    # ========================================================
    # AUTORIZAR ONU
    # ========================================================

    async def authorize_onu(
        self,
        pon: int,
        onu: int,
        profile: str,
        sn: str,
        *,
        save: bool = True,
        raise_on_error: bool = True,
    ) -> str:

        command = (
            f"onu add "
            f"{int(onu)} "
            f"profile {profile} "
            f"sn {sn}"
        )

        result = await self.run_pon(
            pon,
            command,
            raise_on_error=(
                raise_on_error
            ),
        )

        # Guardar configuración
        if save:

            save_result = await self.run(
                "write",
                raise_on_error=(
                    raise_on_error
                ),
            )

            if save_result:

                result = (
                    f"{result}\n"
                    f"{save_result}"
                ).strip()

        return result

    # ========================================================
    # REINICIAR ONU
    # ========================================================

    async def reboot_onu(
        self,
        pon: int,
        onu: int,
        *,
        raise_on_error: bool = True,
    ) -> str:

        return await self.run_pon(
            pon,
            f"onu {int(onu)} reboot",
            raise_on_error=(
                raise_on_error
            ),
        )

    # ========================================================
    # ACTIVAR ONU
    # ========================================================

    async def activate_onu(
        self,
        pon: int,
        onu: int,
        *,
        raise_on_error: bool = True,
    ) -> str:

        return await self.run_pon(
            pon,
            f"onu {int(onu)} activate",
            raise_on_error=(
                raise_on_error
            ),
        )

    # ========================================================
    # DESACTIVAR ONU
    # ========================================================

    async def deactivate_onu(
        self,
        pon: int,
        onu: int,
        *,
        raise_on_error: bool = True,
    ) -> str:

        return await self.run_pon(
            pon,
            f"onu {int(onu)} deactivate",
            raise_on_error=(
                raise_on_error
            ),
        )

    # ========================================================
    # ELIMINAR ONU
    # ========================================================

    async def delete_onu(
        self,
        pon: int,
        onu: int,
        *,
        save: bool = True,
        raise_on_error: bool = True,
    ) -> str:

        result = await self.run_pon(
            pon,
            f"no onu {int(onu)}",
            raise_on_error=(
                raise_on_error
            ),
        )

        if save:

            save_result = await self.run(
                "write",
                raise_on_error=(
                    raise_on_error
                ),
            )

            if save_result:

                result = (
                    f"{result}\n"
                    f"{save_result}"
                ).strip()

        return result


# ============================================================
# PARSER DE TABLAS
# ============================================================

def _split_pipe_table_line(line: str) -> list[str]:
    return [
        value.strip()
        for value in line.split("|")
        if value.strip()
    ]


def _header_columns(line: str) -> tuple[list[str], list[int]]:
    """
    Obtiene nombres de columnas y sus posiciones iniciales.

    VSOL suele imprimir tablas de ancho fijo. Usar únicamente 2+
    espacios para separar una fila rompe casos donde dos valores
    están separados por un solo espacio (por ejemplo status + SN).
    """
    matches = list(
        re.finditer(
            r"\S(?:.*?\S)?(?=\s{2,}|$)",
            line.rstrip(),
        )
    )

    headers = [m.group(0).strip() for m in matches]
    starts = [m.start() for m in matches]

    return headers, starts


def _split_fixed_width_line(
    line: str,
    starts: list[int],
) -> list[str]:
    """Corta una fila usando los offsets de columnas del encabezado."""
    values: list[str] = []

    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(line)
        values.append(line[start:end].strip())

    return values


def parse_table(
    text: str,
) -> list[dict]:
    """
    Convierte las tablas de la VSOL en list[dict].

    Soporta:
        - tablas delimitadas por |
        - tablas de ancho fijo por posiciones
        - tablas separadas por 2+ espacios o tabulaciones
    """
    try:
        if not text or CLI_ERROR_RE.search(text):
            return []

        lines = [
            line.rstrip("\r")
            for line in text.splitlines()
            if line.strip()
        ]

        if len(lines) < 2:
            return []

        header_idx = None
        headers: list[str] = []
        starts: list[int] = []
        pipe_mode = False

        # Buscar un encabezado razonable en las primeras líneas.
        for index, line in enumerate(lines[:15]):
            stripped = line.strip()

            if not stripped:
                continue

            if set(stripped) <= set("-=+|_ "):
                continue

            if "|" in line:
                candidate = _split_pipe_table_line(line)
                candidate_starts: list[int] = []
                is_pipe = True
            else:
                candidate, candidate_starts = _header_columns(line)
                is_pipe = False

                if len(candidate) < 2:
                    candidate = [
                        value.strip()
                        for value in re.split(
                            r"\s{2,}|\t",
                            stripped,
                        )
                        if value.strip()
                    ]
                    candidate_starts = []

            if len(candidate) >= 2:
                header_idx = index
                headers = candidate
                starts = candidate_starts
                pipe_mode = is_pipe
                break

        if header_idx is None or not headers:
            return []

        rows: list[dict] = []

        for line in lines[header_idx + 1:]:
            stripped = line.strip()

            if not stripped:
                continue

            if set(stripped) <= set("-=+|_ "):
                continue

            if pipe_mode or "|" in line:
                cells = _split_pipe_table_line(line)
            elif starts:
                cells = _split_fixed_width_line(
                    line,
                    starts,
                )
            else:
                cells = [
                    value.strip()
                    for value in re.split(
                        r"\s{2,}|\t",
                        stripped,
                    )
                    if value.strip()
                ]

            if not cells:
                continue

            # Si la fila no coincide con el número esperado de columnas,
            # conservamos el fallback por espacios antes de truncar.
            if len(cells) < len(headers) and not pipe_mode:
                fallback = [
                    value.strip()
                    for value in re.split(
                        r"\s{2,}|\t",
                        stripped,
                    )
                    if value.strip()
                ]
                if len(fallback) >= len(cells):
                    cells = fallback

            row = {
                header: cells[index] if index < len(cells) else ""
                for index, header in enumerate(headers)
            }

            rows.append(row)

        return rows

    except Exception:
        return []


# ============================================================
# PARSER KEY/VALUE
# ============================================================

def parse_key_values(
    text: str,
) -> dict:

    """
    Convierte:

        ONU ID : 1
        SN     : GPON123456
        State  : Online

    en:

        {
            "ONU ID": "1",
            "SN": "GPON123456",
            "State": "Online"
        }
    """

    try:

        result = {}

        if not text:
            return result

        for line in (
            text
            .replace(
                "\r",
                "",
            )
            .splitlines()
        ):

            # ------------------------------------------------
            # Formato:
            #   key : value
            #   key = value
            # ------------------------------------------------

            match = re.match(
                r"^\s*"
                r"([A-Za-z][A-Za-z0-9 _\-/().#]*?)"
                r"\s*(?::|=|\s{2,})"
                r"\s*(.+?)"
                r"\s*$",
                line,
            )

            if not match:
                continue

            key = match.group(
                1
            ).strip()

            value = match.group(
                2
            ).strip()

            if key:

                result[key] = value

        return result

    except Exception:
        return {}
