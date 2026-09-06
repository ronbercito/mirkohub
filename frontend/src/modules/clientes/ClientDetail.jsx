/**
 * Archivo: frontend/src/modules/clientes/ClientDetail.jsx
 * Función: Ficha operativa del cliente organizada en pestañas: resumen, servicio,
 * facturación, tickets, comunicaciones, documentos, estadísticas y bitácora.
 * Trabaja con: backend/app/routers/clientes/router.py (GET /api/clients/{id}).
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import {
  Activity, BarChart3, CreditCard, FileText, Mail, MessageSquare,
  Radio, ReceiptText, Ticket, UserRound, Wifi, X
} from "lucide-react";

const tabs = [
  { id: "summary", label: "Resumen", icon: UserRound },
  { id: "service", label: "Servicio", icon: Wifi },
  { id: "billing", label: "Facturación", icon: ReceiptText },
  { id: "tickets", label: "Tickets", icon: Ticket },
  { id: "messages", label: "Email y SMS", icon: Mail },
  { id: "documents", label: "Documentos", icon: FileText },
  { id: "stats", label: "Estadísticas", icon: BarChart3 },
  { id: "log", label: "Log", icon: Activity }
];

const money = (value) => `S/. ${Number(value || 0).toFixed(2)}`;
const date = (value) => value || "Sin registrar";
const prettyStatus = (status) => status === "active" ? "Activo" : status === "suspended" ? "Suspendido" : status || "Sin estado";

function EmptyState({ title, description }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-700 bg-slate-950/40 p-8 text-center">
      <p className="font-semibold text-slate-300">{title}</p>
      <p className="mt-1 text-sm text-slate-500">{description}</p>
    </div>
  );
}

function Value({ label, children }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-1 break-words text-sm font-medium text-slate-200">{children || "Sin registrar"}</p>
    </div>
  );
}

export default function ClientDetail({ clientId, api, token, onClose }) {
  const [activeTab, setActiveTab] = useState("summary");
  const [client, setClient] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await axios.get(`${api}/clients/${clientId}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (alive) setClient(response.data);
      } catch (err) {
        if (alive) setError(err.response?.data?.detail || "No se pudo cargar la ficha del cliente.");
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [api, clientId, token]);

  const content = () => {
    if (loading) return <div className="py-16 text-center text-slate-400">Cargando información del cliente…</div>;
    if (error) return <div className="py-16 text-center text-rose-400">{error}</div>;
    if (!client) return null;

    if (activeTab === "summary") {
      return (
        <div className="grid gap-5 lg:grid-cols-3">
          <section className="space-y-3 lg:col-span-2">
            <h3 className="text-base font-bold text-white">Datos del cliente</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Value label="Nombre / razón social">{client.full_name}</Value>
              <Value label="DNI / RUC">{client.dni_ruc}</Value>
              <Value label="Celular / WhatsApp">{client.phone}</Value>
              <Value label="Correo electrónico">{client.email}</Value>
              <div className="sm:col-span-2"><Value label="Dirección de instalación">{client.address}</Value></div>
              <Value label="Referencia">{client.reference}</Value>
              <Value label="Fecha de instalación">{date(client.installation_date)}</Value>
              <Value label="Zona">{client.zone_name}</Value>
              <Value label="Coordenadas">{client.latitude && client.longitude ? `${client.latitude}, ${client.longitude}` : "Sin registrar"}</Value>
            </div>
          </section>
          <section className="rounded-2xl border border-slate-800 bg-slate-950/55 p-5">
            <h3 className="text-base font-bold text-white">Estado de cuenta</h3>
            <div className="mt-4 space-y-3">
              <div className={`rounded-xl px-3 py-2 text-sm font-semibold ${client.status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-rose-500/15 text-rose-300"}`}>
                Servicio {prettyStatus(client.status)}
              </div>
              <Value label="Plan contratado">{client.plan_name}</Value>
              <Value label="Pago mensual">{money(client.plan_price)}</Value>
              <Value label="Deuda actual">{money(client.balance_due)}</Value>
              <Value label="Facturas pendientes">{client.unpaid_invoices_count || 0}</Value>
              <Value label="Día de pago">Día {client.billing_day || "Sin registrar"}</Value>
            </div>
          </section>
        </div>
      );
    }

    if (activeTab === "service") {
      const fiber = client.technology !== "wireless";
      return (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <div>
              <p className="text-sm font-semibold text-cyan-300">{fiber ? "Fibra óptica" : "Servicio inalámbrico"}</p>
              <p className="mt-1 text-sm text-slate-400">Configuración técnica y aprovisionamiento del cliente.</p>
            </div>
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-slate-300">{client.connection_type || "Sin conexión"}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Value label="MikroTik">{client.router_name}</Value>
            <Value label="Plan">{client.plan_name}</Value>
            <Value label="Red IPv4">{client.ipv4_network_name || client.ipv4_network_id}</Value>
            <Value label="IP del cliente">{client.ip_address}</Value>
            {client.connection_type === "PPPoE" && <Value label="Usuario PPPoE">{client.pppoe_user}</Value>}
            {client.connection_type === "PPPoE" && <Value label="Clave PPPoE">{client.pppoe_password ? "Configurada" : "Sin registrar"}</Value>}
          </div>
          {fiber ? (
            <>
              <h3 className="pt-2 text-base font-bold text-white">Instalación de fibra</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Value label="Zona">{client.zone_name}</Value>
                <Value label="Caja NAP">{client.nap_box}</Value>
                <Value label="Puerto NAP">{client.nap_port ? `Puerto ${client.nap_port}` : "Sin registrar"}</Value>
                <Value label="Serie ONU">{client.onu_sn}</Value>
                <Value label="Potencia ONU">{client.optical_power_dbm !== null && client.optical_power_dbm !== undefined ? `${client.optical_power_dbm} dBm` : "Sin registrar"}</Value>
              </div>
            </>
          ) : (
            <>
              <h3 className="pt-2 text-base font-bold text-white">Instalación inalámbrica</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Value label="Conectado a">{client.monitoring_equipment_name}</Value>
                <Value label="Tipo de antena">{client.antenna_type}</Value>
                <Value label="IP administración">{client.management_ip}</Value>
              </div>
            </>
          )}
        </div>
      );
    }

    if (activeTab === "billing") {
      const invoices = client.invoices || [];
      return invoices.length ? (
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-950 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">Factura</th><th className="px-4 py-3">Periodo</th><th className="px-4 py-3">Emisión</th><th className="px-4 py-3">Vencimiento</th><th className="px-4 py-3">Total</th><th className="px-4 py-3">Estado</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {invoices.map((invoice) => <tr key={invoice.id} className="text-slate-300">
                <td className="px-4 py-3 font-mono text-cyan-300">{invoice.invoice_number}</td>
                <td className="px-4 py-3">{invoice.month_period || "—"}</td>
                <td className="px-4 py-3">{date(invoice.issue_date)}</td>
                <td className="px-4 py-3">{date(invoice.due_date)}</td>
                <td className="px-4 py-3">{money(invoice.amount)}</td>
                <td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-xs font-bold ${invoice.status === "paid" ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300"}`}>{invoice.status === "paid" ? "Pagada" : "Pendiente"}</span></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      ) : <EmptyState title="Sin facturas registradas" description="Las facturas creadas para este cliente aparecerán aquí." />;
    }

    if (activeTab === "tickets") {
      const tickets = client.tickets || [];
      return tickets.length ? (
        <div className="space-y-3">
          {tickets.map((ticket) => <div key={ticket.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
            <div className="flex flex-wrap justify-between gap-2">
              <p className="font-semibold text-slate-200">{ticket.subject || "Ticket sin asunto"}</p>
              <span className="text-xs text-cyan-300">{ticket.status || "Abierto"}</span>
            </div>
            <p className="mt-2 text-sm text-slate-400">{ticket.description || ticket.notes || "Sin detalle registrado."}</p>
            <p className="mt-3 text-xs text-slate-500">{date(ticket.created_at)}</p>
          </div>)}
        </div>
      ) : <EmptyState title="Sin tickets registrados" description="Los tickets de soporte de este cliente se mostrarán en esta pestaña." />;

    if (activeTab === "messages") {
      return <EmptyState title="Sin comunicaciones registradas" description="Los correos y SMS enviados al cliente se centralizarán aquí cuando se registren desde el módulo de mensajería." />;
    }

    if (activeTab === "documents") {
      return <EmptyState title="Sin documentos registrados" description="Aquí se mostrarán contratos, PDFs, evidencias de instalación y notas adjuntas del cliente." />;
    }

    if (activeTab === "stats") {
      const paid = (client.invoices || []).filter((item) => item.status === "paid").length;
      return (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Value label="Servicios activos">{client.status === "active" ? 1 : 0}</Value>
          <Value label="Facturas registradas">{(client.invoices || []).length}</Value>
          <Value label="Facturas pagadas">{paid}</Value>
          <Value label="Tickets creados">{(client.tickets || []).length}</Value>
          <Value label="Saldo pendiente">{money(client.balance_due)}</Value>
          <Value label="Última conexión">{date(client.last_connection_time)}</Value>
          <Value label="Fecha de instalación">{date(client.installation_date)}</Value>
          <Value label="Tecnología">{client.technology === "wireless" ? "Inalámbrico" : "Fibra óptica"}</Value>
        </div>
      );
    }

    const activities = client.activities || [];
    return activities.length ? (
      <div className="space-y-3">
        {activities.map((item) => <div key={item.id} className="flex gap-3 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          <div className="mt-1 rounded-lg bg-cyan-500/10 p-2 text-cyan-300"><Activity className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-semibold text-slate-200">{item.action}</p>
              <p className="text-xs text-slate-500">{date(item.created_at)}</p>
            </div>
            <p className="mt-1 text-sm text-slate-400">{item.detail || "Sin detalle registrado."}</p>
            <p className="mt-2 text-xs text-cyan-400">Operador: {item.operator_name || "Sistema"}</p>
          </div>
        </div>)}
      </div>
    ) : <EmptyState title="Aún no hay movimientos registrados" description="Las nuevas acciones sobre el cliente quedarán guardadas automáticamente en esta bitácora." />;
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/85 p-3 backdrop-blur-sm sm:p-6">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-cyan-400">Ficha del cliente</p>
            <h2 className="mt-1 text-xl font-bold text-white">{client?.full_name || "Cargando…"}</h2>
            {client && <p className="mt-1 text-sm text-slate-400">{client.dni_ruc} · {client.plan_name || "Sin plan"}</p>}
          </div>
          <button onClick={onClose} aria-label="Cerrar ficha" className="rounded-lg p-2 text-slate-400 transition hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
        </header>

        <nav className="flex overflow-x-auto border-b border-slate-800 bg-slate-950/45 px-2">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return <button key={tab.id} onClick={() => setActiveTab(tab.id)} className={`flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-sm font-semibold transition ${active ? "border-cyan-400 text-cyan-300" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
              <Icon className="h-4 w-4" />{tab.label}
            </button>;
          })}
        </nav>

        <main className="min-h-0 flex-1 overflow-y-auto p-5">{content()}</main>
      </div>
    </div>
  );
}
