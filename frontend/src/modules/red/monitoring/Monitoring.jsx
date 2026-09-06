/**
 * Archivo: frontend/src/modules/red/monitoring/Monitoring.jsx
 * Función: Panel operativo de nodos inalámbricos: inventario, ping, estado y
 *          resumen de clientes online, activos y suspendidos por equipo.
 * Trabaja con: backend/app/routers/red/monitoring.py.
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { Activity, CheckCircle2, CircleOff, MapPin, Plus, Radio, RefreshCw, Trash2, Wifi, X } from "lucide-react";
import { toast } from "sonner";

const EMPTY = { name: "", ip_address: "", manufacturer: "MikroTik", equipment_type: "", model_name: "", location: "", details: "" };

export default function Monitoring() {
  const { API, token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [checking, setChecking] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API}/monitoring-equipment`, { headers });
      setRows(response.data || []);
    } catch {
      toast.error("No se pudieron cargar los equipos de monitoreo.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const save = async (event) => {
    event.preventDefault();
    try {
      await axios.post(`${API}/monitoring-equipment`, form, { headers });
      setForm(EMPTY);
      setShowForm(false);
      toast.success("Equipo registrado.");
      load();
    } catch (error) {
      toast.error(error.response?.data?.detail || "No se pudo registrar el equipo.");
    }
  };

  const pingOne = async (row) => {
    setChecking(row.id);
    try {
      const response = await axios.post(`${API}/monitoring-equipment/${row.id}/ping`, {}, { headers });
      toast.success(`${row.name}: ${response.data.ping?.message || "Ping realizado"}`);
      load();
    } catch {
      toast.error("No se pudo realizar el ping.");
    } finally {
      setChecking("");
    }
  };

  const pingAll = async () => {
    setChecking("all");
    try {
      const response = await axios.post(`${API}/monitoring-equipment/ping-all`, {}, { headers });
      setRows(response.data || []);
      toast.success("Estados de equipos actualizados.");
    } catch {
      toast.error("No se pudieron actualizar los estados.");
    } finally {
      setChecking("");
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`¿Eliminar "${row.name}"?`)) return;
    try {
      await axios.delete(`${API}/monitoring-equipment/${row.id}`, { headers });
      toast.success("Equipo eliminado.");
      load();
    } catch {
      toast.error("No se pudo eliminar el equipo.");
    }
  };

  const field = (key, label, placeholder) => (
    <label className="block text-xs font-semibold text-slate-300">
      <span className="mb-1 block">{label}</span>
      <input value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        placeholder={placeholder} className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-slate-100" />
    </label>
  );

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h2 className="flex items-center gap-2 text-2xl font-bold text-slate-100"><Radio className="text-cyan-400" /> Monitoreo</h2>
          <p className="mt-1 text-xs text-slate-400">Estado de nodos inalámbricos y abonados conectados a cada equipo.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={pingAll} disabled={checking === "all"} className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700 disabled:opacity-50">
            <RefreshCw className={`w-4 h-4 ${checking === "all" ? "animate-spin" : ""}`} /> Actualizar estados
          </button>
          <button onClick={() => setShowForm(true)} className="flex items-center gap-2 rounded-xl bg-cyan-500 px-4 py-2 text-xs font-bold text-white hover:bg-cyan-400">
            <Plus className="w-4 h-4" /> Nuevo equipo
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Summary label="Equipos" value={rows.length} icon={Radio} color="text-cyan-300" />
        <Summary label="En línea" value={rows.filter((row) => row.status === "online").length} icon={CheckCircle2} color="text-emerald-300" />
        <Summary label="Clientes activos" value={rows.reduce((sum, row) => sum + (row.clients_active || 0), 0)} icon={Wifi} color="text-amber-300" />
        <Summary label="Suspendidos" value={rows.reduce((sum, row) => sum + (row.clients_suspended || 0), 0)} icon={CircleOff} color="text-rose-300" />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-800 bg-slate-900 shadow-xl">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-slate-800 bg-slate-950 uppercase text-slate-400">
            <tr><th className="p-3">Nombre</th><th className="p-3">Equipo / IP</th><th className="p-3">Estado</th><th className="p-3 text-center">Online</th><th className="p-3 text-center">Activos</th><th className="p-3 text-center">Suspendidos</th><th className="p-3 text-right">Acciones</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {loading ? <tr><td colSpan="7" className="p-8 text-center text-slate-500">Cargando equipos…</td></tr>
              : rows.length === 0 ? <tr><td colSpan="7" className="p-8 text-center text-slate-500">Aún no hay equipos registrados.</td></tr>
              : rows.map((row) => <tr key={row.id} className="hover:bg-slate-800/40">
                <td className="p-3"><p className="font-bold text-slate-100">{row.name}</p><p className="mt-1 flex items-center gap-1 text-[11px] text-slate-500"><MapPin className="w-3 h-3" /> {row.location || "Sin ubicación"}</p></td>
                <td className="p-3"><p className="font-mono text-cyan-300">{row.ip_address || "Sin IP"}</p><p className="mt-1 text-[11px] text-slate-400">{[row.manufacturer, row.model_name || row.equipment_type].filter(Boolean).join(" · ") || "Sin modelo"}</p></td>
                <td className="p-3"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${row.status === "online" ? "bg-emerald-500/15 text-emerald-300" : row.status === "offline" ? "bg-rose-500/15 text-rose-300" : "bg-slate-800 text-slate-400"}`}>{row.status === "online" ? "EN LÍNEA" : row.status === "offline" ? "OFFLINE" : "SIN REVISAR"}</span><p className="mt-1 text-[10px] text-slate-500">{row.last_latency_ms != null ? `${row.last_latency_ms} ms` : row.last_ping_at || "Aún sin ping"}</p></td>
                <td className="p-3 text-center"><Badge value={row.clients_online || 0} color="bg-emerald-500/15 text-emerald-300" /></td>
                <td className="p-3 text-center"><Badge value={row.clients_active || 0} color="bg-amber-500/15 text-amber-300" /></td>
                <td className="p-3 text-center"><Badge value={row.clients_suspended || 0} color="bg-rose-500/15 text-rose-300" /></td>
                <td className="p-3"><div className="flex justify-end gap-2"><button onClick={() => pingOne(row)} disabled={checking === row.id} title="Hacer ping" className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 p-1.5 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-50"><Activity className={`w-4 h-4 ${checking === row.id ? "animate-pulse" : ""}`} /></button><button onClick={() => remove(row)} title="Eliminar equipo" className="rounded-lg border border-slate-700 bg-slate-800 p-1.5 text-rose-400 hover:bg-rose-950/40"><Trash2 className="w-4 h-4" /></button></div></td>
              </tr>)}
          </tbody>
        </table>
      </div>

      {showForm && <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm">
        <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          <div className="mb-5 flex items-center justify-between border-b border-slate-800 pb-3"><h3 className="font-bold text-slate-100">Nuevo equipo de monitoreo</h3><button onClick={() => { setShowForm(false); setForm(EMPTY); }} className="text-slate-400 hover:text-white"><X /></button></div>
          <form onSubmit={save} className="grid grid-cols-1 gap-4 text-xs md:grid-cols-2">
            {field("name", "Nombre del equipo *", "AP Cerro / Torre Norte")}
            {field("ip_address", "Dirección IP", "192.168.x.x")}
            <label className="block text-xs font-semibold text-slate-300"><span className="mb-1 block">Fabricante</span><select value={form.manufacturer} onChange={(event) => setForm({ ...form, manufacturer: event.target.value })} className="w-full rounded-xl border border-slate-700 bg-slate-950 p-2.5 text-slate-100"><option value="MikroTik">MikroTik</option><option value="Ubiquiti">Ubiquiti</option><option value="TP-Link">TP-Link</option><option value="Mimosa">Mimosa</option><option value="Otros">Otros</option></select></label>
            {field("equipment_type", "Tipo de equipo", "AP, estación base, router…")}
            {field("model_name", "Modelo / nombre", "RB1100AHx2, Rocket Prism…")}
            {field("location", "Ubicación", "Zona / torre")}
            <div className="md:col-span-2">{field("details", "Detalles", "Sector, frecuencia u observación…")}</div>
            <p className="md:col-span-2 text-[11px] text-slate-500">El monitoreo usa únicamente ping por IP. No guarda contraseñas ni credenciales.</p>
            <div className="flex justify-end gap-2 md:col-span-2"><button type="button" onClick={() => setShowForm(false)} className="rounded-xl bg-slate-800 px-4 py-2 text-slate-300">Cancelar</button><button className="rounded-xl bg-cyan-500 px-4 py-2 font-bold text-white">Registrar equipo</button></div>
          </form>
        </div>
      </div>}
    </div>
  );
}

const Badge = ({ value, color }) => <span className={`inline-flex min-w-6 justify-center rounded-full px-2 py-1 text-[10px] font-bold ${color}`}>{value}</span>;
const Summary = ({ label, value, icon: Icon, color }) => <div className="rounded-xl border border-slate-800 bg-slate-900 p-4"><p className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-slate-500"><Icon className="w-3.5 h-3.5" /> {label}</p><p className={`mt-2 text-2xl font-black ${color}`}>{value}</p></div>;
