"""
Paquete de integración VSOL.

Compatibilidad añadida para V1600G/V1600G1-B:
- Login Telnet tolerante a alarmas asíncronas.
- show version / métricas desde modo config.
- Selección automática del comando de listado ONU más rico.
- Parser canónico de ONUs y óptica para evitar columnas corridas.
- Detalle ONU enriquecido con descripción, running-config/VLAN y óptica.
"""

import asyncio
import re

from . import vsol as _vsol


# ---------------------------------------------------------------------------
# Login/prompts VSOL
# ---------------------------------------------------------------------------
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


_original_clean_command_output = _vsol.OltClient._clean_command_output.__func__


def _clean_command_output(cls, command: str, output: str) -> str:
    # VSOL puede inyectar alarmas (Dying Gasp, LOS, etc.) en medio de una sesión.
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
                await asyncio.sleep(0.15)
            continue

        if _PASS_RE.search(clean):
            if username_sent and not password_sent:
                self._write(self.password + "\r\n")
                await self._drain()
                password_sent = True
                await asyncio.sleep(0.15)
                continue

            if enable_sent and not enable_password_sent:
                self._write((self.enable_password or "") + "\r\n")
                await self._drain()
                enable_password_sent = True
                await asyncio.sleep(0.15)
                continue

            if not password_sent:
                self._write(self.password + "\r\n")
                await self._drain()
                password_sent = True
                await asyncio.sleep(0.15)
            continue

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
    outputs = {}
    for key, command in (
        ("cpu", "show sys cpu-usage"),
        ("memory", "show sys mem"),
        ("uptime", "show sys running-time"),
    ):
        try:
            outputs[key] = await self.run(command, raise_on_error=False)
        except Exception as exc:
            outputs[key] = f"Error: {exc}"
    return outputs


# ---------------------------------------------------------------------------
# ONU commands: prefer richer output and enrich detail on demand
# ---------------------------------------------------------------------------
def _onu_output_score(text: str) -> int:
    if not text or _vsol.CLI_ERROR_RE.search(text):
        return -1
    low = text.lower()
    score = 0
    for token, points in (
        ("description", 6),
        ("status", 5),
        ("online", 4),
        ("offline", 4),
        ("model", 2),
        ("profile", 2),
        ("authinfo", 2),
        ("info", 1),
    ):
        if token in low:
            score += points
    score += min(20, len(re.findall(r"(?:gpon|epon)?\s*0/\d+\s*:\s*\d+", low, re.I)))
    return score


async def _get_onus(self, pon: int, *, raise_on_error: bool = False) -> str:
    await self.enter_pon(int(pon), raise_on_error=True)

    best = ""
    best_score = -1
    last = ""

    # En algunos firmwares `show onu info` trae Status+Description y
    # `show onuinfo` sólo los datos de autorización. Probamos ambos.
    for command in ("show onu info", "show onuinfo"):
        result = await self.run(command, raise_on_error=False)
        last = result
        score = _onu_output_score(result)
        if score > best_score:
            best = result
            best_score = score

    if best_score < 0:
        if raise_on_error:
            raise _vsol.OltError(
                f"No se pudo obtener el listado ONU en PON {pon}: {last}"
            )
        return last

    return best


async def _get_onu_info(self, pon: int, onu: int, *, raise_on_error: bool = True) -> str:
    pon = int(pon)
    onu = int(onu)
    await self.enter_pon(pon, raise_on_error=True)

    sections = []

    detail = await self.run(f"show onu detail-info {onu}", raise_on_error=False)
    if self._has_cli_error(detail):
        detail = await self.run(f"show onu {onu} detail-info", raise_on_error=False)
    if detail and not self._has_cli_error(detail):
        sections.append(("DETAIL", detail))

    description = await self.run(
        f"show onu {onu} description", raise_on_error=False
    )
    if description and not self._has_cli_error(description):
        sections.append(("DESCRIPTION", description))

    running = await self.run(
        f"show running-config onu {onu}", raise_on_error=False
    )
    if running and not self._has_cli_error(running):
        sections.append(("RUNNING CONFIG", running))

    optical = await self.run(
        f"show onu {onu} optical-info", raise_on_error=False
    )
    if optical and not self._has_cli_error(optical):
        sections.append(("OPTICAL", optical))

    if not sections:
        if raise_on_error:
            raise _vsol.OltError(
                f"No se pudo obtener detalle de ONU {onu} en PON {pon}"
            )
        return detail

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


