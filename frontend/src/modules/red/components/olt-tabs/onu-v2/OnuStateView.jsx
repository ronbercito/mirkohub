/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu-v2/OnuStateView.jsx
 * Pertenece a: Red > OLT > ONUs v2 > submenú "Estado de la ONU".
 * Función: Presenta únicamente los estados obtenidos desde `show onu state`.
 * Regla: No interpreta CLI ni modifica otros submenús.
 */
import React from "react";

export default function OnuStateView({ onus = [] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[880px] border-collapse text-left">
        <thead className="bg-slate-900/90">
          <tr>
            {["PON ID", "ONU ID", "Estado del sistema", "Estado OMCC", "Estado de fase", "Config", "Canal"].map((h) => (
              <th key={h} className="px-3 py-3 border-b border-slate-700 text-[10px] uppercase tracking-wide text-slate-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {onus.map((onu) => (
            <tr key={`${onu.pon_id}-${onu.onu_id}`} className="hover:bg-slate-900/45">
              <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.pon_id}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono font-bold text-cyan-200">{onu.onu_id}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs">{onu.system_state || "—"}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs">{onu.omcc_state || "—"}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs">
                <span className={onu.status === "online" ? "text-emerald-300 font-semibold" : onu.status === "offline" ? "text-rose-300 font-semibold" : "text-slate-400"}>
                  {onu.phase_state || "—"}
                </span>
              </td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs">{onu.config_state || "—"}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.channel || "—"}</td>
            </tr>
          ))}
          {!onus.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-500">Sin datos de estado.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
