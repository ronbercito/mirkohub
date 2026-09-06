/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/OltConsoleTab.jsx
 * Pertenece a: Red > OLT > pestaña "Consola".
 * Función: Ejecuta y muestra únicamente comandos CLI libres de la OLT.
 * Regla: No agregar aquí lógica de resumen, PON, ONUs, auto-find ni óptica.
 */
import React from "react";
import { Terminal } from "lucide-react";

export default function OltConsoleTab({ cmd, setCmd, loading, onRun, res }) {
  return (
    <div>
      <form onSubmit={onRun} className="flex gap-2 mb-3 text-xs">
        <span className="p-2 text-cyan-400"><Terminal className="w-4 h-4" /></span>
        <input
          data-testid="olt-console-input"
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder="show onu info"
          className="flex-1 p-2 bg-slate-950 border border-slate-700 rounded-lg text-slate-100 font-mono"
        />
        <button
          data-testid="olt-console-run"
          type="submit"
          disabled={loading}
          className="px-3 py-2 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-700/50 rounded-lg font-semibold"
        >
          {loading ? "Ejecutando..." : "Ejecutar"}
        </button>
      </form>

      {res?.ok && (
        <pre
          data-testid="olt-raw"
          className="mt-3 p-3 rounded-xl bg-black/60 border border-slate-800 text-[11px] text-slate-300 font-mono whitespace-pre-wrap max-h-96 overflow-auto"
        >
          {res.raw || "(sin salida)"}
        </pre>
      )}
    </div>
  );
}
