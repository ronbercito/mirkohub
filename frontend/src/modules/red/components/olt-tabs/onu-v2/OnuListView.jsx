/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu-v2/OnuListView.jsx
 * Pertenece a: Red > OLT > ONUs v2 > submenú "Lista de ONU".
 * Función: Muestra la lista principal de ONUs con búsqueda, filtros y acciones.
 * Regla: SOLO presenta datos ya canónicos recibidos de onus-v2. No interpreta salida CLI.
 * Alcance: Solo la tabla de lista; oculta el serial sin eliminarlo de búsquedas ni acciones.
 * No modifica el backend, la adquisición RX ni las otras pestañas.
 */
import React, { useMemo, useState } from "react";
import { CheckCircle2, Power, RotateCw, Search, Trash2 } from "lucide-react";

const text = (v) => String(v ?? "").trim();
const norm = (v) => text(v).toLowerCase().replace(/[^a-z0-9]/g, "");

export default function OnuListView({ onus = [], onAction }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [busy, setBusy] = useState("");

  const counts = useMemo(() => ({
    all: onus.length,
    online: onus.filter((x) => x.status === "online").length,
    offline: onus.filter((x) => x.status === "offline").length,
  }), [onus]);

  const filtered = useMemo(() => {
    const q = norm(search);
    return onus.filter((onu) => {
      if (filter !== "all" && onu.status !== filter) return false;
      if (!q) return true;
      return norm([
        onu.pon_id,
        onu.onu_id,
        onu.description,
        onu.model,
        onu.profile,
        onu.auth_mode,
        onu.auth_info,
        onu.phase_state,
      ].join(" ")).includes(q);
    });
  }, [onus, search, filter]);

  const act = async (action, onu) => {
    if (!onAction) return;
    const key = `${action}-${onu.onu_id}`;
    setBusy(key);
    try {
      await onAction(action, onu.onu_id, onu.auth_info || "");
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div className="relative w-full xl:max-w-xl">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nombre, ONU ID, serie, perfil o modelo..."
            className="w-full h-10 pl-10 pr-3 rounded-lg border border-slate-700 bg-slate-950 text-xs text-slate-200 outline-none focus:border-cyan-600"
          />
        </div>

        <div className="flex gap-1.5 flex-wrap">
          {[
            ["all", `Todo ${counts.all}`],
            ["online", `En línea ${counts.online}`],
            ["offline", `Fuera de línea ${counts.offline}`],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`px-3 py-2 rounded-lg border text-xs font-semibold ${
                filter === id
                  ? "border-cyan-600 bg-cyan-950/40 text-cyan-300"
                  : "border-slate-700 bg-slate-900 text-slate-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full min-w-[1080px] border-collapse text-left">
          <thead className="bg-slate-900/90">
            <tr>
              {[
                "PON ID", "ONU ID", "Estado", "Descripción", "Modelo ONU",
                "Perfil ONU", "Modo", "RX", "Acción",
              ].map((h) => (
                <th key={h} className="px-3 py-3 border-b border-slate-700 text-[10px] uppercase tracking-wide text-slate-400">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((onu) => (
              <tr key={`${onu.pon_id}-${onu.onu_id}`} className="hover:bg-slate-900/45">
                <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.pon_id}</td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono font-bold text-cyan-200">{onu.onu_id}</td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs">
                  <span className={onu.status === "online" ? "text-emerald-300 font-semibold" : onu.status === "offline" ? "text-rose-300 font-semibold" : "text-slate-400"}>
                    {onu.status === "online" ? "Online" : onu.status === "offline" ? "Offline" : (onu.phase_state || "Sin estado")}
                  </span>
                </td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs max-w-[300px] whitespace-normal break-words text-slate-200">
                  {onu.description || <span className="text-slate-600">—</span>}
                </td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.model || "—"}</td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.profile || "—"}</td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs">{onu.auth_mode || "—"}</td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.rx_power || "—"}</td>
                <td className="px-3 py-3 border-b border-slate-800">
                  <div className="flex items-center gap-1.5">
                    <button title="Reiniciar" disabled={busy === `reboot-${onu.onu_id}`} onClick={() => act("reboot", onu)} className="w-8 h-8 rounded-lg border border-slate-700 text-cyan-300 flex items-center justify-center"><RotateCw className="w-3.5 h-3.5" /></button>
                    <button title="Activar" disabled={busy === `activate-${onu.onu_id}`} onClick={() => act("activate", onu)} className="w-8 h-8 rounded-lg border border-slate-700 text-emerald-300 flex items-center justify-center"><CheckCircle2 className="w-3.5 h-3.5" /></button>
                    <button title="Desactivar" disabled={busy === `deactivate-${onu.onu_id}`} onClick={() => act("deactivate", onu)} className="w-8 h-8 rounded-lg border border-slate-700 text-amber-300 flex items-center justify-center"><Power className="w-3.5 h-3.5" /></button>
                    <button title="Eliminar" disabled={busy === `delete-${onu.onu_id}`} onClick={() => act("delete", onu)} className="w-8 h-8 rounded-lg border border-slate-700 text-rose-300 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {!filtered.length && (
              <tr><td colSpan={9} className="px-4 py-10 text-center text-xs text-slate-500">No hay ONUs para mostrar con este filtro.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
