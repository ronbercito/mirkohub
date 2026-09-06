/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu-v2/OnuAuthView.jsx
 * Pertenece a: Red > OLT > ONUs v2 > submenú "Autorización de ONU".
 * Función: Presenta perfil, modo, información de autorización, modelo y descripción.
 * Regla: Solo presenta datos canónicos recibidos del backend v2.
 */
import React from "react";

export default function OnuAuthView({ onus = [] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[980px] border-collapse text-left">
        <thead className="bg-slate-900/90">
          <tr>
            {["PON ID", "ONU ID", "Descripción", "Perfil ONU", "Modo de autorización", "Información de autorización", "Modelo ONU"].map((h) => (
              <th key={h} className="px-3 py-3 border-b border-slate-700 text-[10px] uppercase tracking-wide text-slate-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {onus.map((onu) => (
            <tr key={`${onu.pon_id}-${onu.onu_id}`} className="hover:bg-slate-900/45">
              <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.pon_id}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono font-bold text-cyan-200">{onu.onu_id}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs max-w-[260px] whitespace-normal break-words">{onu.description || "—"}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.profile || "—"}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs">{onu.auth_mode || "—"}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.auth_info || "—"}</td>
              <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.model || "—"}</td>
            </tr>
          ))}
          {!onus.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-xs text-slate-500">Sin datos de autorización.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
