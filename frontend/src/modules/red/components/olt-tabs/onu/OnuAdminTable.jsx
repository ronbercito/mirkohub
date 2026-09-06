/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu/OnuAdminTable.jsx
 * Pertenece a: Red > OLT > ONUs > Lista de ONU.
 * Función: Presenta las ONUs en tabla tipo VSOL/AdminOLT y obtiene la lista canónica
 *          desde /olt/onu-inventory, donde ONU ID y estados vienen de `show onu state`.
 * Regla: Este archivo SOLO controla la lista de ONUs. No modificar Resumen, Puertos PON,
 *        Auto-find, Óptica ONU, Consola ni la conexión CLI desde este componente.
 */
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  CheckCircle2,
  Eye,
  Power,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
} from "lucide-react";
import { useAuth } from "../../../../../context/AuthContext";

const text = (value) => String(value ?? "").trim();
const norm = (value) => text(value).toLowerCase().replace(/[^a-z0-9]/g, "");

const pick = (row, keys, fallback = "") => {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== null && value !== undefined && text(value)) return text(value);
  }
  return fallback;
};

const statusOf = (row) => {
  const status = text(row?.Status).toLowerCase();
  const phase = text(row?.["Phase State"]).toLowerCase();
  const combined = `${status} ${phase}`;

  if (/working|online|registered|\bup\b/.test(combined)) {
    return { id: "online", label: "Online", cls: "text-emerald-300" };
  }
  if (/offline|los|down|inactive|deregistered/.test(combined)) {
    return { id: "offline", label: "Offline", cls: "text-rose-300" };
  }
  return { id: "unknown", label: "Sin estado", cls: "text-slate-400" };
};

const Cell = ({ children, mono = false, className = "" }) => (
  <td className={`px-3 py-3 align-top border-b border-slate-800/70 text-[11px] text-slate-200 ${mono ? "font-mono" : ""} ${className}`}>
    {children || <span className="text-slate-600">—</span>}
  </td>
);

