/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/OltAutofindTab.jsx
 * Pertenece a: Red > OLT > pestaña "Pendientes (auto-find)".
 * Función: Muestra ONUs pendientes y el formulario de autorización de una ONU.
 * Regla: No agregar aquí lógica de ONUs registradas, óptica general, resumen ni consola.
 */
import React from "react";
import { CheckCircle2 } from "lucide-react";

export default function OltAutofindTab({ res, auth, setAuth, onAuthorize }) {
  const rows = res?.rows || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2 text-xs p-3 rounded-xl bg-slate-950/60 border border-slate-800">
        <div>
          <label className="block text-slate-400 mb-1">ID ONU a asignar</label>
          <input
            data-testid="olt-auth-onu"
            value={auth.onu}
            onChange={(e) => setAuth({ ...auth, onu: e.target.value })}
            className="p-2 w-20 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono"
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">SN / MAC</label>
          <input
            data-testid="olt-auth-sn"
            value={auth.sn}
            onChange={(e) => setAuth({ ...auth, sn: e.target.value })}
            placeholder="GPON00A1B2C3"
            className="p-2 w-44 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono"
          />
        </div>
        <div>
          <label className="block text-slate-400 mb-1">Perfil ONU</label>
          <input
            data-testid="olt-auth-profile"
            value={auth.profile}
            onChange={(e) => setAuth({ ...auth, profile: e.target.value })}
            className="p-2 w-28 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono"
          />
        </div>
        <button
          data-testid="olt-authorize-btn"
          disabled={!auth.sn}
          onClick={onAuthorize}
          className="px-3 py-2 bg-emerald-900/30 hover:bg-emerald-900/50 text-emerald-300 border border-emerald-800/50 rounded-lg font-semibold flex items-center gap-1 disabled:opacity-40"
        >
          <CheckCircle2 className="w-3.5 h-3.5" /> Autorizar ONU
        </button>
      </div>

      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs" data-testid="olt-table-onu_autofind">
            <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
              <tr>{cols.map((c) => <th key={c} className="py-2.5 px-3 text-[10px]">{c}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {rows.map((row, index) => (
                <tr key={index} className="hover:bg-slate-800/40">
                  {cols.map((c) => <td key={c} className="py-2 px-3 font-mono">{row[c]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="p-4 text-center text-xs text-slate-500">No hay ONUs pendientes detectadas en este PON.</p>
      )}
    </div>
  );
}
