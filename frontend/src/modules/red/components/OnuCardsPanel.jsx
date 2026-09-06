/**
 * Archivo: frontend/src/modules/red/components/OnuCardsPanel.jsx
 * Función: Vista gráfica para ONUs de una OLT VSOL. Cruza el listado CLI con
 *          clientes/planes del sistema por SN, consulta potencia óptica del PON,
 *          permite buscar/filtrar y cargar el detalle de una ONU bajo demanda.
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

const textOf = (value) => String(value ?? "").trim();
const norm = (value) => textOf(value).toLowerCase().replace(/[^a-z0-9]/g, "");

const valueByKey = (row, patterns) => {
  if (!row) return "";
  const keys = Object.keys(row);
  for (const pattern of patterns) {
    const key = keys.find((k) => pattern.test(String(k)));
    if (key) return textOf(row[key]);
  }
  return "";
};

const parseIndex = (row, selectedPon) => {
  const raw = valueByKey(row, [/onu\s*index/i, /onuindex/i, /^index$/i, /^onu$/i, /onu\s*id/i]) || textOf(Object.values(row || {})[0]);

  let match = raw.match(/(?:gpon|epon)?\s*0\/(\d+)\s*[:/]\s*(\d+)/i);
  if (match) {
    return { pon: Number(match[1]), onuId: Number(match[2]), raw };
  }

  match = raw.match(/0\/(\d+)\s*[:/]\s*(\d+)/i);
  if (match) {
    return { pon: Number(match[1]), onuId: Number(match[2]), raw };
  }

  const numbers = raw.match(/\d+/g) || [];
  if (numbers.length >= 2) {
    return { pon: Number(numbers[numbers.length - 2]), onuId: Number(numbers[numbers.length - 1]), raw };
  }
  if (numbers.length === 1) {
    return { pon: Number(selectedPon), onuId: Number(numbers[0]), raw };
  }

  return { pon: Number(selectedPon), onuId: 0, raw };
};

const serialOf = (row) => {
  const direct = valueByKey(row, [/^sn$/i, /serial/i, /auth\s*info/i, /authinfo/i, /mac/i]);
  if (direct) return direct;

  const candidate = Object.values(row || {})
    .map(textOf)
    .find((value) => /[a-z]{3,6}[0-9a-f]{6,12}/i.test(value));
  return candidate || "";
};

const modelOf = (row) => valueByKey(row, [/onu\s*model/i, /^model$/i, /^type$/i, /device/i]);
const profileOf = (row) => valueByKey(row, [/profile/i, /line\s*profile/i, /service\s*profile/i]);
const modeOf = (row) => valueByKey(row, [/^mode$/i, /state/i, /status/i]);
const vlanOf = (row) => valueByKey(row, [/vlan/i, /vid/i]);
const descriptionOf = (row) => valueByKey(row, [/description/i, /name/i, /alias/i]);

const opticalValue = (row, patterns) => valueByKey(row, patterns);

const parseDbm = (value) => {
  const match = textOf(value).match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
};

const rxVisual = (value) => {
  const n = parseDbm(value);
  if (n === null) return { pct: 0, label: "Sin lectura", cls: "text-slate-400", bar: "bg-slate-700" };
  // Escala visual aproximada -35..-8 dBm. No pretende sustituir los umbrales del fabricante.
  const pct = Math.max(4, Math.min(100, ((n + 35) / 27) * 100));
  if (n >= -25) return { pct, label: "RX estable", cls: "text-emerald-300", bar: "bg-emerald-400" };
  if (n >= -28) return { pct, label: "RX medio", cls: "text-amber-300", bar: "bg-amber-400" };
  return { pct, label: "RX bajo", cls: "text-rose-300", bar: "bg-rose-400" };
};

const statusOf = (row, rx) => {
  const raw = [modeOf(row), ...Object.values(row || {}).map(textOf)].join(" ").toLowerCase();
  if (/offline|down|los|dying|inactive|disable/.test(raw)) return "offline";
  if (/online|active|up|registered|working/.test(raw)) return "online";
  if (parseDbm(rx) !== null) return "online";
  return "unknown";
};

const statusUi = {
  online: { label: "ONLINE", cls: "text-emerald-300 bg-emerald-950/40 border-emerald-800/60" },
  offline: { label: "OFFLINE", cls: "text-rose-300 bg-rose-950/40 border-rose-800/60" },
  unknown: { label: "SIN ESTADO", cls: "text-slate-300 bg-slate-800/70 border-slate-700" },
};

const InfoBox = ({ icon: Icon, label, value, valueClass = "text-slate-100", mono = true }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/55 p-2.5 min-w-0">
    <p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
      {Icon && <Icon className="w-3 h-3" />} {label}
    </p>
    <p className={`mt-1 text-[11px] font-semibold truncate ${mono ? "font-mono" : ""} ${valueClass}`} title={textOf(value)}>
      {value || "—"}
    </p>
  </div>
);

export default function OnuCardsPanel({ router, pon, rows = [], onAction, onRefresh }) {
  const { API, token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [opticalRows, setOpticalRows] = useState([]);
  const [loadingExtra, setLoadingExtra] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [details, setDetails] = useState({});
  const [detailLoading, setDetailLoading] = useState({});
  const [actionBusy, setActionBusy] = useState("");

  useEffect(() => {
    let alive = true;
    const loadExtra = async () => {
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
        setOpticalRows(opticalRes.data?.ok ? (opticalRes.data.rows || []) : []);
      } catch (e) {
        if (alive) {
          setOpticalRows([]);
          console.warn("No se pudo enriquecer la vista ONU", e);
        }
      } finally {
        if (alive) setLoadingExtra(false);
      }
    };

    loadExtra();
    return () => { alive = false; };
  }, [API, headers, router.id, pon]);

  useEffect(() => {
    setDetails({});
    setDetailLoading({});
  }, [router.id, pon]);

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);

  const opticalById = useMemo(() => {
    const map = new Map();
    opticalRows.forEach((row) => {
      const idx = parseIndex(row, pon);
      if (idx.onuId) map.set(idx.onuId, row);
    });
    return map;
  }, [opticalRows, pon]);

  const associatedClients = useMemo(
    () => clients.filter((c) => !c.router_id || c.router_id === router.id),
    [clients, router.id]
  );

  const findClient = (row, serial) => {
    const rowBlob = norm(Object.values(row || {}).join(" "));
    const serialNorm = norm(serial);

    return associatedClients.find((client) => {
      const clientSn = norm(client.onu_sn);
      if (!clientSn) return false;
      return (
        (serialNorm && (serialNorm.includes(clientSn) || clientSn.includes(serialNorm))) ||
        rowBlob.includes(clientSn)
      );
    }) || null;
  };

  const cards = useMemo(() => rows.map((row, index) => {
    const idx = parseIndex(row, pon);
    const optical = opticalById.get(idx.onuId) || {};
    const serial = serialOf(row);
    const client = findClient(row, serial);
    const plan = client ? planById.get(client.plan_id) : null;

    const rx = opticalValue(optical, [/rx\s*power/i, /rxpower/i, /^rx$/i]) || opticalValue(row, [/rx\s*power/i, /rxpower/i]);
    const tx = opticalValue(optical, [/tx\s*power/i, /txpower/i, /^tx$/i]) || opticalValue(row, [/tx\s*power/i, /txpower/i]);
    const temp = opticalValue(optical, [/temp/i, /temperature/i]);
    const status = statusOf(row, rx);

    const down = plan?.download_speed_mbps;
    const up = plan?.upload_speed_mbps;
    const speed = down || up ? `${down || 0}↓ / ${up || 0}↑ Mbps` : "";

    return {
      key: `${idx.pon}-${idx.onuId || index}`,
      row,
      pon: idx.pon || pon,
      onuId: idx.onuId,
      onuIndex: idx.raw,
      serial: client?.onu_sn || serial,
      model: modelOf(row),
      profile: profileOf(row),
      mode: modeOf(row),
      vlan: vlanOf(row),
      description: descriptionOf(row),
      rx,
      tx,
      temp,
      status,
      client,
      plan,
      speed,
    };
  }), [rows, pon, opticalById, associatedClients, planById]);

  const filtered = useMemo(() => {
    const q = norm(search);
    return cards.filter((card) => {
      if (statusFilter !== "all" && card.status !== statusFilter) return false;
      if (!q) return true;
      const haystack = norm([
        card.client?.full_name,
        card.client?.dni_ruc,
        card.client?.ip_address,
        card.serial,
        card.model,
        card.profile,
        card.vlan,
        card.onuIndex,
        card.onuId,
        card.plan?.name,
      ].join(" "));
      return haystack.includes(q);
    });
  }, [cards, search, statusFilter]);

  const summary = useMemo(() => ({
    total: cards.length,
    online: cards.filter((c) => c.status === "online").length,
    linked: cards.filter((c) => c.client).length,
    weak: cards.filter((c) => {
      const n = parseDbm(c.rx);
      return n !== null && n < -28;
    }).length,
  }), [cards]);

  const loadDetail = async (card) => {
    if (!card.onuId) return;
    if (details[card.key]?.open) {
      setDetails((prev) => ({ ...prev, [card.key]: { ...prev[card.key], open: false } }));
      return;
    }
    if (details[card.key]?.info) {
      setDetails((prev) => ({ ...prev, [card.key]: { ...prev[card.key], open: true } }));
      return;
    }

    setDetailLoading((prev) => ({ ...prev, [card.key]: true }));
    try {
      const r = await axios.get(`${API}/routers/${router.id}/olt/onu_detail?pon=${pon}&onu=${card.onuId}`, { headers });
      if (!r.data?.ok) throw new Error(r.data?.error || "Sin detalle");
      setDetails((prev) => ({
        ...prev,
        [card.key]: { open: true, info: r.data.info || {}, raw: r.data.raw || "" },
      }));
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "No se pudo leer el detalle de la ONU");
    } finally {
      setDetailLoading((prev) => ({ ...prev, [card.key]: false }));
    }
  };

  const runAction = async (action, card) => {
    const key = `${action}-${card.key}`;
    setActionBusy(key);
    try {
      await onAction(action, card.onuId, card.serial);
    } finally {
      setActionBusy("");
    }
  };

  return (
    <div className="space-y-4" data-testid="onu-cards-panel">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <SummaryCard label="ONUs en este PON" value={summary.total} icon={Radio} />
        <SummaryCard label="Con señal / online" value={summary.online} icon={Wifi} valueClass="text-emerald-300" />
        <SummaryCard label="Ligadas a clientes" value={summary.linked} icon={User} valueClass="text-cyan-300" />
        <SummaryCard label="RX bajo" value={summary.weak} icon={Gauge} valueClass={summary.weak ? "text-rose-300" : "text-slate-100"} />
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
        <div className="relative flex-1 max-w-xl">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar cliente, serie, modelo, ONU ID, IP, perfil..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-600"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {[
            ["all", `Todas ${summary.total}`],
            ["online", `Online ${summary.online}`],
            ["offline", `Offline ${cards.filter((c) => c.status === "offline").length}`],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setStatusFilter(id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition ${statusFilter === id ? "bg-cyan-950/60 text-cyan-300 border-cyan-700/60" : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"}`}
            >
              {label}
            </button>
          ))}
          <button
            onClick={onRefresh}
            title="Actualizar ONUs"
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingExtra ? "animate-spin text-cyan-400" : ""}`} />
          </button>
        </div>
      </div>

      {filtered.length ? (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {filtered.map((card) => {
            const st = statusUi[card.status] || statusUi.unknown;
            const rxUi = rxVisual(card.rx);
            const detail = details[card.key];
            const detailInfo = detail?.info || {};
            const detailVlan = valueByKey(detailInfo, [/vlan/i, /vid/i]);
            const shownVlan = detailVlan || card.vlan;
            const clientName = card.client?.full_name || card.description || "ONU sin cliente asociado";
            const clientSub = card.client
              ? `${card.plan?.name || card.client.plan_name || "Sin plan"}${card.speed ? ` · ${card.speed}` : ""}`
              : "Asocia el SN de esta ONU al abonado para mostrar nombre y plan";

            return (
              <div key={card.key} className="rounded-2xl border border-slate-800 bg-slate-950/55 overflow-hidden shadow-sm">
                <div className="p-4 border-b border-slate-800/80 bg-slate-900/45">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl border border-cyan-800/50 bg-cyan-950/30 text-cyan-300 flex items-center justify-center shrink-0">
                        <Radio className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-100 truncate" title={clientName}>{clientName}</h4>
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate" title={clientSub}>{clientSub}</p>
                      </div>
                    </div>
                    <span className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <InfoBox icon={Layers} label="Puerto PON" value={`0/${card.pon}`} />
                    <InfoBox icon={Hash} label="ONU ID" value={card.onuId || "—"} />
                    <InfoBox icon={Fingerprint} label="Serie / SN" value={card.serial || "—"} />
                    <InfoBox icon={Server} label="Modelo ONU" value={card.model || "—"} />
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <InfoBox icon={Activity} label="Potencia RX" value={card.rx || "—"} valueClass={rxUi.cls} />
                    <InfoBox icon={Radio} label="Potencia TX" value={card.tx || "—"} />
                    <InfoBox icon={Layers} label="VLAN" value={shownVlan || "—"} />
                    <InfoBox icon={Wifi} label="Velocidad" value={card.speed || card.client?.plan_name || "—"} />
                  </div>

                  <div>
                    <div className="flex items-center justify-between text-[10px] mb-1.5">
                      <span className="text-slate-500">Nivel RX</span>
                      <span className={rxUi.cls}>{rxUi.label}{card.rx ? ` · ${card.rx}` : ""}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${rxUi.bar}`} style={{ width: `${rxUi.pct}%` }} />
                    </div>
                    <p className="text-[9px] text-slate-600 mt-1">Indicador visual aproximado; los límites exactos dependen del módulo/ONU.</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <InfoBox icon={User} label="Cliente" value={card.client?.full_name || "Sin asociar"} mono={false} valueClass={card.client ? "text-cyan-300" : "text-amber-300"} />
                    <InfoBox icon={Server} label="Perfil OLT" value={card.profile || card.mode || "—"} />
                  </div>

                  {card.client && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <InfoBox label="IP cliente" value={card.client.ip_address || "—"} />
                      <InfoBox label="NAP" value={card.client.nap_box || "—"} />
                      <InfoBox label="Estado servicio" value={card.client.status || "—"} valueClass={card.client.status === "active" ? "text-emerald-300" : "text-amber-300"} />
                    </div>
                  )}

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/70">
                    <button
                      onClick={() => loadDetail(card)}
                      disabled={!card.onuId || detailLoading[card.key]}
                      className="px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-[11px] text-slate-300 flex items-center gap-1.5 disabled:opacity-40"
                    >
                      {detailLoading[card.key] ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : detail?.open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      {detail?.open ? "Ocultar detalle" : "Ver VLAN y detalle"}
                    </button>

                    <div className="flex items-center gap-1.5">
                      <button title="Reiniciar ONU" onClick={() => runAction("reboot", card)} disabled={!card.onuId || actionBusy === `reboot-${card.key}`} className="p-2 rounded-lg border border-slate-700 text-cyan-300 hover:bg-cyan-950/30 disabled:opacity-40"><RotateCw className="w-3.5 h-3.5" /></button>
                      <button title="Activar ONU" onClick={() => runAction("activate", card)} disabled={!card.onuId || actionBusy === `activate-${card.key}`} className="p-2 rounded-lg border border-slate-700 text-emerald-300 hover:bg-emerald-950/30 disabled:opacity-40"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                      <button title="Desactivar ONU" onClick={() => runAction("deactivate", card)} disabled={!card.onuId || actionBusy === `deactivate-${card.key}`} className="p-2 rounded-lg border border-slate-700 text-amber-300 hover:bg-amber-950/20 disabled:opacity-40"><Power className="w-3.5 h-3.5" /></button>
                      <button title="Eliminar ONU" onClick={() => runAction("delete", card)} disabled={!card.onuId || actionBusy === `delete-${card.key}`} className="p-2 rounded-lg border border-slate-700 text-rose-400 hover:bg-rose-950/30 disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>

                  {detail?.open && (
                    <div className="rounded-xl border border-slate-800 bg-black/20 p-3">
                      <p className="text-[10px] uppercase tracking-wider text-cyan-400 mb-2">Detalle leído directamente de la OLT</p>
                      {Object.keys(detailInfo).length ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                          {Object.entries(detailInfo).map(([key, value]) => (
                            <div key={key} className="flex items-start justify-between gap-3 text-[10px] border-b border-slate-800/50 pb-1">
                              <span className="text-slate-500">{key}</span>
                              <span className="text-slate-200 font-mono text-right break-all">{textOf(value)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500">La OLT no devolvió pares clave/valor para esta ONU.</p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-8 rounded-2xl border border-dashed border-slate-800 text-center text-xs text-slate-500">
          No hay ONUs que coincidan con el filtro actual.
        </div>
      )}
    </div>
  );
}

const SummaryCard = ({ icon: Icon, label, value, valueClass = "text-slate-100" }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-3.5">
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`text-xl font-bold font-mono mt-1 ${valueClass}`}>{value}</p>
      </div>
      <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400">
        <Icon className="w-4 h-4" />
      </div>
    </div>
  </div>
);
