/**
 * Vista ONU amigable para VSOL V1600G.
 *
 * La salida de `show onuinfo` de varias VSOL usa columnas separadas por un solo
 * espacio. El parser genérico podía desplazar Status/Description/Model/Profile
 * y convertir GPON0/1:1 en IDs incorrectos como 111. Este componente vuelve a
 * interpretar la salida cruda y conserva los campos reales de la OLT.
 */
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import {
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Fingerprint,
  Gauge,
  Hash,
  Layers,
  Power,
  Radio,
  RefreshCw,
  RotateCw,
  Search,
  Server,
  Trash2,
  User,
  Wifi,
} from "lucide-react";
import { toast } from "sonner";

const txt = (v) => String(v ?? "").trim();
const norm = (v) => txt(v).toLowerCase().replace(/[^a-z0-9]/g, "");

const byKey = (row, patterns) => {
  if (!row) return "";
  for (const pattern of patterns) {
    const key = Object.keys(row).find((k) => pattern.test(String(k)));
    if (key) return txt(row[key]);
  }
  return "";
};

const cleanDescription = (value) => {
  const raw = txt(value);
  if (!raw || raw === "-" || /^none$/i.test(raw)) return "";
  return raw.replace(/_/g, " ").replace(/\s+/g, " ").trim();
};

const parseIndexText = (value, selectedPon) => {
  const raw = txt(value);
  let m = raw.match(/(?:gpon|epon)?\s*0\/(\d+)\s*[:/]\s*(\d+)/i);
  if (m) return { pon: Number(m[1]), onuId: Number(m[2]), raw };
  m = raw.match(/0\/(\d+)\s*[:/]\s*(\d+)/i);
  if (m) return { pon: Number(m[1]), onuId: Number(m[2]), raw };
  if (/^\d+$/.test(raw)) return { pon: Number(selectedPon), onuId: Number(raw), raw };
  return { pon: Number(selectedPon), onuId: 0, raw };
};

/**
 * Formato observado en la web/CLI de VSOL:
 * GPON0/1:1 Online DESCRIPCION MODELO PERFIL Sn INFO
 *
 * Description suele usar '_' en lugar de espacios, por lo que el split por
 * espacios es fiable para esta familia y evita el corrimiento del parser de
 * ancho fijo.
 */
const parseRawOnuRows = (raw, selectedPon) => {
  const result = [];
  const lines = txt(raw).replace(/\r/g, "").split("\n");

  for (const original of lines) {
    const line = original.trim();
    if (!line) continue;

    const indexMatch = line.match(/^((?:GPON|EPON)?\s*0\/\d+\s*:\s*\d+)\s+(.+)$/i);
    if (!indexMatch) continue;

    const indexText = indexMatch[1].replace(/\s+/g, "");
    const rest = indexMatch[2].trim();
    const parts = rest.split(/\s+/);
    if (!parts.length) continue;

    let status = "";
    if (/^(online|offline|up|down|active|inactive|los)$/i.test(parts[0])) {
      status = parts.shift();
    }

    // VSOL V1600G: Description, Model, Profile, Mode, Info.
    const description = parts.shift() || "";
    const model = parts.shift() || "";
    const profile = parts.shift() || "";
    const mode = parts.shift() || "";
    const info = parts.join(" ") || "";
    const idx = parseIndexText(indexText, selectedPon);

    result.push({
      "ONU ID": indexText,
      Status: status,
      Description: description,
      Model: model,
      Profile: profile,
      Mode: mode,
      Info: info,
      _pon: idx.pon,
      _onuId: idx.onuId,
    });
  }

  return result;
};

const normalizeFallbackRows = (rows, selectedPon) => rows.map((row) => {
  const indexValue = byKey(row, [/onu\s*index/i, /onuindex/i, /onu\s*id/i, /^index$/i, /^onu$/i]) || txt(Object.values(row || {})[0]);
  const idx = parseIndexText(indexValue, selectedPon);
  return {
    ...row,
    "ONU ID": indexValue,
    Status: byKey(row, [/^status$/i, /^state$/i]),
    Description: byKey(row, [/description/i, /^name$/i, /alias/i]),
    Model: byKey(row, [/^model$/i, /onu\s*model/i, /^type$/i]),
    Profile: byKey(row, [/profile/i]),
    Mode: byKey(row, [/^mode$/i]),
    Info: byKey(row, [/^info$/i, /authinfo/i, /auth\s*info/i, /^sn$/i, /serial/i]),
    _pon: idx.pon,
    _onuId: idx.onuId,
  };
});

