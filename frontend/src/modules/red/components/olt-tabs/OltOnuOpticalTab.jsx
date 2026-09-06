/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/OltOnuOpticalTab.jsx
 * Pertenece a: Red > OLT > pestaña "Óptica ONUs".
 * Función: Muestra únicamente las lecturas ópticas de las ONUs del PON seleccionado.
 * Regla: No agregar aquí acciones de autorización, inventario general, resumen ni consola.
 */
import React from "react";

export default function OltOnuOpticalTab({ res }) {
  const rows = res?.rows || [];
  const cols = rows.length ? Object.keys(rows[0]) : [];

  if (!rows.length) {
    return (
      <p className="p-4 text-center text-xs text-slate-500">
        La OLT respondió sin filas ópticas. {res?.raw ? "Revisa la salida cruda." : "Sin registros."}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-slate-800">
      <table className="w-full text-left text-xs" data-testid="olt-table-onu_optical">
        <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
          <tr>{cols.map((c) => <th key={c} className="py-2.5 px-3 text-[10px]">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-800/60 text-slate-300">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-slate-800/40">
              {cols.map((c) => (
                <td
                  key={c}
                  className={`py-2 px-3 font-mono ${/online|up|active/i.test(row[c]) ? "text-emerald-300" : /offline|down|los/i.test(row[c]) ? "text-rose-300" : ""}`}
                >
                  {row[c]}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
