/**
 * Archivo: frontend/src/modules/clientes/mapa/ClientMap.jsx
 * Función: Pantalla interna reservada para el mapa de clientes.
 * Alcance: no consulta ni comparte ubicaciones hasta habilitar un proveedor
 *          de mapas interno aprobado por la empresa.
 */
import React from "react";
import { Map, ShieldCheck } from "lucide-react";

export default function ClientMap() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-100"><Map className="text-cyan-400" /> Mapa de clientes</h2>
        <p className="mt-1 text-xs text-slate-400">Módulo de ubicación y planificación de visitas.</p>
      </div>
      <section className="rounded-2xl border border-slate-800 bg-slate-900 p-8 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300"><Map className="h-7 w-7" /></div>
        <h3 className="mt-4 text-lg font-bold text-slate-100">Mapa de clientes</h3>
        <p className="mx-auto mt-2 max-w-xl text-sm text-slate-400">Esta sección queda preparada para mostrar las ubicaciones de los abonados dentro del panel.</p>
        <div className="mx-auto mt-5 flex max-w-xl items-start gap-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-left text-xs text-slate-400">
          <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-400" />
          <span>Las direcciones y coordenadas de clientes se mantendrán dentro del sistema. La integración del mapa se habilitará únicamente con un proveedor que autorices.</span>
        </div>
      </section>
    </div>
  );
}
