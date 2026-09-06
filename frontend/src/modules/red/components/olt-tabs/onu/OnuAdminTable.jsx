/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu/OnuAdminTable.jsx
 * Pertenece a: Red > OLT > ONUs > Lista de ONU.
 * Función: Presenta las ONUs en formato tabla tipo panel administrativo (estilo VSOL/AdminOLT),
 *          con filtros Todo/Online/Offline, búsqueda, datos principales y acciones por ONU.
 * Regla: Este archivo SOLO controla la presentación de la lista de ONUs. No modifica
 *        Resumen, Puertos PON, Auto-find, Óptica ONU, Consola ni la conexión CLI.
 */
import React, { useMemo, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Eye,
  MoreHorizontal,
  Power,
  RefreshCw,
  RotateCw,
  Search,
  Trash2,
} from "lucide-react";

const text = (value) => String(value ?? "").trim();
const norm = (value) => text(value).toLowerCase().replace(/[^a-z0-9]/g, "");

const pick = (row, patterns, fallback = "") => {
  if (!row) return fallback;
  const keys = Object.keys(row);
  for (const pattern of patterns) {
    const key = keys.find((k) => pattern.test(String(k)));
    if (key) {
      const value = row[key];
      if (value !== null && value !== undefined && typeof value !== "object") {
        const out = text(value);
        if (out) return out;
      }
    }
  }
  return fallback;
};

const parseIndex = (row, selectedPon, index) => {
  const raw = pick(row, [/^onuindex$/i, /^onu index$/i, /^onu id$/i], "");

  const formats = [
    /(?:GPON|EPON)?\s*0\/(\d+)\s*:\s*(\d+)/i,
    /(?:\d+\/)+(?<pon>\d+)\s*:\s*(?<onu>\d+)/i,
    /0\/(\d+)\/(\d+)/i,
  ];

  for (const re of formats) {
    const m = raw.match(re);
    if (!m) continue;
    const pon = Number(m.groups?.pon ?? m[1]);
    const onu = Number(m.groups?.onu ?? m[2]);
    if (Number.isFinite(pon) && Number.isFinite(onu)) return { pon, onu, raw };
  }

  const ponValue = pick(row, [/^pon$/i, /pon id/i], `0/${selectedPon}`);
  const ponMatch = ponValue.match(/(?:0\/)?(\d+)/);
  const explicitOnu = Number(pick(row, [/^onu id$/i, /^onuid$/i], ""));

  return {
    pon: ponMatch ? Number(ponMatch[1]) : Number(selectedPon),
    onu: Number.isFinite(explicitOnu) && explicitOnu > 0 ? explicitOnu : index + 1,
    raw,
  };
};

