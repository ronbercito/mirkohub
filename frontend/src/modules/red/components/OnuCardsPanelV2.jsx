/**
 * Vista gráfica/expandible de ONUs VSOL.
 * Usa las filas canónicas del backend y, al abrir una ONU, muestra TODO lo
 * devuelto por la OLT: detalle, configuración/VLAN, óptica, capability,
 * GEMPORT y TCONT, además de acciones operativas.
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

const text = (v) => String(v ?? "").trim();
const norm = (v) => text(v).toLowerCase().replace(/[^a-z0-9]/g, "");

const cleanName = (v) => {
  const s = text(v);
  if (!s || s === "-" || /^none$/i.test(s)) return "";
  return s.replace(/_/g, " ").replace(/\s+/g, " ").trim();
};

const byKey = (obj, patterns) => {
  if (!obj) return "";
  for (const pattern of patterns) {
    const key = Object.keys(obj).find((k) => pattern.test(String(k)));
    if (key) {
      const value = obj[key];
      if (value !== null && typeof value === "object") continue;
      return text(value);
    }
  }
  return "";
};

const parseIndex = (row, selectedPon) => {
  const raw = text(row?.ONUIndex || row?.["ONU ID"] || "");
  const match = raw.match(/(?:GPON|EPON)?\s*0\/(\d+)\s*:\s*(\d+)/i);
  if (match) {
    return { pon: Number(match[1]), onuId: Number(match[2]), raw };
  }
  const p = text(row?.PON).match(/0\/(\d+)/);
  const id = Number(row?.["ONU ID"] || 0);
  return {
    pon: p ? Number(p[1]) : Number(selectedPon),
    onuId: Number.isFinite(id) ? id : 0,
    raw: raw || `GPON0/${selectedPon}:${id || 0}`,
  };
};

const parseDbm = (v) => {
  const m = text(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const statusInfo = (value, rx = "") => {
  const s = text(value).toLowerCase();
  if (/online|active|registered|working|^up$/.test(s)) {
    return {
      id: "online",
      label: "ONLINE",
      cls: "text-emerald-300 bg-emerald-950/40 border-emerald-800/60",
    };
  }
  if (/offline|inactive|los|disable|^down$/.test(s)) {
    return {
      id: "offline",
      label: "OFFLINE",
      cls: "text-rose-300 bg-rose-950/40 border-rose-800/60",
    };
  }
  if (parseDbm(rx) !== null) {
    return {
      id: "online",
      label: "ONLINE",
      cls: "text-emerald-300 bg-emerald-950/40 border-emerald-800/60",
    };
  }
  return {
    id: "unknown",
    label: "SIN ESTADO",
    cls: "text-slate-300 bg-slate-800/70 border-slate-700",
  };
};

const rxInfo = (value) => {
  const n = parseDbm(value);
  if (n === null) {
    return { pct: 0, label: "Sin lectura", cls: "text-slate-400", bar: "bg-slate-700" };
  }
  const pct = Math.max(4, Math.min(100, ((n + 35) / 27) * 100));
  if (n >= -25) return { pct, label: "Buena", cls: "text-emerald-300", bar: "bg-emerald-400" };
  if (n >= -28) return { pct, label: "Media", cls: "text-amber-300", bar: "bg-amber-400" };
  return { pct, label: "Baja", cls: "text-rose-300", bar: "bg-rose-400" };
};

const Info = ({ icon: Icon, label, value, mono = true, valueClass = "text-slate-100", sub = "" }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/55 p-2.5 min-w-0">
    <p className="text-[9px] uppercase tracking-wider text-slate-500 flex items-center gap-1">
      {Icon && <Icon className="w-3 h-3" />} {label}
    </p>
    <p
      className={`mt-1 text-[11px] font-semibold break-words ${mono ? "font-mono" : ""} ${valueClass}`}
      title={text(value)}
    >
      {value || "—"}
    </p>
    {sub ? <p className="mt-0.5 text-[9px] text-slate-600 truncate">{sub}</p> : null}
  </div>
);

const Mini = ({ label, value, valueClass = "text-slate-100" }) => (
  <div className="min-w-0">
    <p className="text-[8px] uppercase tracking-wider text-slate-600">{label}</p>
    <p className={`text-[10px] font-bold font-mono truncate ${valueClass}`} title={text(value)}>
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
      <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400">
        <Icon className="w-4 h-4" />
      </div>
    </div>
  </div>
);

const ActionButton = ({ icon: Icon, label, className, onClick, disabled }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={`px-3 py-2 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-40 ${className}`}
  >
    <Icon className={`w-3.5 h-3.5 ${disabled ? "animate-pulse" : ""}`} />
    {label}
  </button>
);

const CliSections = ({ sections }) => {
  const entries = Object.entries(sections || {}).filter(([, value]) => text(value));
  if (!entries.length) return null;

  const labels = {
    AUTH: "Autorización / ONU Info",
    DETAIL: "Detalle ONU",
    DESCRIPTION: "Descripción",
    "RUNNING CONFIG": "Configuración / VLAN / Servicio",
    OPTICAL: "Óptica",
    CAPABILITY: "Capacidades",
    GEMPORT: "GEMPORT",
    TCONT: "TCONT",
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] uppercase tracking-wider text-cyan-400">
        Información completa devuelta por la OLT
      </p>
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
        {entries.map(([name, body]) => (
          <details
            key={name}
            className="rounded-xl border border-slate-800 bg-black/25 overflow-hidden"
            open={name === "RUNNING CONFIG" || name === "OPTICAL"}
          >
            <summary className="cursor-pointer select-none px-3 py-2 text-[10px] font-semibold text-slate-300 hover:bg-slate-900/70">
              {labels[name] || name}
            </summary>
            <pre className="border-t border-slate-800 p-3 text-[10px] text-slate-300 font-mono whitespace-pre-wrap break-words max-h-64 overflow-auto">
              {text(body)}
            </pre>
          </details>
        ))}
      </div>
    </div>
  );
};

export default function OnuCardsPanelV2({ router, pon, rows = [], onAction, onRefresh }) {
  const { API, token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState({});
  const [details, setDetails] = useState({});
  const [detailLoading, setDetailLoading] = useState({});
  const [actionBusy, setActionBusy] = useState("");
  const [loadingExtra, setLoadingExtra] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoadingExtra(true);
      try {
        const [clientsRes, plansRes] = await Promise.all([
          axios.get(`${API}/clients`, { headers }),
          axios.get(`${API}/plans`, { headers }),
        ]);
        if (!alive) return;
        setClients(Array.isArray(clientsRes.data) ? clientsRes.data : []);
        setPlans(Array.isArray(plansRes.data) ? plansRes.data : []);
      } catch (e) {
        console.warn("No se pudo cargar clientes/planes para enriquecer ONUs", e);
      } finally {
        if (alive) setLoadingExtra(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [API, headers]);

  useEffect(() => {
    setExpanded({});
    setDetails({});
    setDetailLoading({});
  }, [router.id, pon]);

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);

  const cards = useMemo(() => rows.map((row, index) => {
    const idx = parseIndex(row, pon);
    const serial = text(row.Info || byKey(row, [/authinfo/i, /^sn$/i, /serial/i]));
    const serialNorm = norm(serial);

    const client = clients.find((c) => {
      const sn = norm(c.onu_sn);
      return sn && serialNorm && (sn === serialNorm || sn.includes(serialNorm) || serialNorm.includes(sn));
    }) || null;

    const plan = client ? planById.get(client.plan_id) : null;
    const down = plan?.download_speed_mbps;
    const up = plan?.upload_speed_mbps;
    const speed = down || up ? `${down || 0}↓ / ${up || 0}↑ Mbps` : "";

    const rx = text(row.RxPower || byKey(row, [/rx\s*power/i, /rxpower/i]));
    const tx = text(row.TxPower || byKey(row, [/tx\s*power/i, /txpower/i]));
    const status = statusInfo(row.Status, rx);
    const description = cleanName(row.Description);

    return {
      key: `${idx.pon}-${idx.onuId || index}`,
      idx,
      row,
      serial,
      client,
      plan,
      speed,
      rx,
      tx,
      status,
      description,
      model: text(row.Model),
      profile: text(row.Profile),
      mode: text(row.Mode),
    };
  }), [rows, pon, clients, planById]);

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
        c.client?.full_name,
        c.client?.dni_ruc,
        c.client?.ip_address,
        c.serial,
        c.model,
        c.profile,
        c.mode,
        c.idx.raw,
        c.idx.onuId,
        c.plan?.name,
      ].join(" ")).includes(q);
    });
  }, [cards, search, filter]);

  const loadDetail = async (card, force = false) => {
    if (!card.idx.onuId) return;
    if (!force && details[card.key]?.loaded) return;

    setDetailLoading((prev) => ({ ...prev, [card.key]: true }));
    try {
      const response = await axios.get(
        `${API}/routers/${router.id}/olt/onu_detail?pon=${card.idx.pon}&onu=${card.idx.onuId}`,
        { headers }
      );
      if (!response.data?.ok) throw new Error(response.data?.error || "Sin detalle");

      setDetails((prev) => ({
        ...prev,
        [card.key]: {
          loaded: true,
          info: response.data.info || {},
          raw: response.data.raw || "",
        },
      }));
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "No se pudo leer el detalle de la ONU");
    } finally {
      setDetailLoading((prev) => ({ ...prev, [card.key]: false }));
    }
  };

  const toggle = async (card) => {
    const next = !expanded[card.key];
    setExpanded((prev) => ({ ...prev, [card.key]: next }));
    if (next) await loadDetail(card);
  };

  const refreshAll = async () => {
    setDetails({});
    if (onRefresh) await onRefresh();
  };

  const runAction = async (action, card) => {
    const busy = `${action}-${card.key}`;
    setActionBusy(busy);
    try {
      await onAction(action, card.idx.onuId, card.serial);
      setDetails((prev) => ({ ...prev, [card.key]: undefined }));
    } finally {
      setActionBusy("");
    }
  };

  return (
    <div className="space-y-4" data-testid="onu-cards-panel-v3">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Summary icon={Radio} label="ONUs en este PON" value={counts.total} />
        <Summary icon={Wifi} label="Online" value={counts.online} valueClass="text-emerald-300" />
        <Summary icon={Power} label="Offline" value={counts.offline} valueClass={counts.offline ? "text-rose-300" : "text-slate-100"} />
        <Summary icon={User} label="Con nombre en OLT" value={counts.named} valueClass="text-cyan-300" />
      </div>

      <div className="flex flex-col lg:flex-row gap-3 lg:items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/50 p-3">
        <div className="relative flex-1 max-w-2xl">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar nombre VSOL, cliente, serie, modelo, ONU ID, perfil..."
            className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-600"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {[
            ["all", `Todas ${counts.total}`],
            ["online", `Online ${counts.online}`],
            ["offline", `Offline ${counts.offline}`],
          ].map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition ${
                filter === id
                  ? "bg-cyan-950/60 text-cyan-300 border-cyan-700/60"
                  : "bg-slate-900 text-slate-400 border-slate-800 hover:text-slate-200"
              }`}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={refreshAll}
            title="Actualizar inventario ONU"
            className="p-2 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loadingExtra ? "animate-spin text-cyan-400" : ""}`} />
          </button>
        </div>
      </div>

      {filtered.length ? (
        <div className="space-y-3">
          {filtered.map((card) => {
            const open = Boolean(expanded[card.key]);
            const detail = details[card.key] || {};
            const info = detail.info || {};
            const sections = info._sections && typeof info._sections === "object" ? info._sections : {};

            const detailName = cleanName(byKey(info, [/description/i, /^name$/i]));
            const shownName = detailName || card.description || card.client?.full_name || `ONU ${card.idx.onuId}`;
            const shownSerial = byKey(info, [/^sn$/i, /serial/i, /auth\s*info/i, /authinfo/i]) || card.serial;
            const shownModel = byKey(info, [/model/i, /product/i, /^type$/i]) || card.model;
            const shownVlan = byKey(info, [/^vlan$/i, /uservlan/i, /cvlan/i, /def_vlan/i]);
            const shownRx = byKey(info, [/rx\s*power/i, /rxpower/i, /^rx$/i]) || card.rx;
            const shownTx = byKey(info, [/tx\s*power/i, /txpower/i, /^tx$/i]) || card.tx;
            const detailStatus = byKey(info, [/^status$/i, /^state$/i, /run\s*state/i]);
            const status = statusInfo(detailStatus || card.row.Status, shownRx);
            const rx = rxInfo(shownRx);

            const planName = card.plan?.name || card.client?.plan_name || "";
            const trafficUp = byKey(info, [/upstream profile/i, /upstream/i]);
            const trafficDown = byKey(info, [/downstream profile/i, /downstream/i]);
            const speedLabel = card.speed
              || (planName ? planName : "")
              || ([trafficDown, trafficUp].filter(Boolean).join(" / "))
              || "No asociado";

            const scalarInfo = Object.entries(info).filter(
              ([key, value]) => key !== "_sections" && (value === null || typeof value !== "object")
            );

            return (
              <div
                key={card.key}
                className={`rounded-2xl border bg-slate-950/55 overflow-hidden transition ${
                  open ? "border-cyan-800/60 shadow-lg shadow-cyan-950/10" : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(card)}
                  className="w-full text-left p-4 bg-slate-900/40 hover:bg-slate-900/65 transition"
                >
                  <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
                    <div className="min-w-0 flex items-center gap-3 flex-1">
                      <div className="w-10 h-10 rounded-xl border border-cyan-800/50 bg-cyan-950/30 text-cyan-300 flex items-center justify-center shrink-0">
                        <Radio className="w-5 h-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-sm font-bold text-slate-100 truncate" title={shownName}>
                          {shownName}
                        </h4>
                        <p className="text-[11px] text-slate-400 mt-0.5 truncate">
                          {card.description
                            ? "Nombre configurado en la OLT"
                            : card.client
                              ? "Cliente vinculado por SN"
                              : "Sin descripción detectada"}
                        </p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 lg:min-w-[610px]">
                      <Mini label="PON" value={`0/${card.idx.pon}`} />
                      <Mini label="ONU ID" value={card.idx.onuId || "—"} />
                      <Mini label="Modelo" value={shownModel || "—"} />
                      <Mini label="RX" value={shownRx || "—"} valueClass={rx.cls} />
                      <div className="flex items-center justify-end gap-2">
                        <span className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${status.cls}`}>
                          {status.label}
                        </span>
                        {open ? <ChevronUp className="w-4 h-4 text-cyan-300" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                      </div>
                    </div>
                  </div>
                </button>

                {open && (
                  <div className="p-4 space-y-4 border-t border-slate-800/80">
                    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                      <Info icon={Layers} label="Puerto PON" value={`0/${card.idx.pon}`} />
                      <Info icon={Hash} label="ONU ID" value={card.idx.onuId || "—"} />
                      <Info icon={Fingerprint} label="Serie / SN" value={shownSerial || "—"} />
                      <Info icon={Server} label="Modelo ONU" value={shownModel || "—"} />
                      <Info icon={Server} label="Perfil OLT" value={card.profile || "—"} />
                      <Info icon={Activity} label="Modo" value={card.mode || "—"} />
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <Info icon={Gauge} label="Potencia RX" value={shownRx || "—"} valueClass={rx.cls} />
                      <Info icon={Radio} label="Potencia TX" value={shownTx || "—"} />
                      <Info icon={Layers} label="VLAN" value={detailLoading[card.key] ? "Consultando..." : shownVlan || "No detectada"} />
                      <Info icon={Wifi} label="Velocidad / Plan" value={speedLabel} mono={false} />
                    </div>

                    <div>
                      <div className="flex justify-between items-center text-[10px] mb-1.5">
                        <span className="text-slate-500">Nivel óptico RX</span>
                        <span className={rx.cls}>{rx.label}{shownRx ? ` · ${shownRx}` : ""}</span>
                      </div>
                      <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                        <div className={`h-full rounded-full ${rx.bar}`} style={{ width: `${rx.pct}%` }} />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <Info
                        icon={User}
                        label="Nombre en VSOL"
                        value={shownName}
                        mono={false}
                        valueClass={card.description || detailName ? "text-cyan-300" : "text-slate-100"}
                      />
                      <Info
                        icon={User}
                        label="Cliente en MikroHub"
                        value={card.client?.full_name || "Sin vincular por SN"}
                        mono={false}
                        valueClass={card.client ? "text-emerald-300" : "text-amber-300"}
                        sub={card.client?.ip_address ? `IP ${card.client.ip_address}` : ""}
                      />
                    </div>

                    {card.client && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Info label="Plan" value={planName || "—"} mono={false} />
                        <Info label="Velocidad" value={card.speed || "—"} />
                        <Info label="IP cliente" value={card.client.ip_address || "—"} />
                        <Info label="NAP" value={card.client.nap_box || "—"} />
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-800 bg-black/20 p-3">
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-cyan-400">
                            Datos técnicos detectados
                          </p>
                          <p className="text-[9px] text-slate-600 mt-0.5">
                            Se consultan al desplegar la ONU para no saturar el Telnet.
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => loadDetail(card, true)}
                          disabled={detailLoading[card.key]}
                          className="px-2 py-1 rounded-lg border border-slate-700 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-40"
                        >
                          {detailLoading[card.key] ? "Consultando..." : "Actualizar detalle"}
                        </button>
                      </div>

                      {detailLoading[card.key] && !detail.loaded ? (
                        <p className="text-[11px] text-slate-500">
                          Consultando autorización, detalle, VLAN, óptica, capability, GEMPORT y TCONT...
                        </p>
                      ) : scalarInfo.length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                          {scalarInfo.map(([key, value]) => (
                            <div key={key} className="rounded-lg border border-slate-800/70 bg-slate-950/50 px-2.5 py-2">
                              <p className="text-[9px] uppercase tracking-wider text-slate-600">{key}</p>
                              <p className="text-[10px] text-slate-200 font-mono mt-1 break-all">{text(value) || "—"}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          La OLT todavía no devolvió campos estructurados para esta ONU.
                        </p>
                      )}
                    </div>

                    <CliSections sections={sections} />

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/70">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">Acciones</span>
                      <ActionButton
                        label="Reiniciar"
                        icon={RotateCw}
                        className="text-cyan-300 border-cyan-800/50 hover:bg-cyan-950/30"
                        disabled={actionBusy === `reboot-${card.key}` || !card.idx.onuId}
                        onClick={() => runAction("reboot", card)}
                      />
                      <ActionButton
                        label="Activar"
                        icon={CheckCircle2}
                        className="text-emerald-300 border-emerald-800/50 hover:bg-emerald-950/30"
                        disabled={actionBusy === `activate-${card.key}` || !card.idx.onuId}
                        onClick={() => runAction("activate", card)}
                      />
                      <ActionButton
                        label="Desactivar"
                        icon={Power}
                        className="text-amber-300 border-amber-800/50 hover:bg-amber-950/20"
                        disabled={actionBusy === `deactivate-${card.key}` || !card.idx.onuId}
                        onClick={() => runAction("deactivate", card)}
                      />
                      <ActionButton
                        label="Eliminar"
                        icon={Trash2}
                        className="text-rose-300 border-rose-800/50 hover:bg-rose-950/30"
                        disabled={actionBusy === `delete-${card.key}` || !card.idx.onuId}
                        onClick={() => runAction("delete", card)}
                      />
                    </div>
                  </div>
                )}
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