export default function OnuAdminTable({ router, pon, rows = [], onAction, onRefresh }) {
  const { API, token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);

  const [inventoryRows, setInventoryRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState({});
  const [busy, setBusy] = useState("");

  const loadInventory = async () => {
    if (!router?.id) return;
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(
        `${API}/routers/${router.id}/olt/onu-inventory?pon=${pon}`,
        { headers }
      );
      if (!response.data?.ok) {
        throw new Error(response.data?.error || "La OLT no devolvió inventario ONU válido");
      }
      setInventoryRows(Array.isArray(response.data.rows) ? response.data.rows : []);
    } catch (e) {
      console.warn("No se pudo cargar inventario ONU canónico", e);
      setError(e?.response?.data?.detail || e?.message || "Error leyendo ONUs");
      setInventoryRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setExpanded({});
    loadInventory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router?.id, pon]);

  // Si el endpoint nuevo aún no está disponible en un servidor sin actualizar,
  // se mantiene la tabla anterior como fallback visual. Una vez actualizado, siempre
  // se prioriza inventoryRows porque allí el ONU ID viene de `show onu state`.
  const sourceRows = inventoryRows.length ? inventoryRows : rows;

  const items = useMemo(() => sourceRows.map((row, index) => {
    const ponId = Number(row?.["PON ID"] || pon || 0);
    const onuId = Number(row?.["ONU ID"] || 0);
    const status = statusOf(row);

    return {
      key: `${ponId}-${onuId || index}-${index}`,
      row,
      ponId,
      onuId,
      status,
      systemState: pick(row, ["Admin State", "System State"]),
      description: pick(row, ["Description"]),
      omccState: pick(row, ["OMCC State"]),
      phaseState: pick(row, ["Phase State"], status.label),
      configState: pick(row, ["Config State"]),
      profile: pick(row, ["Profile"]),
      mode: pick(row, ["Mode"]),
      authInfo: pick(row, ["Info", "AuthInfo", "SN"]),
      model: pick(row, ["Model"]),
      channel: pick(row, ["Channel"]),
    };
  }), [sourceRows, pon]);

  const counts = useMemo(() => ({
    total: items.length,
    online: items.filter((item) => item.status.id === "online").length,
    offline: items.filter((item) => item.status.id === "offline").length,
  }), [items]);

  const filtered = useMemo(() => {
    const q = norm(search);
    return items.filter((item) => {
      if (filter !== "all" && item.status.id !== filter) return false;
      if (!q) return true;
      return norm([
        item.ponId,
        item.onuId,
        item.description,
        item.systemState,
        item.omccState,
        item.phaseState,
        item.profile,
        item.mode,
        item.authInfo,
        item.model,
      ].join(" ")).includes(q);
    });
  }, [items, search, filter]);

  const refresh = async () => {
    await loadInventory();
    if (onRefresh) await onRefresh();
  };

  const runAction = async (action, item) => {
    if (!onAction || !item.onuId) return;
    const key = `${action}-${item.key}`;
    setBusy(key);
    try {
      await onAction(action, item.onuId, item.authInfo);
      await loadInventory();
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4" data-testid="onu-admin-table">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/45 overflow-hidden">
        <div className="px-4 py-4 border-b border-slate-800 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-100">Información de Autorización ONU</p>
            <p className="text-[10px] text-slate-500 mt-1">
              PON {pon} · {items.length} ONU(s) · ID real leído desde show onu state
            </p>
          </div>

          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            className="h-9 px-3 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-cyan-300 hover:border-cyan-700 flex items-center gap-2 text-xs disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            {loading ? "Leyendo OLT..." : "Actualizar"}
          </button>
        </div>

        {error && (
          <div className="px-4 py-2 border-b border-amber-900/50 bg-amber-950/20 text-[10px] text-amber-300">
            Inventario canónico no disponible: {error}. Se muestra el listado anterior como respaldo.
          </div>
        )}

        <div className="px-4 py-3 border-b border-slate-800 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="relative w-full xl:max-w-lg">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre, ONU ID, serie, perfil o modelo..."
              className="w-full h-10 pl-10 pr-3 rounded-lg border border-slate-700 bg-slate-950 text-xs text-slate-200 outline-none focus:border-cyan-600"
            />
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button type="button" onClick={() => setFilter("all")} className={`px-3 py-2 rounded-lg border text-xs font-semibold ${filter === "all" ? "border-cyan-600 bg-cyan-950/40 text-cyan-300" : "border-slate-700 bg-slate-900 text-slate-400"}`}>Todo {counts.total}</button>
            <button type="button" onClick={() => setFilter("online")} className={`px-3 py-2 rounded-lg border text-xs font-semibold ${filter === "online" ? "border-emerald-700 bg-emerald-950/35 text-emerald-300" : "border-slate-700 bg-slate-900 text-slate-400"}`}>En línea {counts.online}</button>
            <button type="button" onClick={() => setFilter("offline")} className={`px-3 py-2 rounded-lg border text-xs font-semibold ${filter === "offline" ? "border-rose-700 bg-rose-950/35 text-rose-300" : "border-slate-700 bg-slate-900 text-slate-400"}`}>Fuera de línea {counts.offline}</button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1320px] border-collapse">
            <thead>
              <tr className="bg-slate-900/90 text-left">
                {["PON ID", "ONU ID", "Estado del sistema", "Descripción", "Estado OMCC", "Estado de fase", "Perfil ONU", "Modo de autorización", "Información de autorización", "Modelo de ONU", "Acción"].map((label) => (
                  <th key={label} className="px-3 py-3 border-b border-slate-700 text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{label}</th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filtered.map((item) => {
                const isOpen = !!expanded[item.key];
                return (
                  <React.Fragment key={item.key}>
                    <tr className="hover:bg-slate-900/50 transition-colors">
                      <Cell mono>{item.ponId || pon}</Cell>
                      <Cell mono><span className="font-bold text-cyan-200">{item.onuId || "—"}</span></Cell>
                      <Cell>{item.systemState}</Cell>
                      <Cell className="max-w-[220px]">{item.description || <span className="text-slate-600">Sin descripción</span>}</Cell>
                      <Cell>{item.omccState}</Cell>
                      <Cell><span className={`font-semibold ${item.status.cls}`}>{item.phaseState}</span></Cell>
                      <Cell mono>{item.profile}</Cell>
                      <Cell>{item.mode}</Cell>
                      <Cell mono>{item.authInfo}</Cell>
                      <Cell mono>{item.model}</Cell>
                      <Cell>
                        <div className="flex items-center gap-1.5">
                          <button type="button" title="Ver detalle" onClick={() => setExpanded((prev) => ({ ...prev, [item.key]: !prev[item.key] }))} className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-cyan-300 flex items-center justify-center"><Eye className="w-3.5 h-3.5" /></button>
                          <button type="button" title="Reiniciar ONU" disabled={!item.onuId || busy === `reboot-${item.key}`} onClick={() => runAction("reboot", item)} className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 text-cyan-300 flex items-center justify-center disabled:opacity-40"><RotateCw className="w-3.5 h-3.5" /></button>
                          <button type="button" title="Activar ONU" disabled={!item.onuId || busy === `activate-${item.key}`} onClick={() => runAction("activate", item)} className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 text-emerald-300 flex items-center justify-center disabled:opacity-40"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                          <button type="button" title="Desactivar ONU" disabled={!item.onuId || busy === `deactivate-${item.key}`} onClick={() => runAction("deactivate", item)} className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 text-amber-300 flex items-center justify-center disabled:opacity-40"><Power className="w-3.5 h-3.5" /></button>
                          <button type="button" title="Eliminar ONU" disabled={!item.onuId || busy === `delete-${item.key}`} onClick={() => runAction("delete", item)} className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 text-rose-300 flex items-center justify-center disabled:opacity-40"><Trash2 className="w-3.5 h-3.5" /></button>
                        </div>
                      </Cell>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={11} className="px-4 py-4 border-b border-slate-800 bg-black/20">
                          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">
                            <div className="rounded-lg border border-slate-800 p-3"><p className="text-[9px] text-slate-500">ÍNDICE REAL</p><p className="mt-1 font-mono text-xs text-cyan-200">{pick(item.row, ["ONUIndex"]) || `1/1/${item.ponId}:${item.onuId}`}</p></div>
                            <div className="rounded-lg border border-slate-800 p-3"><p className="text-[9px] text-slate-500">CONFIG STATE</p><p className="mt-1 font-mono text-xs">{item.configState || "—"}</p></div>
                            <div className="rounded-lg border border-slate-800 p-3"><p className="text-[9px] text-slate-500">CHANNEL</p><p className="mt-1 font-mono text-xs">{item.channel || "—"}</p></div>
                            {Object.entries(item.row || {}).filter(([key]) => !["ONUIndex", "PON", "PON ID", "ONU ID"].includes(key)).slice(0, 12).map(([key, value]) => (
                              <div key={key} className="rounded-lg border border-slate-800 p-3 min-w-0"><p className="text-[9px] text-slate-500 uppercase">{key}</p><p className="mt-1 font-mono text-[10px] break-words">{text(value) || "—"}</p></div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {!filtered.length && !loading && (
                <tr><td colSpan={11} className="px-4 py-10 text-center text-xs text-slate-500">No hay ONUs para este filtro.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
