/**
 * Archivo: frontend/src/modules/red/IPv4Networks.jsx
 * Función: Punto de entrada para la futura gestión de redes IPv4 del ISP.
 * Alcance: Presenta la sección y su estado inicial; no lee ni modifica routers,
 *          clientes, pools, DHCP ni reglas de MikroTik.
 * Trabaja con: components/layout/Layout.jsx, components/layout/Sidebar.jsx.
 */
import React from "react";
import { Network, Construction } from "lucide-react";

export default function IPv4Networks() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200" data-testid="ipv4-networks-page">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
          <Network className="w-6 h-6 text-cyan-400" /> Redes IPv4
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">
          Organización de subredes, rangos y asignaciones por router.
        </p>
      </div>

      <div className="max-w-2xl rounded-2xl border border-slate-800 bg-slate-900/90 p-8 shadow-xl">
        <Construction className="w-8 h-8 text-cyan-400 mb-4" />
        <h3 className="text-base font-bold text-slate-100">Módulo preparado</h3>
        <p className="mt-2 text-sm text-slate-400">
          Aquí construiremos el inventario de redes IPv4. Por ahora no se ha creado,
          importado ni modificado ninguna red ni configuración del MikroTik.
        </p>
      </div>
    </div>
  );
}
