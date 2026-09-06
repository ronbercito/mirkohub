"""
Compatibilidad adicional para OLT VSOL V1600G/V1600G1-B.

Este módulo parchea el cliente base sin duplicar service.py/vsol.py:
- login Telnet tolerante a alarmas asíncronas;
- show version y métricas desde modo config;
- inventario ONU combinando `show onu info`, `show onuinfo`, óptica y descripción;
- detalle ONU con descripción, running-config/VLAN y óptica.
"""

import asyncio
import re

from . import vsol as _vsol


# =============================================================================
# LOGIN / PROMPT VSOL
# =============================================================================
_LOGIN_RE = re.compile(
    r"^\s*(?:login|username|user\s*name)\s*:\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_PASS_RE = re.compile(
    r"^\s*(?:password|contraseña|contrasena)\s*:\s*$",
    re.IGNORECASE | re.MULTILINE,
)
_EVENT_RE = re.compile(
    r"^\s*\d{4}/\d{2}/\d{2}\s+\d{2}:\d{2}:\d{2}\s+",
    re.IGNORECASE,
)

_vsol.LOGIN_RE = _LOGIN_RE
_vsol.PASS_RE = _PASS_RE


def _last_prompt_line(text: str) -> str:
    for line in reversed((text or "").replace("\r", "").split("\n")):
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


_original_clean_command_output = _vsol.OltClient._clean_command_output.__func__


def _clean_command_output(cls, command: str, output: str) -> str:
    lines = []
    for line in (output or "").replace("\r", "").split("\n"):
        if _EVENT_RE.match(line):
            continue
        lines.append(line)
    return _original_clean_command_output(cls, command, "\n".join(lines))


async def _login(self):
    username_sent = False
    password_sent = False
    enable_sent = False
    enable_password_sent = False

    for _ in range(60):
        output = await self._read_initial()
        if not output:
            continue
        clean = self._clean_ansi(output)

        if _vsol.AUTH_ERROR_RE.search(clean):
            raise _vsol.OltError("Usuario o contraseña rechazados por la OLT")

        if _LOGIN_RE.search(clean):
            if not username_sent:
                self._write(self.username + "\r\n")
                await self._drain()
                username_sent = True
                await asyncio.sleep(0.12)
            continue

        if _PASS_RE.search(clean):
            if username_sent and not password_sent:
                self._write(self.password + "\r\n")
                await self._drain()
                password_sent = True
                await asyncio.sleep(0.12)
                continue
            if enable_sent and not enable_password_sent:
                self._write((self.enable_password or "") + "\r\n")
                await self._drain()
                enable_password_sent = True
                await asyncio.sleep(0.12)
                continue
            if not password_sent:
                self._write(self.password + "\r\n")
                await self._drain()
                password_sent = True
                await asyncio.sleep(0.12)
            continue

        prompt = _last_prompt_line(clean)
        if prompt.endswith("#"):
            self._mode = "privileged"
            self._current_pon = None
            return
        if prompt.endswith(">") and not enable_sent:
            self._write("enable\r\n")
            await self._drain()
            enable_sent = True
            await asyncio.sleep(0.12)

    raise _vsol.OltError(
        "No se pudo completar el login o alcanzar el prompt privilegiado (#)"
    )


async def _ensure_config(self):
    await self.ensure_privileged()
    if self._mode != "config":
        await self.run("configure terminal", raise_on_error=True)


async def _get_version(self) -> str:
    await _ensure_config(self)
    return await self.run("show version", raise_on_error=True)


async def _get_system_metrics(self) -> dict:
    await _ensure_config(self)
    out = {}
    for key, command in (
        ("cpu", "show sys cpu-usage"),
        ("memory", "show sys mem"),
        ("uptime", "show sys running-time"),
    ):
        try:
            out[key] = await self.run(command, raise_on_error=False)
        except Exception as exc:
            out[key] = f"Error: {exc}"
    return out


