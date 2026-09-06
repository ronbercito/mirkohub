"""
Corrección de inventario ONU para VSOL V1600G/V1600G1-B.

Objetivos:
- negociar ancho Telnet (NAWS) para que las tablas no se partan;
- leer ONU ID/estado/nombre/modelo/perfil/SN/potencia de forma canónica;
- consultar detalle completo por ONU sólo al desplegarla;
- entregar datos estructurados al frontend sin depender del parser genérico.
"""
import asyncio
import json
import re

from . import vsol as _vsol
from . import service as _service


# ---------------------------------------------------------------------------
# Telnet: terminal ancho
# ---------------------------------------------------------------------------
_IAC, _SB, _SE = 255, 250, 240
_WILL, _WONT, _DO, _DONT = 251, 252, 253, 254
_ECHO, _SGA, _TTYPE, _NAWS = 1, 3, 24, 31
_TTYPE_IS, _TTYPE_SEND = 0, 1

_previous_login = _vsol.OltClient._login


def _naws(width=240, height=80):
    return bytes([
        _IAC, _SB, _NAWS,
        (width >> 8) & 0xFF, width & 0xFF,
        (height >> 8) & 0xFF, height & 0xFF,
        _IAC, _SE,
    ])


def _wide_process_telnet(self, data: bytes):
    clean = bytearray()
    replies = bytearray()
    i = 0

    while i < len(data):
        if data[i] != _IAC:
            clean.append(data[i])
            i += 1
            continue

        if i + 1 >= len(data):
            self._telnet_pending.extend(data[i:])
            break

        cmd = data[i + 1]

        if cmd == _IAC:
            clean.append(_IAC)
            i += 2
            continue

        if cmd in (_WILL, _WONT, _DO, _DONT):
            if i + 2 >= len(data):
                self._telnet_pending.extend(data[i:])
                break

            opt = data[i + 2]

            if cmd == _WILL:
                if opt in (_ECHO, _SGA):
                    replies.extend((_IAC, _DO, opt))
                else:
                    replies.extend((_IAC, _DONT, opt))

            elif cmd == _DO:
                if opt == _NAWS:
                    replies.extend((_IAC, _WILL, _NAWS))
                    replies.extend(_naws())
                elif opt == _TTYPE:
                    replies.extend((_IAC, _WILL, _TTYPE))
                elif opt == _SGA:
                    replies.extend((_IAC, _WILL, _SGA))
                else:
                    replies.extend((_IAC, _WONT, opt))

            elif cmd == _WONT:
                replies.extend((_IAC, _DONT, opt))

            elif cmd == _DONT:
                replies.extend((_IAC, _WONT, opt))

            i += 3
            continue

        if cmd == _SB:
            end = i + 2
            while end + 1 < len(data):
                if data[end] == _IAC and data[end + 1] == _SE:
                    break
                end += 1

            if end + 1 >= len(data):
                self._telnet_pending.extend(data[i:])
                break

            payload = data[i + 2:end]
            if payload:
                opt = payload[0]
                if opt == _TTYPE and len(payload) > 1 and payload[1] == _TTYPE_SEND:
                    replies.extend(
                        bytes([_IAC, _SB, _TTYPE, _TTYPE_IS])
                        + b"xterm"
                        + bytes([_IAC, _SE])
                    )
                elif opt == _NAWS:
                    replies.extend(_naws())

            i = end + 2
            continue

        i += 2

    return clean, bytes(replies)


async def _wide_login(self):
    if getattr(self, "protocol", "") == "telnet" and getattr(self, "_writer", None):
        try:
            self._writer.write(
                bytes([_IAC, _WILL, _NAWS])
                + _naws()
                + bytes([_IAC, _WILL, _TTYPE])
            )
            await self._writer.drain()
        except Exception:
            pass

    return await _previous_login(self)


_vsol.OltClient._process_telnet_bytes = _wide_process_telnet
_vsol.OltClient._login = _wide_login


