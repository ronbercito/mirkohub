/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu-v2/OnuOpticalView.jsx
 * Pertenece a: Red > OLT > ONUs v2 > submenú "Potencia Óptica ONU".
 * Función: Presenta las lecturas RX/TX obtenidas desde `show pon rx_power`.
 * Regla: No consulta la OLT directamente ni modifica otros submenús.
 */
import React from "react";

const quality = (rx) => {
  const value = Number.parseFloat(String(rx ?? ""));
  if (!Number.isFinite(value)) return { label: "Sin lectura", cls: "text-slate-500" };
  if (value >= -25) return { label: "Buena", cls: "text-emerald-300" };
  if (value >= -28) return { label: "Media", cls: "text-amber-300" };
  return { label: "Baja", cls: "text-rose-300" };
};

export default function OnuOpticalView({ onus = [] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full min-w-[680px] border-collapse text-left">
        <thead className="bg-slate-900/90">
          <tr>
            {["PON ID", "ONU ID", "Descripción", "RX", "TX", "Nivel"].map((h) => (
              <th key={h} className="px-3 py-3 border-b border-slate-700 text-[10px] uppercase tracking-wide text-slate-400">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {onus.map((onu) => {
            const q = quality(onu.rx_power);
            return (
              <tr key={`${onu.pon_id}-${onu.onu_id}`} className="hover:bg-slate-900/45">
                <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.pon_id}</td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono font-bold text-cyan-200">{onu.onu_id}</td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs">{onu.description || "—"}</td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.rx_power || "—"}</td>
                <td className="px-3 py-3 border-b border-slate-800 text-xs font-mono">{onu.tx_power || "—"}</td>
                <td className={`px-3 py-3 border-b border-slate-800 text-xs font-semibold ${q.cls}`}>{q.label}</td>
              </tr>
            );
          })}
          {!onus.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-500">Sin lecturas ópticas.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