# =============================================================================
# INVENTARIO ONU
# =============================================================================
def _extract_explicit_ids(text: str, pon: int) -> list[int]:
    ids = []
    for m in re.finditer(
        rf"(?:GPON|EPON)?\s*0/{int(pon)}\s*[:/]\s*(\d{{1,3}})",
        text or "",
        re.I,
    ):
        value = int(m.group(1))
        if 1 <= value <= 128 and value not in ids:
            ids.append(value)

    # Algunas revisiones imprimen sólo el ID al inicio de cada fila.
    if not ids:
        for line in (text or "").replace("\r", "").splitlines():
            m = re.match(r"^\s*(\d{1,3})\s+", line)
            if not m:
                continue
            value = int(m.group(1))
            if 1 <= value <= 128 and value not in ids:
                ids.append(value)
    return ids


def _estimate_onu_count(text: str) -> int:
    count = 0
    for original in (text or "").replace("\r", "").splitlines():
        line = original.strip()
        if not line:
            continue
        low = line.lower()
        if any(x in low for x in ("onuindex", "onu index", "model", "profile", "authinfo")):
            continue
        if set(line) <= set("-=+|_ "):
            continue
        # Fila GPON explícita o fila con suficientes columnas.
        if re.search(r"(?:gpon|epon)?\s*0/\d+\s*[:/]\s*\d+", line, re.I):
            count += 1
        elif len(re.split(r"\s+", line)) >= 4 and not line.startswith("%"):
            count += 1
    return min(128, count)


async def _get_onus(self, pon: int, *, raise_on_error: bool = False) -> str:
    """
    Devuelve varias fuentes en una sola respuesta.

    `show onu info` aporta estado en firmwares que lo soportan; `show onuinfo`
    aporta modelo/perfil/SN. Además incluimos potencia óptica y descripción.
    Las descripciones se consultan en la MISMA sesión Telnet para evitar abrir
    decenas de conexiones nuevas desde el navegador.
    """
    pon = int(pon)
    await self.enter_pon(pon, raise_on_error=True)

    status_raw = await self.run("show onu info", raise_on_error=False)
    auth_raw = await self.run("show onuinfo", raise_on_error=False)

    try:
        optical_raw = await self.get_onu_optical(pon, raise_on_error=False)
    except Exception:
        optical_raw = ""

    valid_status = status_raw and not self._has_cli_error(status_raw)
    valid_auth = auth_raw and not self._has_cli_error(auth_raw)
    if not valid_status and not valid_auth:
        last = auth_raw or status_raw
        if raise_on_error:
            raise _vsol.OltError(
                f"No se pudo obtener el listado ONU en PON {pon}: {last}"
            )
        return last

    ids = _extract_explicit_ids(status_raw, pon)
    for value in _extract_explicit_ids(auth_raw, pon):
        if value not in ids:
            ids.append(value)

    # Hay firmwares que omiten el índice en el texto capturado pero conservan el
    # orden 1..N. En ese caso usamos el número de filas como último recurso.
    if not ids:
        estimated = max(_estimate_onu_count(status_raw), _estimate_onu_count(auth_raw))
        ids = list(range(1, estimated + 1))

    description_sections = []
    # Máximo 128 por estándar VSOL. Una pausa corta evita saturar el CLI.
    for onu_id in ids[:128]:
        try:
            desc = await self.run(
                f"show onu {onu_id} description",
                raise_on_error=False,
            )
        except Exception:
            desc = ""
        if desc and not self._has_cli_error(desc):
            description_sections.append(
                f"### ONU {onu_id}\n{desc.strip()}"
            )
        await asyncio.sleep(0.015)

    sections = []
    if valid_status:
        sections.append("--- STATUS ---\n" + status_raw.strip())
    if valid_auth:
        sections.append("--- AUTH ---\n" + auth_raw.strip())
    if optical_raw and not self._has_cli_error(optical_raw):
        sections.append("--- OPTICAL ---\n" + optical_raw.strip())
    if description_sections:
        sections.append("--- DESCRIPTIONS ---\n" + "\n".join(description_sections))

    return "\n\n".join(sections)