# ---------------------------------------------------------------------------
# Service wrappers
# ---------------------------------------------------------------------------
from . import service as _service  # noqa: E402

_original_run_action = _service.run_action
_original_snapshot_olt = _service.snapshot_olt


def _valid_metric_output(text: str) -> bool:
    return bool(text) and not _vsol.CLI_ERROR_RE.search(text)


def _parse_cpu_usage(text: str):
    if not _valid_metric_output(text):
        return None

    lines = [x.strip() for x in text.replace("\r", "").splitlines() if x.strip()]

    for line in reversed(lines):
        match = re.search(r"(?:Average:\s*)?\ball\b\s+(.+)$", line, re.I)
        if not match:
            continue
        numbers = re.findall(r"-?\d+(?:\.\d+)?", match.group(1))
        if numbers:
            try:
                idle = float(numbers[-1])
                if 0 <= idle <= 100:
                    return max(0, min(100, round(100 - idle)))
            except ValueError:
                pass

    match = re.search(
        r"cpu[^\n%]{0,40}(?:usage|utilization)?[^\n%]{0,20}(\d+(?:\.\d+)?)\s*%",
        text,
        re.I,
    )
    return max(0, min(100, round(float(match.group(1))))) if match else None


def _parse_memory_usage(text: str):
    if not _valid_metric_output(text):
        return None

    def val(name: str):
        m = re.search(
            rf"^\s*{re.escape(name)}\s*:\s*(\d+(?:\.\d+)?)",
            text,
            re.I | re.M,
        )
        return float(m.group(1)) if m else None

    total = val("MemTotal")
    available = val("MemAvailable")
    free = val("MemFree")
    buffers = val("Buffers") or 0
    cached = val("Cached") or 0

    if total and total > 0:
        if available is not None:
            used = total - available
        elif free is not None:
            used = total - free - buffers - cached
        else:
            used = None
        if used is not None:
            return max(0, min(100, round((used / total) * 100)))

    m = re.search(
        r"^\s*Mem:\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)\s+",
        text,
        re.I | re.M,
    )
    if m:
        total = float(m.group(1))
        used = float(m.group(2))
        if total > 0:
            return max(0, min(100, round((used / total) * 100)))

    m = re.search(
        r"(?:mem|memory)[^\n%]{0,50}(?:used|usage|utilization)?[^\n%]{0,20}(\d+(?:\.\d+)?)\s*%",
        text,
        re.I,
    )
    return max(0, min(100, round(float(m.group(1))))) if m else None


def _parse_uptime(text: str):
    if not _valid_metric_output(text):
        return None

    clean = text.replace("\r", "").strip()
    m = re.search(
        r"(?:system\s+)?(?:running[- ]time|uptime)\s*(?::|=)?\s*(.+)$",
        clean,
        re.I | re.M,
    )
    if m and m.group(1).strip():
        return m.group(1).strip()

    for line in [x.strip() for x in clean.splitlines() if x.strip()]:
        if line.lower().startswith("show sys running-time"):
            continue
        if _vsol.CLI_ERROR_RE.search(line):
            continue
        return line
    return None


async def _read_system_metrics(router):
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
    if metrics.get("cpu") is not None:
        router.cpu_usage_pct = int(metrics["cpu"])
    if metrics.get("memory") is not None:
        router.memory_usage_pct = int(metrics["memory"])
    if metrics.get("uptime"):
        router.uptime = str(metrics["uptime"])[:60]


def _parse_active_version_info(raw: str) -> dict:
    text = (raw or "").replace("\r", "")
    if not text.strip():
        return {}

    text = re.split(
        r"^\s*\$\s+show\s+sys\b",
        text,
        maxsplit=1,
        flags=re.I | re.M,
    )[0]

    current = re.search(r"^\s*Current\s+Version\s*$", text, re.I | re.M)
    if current:
        text = text[current.end():]

    text = re.split(
        r"^\s*Partition\s+[A-Za-z0-9_-]+\s*$",
        text,
        maxsplit=1,
        flags=re.I | re.M,
    )[0]

    def pick(*labels):
        for label in labels:
            m = re.search(
                rf"^\s*{label}\s*:\s*(.+?)\s*$",
                text,
                re.I | re.M,
            )
            if m:
                return m.group(1).strip()
        return ""

    return {
        "serial": pick(r"OLT\s+Serial\s+Number"),
        "model": pick(r"OLT\s+Device\s+Model", r"Device\s+Model", r"Model"),
        "hardware": pick(r"Hardware\s+Version"),
        "software": pick(r"Software\s+Version", r"Firmware\s+Version"),
        "created": pick(r"Software\s+Created\s+Time"),
    }