const statusOf = (row) => {
  const phase = pick(row, [/phase.*state/i, /estado.*fase/i], "");
  const status = pick(row, [/^status$/i, /onu.*status/i, /working.*state/i], phase);
  const low = `${status} ${phase}`.toLowerCase();

  if (/working|online|registered|active|\bup\b/.test(low)) {
    return { id: "online", label: "Online", cls: "text-emerald-300" };
  }
  if (/offline|los|down|inactive|deregistered/.test(low)) {
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
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expanded, setExpanded] = useState({});
  const [busy, setBusy] = useState("");

  const items = useMemo(() => rows.map((row, index) => {
    const idx = parseIndex(row, pon, index);
    const status = statusOf(row);

    const description = pick(row, [/^description$/i, /descripcion/i, /name/i], "");
    const systemState = pick(row, [/admin.*state/i, /system.*state/i, /estado.*sistema/i], "");
    const omccState = pick(row, [/omcc.*state/i, /estado.*omcc/i], "");
    const phaseState = pick(row, [/phase.*state/i, /estado.*fase/i], status.label);
    const profile = pick(row, [/^profile$/i, /perfil.*onu/i], "");
    const mode = pick(row, [/^mode$/i, /authorization.*mode/i, /modo.*aut/i], "");
    const authInfo = pick(row, [/^info$/i, /authinfo/i, /authorization.*info/i, /serial/i, /^sn$/i], "");
    const model = pick(row, [/^model$/i, /modelo.*onu/i], "");

    return {
      key: `${idx.pon}-${idx.onu}-${index}`,
      index,
      row,
      idx,
      status,
      description,
      systemState,
      omccState,
      phaseState,
      profile,
      mode,
      authInfo,
      model,
    };
  }), [rows, pon]);

  const counts = useMemo(() => ({
    total: items.length,
    online: items.filter((x) => x.status.id === "online").length,
    offline: items.filter((x) => x.status.id === "offline").length,
  }), [items]);

  const filtered = useMemo(() => {
    const q = norm(search);
    return items.filter((item) => {
      if (filter !== "all" && item.status.id !== filter) return false;
      if (!q) return true;
      return norm([
        item.idx.pon,
        item.idx.onu,
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

  const runAction = async (action, item) => {
    if (!onAction) return;
    const key = `${action}-${item.key}`;
    setBusy(key);
    try {
      await onAction(action, item.idx.onu, item.authInfo);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-4" data-testid="onu-admin-table">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/45 overflow-hidden">
        <div className="px-4 py-4 border-b border-slate-800">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-100">Información de Autorización ONU</p>
              <p className="text-[10px] text-slate-500 mt-1">PON {pon} · {rows.length} ONU(s) detectadas en este puerto</p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onRefresh?.()}
                className="h-9 px-3 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-cyan-300 hover:border-cyan-700 flex items-center gap-2 text-xs"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Actualizar
              </button>
            </div>
          </div>
        </div>

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
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold ${filter === "all" ? "border-cyan-600 bg-cyan-950/40 text-cyan-300" : "border-slate-700 bg-slate-900 text-slate-400"}`}
            >
              Todo {counts.total}
            </button>
            <button
              type="button"
              onClick={() => setFilter("online")}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold ${filter === "online" ? "border-emerald-700 bg-emerald-950/35 text-emerald-300" : "border-slate-700 bg-slate-900 text-slate-400"}`}
            >
              En línea {counts.online}
            </button>
            <button
              type="button"
              onClick={() => setFilter("offline")}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold ${filter === "offline" ? "border-rose-700 bg-rose-950/35 text-rose-300" : "border-slate-700 bg-slate-900 text-slate-400"}`}
            >
              Fuera de línea {counts.offline}
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1280px] border-collapse">
            <thead>
              <tr className="bg-slate-900/90 text-left">
                {[
                  "PON ID",
                  "ONU ID",
                  "Estado del sistema",
                  "Descripción",
                  "Estado OMCC",
                  "Estado de fase",
                  "Perfil ONU",
                  "Modo de autorización",
                  "Información de autorización",
                  "Modelo de ONU",
                  "Acción",
                ].map((label) => (
                  <th key={label} className="px-3 py-3 border-b border-slate-700 text-[10px] uppercase tracking-wide text-slate-400 font-semibold">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filtered.map((item) => {
                const isOpen = !!expanded[item.key];
                return (
                  <React.Fragment key={item.key}>
                    <tr className="hover:bg-slate-900/50 transition-colors">
                      <Cell mono>{item.idx.pon}</Cell>
                      <Cell mono>{item.idx.onu}</Cell>
                      <Cell>{item.systemState || (item.status.id === "unknown" ? "—" : "Enable")}</Cell>
                      <Cell className="max-w-[220px]">
                        <div className="max-w-[220px] whitespace-normal break-words font-medium text-slate-100">
                          {item.description || <span className="text-slate-600">Sin descripción</span>}
                        </div>
                      </Cell>
                      <Cell>{item.omccState}</Cell>
                      <Cell>
                        <span className={`font-semibold ${item.status.cls}`}>{item.phaseState || item.status.label}</span>
                      </Cell>
                      <Cell mono>{item.profile}</Cell>
                      <Cell>{item.mode}</Cell>
                      <Cell mono>{item.authInfo}</Cell>
                      <Cell mono>{item.model}</Cell>
                      <Cell>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            title="Ver detalle"
                            onClick={() => setExpanded((prev) => ({ ...prev, [item.key]: !prev[item.key] }))}
                            className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-cyan-300 hover:border-cyan-700 flex items-center justify-center"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Reiniciar ONU"
                            disabled={busy === `reboot-${item.key}`}
                            onClick={() => runAction("reboot", item)}
                            className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 text-cyan-300 hover:bg-cyan-950/30 flex items-center justify-center disabled:opacity-40"
                          >
                            <RotateCw className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Activar ONU"
                            disabled={busy === `activate-${item.key}`}
                            onClick={() => runAction("activate", item)}
                            className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 text-emerald-300 hover:bg-emerald-950/30 flex items-center justify-center disabled:opacity-40"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Desactivar ONU"
                            disabled={busy === `deactivate-${item.key}`}
                            onClick={() => runAction("deactivate", item)}
                            className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 text-amber-300 hover:bg-amber-950/30 flex items-center justify-center disabled:opacity-40"
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            title="Eliminar ONU"
                            disabled={busy === `delete-${item.key}`}
                            onClick={() => runAction("delete", item)}
                            className="w-8 h-8 rounded-lg border border-slate-700 bg-slate-900 text-rose-300 hover:bg-rose-950/30 flex items-center justify-center disabled:opacity-40"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </Cell>
                    </tr>

                    {isOpen && (
                      <tr>
                        <td colSpan={11} className="px-4 py-4 border-b border-slate-800 bg-black/20">
                          <div className="rounded-xl border border-slate-800 bg-slate-950/60 overflow-hidden">
                            <div className="px-3 py-2 flex items-center justify-between border-b border-slate-800">
                              <div className="flex items-center gap-2">
                                {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-cyan-300" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-cyan-300">Detalle recibido de la OLT</span>
                              </div>
                              <MoreHorizontal className="w-4 h-4 text-slate-600" />
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-px bg-slate-800">
                              {Object.entries(item.row || {}).map(([key, value]) => (
                                <div key={key} className="bg-slate-950 p-3 min-w-0">
                                  <p className="text-[8px] uppercase tracking-wide text-slate-600">{key}</p>
                                  <p className="mt-1 text-[10px] font-mono text-slate-200 break-words">{text(value) || "—"}</p>
                                </div>
                              ))}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}

              {!filtered.length && (
                <tr>
                  <td colSpan={11} className="px-4 py-10 text-center text-xs text-slate-500">
                    No hay ONUs que coincidan con el filtro actual.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