async def _get_onu_info(self, pon: int, onu: int, *, raise_on_error: bool = True) -> str:
    pon = int(pon)
    onu = int(onu)
    await self.enter_pon(pon, raise_on_error=True)

    sections = []
    commands = (
        ("DETAIL", f"show onu detail-info {onu}"),
        ("DESCRIPTION", f"show onu {onu} description"),
        ("RUNNING CONFIG", f"show running-config onu {onu}"),
        ("OPTICAL", f"show onu {onu} optical-info"),
    )

    for title, command in commands:
        result = await self.run(command, raise_on_error=False)
        if title == "DETAIL" and self._has_cli_error(result):
            result = await self.run(
                f"show onu {onu} detail-info", raise_on_error=False
            )
        if result and not self._has_cli_error(result):
            sections.append((title, result))

    if not sections:
        if raise_on_error:
            raise _vsol.OltError(
                f"No se pudo obtener detalle de ONU {onu} en PON {pon}"
            )
        return ""

    return "\n\n".join(
        f"--- {title} ---\n{body.strip()}" for title, body in sections
    )


_vsol.OltClient._last_prompt_line = staticmethod(_last_prompt_line)
_vsol.OltClient._looks_like_prompt = classmethod(_looks_like_prompt)
_vsol.OltClient._clean_command_output = classmethod(_clean_command_output)
_vsol.OltClient._login = _login
_vsol.OltClient.get_version = _get_version
_vsol.OltClient.get_system_metrics = _get_system_metrics
_vsol.OltClient.get_onus = _get_onus
_vsol.OltClient.get_onu_info = _get_onu_info


# =============================================================================
# SERVICE WRAPPERS
# =============================================================================
from . import service as _service  # noqa: E402

_original_run_action = _service.run_action
_original_snapshot_olt = _service.snapshot_olt


def _section(raw: str, name: str) -> str:
    m = re.search(
        rf"---\s*{re.escape(name)}\s*---\s*\n(.*?)(?=\n\s*---\s*[A-Z ]+\s*---|\Z)",
        raw or "",
        re.I | re.S,
    )
    return m.group(1).strip() if m else ""


def _row_value(row: dict, *patterns) -> str:
    for pattern in patterns:
        for key, value in (row or {}).items():
            if re.search(pattern, str(key), re.I):
                return str(value or "").strip()
    return ""


def _id_from_row(row: dict, pon: int) -> int:
    for value in (row or {}).values():
        m = re.search(
            rf"(?:GPON|EPON)?\s*0/{int(pon)}\s*[:/]\s*(\d{{1,3}})",
            str(value or ""),
            re.I,
        )
        if m:
            value_i = int(m.group(1))
            if 1 <= value_i <= 128:
                return value_i

    raw = _row_value(row, r"onu\s*id", r"onuindex", r"onu\s*index", r"^index$", r"^onu$")
    if re.fullmatch(r"\d{1,3}", raw):
        value_i = int(raw)
        if 1 <= value_i <= 128:
            return value_i
    return 0


def _description_from_raw(raw: str) -> dict[int, str]:
    result = {}
    block = _section(raw, "DESCRIPTIONS")
    if not block:
        return result

    chunks = re.split(r"^###\s+ONU\s+(\d{1,3})\s*$", block, flags=re.I | re.M)
    for i in range(1, len(chunks), 2):
        try:
            onu_id = int(chunks[i])
        except ValueError:
            continue
        body = chunks[i + 1] if i + 1 < len(chunks) else ""
        lines = [
            x.strip()
            for x in body.replace("\r", "").splitlines()
            if x.strip() and not x.lower().startswith("show onu")
        ]
        if not lines:
            continue
        value = lines[-1]
        value = re.sub(r"^(?:description)\s*[:=]?\s*", "", value, flags=re.I).strip()
        if value and "unknown command" not in value.lower():
            result[onu_id] = value
    return result