def _apply_active_version(router, active: dict):
    if active.get("software"):
        router.ros_version = active["software"]
        router.software_version = active["software"]
    if active.get("model"):
        router.board_name = active["model"]


def _apply_active_version_to_result(result: dict, active: dict) -> dict:
    if not isinstance(result, dict) or not active:
        return result

    info = dict(result.get("info") or {})
    canonical = {
        "serial": "Olt Serial Number",
        "model": "Olt Device Model",
        "hardware": "Hardware Version",
        "software": "Software Version",
        "created": "Software Created Time",
    }
    targets = {x.lower() for x in canonical.values()}
    info = {
        k: v
        for k, v in info.items()
        if str(k).strip().lower() not in targets
    }
    for field, key in canonical.items():
        if active.get(field):
            info[key] = active[field]
    result["info"] = info
    result["active_version"] = active
    return result


def _augment_system_result(result: dict, metrics: dict) -> dict:
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

    raw_sections = [result["raw"]] if result.get("raw") else []
    for key, title in (
        ("cpu", "show sys cpu-usage"),
        ("memory", "show sys mem"),
        ("uptime", "show sys running-time"),
    ):
        value = ((metrics.get("raw") or {}).get(key) or "").strip()
        if value:
            raw_sections.append(f"$ {title}\n{value}")

    if raw_sections:
        result["raw"] = "\n\n".join(raw_sections)
    if metrics.get("error"):
        result["metrics_warning"] = metrics["error"]
    return result


# ---------------------------------------------------------------------------
# Canonical ONU parsers
# ---------------------------------------------------------------------------
def _parse_onu_index(value: str, default_pon: int = 1):
    value = (value or "").strip()
    m = re.search(
        r"(?:GPON|EPON)?\s*0/(\d+)\s*:\s*(\d+)",
        value,
        re.I,
    )
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.search(r"\b(\d{1,3})\b", value)
    if m:
        return int(default_pon), int(m.group(1))
    return int(default_pon), 0


def _parse_onu_list(raw: str, default_pon: int = 1):
    rows = []

    for original in (raw or "").replace("\r", "").splitlines():
        line = original.strip()
        if not line:
            continue

        m = re.match(
            r"^((?:GPON|EPON)?\s*0/\d+\s*:\s*\d+)\s+(.+)$",
            line,
            re.I,
        )
        if not m:
            continue

        index = re.sub(r"\s+", "", m.group(1))
        rest = m.group(2).strip()
        pon, onu_id = _parse_onu_index(index, default_pon)

        rich = re.match(
            r"^(Online|Offline|Up|Down|Active|Inactive|LOS)\s+"
            r"(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(.+)$",
            rest,
            re.I,
        )
        if rich:
            status, description, model, profile, mode, info = rich.groups()
        else:
            parts = rest.split()
            status = ""
            description = ""
            if len(parts) >= 4:
                model = parts[0]
                profile = parts[1]
                mode = parts[2]
                info = " ".join(parts[3:])
            else:
                model = parts[0] if len(parts) > 0 else ""
                profile = parts[1] if len(parts) > 1 else ""
                mode = parts[2] if len(parts) > 2 else ""
                info = ""

        rows.append(
            {
                "ONUIndex": index,
                "Status": status,
                "Description": description,
                "Model": model,
                "Profile": profile,
                "Mode": mode,
                "Info": info,
                "PON": f"0/{pon}",
                "ONU ID": onu_id,
            }
        )

    return rows


def _parse_optical_list(raw: str, default_pon: int = 1):
    rows = []

    for original in (raw or "").replace("\r", "").splitlines():
        line = original.strip()
        if not line:
            continue

        pon = int(default_pon)
        onu_id = 0

        indexed = re.search(
            r"(?:GPON|EPON)?\s*0/(\d+)\s*[:/]\s*(\d+)",
            line,
            re.I,
        )
        if indexed:
            pon = int(indexed.group(1))
            onu_id = int(indexed.group(2))
            tail = line[indexed.end():]
        else:
            first = re.match(r"^(\d{1,3})\s+(.+)$", line)
            if not first:
                continue
            onu_id = int(first.group(1))
            tail = first.group(2)

        if onu_id <= 0:
            continue

        numbers = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", tail)]
        rx = next((n for n in numbers if n < 0), None)
        positives = [n for n in numbers if 0 <= n <= 15]
        tx = positives[0] if positives else None

        if rx is None and tx is None:
            continue

        rows.append(
            {
                "ONUIndex": f"GPON0/{pon}:{onu_id}",
                "ONU ID": onu_id,
                "RxPower": f"{rx:g} dBm" if rx is not None else "",
                "TxPower": f"{tx:g} dBm" if tx is not None else "",
            }
        )

    return rows


