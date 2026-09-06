/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/OltSummaryTab.jsx
 * Pertenece a: Red > OLT > pestaña "Resumen".
 * Función: Renderiza únicamente el resumen de datos generales de la OLT.
 * Regla: No agregar aquí lógica de otras pestañas; cualquier cambio de Resumen debe hacerse en este archivo.
 */
import React from "react";

export default function OltSummaryTab({ res }) {
  const info = res?.info || {};

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
      {Object.entries(info).map(([key, value]) => (
        <div key={key} className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
          <p className="text-[10px] uppercase text-slate-500">{key}</p>
          <p className="font-mono text-slate-100 mt-1 break-all">{value}</p>
        </div>
      ))}

      {!Object.keys(info).length && (
        <p className="text-slate-500 col-span-4">
          La OLT respondió pero sin pares clave/valor; activa "Salida cruda".
        </p>
      )}
    </div>
  );
}