def _parse_optical_section(raw: str, pon: int) -> dict[int, dict]:
    block = _section(raw, "OPTICAL")
    result = {}
    if not block:
        return result

    rows = _service.parse_table(block)
    for index, row in enumerate(rows, start=1):
        onu_id = _id_from_row(row, pon) or index
        rx = _row_value(row, r"rx\s*power", r"rxpower", r"^rx$")
        tx = _row_value(row, r"tx\s*power", r"txpower", r"^tx$")
        if rx or tx:
            result[onu_id] = {"rx": rx, "tx": tx}

    # Fallback por línea para firmwares sin encabezado parseable.
    for original in block.replace("\r", "").splitlines():
        line = original.strip()
        if not line:
            continue
        explicit = re.search(
            rf"(?:GPON|EPON)?\s*0/{int(pon)}\s*[:/]\s*(\d{{1,3}})",
            line,
            re.I,
        )
        if explicit:
            onu_id = int(explicit.group(1))
            tail = line[explicit.end():]
        else:
            m = re.match(r"^(\d{1,3})\s+(.+)$", line)
            if not m:
                continue
            onu_id = int(m.group(1))
            tail = m.group(2)
        if not (1 <= onu_id <= 128):
            continue
        numbers = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", tail)]
        negative = next((n for n in numbers if n < 0), None)
        positives = [n for n in numbers if 0 <= n <= 15]
        current = result.setdefault(onu_id, {})
        if not current.get("rx") and negative is not None:
            current["rx"] = f"{negative:g} dBm"
        if not current.get("tx") and positives:
            current["tx"] = f"{positives[0]:g} dBm"
    return result


def _canonical_onu_rows(raw: str, pon: int) -> list[dict]:
    status_block = _section(raw, "STATUS")
    auth_block = _section(raw, "AUTH")
    status_rows = _service.parse_table(status_block) if status_block else []
    auth_rows = _service.parse_table(auth_block) if auth_block else []
    descriptions = _description_from_raw(raw)
    optical = _parse_optical_section(raw, pon)

    ids = []
    for block in (status_block, auth_block):
        for value in _extract_explicit_ids(block, pon):
            if value not in ids:
                ids.append(value)

    max_len = max(len(status_rows), len(auth_rows), len(descriptions), len(optical), 0)
    if not ids and max_len:
        ids = list(range(1, min(128, max_len) + 1))

    # Si el parser encontró filas pero no todos los IDs, completar por posición.
    while len(ids) < max_len and len(ids) < 128:
        candidate = len(ids) + 1
        if candidate not in ids:
            ids.append(candidate)
        else:
            break

    result = []
    for pos, onu_id in enumerate(ids):
        srow = status_rows[pos] if pos < len(status_rows) else {}
        arow = auth_rows[pos] if pos < len(auth_rows) else {}

        # Si alguna tabla sí contiene ID explícito, buscar su fila real.
        for row in status_rows:
            if _id_from_row(row, pon) == onu_id:
                srow = row
                break
        for row in auth_rows:
            if _id_from_row(row, pon) == onu_id:
                arow = row
                break

        status = _row_value(srow, r"^status$", r"^state$", r"onu\s*state")
        if not status:
            blob = " ".join(str(v or "") for v in srow.values())
            m = re.search(r"\b(online|offline|up|down|active|inactive|los)\b", blob, re.I)
            status = m.group(1) if m else ""

        description = (
            descriptions.get(onu_id)
            or _row_value(srow, r"description", r"^name$", r"alias")
            or _row_value(arow, r"description", r"^name$", r"alias")
        )

        model = _row_value(arow, r"^model$", r"onu\s*model", r"^type$") or _row_value(
            srow, r"^model$", r"onu\s*model", r"^type$"
        )
        profile = _row_value(arow, r"profile") or _row_value(srow, r"profile")
        mode = _row_value(arow, r"^mode$") or _row_value(srow, r"^mode$")
        info = _row_value(arow, r"authinfo", r"auth\s*info", r"^info$", r"^sn$", r"serial")
        if not info:
            info = _row_value(srow, r"authinfo", r"auth\s*info", r"^info$", r"^sn$", r"serial")

        opt = optical.get(onu_id, {})
        if not status and optical:
            status = "Online" if onu_id in optical else "Offline"

        # Reparar casos donde el parser genérico pegó el índice al inicio del modelo.
        model = re.sub(r"^(?:GPON|EPON)?0/\d+:\d+", "", model, flags=re.I).strip()

        result.append(
            {
                "PON": f"0/{pon}",
                "ONU ID": onu_id,
                "Status": status,
                "Description": description,
                "Model": model,
                "Profile": profile,
                "Mode": mode,
                "Info": info,
                "RxPower": opt.get("rx", ""),
                "TxPower": opt.get("tx", ""),
            }
        )

    return result


