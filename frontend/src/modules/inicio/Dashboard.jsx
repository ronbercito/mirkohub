/**
 * Archivo: frontend/src/modules/inicio/Dashboard.jsx
 * Función: Página de inicio: KPIs (clientes online, cobros del día/mes, facturas impagas, tickets), gráfico de recaudación de 7 días, medidor de tráfico leído de los MikroTik, resumen del sistema, últimos pagos y abonados conectados.
 * Trabaja con: backend/app/routers/inicio/router.py (/api/dashboard/summary), components/layout/Layout.jsx
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { 
  Users, DollarSign, FileText, Headphones, ArrowRight, Activity, 
  Wifi, Server, ArrowDown, ArrowUp, RefreshCw, CheckCircle, AlertTriangle,
  Zap, Clock, Phone, MapPin
} from "lucide-react";
import { 
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, 
  PieChart, Pie, Cell 
} from "recharts";
import { toast } from "sonner";

export default function Dashboard({ setActiveTab, onSelectClient }) {
  const { API, token, user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchDashboard = async () => {
    try {
      const res = await axios.get(`${API}/dashboard/summary`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setData(res.data);
    } catch (e) {
      console.error(e);
      toast.error("Error al cargar datos del dashboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
    const interval = setInterval(fetchDashboard, 15000); // 15s auto-refresh
    return () => clearInterval(interval);
  }, [API, token]);

  if (loading || !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-sm text-slate-400">Cargando métricas de la red FibraZ...</p>
        </div>
      </div>
    );
  }

  const { kpi, system_status, bandwidth_gauge, last_7_days, recent_payments, recent_connected } = data;

  const donutData = [
    { name: "Descarga", value: bandwidth_gauge.download_pct, color: "#06b6d4" },
    { name: "Subida", value: bandwidth_gauge.upload_pct, color: "#10b981" }
  ];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Header Welcome Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            Bienvenido <span className="text-slate-400 text-lg font-normal">{user?.name || "Administrador"}</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Estado de red en tiempo real, facturación en Soles (S/.) y control de abonados
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setRefreshing(true); fetchDashboard(); }}
            className="px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg border border-slate-700 flex items-center gap-1.5 transition"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-cyan-400" : ""}`} />
            Actualizar
          </button>
        </div>
      </div>

      {/* 4 Colored KPI Cards matching Screenshot */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Clientes Online (Teal / Cyan) */}
        <div className="bg-gradient-to-r from-teal-500 to-emerald-600 rounded-xl p-4 text-white shadow-lg shadow-teal-500/10 relative overflow-hidden flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-teal-100">Clientes Online</p>
              <h3 className="text-3xl font-extrabold mt-1">{kpi.clients_online}</h3>
              <p className="text-xs text-teal-100/90 mt-1">Total Registrados {kpi.total_clients}</p>
            </div>
            <Users className="w-12 h-12 text-teal-200/30 -mr-1 -mt-1" />
          </div>
          <button
            onClick={() => setActiveTab("clientes")}
            className="mt-4 pt-2 border-t border-teal-400/30 text-xs font-medium text-white hover:text-teal-100 flex items-center justify-between group"
          >
            <span>Ver clientes</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Card 2: Transacciones Hoy (Sky / Blue) */}
        <div className="bg-gradient-to-r from-sky-500 to-blue-600 rounded-xl p-4 text-white shadow-lg shadow-sky-500/10 relative overflow-hidden flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-sky-100">Transacciones Hoy</p>
              <h3 className="text-3xl font-extrabold mt-1">S/. {kpi.today_collected_pen.toFixed(2)}</h3>
              <p className="text-xs text-sky-100/90 mt-1">Cobrado este mes S/. {kpi.month_collected_pen.toFixed(2)}</p>
            </div>
            <DollarSign className="w-12 h-12 text-sky-200/30 -mr-1 -mt-1" />
          </div>
          <button
            onClick={() => setActiveTab("facturacion")}
            className="mt-4 pt-2 border-t border-sky-400/30 text-xs font-medium text-white hover:text-sky-100 flex items-center justify-between group"
          >
            <span>Ver transacciones</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Card 3: Facturas No Pagadas (Purple / Indigo) */}
        <div className="bg-gradient-to-r from-purple-500 to-indigo-600 rounded-xl p-4 text-white shadow-lg shadow-purple-500/10 relative overflow-hidden flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-purple-100">Facturas No Pagadas</p>
              <h3 className="text-3xl font-extrabold mt-1">{kpi.unpaid_invoices_count}</h3>
              <p className="text-xs text-purple-100/90 mt-1">
                Total vencidas {kpi.overdue_invoices_count} (S/. {kpi.unpaid_total_pen.toFixed(2)})
              </p>
            </div>
            <FileText className="w-12 h-12 text-purple-200/30 -mr-1 -mt-1" />
          </div>
          <button
            onClick={() => setActiveTab("facturacion")}
            className="mt-4 pt-2 border-t border-purple-400/30 text-xs font-medium text-white hover:text-purple-100 flex items-center justify-between group"
          >
            <span>Ver Facturas</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        {/* Card 4: Ticket Soporte (Dark Slate / Charcoal) */}
        <div className="bg-gradient-to-r from-slate-700 to-slate-800 rounded-xl p-4 text-white shadow-lg shadow-slate-900/20 relative overflow-hidden flex flex-col justify-between">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">Ticket Soporte</p>
              <h3 className="text-3xl font-extrabold mt-1">{kpi.open_tickets}</h3>
              <p className="text-xs text-slate-300/90 mt-1">Total Abiertos {kpi.open_tickets}</p>
            </div>
            <Headphones className="w-12 h-12 text-slate-400/20 -mr-1 -mt-1" />
          </div>
          <button
            onClick={() => setActiveTab("tickets")}
            className="mt-4 pt-2 border-t border-slate-600/50 text-xs font-medium text-white hover:text-slate-200 flex items-center justify-between group"
          >
            <span>Ver Tickets</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>

      {/* Middle Section: Traffic Chart & Bandwidth Donut + Resumen del Sistema */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left 8 Cols: Tráfico Clientes últimos 7 días + Donut */}
        <div className="lg:col-span-8 bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-100">Recaudación Diaria</h3>
              <p className="text-xs text-slate-400">Últimos 7 días (pagos registrados en S/.)</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-cyan-400">
                <span className="w-2.5 h-2.5 rounded-full bg-cyan-400"></span> Cobrado S/.
              </span>
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400"></span> N° pagos
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
            {/* Area Chart 8 cols */}
            <div className="md:col-span-8 h-56 w-full">
              <ResponsiveContainer width="100%" height="100%" minHeight={160}>
                <AreaChart data={last_7_days} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorDown" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#06b6d4" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorUp" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.4}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Area type="monotone" dataKey="collected_pen" stroke="#06b6d4" strokeWidth={2} fillOpacity={1} fill="url(#colorDown)" name="Cobrado (S/.)" />
                  <Area type="monotone" dataKey="payments" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorUp)" name="N° pagos" />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            {/* Circular Donut Gauge 4 cols */}
            <div className="md:col-span-4 flex flex-col items-center justify-center p-2 border-t md:border-t-0 md:border-l border-slate-800">
              <div className="relative w-40 h-40 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%" minHeight={160}>
                  <PieChart>
                    <Pie
                      data={donutData}
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={68}
                      startAngle={90}
                      endAngle={-270}
                      paddingAngle={4}
                      dataKey="value"
                    >
                      {donutData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-xl font-black text-white">{bandwidth_gauge.download_pct}%</span>
                  <span className="text-[10px] font-semibold text-cyan-400 uppercase tracking-wider">DESCARGA</span>
                </div>
              </div>

              <div className="mt-2 text-center">
                <p className="text-xs font-semibold text-slate-200">
                  {bandwidth_gauge.live_download_mbps} / {bandwidth_gauge.live_upload_mbps} Mbps en routers online
                </p>
                <div className="flex items-center justify-center gap-3 mt-1 text-[11px] text-slate-400">
                  <span className="text-cyan-400">● {bandwidth_gauge.download_pct}% Descarga</span>
                  <span className="text-emerald-400">● {bandwidth_gauge.upload_pct}% Subida</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Right 4 Cols: Resumen del Sistema (Matching Screenshot item list with badges) */}
        <div className="lg:col-span-4 bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl flex flex-col justify-between">
          <h3 className="text-base font-bold text-slate-100 mb-4 pb-2 border-b border-slate-800">
            Resumen del sistema
          </h3>

          <div className="space-y-3 text-xs font-medium">
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/50 hover:bg-slate-800/50 transition">
              <span className="text-slate-300">1. Routers Activos</span>
              <span className="px-2.5 py-0.5 rounded-full bg-teal-500/20 text-teal-400 font-bold border border-teal-500/30">
                {system_status.routers_active}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/50 hover:bg-slate-800/50 transition">
              <span className="text-slate-300">2. Routers desconectados</span>
              <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-bold border border-rose-500/30">
                {system_status.routers_offline}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/50 hover:bg-slate-800/50 transition">
              <span className="text-slate-300">3. Clientes Activos</span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                {system_status.clients_active}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/50 hover:bg-slate-800/50 transition">
              <span className="text-slate-300">4. Clientes suspendidos</span>
              <span className="px-2.5 py-0.5 rounded-full bg-rose-500/20 text-rose-400 font-bold border border-rose-500/30">
                {system_status.clients_suspended}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/50 hover:bg-slate-800/50 transition">
              <span className="text-slate-300">5. Servicios Activos</span>
              <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-400 font-bold border border-cyan-500/30">
                {system_status.active_services}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/50 hover:bg-slate-800/50 transition">
              <span className="text-slate-300">6. Monitoreo Activos</span>
              <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold border border-emerald-500/30">
                {system_status.monitoring_up}
              </span>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-950/50 hover:bg-slate-800/50 transition">
              <span className="text-slate-300">7. Monitoreo Caídos</span>
              <span className="px-2.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 font-bold border border-purple-500/30">
                {system_status.monitoring_down}
              </span>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-slate-800 text-center">
            <button
              onClick={() => setActiveTab("red")}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-medium flex items-center justify-center gap-1 mx-auto"
            >
              <Server className="w-3.5 h-3.5" /> Administrar Nodos y MikroTik
            </button>
          </div>
        </div>
      </div>

      {/* Bottom Section: 2 Tables (Últimos pagos registrados & Últimos conectados) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Table 1: Últimos pagos registrados (7 cols) */}
        <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-emerald-400" /> Últimos pagos registrados
            </h3>
            <button
              onClick={() => setActiveTab("facturacion")}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-medium"
            >
              Ver todos →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Cliente</th>
                  <th className="py-2.5 px-3">Cobrado</th>
                  <th className="py-2.5 px-3">Método / Operador</th>
                  <th className="py-2.5 px-3">Fecha</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {recent_payments.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-6 text-center text-slate-500">
                      No hay pagos registrados recientemente
                    </td>
                  </tr>
                ) : (
                  recent_payments.map((p) => (
                    <tr key={p.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-3 font-semibold text-slate-200">
                        {p.client_name}
                      </td>
                      <td className="py-2.5 px-3 text-emerald-400 font-bold">
                        S/. {Number(p.amount).toFixed(2)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded bg-slate-800 text-[11px] text-slate-300 mr-1.5">
                          {p.payment_method}
                        </span>
                        <span className="text-slate-400 text-[11px]">{p.operator}</span>
                      </td>
                      <td className="py-2.5 px-3 text-slate-400">
                        {p.payment_date ? p.payment_date.split("T")[0] : "Reciente"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Table 2: Últimos conectados (5 cols) */}
        <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <Wifi className="w-4 h-4 text-cyan-400" /> Últimos conectados
            </h3>
            <button
              onClick={() => setActiveTab("clientes")}
              className="text-xs text-cyan-400 hover:text-cyan-300 font-medium"
            >
              Ver todos →
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Abonado</th>
                  <th className="py-2.5 px-3">IP / Plan</th>
                  <th className="py-2.5 px-3">Conexión</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {recent_connected.length === 0 ? (
                  <tr>
                    <td colSpan="3" className="py-6 text-center text-slate-500">
                      Sin clientes conectados
                    </td>
                  </tr>
                ) : (
                  recent_connected.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-800/40 transition">
                      <td className="py-2.5 px-3">
                        <div className="font-semibold text-slate-200">{c.name}</div>
                        <div className="text-[10px] text-slate-400">{c.mac_address || c.connection_type}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="text-cyan-400 font-mono text-[11px]">{c.ip_address}</div>
                        <div className="text-[10px] text-slate-400">{c.plan_name}</div>
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 font-mono text-[11px]">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                          {c.connection_type} ACTIVO
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