def _extract_detail_info(raw: str, base_info: dict | None = None):
    info = dict(base_info or {})
    text = (raw or "").replace("\r", "")

    m = re.search(
        r"(?:onu\s+)?description\s*(?::|=)\s*(.+)$",
        text,
        re.I | re.M,
    )
    if m:
        value = m.group(1).strip()
        if value and "unknown command" not in value.lower():
            info["Description"] = value

    desc_section = re.search(
        r"---\s*DESCRIPTION\s*---\s*\n(.+?)(?=\n\s*---|\Z)",
        text,
        re.I | re.S,
    )
    if desc_section and not info.get("Description"):
        candidates = [
            x.strip()
            for x in desc_section.group(1).splitlines()
            if x.strip()
            and not x.lower().startswith("show onu")
            and "unknown command" not in x.lower()
        ]
        if candidates:
            last = candidates[-1]
            last = re.sub(r"^(?:description)\s*[:=]?\s*", "", last, flags=re.I)
            if last:
                info["Description"] = last

    m = re.search(r"\buservlan\s+(\d{1,4})\b", text, re.I)
    if not m:
        m = re.search(r"\b(?:cvlan|def_vlan|vlan)\s+(\d{1,4})\b", text, re.I)
    if m:
        info["VLAN"] = m.group(1)

    optical = re.search(
        r"---\s*OPTICAL\s*---\s*\n(.+?)(?=\n\s*---|\Z)",
        text,
        re.I | re.S,
    )
    if optical:
        body = optical.group(1)
        rx_m = re.search(
            r"(?:rx\s*power|rxpower|receive[^:\n]*)\s*(?::|=)?\s*(-?\d+(?:\.\d+)?)",
            body,
            re.I,
        )
        tx_m = re.search(
            r"(?:tx\s*power|txpower|transmit[^:\n]*)\s*(?::|=)?\s*(-?\d+(?:\.\d+)?)",
            body,
            re.I,
        )
        if rx_m:
            info["RxPower"] = f"{rx_m.group(1)} dBm"
        if tx_m:
            info["TxPower"] = f"{tx_m.group(1)} dBm"

    return info


async def _run_action_enriched(router, action: str, **params):
    result = await _original_run_action(router, action, **params)
    if not result.get("ok"):
        return result

    pon = int(params.get("pon", 1) or 1)

    if action == "system":
        active = _parse_active_version_info(result.get("raw", ""))
        _apply_active_version(router, active)
        _apply_active_version_to_result(result, active)
        metrics = await _read_system_metrics(router)
        _apply_metrics(router, metrics)
        return _augment_system_result(result, metrics)

    if action == "onu_list":
        canonical = _parse_onu_list(result.get("raw", ""), pon)
        if canonical:
            result["rows"] = canonical
            result["onu_summary"] = {
                "total": len(canonical),
                "online": sum(
                    1 for r in canonical
                    if re.search(r"online|active|up", r.get("Status", ""), re.I)
                ),
                "offline": sum(
                    1 for r in canonical
                    if re.search(r"offline|down|los|inactive", r.get("Status", ""), re.I)
                ),
                "named": sum(1 for r in canonical if r.get("Description")),
            }
        return result

    if action == "onu_optical":
        optical = _parse_optical_list(result.get("raw", ""), pon)
        if optical:
            result["rows"] = optical
        return result

    if action == "onu_detail":
        result["info"] = _extract_detail_info(
            result.get("raw", ""),
            result.get("info") or {},
        )
        return result

    return result


async def _snapshot_olt_with_metrics(router):
    result = await _original_snapshot_olt(router)
    if not result.get("ok"):
        return result

    active = _parse_active_version_info(result.get("raw", ""))
    _apply_active_version(router, active)
    _apply_active_version_to_result(result, active)

    metrics = await _read_system_metrics(router)
    _apply_metrics(router, metrics)
    return _augment_system_result(result, metrics)


_service.run_action = _run_action_enriched
_service.snapshot_olt = _snapshot_olt_with_metrics