def _extract_detail_info(raw: str, base: dict | None = None) -> dict:
    info = dict(base or {})
    text = (raw or "").replace("\r", "")

    desc = _section(text, "DESCRIPTION")
    if desc:
        lines = [
            x.strip() for x in desc.splitlines()
            if x.strip() and not x.lower().startswith("show onu")
        ]
        if lines:
            value = re.sub(r"^description\s*[:=]?\s*", "", lines[-1], flags=re.I).strip()
            if value:
                info["Description"] = value

    running = _section(text, "RUNNING CONFIG")
    if running:
        m = re.search(r"\buservlan\s+(\d{1,4})\b", running, re.I)
        if not m:
            m = re.search(r"\b(?:user-vlan|cvlan|def_vlan|vlan)\s+(\d{1,4})\b", running, re.I)
        if m:
            info["VLAN"] = m.group(1)

    optical = _section(text, "OPTICAL")
    if optical:
        for key, regex in (
            ("RxPower", r"(?:rx\s*power|rxpower|receive[^:\n]*)\s*(?::|=)?\s*(-?\d+(?:\.\d+)?)"),
            ("TxPower", r"(?:tx\s*power|txpower|transmit[^:\n]*)\s*(?::|=)?\s*(-?\d+(?:\.\d+)?)"),
        ):
            m = re.search(regex, optical, re.I)
            if m:
                info[key] = f"{m.group(1)} dBm"

    # También conservar pares clave/valor del detalle principal.
    detail = _section(text, "DETAIL")
    if detail:
        for key, value in _vsol.parse_key_values(detail).items():
            info.setdefault(key, value)
    return info


# =============================================================================
# SISTEMA / VERSION
# =============================================================================
def _valid_metric_output(text: str) -> bool:
    return bool(text) and not _vsol.CLI_ERROR_RE.search(text)


def _parse_cpu_usage(text: str):
    if not _valid_metric_output(text):
        return None
    m = re.search(r"Current\s+CPU\s+Usage\s*:\s*(\d+(?:\.\d+)?)\s*%", text, re.I)
    if m:
        return max(0, min(100, round(float(m.group(1)))))
    lines = [x.strip() for x in text.replace("\r", "").splitlines() if x.strip()]
    for line in reversed(lines):
        m = re.search(r"(?:Average:\s*)?\ball\b\s+(.+)$", line, re.I)
        if not m:
            continue
        nums = re.findall(r"-?\d+(?:\.\d+)?", m.group(1))
        if nums:
            idle = float(nums[-1])
            if 0 <= idle <= 100:
                return max(0, min(100, round(100 - idle)))
    return None


def _parse_memory_usage(text: str):
    if not _valid_metric_output(text):
        return None
    m = re.search(r"(?:memory|mem)[^\n%]{0,60}(\d+(?:\.\d+)?)\s*%", text, re.I)
    if m:
        return max(0, min(100, round(float(m.group(1)))))

    def value(name):
        x = re.search(rf"^\s*{name}\s*:\s*(\d+(?:\.\d+)?)", text, re.I | re.M)
        return float(x.group(1)) if x else None

    total = value("MemTotal")
    available = value("MemAvailable")
    free = value("MemFree")
    if total and total > 0:
        usable = available if available is not None else free
        if usable is not None:
            return max(0, min(100, round(((total - usable) / total) * 100)))
    return None


def _parse_uptime(text: str):
    if not _valid_metric_output(text):
        return None
    m = re.search(
        r"(?:system\s+)?(?:running[- ]time|uptime)\s*(?::|=)?\s*(.+)$",
        text,
        re.I | re.M,
    )
    if m:
        return m.group(1).strip()
    lines = [x.strip() for x in text.replace("\r", "").splitlines() if x.strip()]
    return lines[0] if lines else None