const parseOpticalRows = (payload, selectedPon) => {
  const map = new Map();
  const rows = payload?.rows || [];

  rows.forEach((row) => {
    const indexValue = byKey(row, [/onu\s*index/i, /onuindex/i, /onu\s*id/i, /^index$/i, /^onu$/i]) || txt(Object.values(row || {})[0]);
    const idx = parseIndexText(indexValue, selectedPon);
    if (!idx.onuId) return;
    map.set(idx.onuId, {
      rx: byKey(row, [/rx\s*power/i, /rxpower/i, /^rx$/i]),
      tx: byKey(row, [/tx\s*power/i, /txpower/i, /^tx$/i]),
      temperature: byKey(row, [/temp/i, /temperature/i]),
    });
  });

  // Fallback sobre la salida cruda: extrae índice y luego valores ópticos.
  for (const original of txt(payload?.raw).replace(/\r/g, "").split("\n")) {
    const line = original.trim();
    if (!line) continue;
    let idx = null;
    const indexed = line.match(/(?:GPON|EPON)?\s*0\/(\d+)\s*[:/]\s*(\d+)/i);
    if (indexed) idx = { pon: Number(indexed[1]), onuId: Number(indexed[2]) };
    if (!idx?.onuId || idx.pon !== Number(selectedPon)) continue;

    const numbers = line.match(/-?\d+(?:\.\d+)?/g) || [];
    const negative = numbers.map(Number).find((n) => n < 0);
    const existing = map.get(idx.onuId) || {};
    if (!existing.rx && negative !== undefined) existing.rx = `${negative} dBm`;
    map.set(idx.onuId, existing);
  }

  return map;
};

const parseDbm = (value) => {
  const m = txt(value).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const rxUi = (value) => {
  const n = parseDbm(value);
  if (n === null) return { pct: 0, text: "Sin lectura", color: "text-slate-400", bar: "bg-slate-700" };
  const pct = Math.max(4, Math.min(100, ((n + 35) / 27) * 100));
  if (n >= -25) return { pct, text: "Buena", color: "text-emerald-300", bar: "bg-emerald-400" };
  if (n >= -28) return { pct, text: "Media", color: "text-amber-300", bar: "bg-amber-400" };
  return { pct, text: "Baja", color: "text-rose-300", bar: "bg-rose-400" };
};

const statusUi = (value) => {
  const s = txt(value).toLowerCase();
  if (/online|active|up/.test(s)) return { id: "online", label: "ONLINE", cls: "text-emerald-300 bg-emerald-950/40 border-emerald-800/60" };
  if (/offline|down|los|inactive/.test(s)) return { id: "offline", label: "OFFLINE", cls: "text-rose-300 bg-rose-950/40 border-rose-800/60" };
  return { id: "unknown", label: "SIN ESTADO", cls: "text-slate-300 bg-slate-800/70 border-slate-700" };
};

const Info = ({ icon: Icon, label, value, valueClass = "text-slate-100", mono = true }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/55 p-2.5 min-w-0">
    <p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
      {Icon && <Icon className="w-3 h-3" />} {label}
    </p>
    <p className={`mt-1 text-[11px] font-semibold break-words ${mono ? "font-mono" : ""} ${valueClass}`} title={txt(value)}>
      {value || "—"}
    </p>
  </div>
);

const Summary = ({ icon: Icon, label, value, valueClass = "text-slate-100" }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-3.5">
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`text-xl font-bold font-mono mt-1 ${valueClass}`}>{value}</p>
      </div>
      <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400"><Icon className="w-4 h-4" /></div>
    </div>
  </div>
);

