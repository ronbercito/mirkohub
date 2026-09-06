/**
 * Vista gráfica y expandible para ONUs VSOL.
 *
 * Consume filas canónicas del backend (ONUIndex, Status, Description, Model,
 * Profile, Mode, Info, PON, ONU ID), cruza SN con clientes/planes y consulta
 * potencia del PON en bloque. El detalle pesado (VLAN/running-config/óptica
 * individual) se consulta sólo cuando el usuario abre una ONU.
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

const byKey = (obj, patterns) => {
  if (!obj) return "";
  for (const pattern of patterns) {
    const key = Object.keys(obj).find((k) => pattern.test(String(k)));
    if (key) return text(obj[key]);
  }
  return "";
};

const cleanName = (v) => {
  const value = text(v);
  if (!value || value === "-" || /^none$/i.test(value)) return "";
  return value.replace(/_/g, " ").replace(/\s+/g, " ").trim();
};

const parseIndex = (row, selectedPon) => {
  const raw = text(row?.ONUIndex || row?.["ONU ID"] || "");
  const m = raw.match(/(?:GPON|EPON)?\s*0\/(\d+)\s*:\s*(\d+)/i);
  if (m) return { pon: Number(m[1]), onuId: Number(m[2]), raw: raw.replace(/\s+/g, "") };

  const explicitPon = text(row?.PON).match(/0\/(\d+)/);
  const explicitId = Number(row?.["ONU ID"]);
  return {
    pon: explicitPon ? Number(explicitPon[1]) : Number(selectedPon),
    onuId: Number.isFinite(explicitId) ? explicitId : 0,
    raw: raw || `GPON0/${selectedPon}:${explicitId || 0}`,
  };
};

const parseDbm = (v) => {
  const m = text(v).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};

const opticalMap = (payload, selectedPon) => {
  const map = new Map();
  const rows = payload?.rows || [];

  for (const row of rows) {
    const idx = parseIndex(row, selectedPon);
    if (!idx.onuId) continue;
    map.set(idx.onuId, {
      rx: byKey(row, [/rx\s*power/i, /rxpower/i, /^rx$/i]),
      tx: byKey(row, [/tx\s*power/i, /txpower/i, /^tx$/i]),
    });
  }

  for (const original of text(payload?.raw).replace(/\r/g, "").split("\n")) {
    const line = original.trim();
    if (!line) continue;

    let onuId = 0;
    let tail = line;

    const indexed = line.match(/(?:GPON|EPON)?\s*0\/(\d+)\s*[:/]\s*(\d+)/i);
    if (indexed) {
      if (Number(indexed[1]) !== Number(selectedPon)) continue;
      onuId = Number(indexed[2]);
      tail = line.slice(indexed.index + indexed[0].length);
    } else {
      const first = line.match(/^(\d{1,3})\s+(.+)$/);
      if (!first) continue;
      onuId = Number(first[1]);
      tail = first[2];
    }

    if (!onuId) continue;
    const nums = (tail.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
    const rx = nums.find((n) => n < 0);
    const positive = nums.find((n) => n >= 0 && n <= 15);
    const current = map.get(onuId) || {};
    if (!current.rx && rx !== undefined) current.rx = `${rx} dBm`;
    if (!current.tx && positive !== undefined) current.tx = `${positive} dBm`;
    map.set(onuId, current);
  }

  return map;
};

const statusInfo = (value, rx = "") => {
  const v = text(value).toLowerCase();
  if (/online|active|up|working|registered/.test(v)) {
    return { id: "online", label: "ONLINE", cls: "text-emerald-300 bg-emerald-950/40 border-emerald-800/60" };
  }
  if (/offline|down|los|inactive|disable/.test(v)) {
    return { id: "offline", label: "OFFLINE", cls: "text-rose-300 bg-rose-950/40 border-rose-800/60" };
  }
  if (parseDbm(rx) !== null) {
    return { id: "online", label: "ONLINE", cls: "text-emerald-300 bg-emerald-950/40 border-emerald-800/60" };
  }
  return { id: "unknown", label: "SIN ESTADO", cls: "text-slate-300 bg-slate-800/70 border-slate-700" };
};

const rxUi = (value) => {
  const n = parseDbm(value);
  if (n === null) return { pct: 0, label: "Sin lectura", cls: "text-slate-400", bar: "bg-slate-700" };
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
    <p className={`mt-1 text-[11px] font-semibold break-words ${mono ? "font-mono" : ""} ${valueClass}`} title={text(value)}>
      {value || "—"}
    </p>
    {sub ? <p className="mt-0.5 text-[9px] text-slate-600 truncate">{sub}</p> : null}
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
  const [details, setDetails] = useState({});
  const [detailLoading, setDetailLoading] = useState({});
  const [actionBusy, setActionBusy] = useState("");

  useEffect(() => {
    let alive = true;

    const loadExtras = async () => {
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
        setOptical(opticalRes.data?.ok ? opticalMap(opticalRes.data, pon) : new Map());
      } catch (e) {
        if (alive) {
          console.warn("No se pudo cargar información complementaria de ONUs", e);
          setOptical(new Map());
        }
      } finally {
        if (alive) setLoadingExtra(false);
      }
    };

    loadExtras();
    return () => { alive = false; };
  }, [API, headers, router.id, pon, extraTick]);

  useEffect(() => {
    setExpanded({});
    setDetails({});
    setDetailLoading({});
  }, [router.id, pon]);

  const planById = useMemo(() => new Map(plans.map((p) => [p.id, p])), [plans]);

  const cards = useMemo(() => rows.map((row, index) => {
    const idx = parseIndex(row, pon);
    const opt = optical.get(idx.onuId) || {};
    const serial = text(row.Info || byKey(row, [/authinfo/i, /^sn$/i, /serial/i]));
    const serialNorm = norm(serial);

    const client = clients.find((c) => {
      const clientSn = norm(c.onu_sn);
      if (!clientSn || !serialNorm) return false;
      return clientSn === serialNorm || clientSn.includes(serialNorm) || serialNorm.includes(clientSn);
    }) || null;

    const plan = client ? planById.get(client.plan_id) : null;
    const down = plan?.download_speed_mbps;
    const up = plan?.upload_speed_mbps;
    const speed = down || up ? `${down || 0}↓ / ${up || 0}↑ Mbps` : "";

    const description = cleanName(row.Description);
    const rx = opt.rx || byKey(row, [/rx\s*power/i, /rxpower/i]);
    const tx = opt.tx || byKey(row, [/tx\s*power/i, /txpower/i]);
    const status = statusInfo(row.Status, rx);

    return {
      key: `${idx.pon}-${idx.onuId || index}`,
      idx,
      row,
      serial,
      client,
      plan,
      speed,
      description,
      model: text(row.Model),
      profile: text(row.Profile),
      mode: text(row.Mode),
      rx,
      tx,
      status,
    };
  }), [rows, pon, optical, clients, planById]);

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

  const loadDetail = async (card) => {
    if (!card.idx.onuId || details[card.key]?.loaded) return;

    setDetailLoading((prev) => ({ ...prev, [card.key]: true }));
    try {
      const r = await axios.get(
        `${API}/routers/${router.id}/olt/onu_detail?pon=${pon}&onu=${card.idx.onuId}`,
        { headers }
      );
      if (!r.data?.ok) throw new Error(r.data?.error || "Sin detalle");

      setDetails((prev) => ({
        ...prev,
        [card.key]: {
          loaded: true,
          info: r.data.info || {},
          raw: r.data.raw || "",
        },
      }));
    } catch (e) {
      toast.error(e?.response?.data?.detail || e?.message || "No se pudo leer el detalle de la ONU");
    } finally {
      setDetailLoading((prev) => ({ ...prev, [card.key]: false }));
    }
  };

  const toggleCard = async (card) => {
    const next = !expanded[card.key];
    setExpanded((prev) => ({ ...prev, [card.key]: next }));
    if (next) await loadDetail(card);
  };

  const refreshAll = async () => {
    setExtraTick((n) => n + 1);
    if (onRefresh) await onRefresh();
  };

  const runAction = async (action, card) => {
    const busyKey = `${action}-${card.key}`;
    setActionBusy(busyKey);
    try {
      await onAction(action, card.idx.onuId, card.serial);
      setExtraTick((n) => n + 1);
    } finally {
      setActionBusy("");
    }
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
            onClick={refreshAll}
            title="Actualizar ONUs y potencia"
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

            const detailName = cleanName(byKey(info, [/description/i, /^name$/i]));
            const shownName = detailName || card.description || card.client?.full_name || `ONU ${card.idx.onuId}`;
            const shownSerial = byKey(info, [/^sn$/i, /serial/i, /auth/i]) || card.serial;
            const shownModel = byKey(info, [/model/i, /product/i, /^type$/i]) || card.model;
            const shownVlan = byKey(info, [/^vlan$/i, /uservlan/i, /cvlan/i, /def_vlan/i]);
            const detailRx = byKey(info, [/rx\s*power/i, /rxpower/i, /^rx$/i]);
            const detailTx = byKey(info, [/tx\s*power/i, /txpower/i, /^tx$/i]);
            const shownRx = detailRx || card.rx;
            const shownTx = detailTx || card.tx;
            const detailStatus = byKey(info, [/^status$/i, /^state$/i]);
            const st = statusInfo(detailStatus || card.row.Status, shownRx);
            const rx = rxUi(shownRx);

            const planName = card.plan?.name || card.client?.plan_name || "";
            const speedLabel = card.speed || (planName ? planName : "No asociado");

            return (
              <div
                key={card.key}
                className={`rounded-2xl border bg-slate-950/55 overflow-hidden transition ${
                  open ? "border-cyan-800/60 shadow-lg shadow-cyan-950/10" : "border-slate-800 hover:border-slate-700"
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggleCard(card)}
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
                            ? "Nombre configurado directamente en la OLT"
                            : card.client
                              ? "Cliente vinculado por número de serie"
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
                        <span className={`px-2 py-1 rounded-lg border text-[10px] font-bold ${st.cls}`}>
                          {st.label}
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
                      <Info icon={Activity} label="Potencia RX" value={shownRx || "—"} valueClass={rx.cls} />
                      <Info icon={Radio} label="Potencia TX" value={shownTx || "—"} />
                      <Info
                        icon={Layers}
                        label="VLAN"
                        value={detailLoading[card.key] ? "Consultando..." : shownVlan || "No devuelta por CLI"}
                      />
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
                      <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
                        <Info label="Plan" value={planName || "—"} mono={false} />
                        <Info label="Velocidad" value={card.speed || "—"} />
                        <Info label="IP cliente" value={card.client.ip_address || "—"} />
                        <Info label="NAP" value={card.client.nap_box || "—"} />
                      </div>
                    )}

                    <div className="rounded-xl border border-slate-800 bg-black/20 p-3">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <p className="text-[10px] uppercase tracking-wider text-cyan-400">
                          Información detallada de la OLT
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setDetails((prev) => ({ ...prev, [card.key]: undefined }));
                            loadDetail(card);
                          }}
                          disabled={detailLoading[card.key]}
                          className="px-2 py-1 rounded-lg border border-slate-700 text-[10px] text-slate-300 hover:bg-slate-800"
                        >
                          {detailLoading[card.key] ? "Consultando..." : "Actualizar detalle"}
                        </button>
                      </div>

                      {detailLoading[card.key] ? (
                        <p className="text-[11px] text-slate-500">Consultando descripción, configuración, VLAN y óptica...</p>
                      ) : Object.keys(info).length ? (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-1.5">
                          {Object.entries(info).map(([k, v]) => (
                            <div key={k} className="flex items-start justify-between gap-3 text-[10px] border-b border-slate-800/50 pb-1">
                              <span className="text-slate-500">{k}</span>
                              <span className="text-slate-200 font-mono text-right break-all">{text(v)}</span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-500">
                          La OLT todavía no devolvió detalle para esta ONU.
                        </p>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/70">
                      <span className="text-[10px] uppercase tracking-wider text-slate-500 mr-1">Acciones</span>
                      <ActionButton
                        label="Reiniciar"
                        icon={RotateCw}
                        cls="text-cyan-300 border-cyan-800/50 hover:bg-cyan-950/30"
                        busy={actionBusy === `reboot-${card.key}`}
                        onClick={() => runAction("reboot", card)}
                      />
                      <ActionButton
                        label="Activar"
                        icon={CheckCircle2}
                        cls="text-emerald-300 border-emerald-800/50 hover:bg-emerald-950/30"
                        busy={actionBusy === `activate-${card.key}`}
                        onClick={() => runAction("activate", card)}
                      />
                      <ActionButton
                        label="Desactivar"
                        icon={Power}
                        cls="text-amber-300 border-amber-800/50 hover:bg-amber-950/20"
                        busy={actionBusy === `deactivate-${card.key}`}
                        onClick={() => runAction("deactivate", card)}
                      />
                      <ActionButton
                        label="Eliminar"
                        icon={Trash2}
                        cls="text-rose-300 border-rose-800/50 hover:bg-rose-950/30"
                        busy={actionBusy === `delete-${card.key}`}
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

const Mini = ({ label, value, valueClass = "text-slate-100" }) => (
  <div className="min-w-0">
    <p className="text-[8px] uppercase tracking-wider text-slate-600">{label}</p>
    <p className={`text-[10px] font-mono font-semibold truncate ${valueClass}`} title={text(value)}>
      {value || "—"}
    </p>
  </div>
);

const ActionButton = ({ label, icon: Icon, cls, busy, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className={`px-3 py-1.5 rounded-lg border text-[11px] font-semibold flex items-center gap-1.5 disabled:opacity-40 ${cls}`}
  >
    <Icon className={`w-3.5 h-3.5 ${busy ? "animate-spin" : ""}`} />
    {label}
  </button>
);