# ---------------------------------------------------------------------------
# Utilidades
# ---------------------------------------------------------------------------
_BAD = re.compile(
    r"(?:%\s*(?:unknown|invalid|incomplete|ambiguous)\s+command|"
    r"unknown\s+command|invalid\s+command|command\s+not\s+found|"
    r"no\s+related\s+information|not\s+found|does\s+not\s+exist)",
    re.I,
)


def _valid(text):
    return bool((text or "").strip()) and not _BAD.search(text or "")


def _section(raw, name):
    m = re.search(
        rf"---\s*{re.escape(name)}\s*---\s*\n(.*?)(?=\n\s*---\s*[A-Z0-9 _-]+\s*---|\Z)",
        raw or "",
        re.I | re.S,
    )
    return m.group(1).strip() if m else ""


def _index(text, default_pon):
    m = re.search(r"(?:GPON|EPON)?\s*0/(\d+)\s*[:/]\s*(\d{1,3})", text or "", re.I)
    if m:
        return int(m.group(1)), int(m.group(2))
    return int(default_pon), 0


def _clean_desc(text):
    if not text:
        return ""
    lines = []
    for line in text.replace("\r", "").splitlines():
        s = line.strip()
        if not s:
            continue
        if s.lower().startswith(("show onu", "v1600", "gpon", "epon")) and s.endswith("#"):
            continue
        if _BAD.search(s):
            continue
        lines.append(s)
    if not lines:
        return ""

    for line in lines:
        m = re.search(r"\bdescription\b\s*(?::|=)?\s*(.+)$", line, re.I)
        if m and m.group(1).strip():
            return m.group(1).strip()

    value = lines[-1]
    value = re.sub(r"^(?:description)\s*(?::|=)?\s*", "", value, flags=re.I).strip()
    return value


def _header_slices(raw, wanted):
    """Parsea una tabla de ancho fijo usando posiciones del encabezado."""
    lines = [x.rstrip("\r\n") for x in (raw or "").splitlines()]
    header_idx = None
    positions = []

    for i, line in enumerate(lines):
        low = line.lower()
        if not all(any(alias.lower() in low for alias in aliases) for _, aliases in wanted[:2]):
            continue

        found = []
        for key, aliases in wanted:
            best = None
            for alias in aliases:
                p = low.find(alias.lower())
                if p >= 0 and (best is None or p < best):
                    best = p
            if best is not None:
                found.append((best, key))
        if len(found) >= 2:
            positions = sorted(found)
            header_idx = i
            break

    if header_idx is None:
        return []

    rows = []
    for line in lines[header_idx + 1:]:
        if not line.strip() or set(line.strip()) <= set("-=+|_ "):
            continue
        if line.lstrip().startswith(("%", "---")):
            continue

        row = {}
        for n, (start, key) in enumerate(positions):
            end = positions[n + 1][0] if n + 1 < len(positions) else len(line)
            row[key] = line[start:end].strip()
        if any(row.values()):
            rows.append(row)
    return rows


_AUTH_COLUMNS = [
    ("ONUIndex", ("onuindex", "onu index", "onu id")),
    ("Model", ("model",)),
    ("Profile", ("profile",)),
    ("Mode", ("mode",)),
    ("Info", ("authinfo", "auth info", "info")),
]

_STATUS_COLUMNS = [
    ("ONUIndex", ("onu id", "onuindex", "onu index")),
    ("Status", ("status", "state")),
    ("Description", ("description", "name")),
    ("Model", ("model",)),
    ("Profile", ("profile",)),
    ("Mode", ("mode",)),
    ("Info", ("info", "authinfo")),
]