async def _read_system_metrics(router):
    try:
        async with _service.connect(router) as olt:
            raw = await olt.get_system_metrics()
    except Exception as exc:
        return {"cpu": None, "memory": None, "uptime": None, "raw": {}, "error": str(exc)}
    return {
        "cpu": _parse_cpu_usage(raw.get("cpu", "")),
        "memory": _parse_memory_usage(raw.get("memory", "")),
        "uptime": _parse_uptime(raw.get("uptime", "")),
        "raw": raw,
        "error": "",
    }


def _parse_active_version_info(raw: str) -> dict:
    text = (raw or "").replace("\r", "")
    current = re.search(r"^\s*Current\s+Version\s*$", text, re.I | re.M)
    if current:
        text = text[current.end():]
    text = re.split(
        r"^\s*Partition\s+[A-Za-z0-9_-]+\s*$",
        text,
        maxsplit=1,
        flags=re.I | re.M,
    )[0]

    def pick(label):
        m = re.search(rf"^\s*{label}\s*:\s*(.+?)\s*$", text, re.I | re.M)
        return m.group(1).strip() if m else ""

    return {
        "serial": pick(r"OLT\s+Serial\s+Number"),
        "model": pick(r"OLT\s+Device\s+Model"),
        "hardware": pick(r"Hardware\s+Version"),
        "software": pick(r"Software\s+Version"),
        "created": pick(r"Software\s+Created\s+Time"),
    }


def _apply_active_version(router, active: dict):
    if active.get("software"):
        router.ros_version = active["software"]
        router.software_version = active["software"]
    if active.get("model"):
        router.board_name = active["model"]


def _augment_system_result(result: dict, router, active: dict, metrics: dict) -> dict:
    info = dict(result.get("info") or {})
    labels = {
        "serial": "Olt Serial Number",
        "model": "Olt Device Model",
        "hardware": "Hardware Version",
        "software": "Software Version",
        "created": "Software Created Time",
    }
    # Eliminar valores duplicados de Software Version de particiones secundarias.
    targets = {v.lower() for v in labels.values()}
    info = {k: v for k, v in info.items() if str(k).strip().lower() not in targets}
    for field, label in labels.items():
        if active.get(field):
            info[label] = active[field]
    if metrics.get("cpu") is not None:
        info["CPU Usage"] = f"{metrics['cpu']}%"
        router.cpu_usage_pct = int(metrics["cpu"])
    if metrics.get("memory") is not None:
        info["Memory Usage"] = f"{metrics['memory']}%"
        router.memory_usage_pct = int(metrics["memory"])
    if metrics.get("uptime"):
        info["Uptime"] = metrics["uptime"]
        router.uptime = str(metrics["uptime"])[:60]
    result["info"] = info
    result["active_version"] = active
    return result


async def _run_action_enriched(router, action: str, **params):
    result = await _original_run_action(router, action, **params)
    if not result.get("ok"):
        return result

    if action == "system":
        active = _parse_active_version_info(result.get("raw", ""))
        _apply_active_version(router, active)
        metrics = await _read_system_metrics(router)
        return _augment_system_result(result, router, active, metrics)

    if action == "onu_list":
        pon = int(params.get("pon", 1) or 1)
        rows = _canonical_onu_rows(result.get("raw", ""), pon)
        if rows:
            result["rows"] = rows
            result["onu_summary"] = {
                "total": len(rows),
                "online": sum(1 for r in rows if re.search(r"online|active|up", r.get("Status", ""), re.I)),
                "offline": sum(1 for r in rows if re.search(r"offline|down|los|inactive", r.get("Status", ""), re.I)),
                "named": sum(1 for r in rows if str(r.get("Description", "")).strip()),
            }
        return result

    if action == "onu_detail":
        result["info"] = _extract_detail_info(result.get("raw", ""), result.get("info") or {})
        return result

    return result


async def _snapshot_olt_with_metrics(router):
    result = await _original_snapshot_olt(router)
    if not result.get("ok"):
        return result
    active = _parse_active_version_info(result.get("raw", ""))
    _apply_active_version(router, active)
    metrics = await _read_system_metrics(router)
    return _augment_system_result(result, router, active, metrics)


_service.run_action = _run_action_enriched
_service.snapshot_olt = _snapshot_olt_with_metrics
