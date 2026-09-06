/**
 * Archivo: frontend/src/modules/red/components/RouterCard.jsx
 * Función: Tarjeta resumen de un equipo de red (MikroTik u OLT) con estado online/offline
 *          real, IP, modelo, CPU y latencia. Al hacer clic se selecciona para ver el detalle.
 * Trabaja con: modules/red/Network.jsx, backend/app/models/router.py (campos mostrados)
 */
import React from "react";
import { Server, Cpu, Activity, Radio } from "lucide-react";

const STATUS = {
  online: { label: "ONLINE", cls: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30", dot: "bg-emerald-400 animate-pulse" },
  offline: { label: "OFFLINE", cls: "bg-rose-500/20 text-rose-400 border-rose-500/30", dot: "bg-rose-400" },
  unknown: { label: "SIN PROBAR", cls: "bg-slate-700/40 text-slate-300 border-slate-600/40", dot: "bg-slate-400" },
};

export default function RouterCard({ router, selected, onSelect }) {
  const st = STATUS[router.status] || STATUS.unknown;
  const Icon = router.device_type === "olt" ? Radio : Server;
  return (
    <div
      data-testid={`router-card-${router.id}`}
      onClick={onSelect}
      className={`p-4 rounded-xl border cursor-pointer transition relative overflow-hidden ${
        selected ? "bg-slate-900 border-cyan-500 shadow-xl shadow-cyan-500/10" : "bg-slate-900/60 border-slate-800 hover:border-slate-700"
      }`}
    >
      <div className="flex justify-between items-start mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
            <Icon className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-100 truncate">{router.name}</h3>
            <p className="text-[11px] font-mono text-cyan-400">{router.ip_address}:{router.port}</p>
          </div>
        </div>
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-bold text-[10px] border ${st.cls}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}></span> {st.label}
        </span>
      </div>
      <p className="text-[11px] text-slate-400 mb-3 truncate">
        {router.identity ? `${router.identity} · ` : ""}{router.board_name || router.model || (router.device_type === "olt" ? "OLT GPON" : "MikroTik RouterOS")}
      </p>
      <div className="grid grid-cols-2 gap-2 text-[11px] pt-3 border-t border-slate-800">
        <div className="flex items-center gap-1.5 text-slate-400">
          <Cpu className="w-3.5 h-3.5 text-slate-500" /> CPU: <span className="text-slate-200 font-bold">{router.cpu_usage_pct}%</span>
        </div>
        <div className="flex items-center gap-1.5 text-slate-400">
          <Activity className="w-3.5 h-3.5 text-emerald-400" /> Ping: <span className="text-slate-200 font-bold">{router.ping_ms ? `${router.ping_ms} ms` : "—"}</span>
        </div>
      </div>
    </div>
  );
}