def _rows_fallback(raw, pon, kind="auth"):
    result = []
    for original in (raw or "").replace("\r", "").splitlines():
        line = original.strip()
        if not line:
            continue
        m = re.match(r"^((?:GPON|EPON)?\s*0/\d+\s*:\s*\d{1,3})\s+(.+)$", line, re.I)
        if not m:
            continue
        p, onu = _index(m.group(1), pon)
        if not onu:
            continue
        rest = m.group(2).split()
        row = {"ONUIndex": f"GPON0/{p}:{onu}"}

        if kind == "status" and rest and re.match(r"^(online|offline|up|down|active|inactive|los)$", rest[0], re.I):
            row["Status"] = rest.pop(0)
            if rest:
                row["Description"] = rest.pop(0)
        if rest:
            row["Model"] = rest.pop(0)
        if rest:
            row["Profile"] = rest.pop(0)
        if rest:
            row["Mode"] = rest.pop(0)
        if rest:
            row["Info"] = " ".join(rest)
        result.append(row)
    return result


def _table_rows(raw, pon, kind):
    wanted = _STATUS_COLUMNS if kind == "status" else _AUTH_COLUMNS
    rows = _header_slices(raw, wanted)
    good = []
    for row in rows:
        p, onu = _index(row.get("ONUIndex", ""), pon)
        if onu:
            row["_pon"] = p
            row["_onu"] = onu
            good.append(row)
    if good:
        return good

    rows = _rows_fallback(raw, pon, kind)
    for row in rows:
        p, onu = _index(row.get("ONUIndex", ""), pon)
        row["_pon"], row["_onu"] = p, onu
    return rows


def _row_count(raw):
    count = 0
    for line in (raw or "").splitlines():
        if re.match(r"^\s*(?:GPON|EPON)?\s*0/\d+\s*:\s*\d+", line, re.I):
            count += 1
    return count


def _explicit_ids(raw, pon):
    out = []
    for m in re.finditer(rf"(?:GPON|EPON)?\s*0/{int(pon)}\s*:\s*(\d{{1,3}})", raw or "", re.I):
        n = int(m.group(1))
        if 1 <= n <= 128 and n not in out:
            out.append(n)
    return out


def _auth_fields(raw, pon, onu):
    rows = _table_rows(raw, pon, "auth")
    for row in rows:
        if row.get("_onu") == onu:
            return {
                "Model": row.get("Model", ""),
                "Profile": row.get("Profile", ""),
                "Mode": row.get("Mode", ""),
                "Info": row.get("Info", ""),
            }

    info = _vsol.parse_key_values(raw or "")

    def pick(*patterns):
        for pattern in patterns:
            for key, value in info.items():
                if re.search(pattern, str(key), re.I):
                    return str(value or "").strip()
        return ""

    return {
        "Model": pick(r"model", r"product"),
        "Profile": pick(r"profile"),
        "Mode": pick(r"mode"),
        "Info": pick(r"auth\s*info", r"authinfo", r"serial", r"^sn$"),
    }