export default function OnuCardsPanelV2({ router, pon, rows = [], raw = "", onAction, onRefresh }) {
  const { API, token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [optical, setOptical] = useState(new Map());
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [extraTick, setExtraTick] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState({});
  const [detail, setDetail] = useState({});
  const [detailLoading, setDetailLoading] = useState({});
  const [actionBusy, setActionBusy] = useState("");

  const parsedRows = useMemo(() => {
    const fromRaw = parseRawOnuRows(raw, pon);
    return fromRaw.length ? fromRaw : normalizeFallbackRows(rows, pon);
  }, [raw, rows, pon]);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoadingExtra(true);
      try {
        const [clientsRes, plansRes, opticalRes] = await Promise.all([
          axios.get(`${API}/clients`, { headers }),
          axios.get(`${API}/plans`, { headers }),
          axios.get(`${API}/routers/${router.id}/olt/onu_optical?pon=${pon}`, { headers }),
        ]);
        if (!alive) return;
        setClients(Array.isArray(clientsRes.data) ? clientsRes.data : []);
        setPlans(Array.isArray(plansRes.data) ? plansRes.data : []);
        setOptical(opticalRes.data?.ok ? parseOpticalRows(opticalRes.data, pon) : new Map());
      } catch (e) {
        if (alive) console.warn("No se pudo enriquecer ONUs", e);
      } finally {
        if (alive) setLoadingExtra(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [API, headers, router.id, pon, extraTick]);

  useEffect(() => {
    setExpanded({});
    setDetail({});
    setDetailLoading({});
  }, [router.id, pon]);

  const plansById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);

  const cards = useMemo(() => parsedRows.map((row, i) => {
    const idx = row._onuId ? { pon: row._pon, onuId: row._onuId, raw: row["ONU ID"] } : parseIndexText(row["ONU ID"], pon);
    const serial = txt(row.Info) || byKey(row, [/^sn$/i, /serial/i, /authinfo/i]);
    const serialNorm = norm(serial);
    const client = clients.find((c) => {
      const cSn = norm(c.onu_sn);
      return cSn && serialNorm && (cSn === serialNorm || cSn.includes(serialNorm) || serialNorm.includes(cSn));
    }) || null;
    const plan = client ? plansById.get(client.plan_id) : null;
    const opt = optical.get(idx.onuId) || {};
    const status = statusUi(row.Status);
    const descriptionRaw = txt(row.Description);
    const description = cleanDescription(descriptionRaw);
    const down = plan?.download_speed_mbps;
    const up = plan?.upload_speed_mbps;

    return {
      key: `${idx.pon}-${idx.onuId || i}`,
      pon: idx.pon || Number(pon),
      onuId: idx.onuId,
      onuIndex: idx.raw || row["ONU ID"],
      status,
      descriptionRaw,
      description,
      model: txt(row.Model),
      profile: txt(row.Profile),
      mode: txt(row.Mode),
      serial,
      rx: opt.rx || "",
      tx: opt.tx || "",
      client,
      plan,
      speed: down || up ? `${down || 0}↓ / ${up || 0}↑ Mbps` : "",
      row,
    };
  }), [parsedRows, pon, clients, plansById, optical]);

  const counts = useMemo(() => ({
    total: cards.length,
    online: cards.filter((c) => c.status.id === "online").length,
    offline: cards.filter((c) => c.status.id === "offline").length,
    named: cards.filter((c) => c.description).length,
  }), [cards]);

  const filtered = useMemo(() => {
    const q = norm(search);
    return cards.filter((c) => {
      if (filter !== "all" && c.status.id !== filter) return false;
      if (!q) return true;
      return norm([
        c.description,
        c.descriptionRaw,
        c.client?.full_name,
        c.client?.dni_ruc,
        c.client?.ip_address,
        c.serial,
        c.model,
        c.profile,
        c.mode,
        c.onuIndex,
        c.onuId,
        c.plan?.name,
      ].join(" ")).includes(q);
    });
  }, [cards, search, filter]);

  const loadDetail = async (card) => {
    if (!card.onuId || detailLoading[card.key] || detail[card.key]) return;
    setDetailLoading((p) => ({ ...p, [card.key]: true }));
    try {
      const r = await axios.get(`${API}/routers/${router.id}/olt/onu_detail?pon=${card.pon}&onu=${card.onuId}`, { headers });
      if (!r.data?.ok) throw new Error(r.data?.error || "Sin detalle");
      setDetail((p) => ({ ...p, [card.key]: { info: r.data.info || {}, raw: r.data.raw || "" } }));
    } catch (e) {
      setDetail((p) => ({ ...p, [card.key]: { info: {}, raw: "", error: e?.response?.data?.detail || e?.message || "No se pudo leer detalle" } }));
    } finally {
      setDetailLoading((p) => ({ ...p, [card.key]: false }));
    }
  };

  const toggle = (card) => {
    const willOpen = !expanded[card.key];
    setExpanded((p) => ({ ...p, [card.key]: willOpen }));
    if (willOpen) loadDetail(card);
  };

  const runAction = async (action, card) => {
    const busy = `${action}-${card.key}`;
    setActionBusy(busy);
    try {
      await onAction(action, card.onuId, card.serial);
      setExtraTick((n) => n + 1);
    } finally {
      setActionBusy("");
    }
  };

  const refreshAll = async () => {
    setExtraTick((n) => n + 1);
    if (onRefresh) await onRefresh();
  };

  return (
    <div className="space-y-4" data-testid="onu-cards-panel-v2">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Summary icon={Radio} label="ONUs en este PON" value={counts.total} />
        <Summary icon={Wifi} label="Online" value={counts.online} valueClass="text-emerald-300" />
        <Summary icon={Power} label="Offline" value={counts.offline} valueClass={counts.offline ? "text-rose-300" : "text-slate-100"} />
        <Summary icon={User} label="Con nombre en OLT" value={counts.named} valueClass="text-cyan-300" />
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
        <div className="relative flex-1 max-w-xl">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nombre VSOL, cliente, serie, modelo, ONU ID, perfil..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-600"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {[["all", `Todas ${counts.total}`], ["online", `Online ${counts.online}`], ["offline", `Offline ${counts.offline}`]].map(([id, label]) => (
            <button key={id} onClick={() => setFilter(id)} className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition ${filter === id ? "bg-cyan-950/60 text-cyan-300 border-cyan-700/60" : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"}`}>{label}</button>
          ))}
          <button onClick={refreshAll} title="Actualizar" className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800">
            <RefreshCw className={`w-3.5 h-3.5 ${loadingExtra ? "animate-spin text-cyan-400" : ""}`} />
          </button>
        </div>
      </div>

      {filtered.length ? (
        <div className="space-y-3">
          {filtered.map((card) => {
            const open = !!expanded[card.key];
            const d = detail[card.key] || {};
            const dInfo = d.info || {};
            const vlan = byKey(dInfo, [/vlan/i, /vid/i]) || byKey(card.row, [/vlan/i, /vid/i]);
            const detailModel = byKey(dInfo, [/model/i, /type/i]);
            const detailSn = byKey(dInfo, [/^sn$/i, /serial/i, /auth/i]);
            const rx = rxUi(card.rx);
            const title = card.description || card.client?.full_name || `ONU ${card.onuId}`;
            const subtitle = card.client
              ? `Cliente: ${card.client.full_name}${card.plan?.name ? ` · ${card.plan.name}` : ""}`
              : card.description
                ? "Nombre configurado directamente en la VSOL"
                : "Sin descripción asignada en la OLT";

            return (
              <div key={card.key} className={`rounded-2xl border overflow-hidden transition ${open ? "border-cyan-800/60 bg-slate-950/70" : "border-slate-800 bg-slate-950/50 hover:border-slate-700"}`}>
                <button type="button" onClick={() => toggle(card)} className="w-full text-left p-4 bg-slate-900/45 hover:bg-slate-900/70 transition">
                  <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-10 h-10 rounded-xl border border-cyan-800/50 bg-cyan-950/30 text-cyan-300 flex items-center justify-center shrink-0"><Radio className="w-5 h-5" /></div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-100 truncate" title={title}>{title}</h4>
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate" title={subtitle}>{subtitle}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 lg:min-w-[620px]">
                      <Mini label="PON" value={`0/${card.pon}`} />
                      <Mini label="ONU ID" value={card.onuId || "—"} />
                      <Mini label="Modelo" value={card.model || "—"} />
                      <Mini label="RX" value={card.rx || "—"} valueClass={rx.color} />
                      <div className="flex items-center justify-end gap-2">
                        <span className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${card.status.cls}`}>{card.status.label}</span>
                        {open ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                    </div>
                  </div>
                </button>

                {open && (
                  <div className="p-4 space-y-4 border-t border-slate-800/80">
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                      <Info icon={Layers} label="Puerto PON" value={`0/${card.pon}`} />
                      <Info icon={Hash} label="ONU ID" value={card.onuId || "—"} />
                      <Info icon={Fingerprint} label="Serie / Info" value={detailSn || card.serial || "—"} />
                      <Info icon={Server} label="Modelo ONU" value={detailModel || card.model || "—"} />
                      <Info icon={Server} label="Perfil" value={card.profile || "—"} />
                      <Info icon={Activity} label="Modo" value={card.mode || "—"} />
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Info icon={Activity} label="Potencia RX" value={card.rx || "—"} valueClass={rx.color} />
                      <Info icon={Radio} label="Potencia TX" value={card.tx || "—"} />
                      <Info icon={Layers} label="VLAN" value={vlan || "No devuelta por CLI"} valueClass={vlan ? "text-cyan-300" : "text-slate-500"} />
                      <Info icon={Wifi} label="Velocidad / plan" value={card.speed || card.plan?.name || card.client?.plan_name || "No asociado"} />
                    </div>

                    <div>
                      <div className="flex justify-between text-[10px] mb-1.5"><span className="text-slate-500">Nivel óptico RX</span><span className={rx.color}>{rx.text}{card.rx ? ` · ${card.rx}` : ""}</span></div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className={`h-full rounded-full ${rx.bar}`} style={{ width: `${rx.pct}%` }} /></div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Info icon={User} label="Nombre en VSOL" value={card.description || "Sin descripción"} mono={false} valueClass="text-cyan-300" />
                      <Info icon={User} label="Cliente en MikroHub" value={card.client?.full_name || "Sin vincular por SN"} mono={false} valueClass={card.client ? "text-emerald-300" : "text-amber-300"} />
                    </div>

                    {card.client && (
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <Info label="IP cliente" value={card.client.ip_address || "—"} />
                        <Info label="NAP" value={card.client.nap_box || "—"} />
                        <Info label="Plan" value={card.plan?.name || card.client.plan_name || "—"} mono={false} />
                        <Info label="Estado servicio" value={card.client.status || "—"} valueClass={card.client.status === "active" ? "text-emerald-300" : "text-amber-300"} />
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-800 bg-black/20 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-[10px] uppercase tracking-wider text-cyan-400">Información detallada de la OLT</p>
                        {detailLoading[card.key] && <RefreshCw className="w-3.5 h-3.5 animate-spin text-cyan-400" />}
                      </div>
                      {d.error ? (
                        <p className="text-[11px] text-amber-300">{d.error}</p>
                      ) : Object.keys(dInfo).length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                          {Object.entries(dInfo).map(([k, v]) => <Info key={k} label={k} value={v} />)}
                        </div>
                      ) : d.raw ? (
                        <pre className="text-[10px] text-slate-300 font-mono whitespace-pre-wrap max-h-60 overflow-auto">{d.raw}</pre>
                      ) : (
                        <p className="text-[11px] text-slate-500">Consultando detalle de ONU...</p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">Acciones</span>
                      <ActionButton label="Reiniciar" icon={RotateCw} cls="text-cyan-300 border-cyan-900/60 hover:bg-cyan-950/30" onClick={() => runAction("reboot", card)} disabled={!card.onuId || actionBusy === `reboot-${card.key}`} />
                      <ActionButton label="Activar" icon={CheckCircle2} cls="text-emerald-300 border-emerald-900/60 hover:bg-emerald-950/30" onClick={() => runAction("activate", card)} disabled={!card.onuId || actionBusy === `activate-${card.key}`} />
                      <ActionButton label="Desactivar" icon={Power} cls="text-amber-300 border-amber-900/60 hover:bg-amber-950/20" onClick={() => runAction("deactivate", card)} disabled={!card.onuId || actionBusy === `deactivate-${card.key}`} />
                      <ActionButton label="Eliminar" icon={Trash2} cls="text-rose-300 border-rose-900/60 hover:bg-rose-950/30" onClick={() => runAction("delete", card)} disabled={!card.onuId || actionBusy === `delete-${card.key}`} />
                      <button onClick={() => { setDetail((p) => { const n = { ...p }; delete n[card.key]; return n; }); loadDetail(card); }} className="px-3 py-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:bg-slate-800 text-[11px] flex items-center gap-1.5"><RefreshCw className="w-3.5 h-3.5" />Actualizar detalle</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-8 rounded-2xl border border-dashed border-slate-800 text-center text-xs text-slate-500">No hay ONUs que coincidan con el filtro.</div>
      )}
    </div>
  );
}

const Mini = ({ label, value, valueClass = "text-slate-200" }) => (
  <div className="min-w-0">
    <p className="text-[9px] uppercase text-slate-600">{label}</p>
    <p className={`text-[10px] font-mono font-semibold truncate ${valueClass}`} title={txt(value)}>{value}</p>
  </div>
);

const ActionButton = ({ label, icon: Icon, cls, onClick, disabled }) => (
  <button onClick={onClick} disabled={disabled} className={`px-3 py-2 rounded-lg border bg-slate-950/40 text-[11px] font-semibold flex items-center gap-1.5 transition disabled:opacity-40 ${cls}`}>
    <Icon className="w-3.5 h-3.5" />{label}
  </button>
);
