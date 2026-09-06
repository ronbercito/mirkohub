/**
 * Archivo: frontend/src/modules/red/Network.jsx
 * Función: Página "Gestión de Red": lista de equipos MikroTik / OLT registrados, estado real
 *          leído por API RouterOS (identidad, versión, CPU, RAM, uptime, latencia), botones de
 *          probar conexión / ping / sincronizar planes / cortes masivos, y pestañas en vivo
 *          (interfaces, PPPoE, colas, DHCP, address-list, hotspot) del MikroTik seleccionado, o pestañas
 *          de OLT VSOL (resumen, PON, ONUs, auto-find, óptica, consola) si el equipo es una OLT.
 * Trabaja con: modules/red/components/RouterCard.jsx, RouterForm.jsx, RouterLiveTabs.jsx, OltLiveTabs.jsx,
 *              backend/app/routers/red/router.py (/api/routers/*), context/AuthContext.js
 */
import React, { useState, useEffect, useCallback } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { Server, Plus, Activity, RefreshCw, Zap, ShieldOff, Cpu, HardDrive, Clock, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import RouterCard from "./components/RouterCard";
import RouterForm from "./components/RouterForm";
import RouterLiveTabs from "./components/RouterLiveTabs";
import OltLiveTabs from "./components/OltLiveTabs";

const errMsg = (e, fallback) => e?.response?.data?.detail || fallback;

export default function Network() {
  const { API, token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [routers, setRouters] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [pingResult, setPingResult] = useState(null);
  const [formRouter, setFormRouter] = useState(null); // null = cerrado, {} = nuevo, {...} = editar

  const fetchRouters = useCallback(async () => {
    try {
      const res = await axios.get(`${API}/routers`, { headers });
      setRouters(res.data);
      setSelected((prev) => (prev ? res.data.find((r) => r.id === prev.id) || res.data[0] || null : res.data[0] || null));
    } catch (e) {
      toast.error("Error al cargar los equipos de red");
    } finally {
      setLoading(false);
    }
  }, [API, token]);

  useEffect(() => { fetchRouters(); }, [fetchRouters]);

  const run = async (key, fn) => {
    setBusy(key);
    try { await fn(); } finally { setBusy(""); }
  };

  const testConnection = (r) => run("test", async () => {
    try {
      const res = await axios.post(`${API}/routers/${r.id}/test-connection`, {}, { headers });
      res.data.ok ? toast.success(res.data.message) : toast.error(res.data.message);
      fetchRouters();
    } catch (e) { toast.error(errMsg(e, "Error al probar la conexión")); }
  });

  const ping = (r) => run("ping", async () => {
    setPingResult(null);
    try {
      const res = await axios.post(`${API}/routers/${r.id}/ping`, {}, { headers });
      setPingResult(res.data);
      res.data.latency_ms !== null
        ? toast.success(`Respuesta de ${res.data.ip}:${res.data.port} en ${res.data.latency_ms} ms`)
        : toast.error(`Sin respuesta de ${res.data.ip}:${res.data.port}`);
      fetchRouters();
    } catch (e) { toast.error(errMsg(e, "Error al realizar ping")); }
  });

  const syncPlans = (r) => run("plans", async () => {
    try {
      const res = await axios.post(`${API}/routers/${r.id}/sync-plans`, {}, { headers });
      res.data.ok ? toast.success(res.data.message) : toast.error(res.data.message);
    } catch (e) { toast.error(errMsg(e, "Error al sincronizar planes")); }
  });

  const syncCuts = () => run("cuts", async () => {
    if (!window.confirm("¿Aplicar corte de servicio a todos los clientes con facturas vencidas?")) return;
    try {
      const res = await axios.post(`${API}/routers/sync-cuts`, {}, { headers });
      toast.success(res.data.message);
    } catch (e) { toast.error(errMsg(e, "Error al ejecutar cortes")); }
  });

  const removeRouter = async (r) => {
    if (!window.confirm(`¿Eliminar el equipo "${r.name}"?`)) return;
    try {
      await axios.delete(`${API}/routers/${r.id}`, { headers });
      toast.success("Equipo eliminado");
      setSelected(null);
      fetchRouters();
    } catch (e) { toast.error(errMsg(e, "Error al eliminar")); }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200" data-testid="network-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Server className="w-6 h-6 text-cyan-400" /> Gestión de Red, MikroTik y OLT
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Lectura en vivo vía API RouterOS (v6/v7): interfaces, PPPoE, colas, DHCP, address-list y hotspot
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button data-testid={TEST_IDS.BTN_SYNC_CUTS} onClick={syncCuts} disabled={busy === "cuts"}
            className="px-3 py-2 bg-rose-950/40 hover:bg-rose-900/40 text-rose-300 border border-rose-800/50 text-xs font-semibold rounded-xl flex items-center gap-2 transition">
            <ShieldOff className="w-4 h-4" /> {busy === "cuts" ? "Aplicando..." : "Cortar morosos"}
          </button>
          <button data-testid={TEST_IDS.BTN_NEW_ROUTER} onClick={() => setFormRouter({})}
            className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-cyan-600/20">
            <Plus className="w-4 h-4" /> Agregar Router / OLT
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-xs text-slate-400">Cargando equipos...</p>
      ) : routers.length === 0 ? (
        <div data-testid="routers-empty" className="p-10 border border-dashed border-slate-800 rounded-2xl text-center text-sm text-slate-400">
          Aún no hay equipos registrados. Agrega tu MikroTik con la IP, puerto API (8728) y credenciales para comenzar a leerlo.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {routers.map((r) => (
            <RouterCard key={r.id} router={r} selected={selected?.id === r.id} onSelect={() => { setSelected(r); setPingResult(null); }} />
          ))}
        </div>
      )}

      {selected && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-6 shadow-xl space-y-5" data-testid="router-detail">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-800">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h3 className="text-lg font-bold text-slate-100" data-testid="router-detail-name">{selected.name}</h3>
                {selected.identity && <span className="px-2 py-0.5 rounded bg-slate-800 text-[11px] text-cyan-300 font-mono">{selected.identity}</span>}
                {selected.ros_version && <span className="px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300 font-mono">{selected.device_type === "olt" ? "Firmware" : "RouterOS"} {selected.ros_version}</span>}
                {selected.board_name && <span className="px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300 font-mono">{selected.board_name}</span>}
              </div>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                {selected.ip_address}:{selected.port} {selected.device_type === "olt" ? `(${(selected.protocol || "telnet").toUpperCase()} · ${selected.olt_model || selected.pon_type} · ${selected.pon_type} v${selected.software_version})` : selected.use_ssl ? "(API-SSL)" : "(API)"} · usuario {selected.username}
                {selected.private_ip && ` · IP privada ${selected.private_ip}`}
                {selected.location && ` · ${selected.location}`}
              </p>
              {selected.last_error && <p className="text-[11px] text-rose-400 mt-1" data-testid="router-last-error">Último error: {selected.last_error}</p>}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button data-testid="btn-test-connection" onClick={() => testConnection(selected)} disabled={busy === "test"}
                className="px-3 py-1.5 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-700/50 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition disabled:opacity-40">
                <RefreshCw className={`w-3.5 h-3.5 ${busy === "test" ? "animate-spin" : ""}`} /> {selected.device_type === "olt" ? "Probar conexión CLI" : "Probar conexión API"}
              </button>
              <button data-testid="btn-ping-router" onClick={() => ping(selected)} disabled={busy === "ping"}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition">
                <Activity className={`w-3.5 h-3.5 ${busy === "ping" ? "animate-spin text-cyan-400" : ""}`} /> Ping
              </button>
              <button data-testid="btn-sync-plans" onClick={() => syncPlans(selected)} disabled={busy === "plans" || selected.device_type !== "mikrotik"}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 text-xs font-semibold rounded-lg flex items-center gap-1.5 transition disabled:opacity-40">
                <Zap className="w-3.5 h-3.5" /> Sincronizar planes (PPP profiles)
              </button>
              <button data-testid="btn-edit-router" onClick={() => setFormRouter(selected)} className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg" title="Editar">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button data-testid="btn-delete-router" onClick={() => removeRouter(selected)} className="p-1.5 bg-slate-800 hover:bg-rose-900/40 text-rose-400 border border-slate-700 rounded-lg" title="Eliminar">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-6 gap-3 text-xs">
            <Stat icon={Cpu} label="CPU" value={`${selected.cpu_usage_pct}%`} />
            <Stat icon={HardDrive} label="Memoria" value={`${selected.memory_usage_pct}%`} />
            <Stat icon={Clock} label="Uptime" value={selected.uptime || "—"} />
            <Stat icon={Activity} label="Latencia" value={selected.ping_ms ? `${selected.ping_ms} ms` : "—"} />
            <Stat icon={Zap} label={selected.device_type === "olt" ? "Puertos PON" : "PPPoE activos"} value={selected.device_type === "olt" ? selected.pon_ports : selected.active_pppoe_count} />
            <Stat icon={Server} label={selected.device_type === "olt" ? "Protocolo" : "Colas"} value={selected.device_type === "olt" ? (selected.protocol || "telnet").toUpperCase() : selected.active_queues_count} />
          </div>

          {pingResult && (
            <div data-testid="ping-result" className="p-3 bg-cyan-950/40 border border-cyan-800/50 rounded-xl text-xs text-cyan-200 font-mono flex items-center gap-2">
              <Zap className="w-4 h-4 text-cyan-400" />
              {pingResult.latency_ms !== null
                ? `Conexión TCP a ${pingResult.ip}:${pingResult.port} — tiempo=${pingResult.latency_ms} ms, pérdida=${pingResult.packet_loss}`
                : `Sin respuesta de ${pingResult.ip}:${pingResult.port} (pérdida 100%). Verifica IP, puerto API y firewall.`}
            </div>
          )}

          {selected.device_type === "mikrotik" ? <RouterLiveTabs router={selected} /> : <OltLiveTabs router={selected} />}
        </div>
      )}

      {formRouter !== null && (
        <RouterForm
          initial={formRouter}
          onClose={() => setFormRouter(null)}
          onSaved={() => { setFormRouter(null); fetchRouters(); }}
        />
      )}
    </div>
  );
}

const Stat = ({ icon: Icon, label, value }) => (
  <div className="p-3 rounded-xl bg-slate-950/60 border border-slate-800">
    <p className="text-[10px] uppercase tracking-wider text-slate-500 flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</p>
    <p className="text-sm font-bold text-slate-100 mt-1 font-mono truncate">{value}</p>
  </div>
);