def _parse_optical(raw, pon):
    result = {}

    rows = _service.parse_table(raw or "")
    for row in rows:
        blob = " ".join(str(v or "") for v in row.values())
        p, onu = _index(blob, pon)
        if not onu:
            for key, value in row.items():
                if re.search(r"onu|index|id", str(key), re.I):
                    try:
                        n = int(re.search(r"\d{1,3}", str(value)).group(0))
                    except Exception:
                        n = 0
                    if 1 <= n <= 128:
                        onu = n
                        break
        if not onu:
            continue

        def val(*patterns):
            for pattern in patterns:
                for key, value in row.items():
                    if re.search(pattern, str(key), re.I):
                        return str(value or "").strip()
            return ""

        rx = val(r"rx\s*power", r"rxpower", r"^rx$")
        tx = val(r"tx\s*power", r"txpower", r"^tx$")
        if rx or tx:
            result[onu] = {"rx": rx, "tx": tx}

    for line in (raw or "").replace("\r", "").splitlines():
        p, onu = _index(line, pon)
        if not onu or p != int(pon):
            continue
        tail = re.split(r"(?:GPON|EPON)?\s*0/\d+\s*:\s*\d+", line, maxsplit=1, flags=re.I)[-1]
        nums = [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", tail)]
        if not nums:
            continue
        rx = next((x for x in nums if -50 < x < 0), None)
        tx = next((x for x in nums if 0 <= x <= 15), None)
        cur = result.get(onu, {})
        if not cur.get("rx") and rx is not None:
            cur["rx"] = f"{rx:g} dBm"
        if not cur.get("tx") and tx is not None:
            cur["tx"] = f"{tx:g} dBm"
        result[onu] = cur

    return result


def _status_map(raw, pon):
    result = {}
    for row in _table_rows(raw, pon, "status"):
        onu = row.get("_onu", 0)
        if onu:
            result[onu] = {
                "status": row.get("Status", ""),
                "description": row.get("Description", ""),
                "model": row.get("Model", ""),
                "profile": row.get("Profile", ""),
                "mode": row.get("Mode", ""),
                "info": row.get("Info", ""),
            }

    for line in (raw or "").splitlines():
        p, onu = _index(line, pon)
        if not onu or p != int(pon):
            continue
        m = re.search(r"\b(online|offline|up|down|active|inactive|los)\b", line, re.I)
        if m:
            result.setdefault(onu, {})["status"] = m.group(1)
    return result


async def _try_command(self, command):
    try:
        out = await self.run(command, raise_on_error=False)
        return out if _valid(out) else ""
    except Exception:
        return ""


async def _discover_ids(self, pon, auth_raw):
    rows = _table_rows(auth_raw, pon, "auth")
    ids = [r["_onu"] for r in rows if 1 <= r.get("_onu", 0) <= 128]
    ids = list(dict.fromkeys(ids))
    expected = max(len(rows), _row_count(auth_raw))

    suspicious = (
        not ids
        or (expected and len(ids) < max(1, int(expected * 0.75)))
        or (expected >= 5 and any(n > 100 for n in ids[:5]))
    )
    if not suspicious:
        return ids, {}

    found = []
    cache = {}
    consecutive_misses = 0
    for onu in range(1, 129):
        out = await _try_command(self, f"show onuinfo {onu}")
        if out and not re.search(r"no\s+related|not\s+exist|not\s+found", out, re.I):
            if (
                re.search(rf"(?:GPON|EPON)?\s*0/{int(pon)}\s*:\s*{onu}\b", out, re.I)
                or re.search(r"\b(model|profile|authinfo|serial|sn)\b", out, re.I)
            ):
                found.append(onu)
                cache[onu] = out
                consecutive_misses = 0
            else:
                consecutive_misses += 1
        else:
            consecutive_misses += 1

        if expected and len(found) >= expected:
            break
        if found and consecutive_misses >= 24 and (not expected or len(found) >= max(1, expected - 2)):
            break
        await asyncio.sleep(0.005)

    return (found or ids), cache


# ---------------------------------------------------------------------------
# Lecturas ONU
# ---------------------------------------------------------------------------
async def _complete_get_onus(self, pon: int, *, raise_on_error: bool = False):
    pon = int(pon)

    try:
        await self.ensure_privileged()
        if self._mode != "config":
            await self.run("configure terminal", raise_on_error=True)
    except Exception:
        pass

    global_status = ""
    for command in ("show onu status all", "show onu info"):
        out = await _try_command(self, command)
        if out:
            global_status += ("\n" if global_status else "") + out

    await self.enter_pon(pon, raise_on_error=True)

    auth_raw = await _try_command(self, "show onuinfo")
    pon_status = await _try_command(self, "show onu info")
    status_raw = "\n".join(x for x in (global_status, pon_status) if x)

    if not auth_raw and not status_raw:
        if raise_on_error:
            raise _vsol.OltError(f"No se pudo leer ONUs del PON 0/{pon}")
        return ""

    optical_raw = ""
    try:
        optical_raw = await self.get_onu_optical(pon, raise_on_error=False)
        if not _valid(optical_raw):
            optical_raw = ""
    except Exception:
        pass

    ids, individual_cache = await _discover_ids(self, pon, auth_raw)

    for onu in _explicit_ids(status_raw, pon):
        if onu not in ids:
            ids.append(onu)
    ids = sorted(n for n in ids if 1 <= n <= 128)

    auth_rows = _table_rows(auth_raw, pon, "auth")
    auth_by_id = {r["_onu"]: r for r in auth_rows if r.get("_onu")}
    statuses = _status_map(status_raw, pon)
    optical = _parse_optical(optical_raw, pon)

    canonical = []
    detail_chunks = []
    description_chunks = []

    for onu in ids:
        row = auth_by_id.get(onu, {})
        fields = {
            "Model": row.get("Model", ""),
            "Profile": row.get("Profile", ""),
            "Mode": row.get("Mode", ""),
            "Info": row.get("Info", ""),
        }

        probe = individual_cache.get(onu, "")
        if not all(fields.values()):
            if not probe:
                probe = await _try_command(self, f"show onuinfo {onu}")
            if probe:
                extra = _auth_fields(probe, pon, onu)
                for key in fields:
                    if not fields[key]:
                        fields[key] = extra.get(key, "")
                detail_chunks.append(f"### ONU {onu}\n{probe.strip()}")

        st = statuses.get(onu, {})
        if not fields["Model"]:
            fields["Model"] = st.get("model", "")
        if not fields["Profile"]:
            fields["Profile"] = st.get("profile", "")
        if not fields["Mode"]:
            fields["Mode"] = st.get("mode", "")
        if not fields["Info"]:
            fields["Info"] = st.get("info", "")

        desc = st.get("description", "")
        if not desc:
            raw_desc = await _try_command(self, f"show onu {onu} description")
            desc = _clean_desc(raw_desc)
            if raw_desc:
                description_chunks.append(f"### ONU {onu}\n{raw_desc.strip()}")

        opt = optical.get(onu, {})
        status = st.get("status", "")
        if not status and opt.get("rx"):
            status = "Online"

        canonical.append({
            "ONUIndex": f"GPON0/{pon}:{onu}",
            "PON": f"0/{pon}",
            "ONU ID": onu,
            "Status": status or "Unknown",
            "Description": desc,
            "Model": fields["Model"],
            "Profile": fields["Profile"],
            "Mode": fields["Mode"],
            "Info": fields["Info"],
            "RxPower": opt.get("rx", ""),
            "TxPower": opt.get("tx", ""),
        })

        await asyncio.sleep(0.005)

    sections = []
    if auth_raw:
        sections.append("--- AUTH ---\n" + auth_raw.strip())
    if status_raw:
        sections.append("--- STATUS ---\n" + status_raw.strip())
    if optical_raw:
        sections.append("--- OPTICAL ---\n" + optical_raw.strip())
    if description_chunks:
        sections.append("--- DESCRIPTIONS ---\n" + "\n".join(description_chunks))
    if detail_chunks:
        sections.append("--- INDIVIDUAL ---\n" + "\n".join(detail_chunks))
    sections.append("--- CANONICAL JSON ---\n" + json.dumps(canonical, ensure_ascii=False))
    return "\n\n".join(sections)


async def _complete_get_onu_info(self, pon: int, onu: int, *, raise_on_error: bool = True):
    pon, onu = int(pon), int(onu)
    if not (1 <= onu <= 128):
        raise _vsol.OltError(f"ONU ID fuera de rango: {onu}")

    await self.enter_pon(pon, raise_on_error=True)

    commands = [
        ("AUTH", f"show onuinfo {onu}"),
        ("DETAIL", f"show onu detail-info {onu}"),
        ("DESCRIPTION", f"show onu {onu} description"),
        ("RUNNING CONFIG", f"show running-config onu {onu}"),
        ("OPTICAL", f"show onu {onu} optical-info"),
        ("CAPABILITY", f"show onu {onu} capability"),
        ("GEMPORT", f"show onu {onu} gemport"),
        ("TCONT", f"show onu {onu} tcont"),
    ]

    sections = []
    for title, command in commands:
        out = await _try_command(self, command)
        if out:
            sections.append(f"--- {title} ---\n{out.strip()}")
        await asyncio.sleep(0.005)

    if not sections and raise_on_error:
        raise _vsol.OltError(f"No se pudo obtener detalle de ONU {onu} en PON {pon}")

    return "\n\n".join(sections)


_vsol.OltClient.get_onus = _complete_get_onus
_vsol.OltClient.get_onu_info = _complete_get_onu_info


# ---------------------------------------------------------------------------
# Post-procesado del service
# ---------------------------------------------------------------------------
_previous_run_action = _service.run_action


def _parse_canonical(raw):
    block = _section(raw, "CANONICAL JSON")
    if not block:
        return []
    try:
        value = json.loads(block)
        return value if isinstance(value, list) else []
    except Exception:
        return []


def _detail_info(raw, base=None):
    info = dict(base or {})
    sections = {}

    for name in ("AUTH", "DETAIL", "DESCRIPTION", "RUNNING CONFIG", "OPTICAL", "CAPABILITY", "GEMPORT", "TCONT"):
        block = _section(raw, name)
        if not block:
            continue
        sections[name] = block
        for key, value in _vsol.parse_key_values(block).items():
            if str(value or "").strip():
                info[str(key)] = str(value).strip()

    desc = _clean_desc(sections.get("DESCRIPTION", ""))
    if desc:
        info["Description"] = desc

    running = sections.get("RUNNING CONFIG", "")
    for pattern in (
        r"\buservlan\s+(\d{1,4})\b",
        r"\buser-vlan\s+(\d{1,4})\b",
        r"\bdef_vlan\s+(\d{1,4})\b",
        r"\bcvlan\s+(\d{1,4})\b",
        r"\bvlan\s+(\d{1,4})\b",
    ):
        m = re.search(pattern, running, re.I)
        if m:
            info["VLAN"] = m.group(1)
            break

    m = re.search(r"traffic-limit\s+upstream\s+(\S+)\s+downstream\s+(\S+)", running, re.I)
    if m:
        info["Upstream Profile"] = m.group(1)
        info["Downstream Profile"] = m.group(2)

    optical = sections.get("OPTICAL", "")
    for label, pattern in (
        ("RxPower", r"(?:rx\s*power|rxpower|receive[^:\n]*)\s*(?::|=)?\s*(-?\d+(?:\.\d+)?)"),
        ("TxPower", r"(?:tx\s*power|txpower|transmit[^:\n]*)\s*(?::|=)?\s*(-?\d+(?:\.\d+)?)"),
    ):
        m = re.search(pattern, optical, re.I)
        if m:
            info[label] = f"{m.group(1)} dBm"

    info["_sections"] = sections
    return info


async def _run_action_complete(router, action: str, **params):
    result = await _previous_run_action(router, action, **params)
    if not result.get("ok"):
        return result

    if action == "onu_list":
        rows = _parse_canonical(result.get("raw", ""))
        if rows:
            result["rows"] = rows
            result["onu_summary"] = {
                "total": len(rows),
                "online": sum(1 for r in rows if re.search(r"\bonline\b|\bactive\b|\bup\b", r.get("Status", ""), re.I)),
                "offline": sum(1 for r in rows if re.search(r"\boffline\b|\bdown\b|\blos\b|\binactive\b", r.get("Status", ""), re.I)),
                "named": sum(1 for r in rows if str(r.get("Description", "") or "").strip()),
            }

        result["raw"] = re.sub(
            r"\n*---\s*CANONICAL JSON\s*---\s*\n.*\Z",
            "",
            result.get("raw", ""),
            flags=re.I | re.S,
        ).rstrip()
        return result

    if action == "onu_detail":
        result["info"] = _detail_info(result.get("raw", ""), result.get("info") or {})
        return result

    return result


_service.run_action = _run_action_complete
