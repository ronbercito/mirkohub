/**
 * Archivo: frontend/src/modules/clientes/Clients.jsx
 * Función: Módulo Clientes: listado con búsqueda/filtros, alta y edición de abonados (datos personales, tipo de conexión PPPoE/IP Estática/DHCP, IP, usuario PPPoE, plan, router, NAP, potencia óptica), corte/reactivación real en MikroTik, recordatorio WhatsApp y eliminación.
 * Trabaja con: backend/app/routers/clientes/router.py (/api/clients), backend/app/integrations/mikrotik/service.py, modules/planes, modules/red
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { 
  Users, UserPlus, Search, Phone, MapPin, Wifi, ShieldAlert, 
  CheckCircle2, XCircle, DollarSign, MessageSquare, Edit3, Trash2,
  Activity, ExternalLink, RefreshCw, Layers, Radio
} from "lucide-react";
import { toast } from "sonner";
import ClientRegistrationWizard from "./usuarios/ClientRegistrationWizard";
import ClientDetail from "./ClientDetail";

export default function Clients({ onSelectClient }) {
  const { API, token } = useAuth();
  const [clients, setClients] = useState([]);
  const [plans, setPlans] = useState([]);
  const [routers, setRouters] = useState([]);
  const [ipv4Networks, setIpv4Networks] = useState([]);
  const [napBoxes, setNapBoxes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const activePlans = plans.filter((plan) => plan.is_active);
  const mikrotikRouters = routers.filter((router) => router.device_type === "mikrotik");
  
  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [detailClientId, setDetailClientId] = useState(null);
  const [selectedClient, setSelectedClient] = useState(null);
  const [formData, setFormData] = useState({
    full_name: "",
    dni_ruc: "",
    phone: "",
    email: "",
    address: "",
    reference: "",
    latitude: "",
    longitude: "",
    ip_address: "",
    onu_sn: "",
    connection_type: "PPPoE",
    pppoe_user: "",
    pppoe_password: "",
    plan_id: "",
    router_id: "",
    ipv4_network_id: "",
    nap_box: "",
    nap_box_id: "",
    nap_port: "",
    optical_power_dbm: "",
    installation_date: "",
    technology: "fiber",
    zone_id: "",
    zone_name: "",
    monitoring_equipment_id: "",
    monitoring_equipment_name: "",
    antenna_type: "",
    management_ip: "",
    status: "active",
    billing_day: new Date().getDate(),
    billing_type: "prepaid",
    invoice_lead_days: 5,
    grace_days: 5,
    cut_after_months: 1,
    invoice_notification_channel: "none",
    payment_reminder_channel: "none",
    reminder_1_days: null,
    reminder_2_days: null,
    reminder_3_days: null,
    create_first_invoice: true
  });
  const compatibleNetworks = ipv4Networks.filter((network) => network.router_id === formData.router_id);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [resClients, resPlans, resRouters, resNetworks, resNapBoxes] = await Promise.all([
        axios.get(`${API}/clients`, {
          params: { search, status: statusFilter },
          headers: { Authorization: `Bearer ${token}` }
        }),
        axios.get(`${API}/plans`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/routers`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/ipv4-networks`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/nap-boxes`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      setClients(resClients.data);
      setPlans(resPlans.data);
      setRouters(resRouters.data);
      setIpv4Networks(resNetworks.data);
      setNapBoxes(resNapBoxes.data);

      const firstActivePlan = resPlans.data.find((plan) => plan.is_active);
      const firstMikrotik = resRouters.data.find((router) => router.device_type === "mikrotik");
      if (firstActivePlan && !formData.plan_id) {
        setFormData(prev => ({ ...prev, plan_id: firstActivePlan.id }));
      }
      if (firstMikrotik && !formData.router_id) {
        setFormData(prev => ({ ...prev, router_id: firstMikrotik.id }));
      }
    } catch (e) {
      console.error(e);
      toast.error("Error al cargar la lista de abonados");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [search, statusFilter]);

  const handleToggleStatus = async (id, name, currentStatus) => {
    try {
      const res = await axios.post(`${API}/clients/${id}/toggle-status`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      (res.data.mikrotik?.ok ? toast.success : toast.warning)(`${name}: ${res.data.message}`);
      fetchData();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Error al cambiar estado del cliente");
    }
  };

  const handleOnuStatus = async (c) => {
    toast.info(`Consultando ONU ${c.onu_sn} en la OLT...`);
    try {
      const res = await axios.get(`${API}/clients/${c.id}/onu-status`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.data.ok) return toast.error(res.data.error);
      if (!res.data.found) return toast.warning(res.data.message);
      const onu = Object.entries(res.data.onu).map(([k, v]) => `${k}: ${v}`).join(" · ");
      const opt = Object.entries(res.data.optical || {}).map(([k, v]) => `${k}: ${v}`).join(" · ");
      toast.success(`${res.data.olt} · PON 0/${res.data.pon} · ONU ${res.data.onu_id}\n${onu}${opt ? `\nÓptica: ${opt}` : ""}`, { duration: 12000 });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "No se pudo consultar la OLT");
    }
  };

  const handleSaveClient = async (e) => {
    e.preventDefault();
    const payload = { ...formData, optical_power_dbm: formData.optical_power_dbm === "" ? null : formData.optical_power_dbm, latitude: formData.latitude === "" || formData.latitude == null ? 0 : Number(formData.latitude), longitude: formData.longitude === "" || formData.longitude == null ? 0 : Number(formData.longitude) };
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const res = selectedClient
        ? await axios.put(`${API}/clients/${selectedClient.id}`, payload, { headers })
        : await axios.post(`${API}/clients`, payload, { headers });
      toast.success(selectedClient ? "Abonado actualizado correctamente" : "Nuevo abonado registrado y primera factura emitida");
      if (res.data.mikrotik) {
        (res.data.mikrotik.ok ? toast.success : toast.warning)(`MikroTik: ${res.data.mikrotik.message}`);
      }
      setShowAddModal(false);
      setSelectedClient(null);
      fetchData();
    } catch (e) {
      const d = e.response?.data?.detail;
      toast.error(typeof d === "string" ? d : "Error al guardar abonado (revisa los campos obligatorios)");
    }
  };

  const handleDeleteClient = async (id, name) => {
    if (!window.confirm(`¿Estás seguro de eliminar el cliente "${name}"?`)) return;
    try {
      await axios.delete(`${API}/clients/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Cliente eliminado del sistema");
      fetchData();
    } catch (e) {
      toast.error("Error al eliminar");
    }
  };

  const openWhatsAppReminder = (client) => {
    const text = `Hola ${client.full_name}, le saludamos de FibraZ Perú. Su servicio de internet de ${client.plan_name} presenta un saldo pendiente de S/. ${Number(client.balance_due || 0).toFixed(2)}. Puede realizar su pago por Yape/Plin al 987654321 o BCP. ¡Gracias!`;
    const cleanPhone = (client.phone || "").replace(/\D/g, "");
    const waUrl = `https://wa.me/51${cleanPhone}?text=${encodeURIComponent(text)}`;
    window.open(waUrl, "_blank");
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Users className="w-6 h-6 text-cyan-400" /> Control de Abonados y Clientes
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Administración de contratos de fibra óptica, IP asignada, cortes y reactivaciones
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            data-testid={TEST_IDS.BTN_NEW_CLIENT}
            onClick={() => {
              setSelectedClient(null);
              setFormData({
                full_name: "",
                dni_ruc: "",
                phone: "",
                email: "",
                address: "",
                reference: "",
                latitude: "",
                longitude: "",
                ip_address: "",
                onu_sn: "",
                connection_type: "PPPoE",
                pppoe_user: "",
                pppoe_password: "",
                plan_id: activePlans[0]?.id || "",
                router_id: mikrotikRouters[0]?.id || "",
                ipv4_network_id: "",
                nap_box: "",
                nap_box_id: "",
                nap_port: "",
                optical_power_dbm: "",
                installation_date: "",
                technology: "fiber",
                zone_id: "",
                zone_name: "",
                monitoring_equipment_id: "",
                monitoring_equipment_name: "",
                antenna_type: "",
                management_ip: "",
                status: "active",
    billing_day: new Date().getDate(),
    billing_type: "prepaid",
    invoice_lead_days: 5,
    grace_days: 5,
    cut_after_months: 1,
    invoice_notification_channel: "none",
    payment_reminder_channel: "none",
    reminder_1_days: null,
    reminder_2_days: null,
    reminder_3_days: null,
    create_first_invoice: true
              });
              setShowAddModal(true);
            }}
            className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold rounded-xl shadow-lg shadow-cyan-600/20 flex items-center gap-2 transition"
          >
            <UserPlus className="w-4 h-4" /> Nuevo Abonado
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-xl flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-3" />
          <input
            data-testid={TEST_IDS.CLIENT_SEARCH}
            type="text"
            placeholder="Buscar por nombre, DNI/RUC, IP, teléfono o dirección..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
          <button
            onClick={() => setStatusFilter("all")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === "all" ? "bg-cyan-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Todos ({clients.length})
          </button>
          <button
            onClick={() => setStatusFilter("active")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === "active" ? "bg-emerald-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Activos
          </button>
          <button
            onClick={() => setStatusFilter("suspended")}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              statusFilter === "suspended" ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-400 hover:bg-slate-700"
            }`}
          >
            Suspendidos
          </button>
        </div>
      </div>

      {/* Clients Table */}
      <div className="bg-slate-900/90 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Abonado / Contacto</th>
                <th className="py-3 px-4">Plan / Tarifa</th>
                <th className="py-3 px-4">IP / Conexión</th>
                <th className="py-3 px-4">Caja NAP / Potencia</th>
                <th className="py-3 px-4">Estado / Deuda</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-500">
                    Cargando abonados...
                  </td>
                </tr>
              ) : clients.length === 0 ? (
                <tr>
                  <td colSpan="6" className="py-8 text-center text-slate-500">
                    No se encontraron abonados con los filtros aplicados.
                  </td>
                </tr>
              ) : (
                clients.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-100 flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${c.is_online ? "bg-emerald-400" : "bg-rose-400"}`}></span>
                        {c.full_name}
                      </div>
                      <div className="text-[11px] text-slate-400 flex items-center gap-2 mt-0.5">
                        <span>DNI: {c.dni_ruc}</span>
                        <span>•</span>
                        <span className="flex items-center gap-1 text-slate-300"><Phone className="w-3 h-3 text-cyan-400"/> {c.phone}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate max-w-xs mt-0.5">
                        <MapPin className="w-2.5 h-2.5 inline mr-1 text-slate-500" />
                        {c.address}
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-semibold text-cyan-300">{c.plan_name}</div>
                      <div className="text-[11px] font-bold text-emerald-400">
                        S/. {Number(c.plan_price || 0).toFixed(2)} / mes
                      </div>
                      <div className="text-[10px] text-slate-500">Día de cobro: {c.billing_day} de cada mes</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-mono text-slate-200">{c.ip_address}</div>
                      <div className="text-[11px] text-slate-400">
                        {c.connection_type}: <span className="font-mono text-cyan-400">{c.pppoe_user || "estática"}</span>
                      </div>
                      <div className="text-[10px] text-slate-500">Router: {c.router_name}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="text-slate-200">{c.nap_box || "NAP Central"}</div>
                      <div className="text-[11px] font-mono mt-0.5">
                        <span className={`px-1.5 py-0.5 rounded ${
                          (c.optical_power_dbm ?? -20) > -24 ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"
                        }`}>
                          {c.optical_power_dbm != null ? `${c.optical_power_dbm} dBm` : "— dBm"}
                        </span>
                      </div>
                    </td>

                    <td className="py-3 px-4">
                      <div>
                        {c.status === "active" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[11px] border border-emerald-500/30">
                            <CheckCircle2 className="w-3.5 h-3.5" /> ACTIVO
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400 font-bold text-[11px] border border-rose-500/30">
                            <XCircle className="w-3.5 h-3.5" /> CORTADO
                          </span>
                        )}
                      </div>
                      {c.balance_due > 0 && (
                        <div className="text-[11px] text-rose-400 font-bold mt-1">
                          Deuda: S/. {Number(c.balance_due).toFixed(2)} ({c.unpaid_invoices_count} rec.)
                        </div>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <button
                          onClick={() => setDetailClientId(c.id)}
                          title="Ver ficha del cliente"
                          className="p-1.5 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 transition"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </button>

                        {/* Toggle Service Cut Button */}
                        <button
                          data-testid={`btn-toggle-client-${c.id}`}
                          onClick={() => handleToggleStatus(c.id, c.full_name, c.status)}
                          title={c.status === "active" ? "Cortar Servicio MikroTik" : "Reactivar Servicio"}
                          className={`p-1.5 rounded-lg border transition ${
                            c.status === "active"
                              ? "bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border-rose-500/30"
                              : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/30"
                          }`}
                        >
                          <ShieldAlert className="w-4 h-4" />
                        </button>

                        {/* Estado ONU en la OLT */}
                        {c.onu_sn && (
                          <button
                            data-testid={`btn-onu-client-${c.id}`}
                            onClick={() => handleOnuStatus(c)}
                            title="Ver ONU en la OLT (estado y potencia óptica)"
                            className="p-1.5 rounded-lg bg-cyan-600/10 hover:bg-cyan-600/20 text-cyan-300 border border-cyan-600/30 transition"
                          >
                            <Radio className="w-4 h-4" />
                          </button>
                        )}

                        {/* WhatsApp reminder */}
                        <button
                          data-testid={`btn-whatsapp-client-${c.id}`}
                          onClick={() => openWhatsAppReminder(c)}
                          title="Enviar aviso WhatsApp"
                          className="p-1.5 rounded-lg bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-400 border border-emerald-600/30 transition"
                        >
                          <MessageSquare className="w-4 h-4" />
                        </button>

                        {/* Edit */}
                        <button
                          data-testid={`btn-edit-client-${c.id}`}
                          onClick={() => {
                            setSelectedClient(c);
                            setFormData({
                              full_name: c.full_name,
                              dni_ruc: c.dni_ruc,
                              phone: c.phone,
                              email: c.email || "",
                              address: c.address,
                              reference: c.reference || "",
                              latitude: c.latitude ?? "",
                              longitude: c.longitude ?? "",
                              ip_address: c.ip_address,
                              onu_sn: c.onu_sn || "",
                              connection_type: c.connection_type || "PPPoE",
                              pppoe_user: c.pppoe_user || "",
                              pppoe_password: c.pppoe_password || "",
                              plan_id: c.plan_id,
                              router_id: c.router_id,
                              ipv4_network_id: c.ipv4_network_id || "",
                              nap_box: c.nap_box || "",
                              nap_box_id: c.nap_box_id || "",
                              nap_port: c.nap_port ?? "",
                              optical_power_dbm: c.optical_power_dbm ?? "",
                              installation_date: c.installation_date || "",
                              technology: c.technology || "fiber",
                              zone_id: c.zone_id || "",
                              zone_name: c.zone_name || "",
                              monitoring_equipment_id: c.monitoring_equipment_id || "",
                              monitoring_equipment_name: c.monitoring_equipment_name || "",
                              antenna_type: c.antenna_type || "",
                              management_ip: c.management_ip || "",
                              status: c.status,
                              billing_day: c.billing_day ?? 5,
                              billing_type: c.billing_type || "prepaid",
                              invoice_lead_days: c.invoice_lead_days ?? 5,
                              grace_days: c.grace_days ?? 5,
                              cut_after_months: c.cut_after_months ?? 1,
                              invoice_notification_channel: c.invoice_notification_channel || "none",
                              payment_reminder_channel: c.payment_reminder_channel || "none",
                              reminder_1_days: c.reminder_1_days ?? null,
                              reminder_2_days: c.reminder_2_days ?? null,
                              reminder_3_days: c.reminder_3_days ?? null,
                              create_first_invoice: false
                            });
                            setShowAddModal(true);
                          }}
                          title="Editar Abonado"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                        >
                          <Edit3 className="w-4 h-4" />
                        </button>

                        {/* Delete */}
                        <button
                          data-testid={`btn-delete-client-${c.id}`}
                          onClick={() => handleDeleteClient(c.id, c.full_name)}
                          title="Eliminar"
                          className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 border border-slate-700 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit Client Modal */}
      {false && showAddModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                <Users className="w-5 h-5 text-cyan-400" />
                {selectedClient ? "Editar Abonado" : "Nuevo Abonado FibraZ"}
              </h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-slate-400 hover:text-slate-200 text-sm font-bold p-1"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveClient} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Nombre Completo / Razón Social *</label>
                  <input
                    type="text"
                    required
                    value={formData.full_name}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    placeholder="Ej. Juan Pérez / Inversiones SAC"
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">DNI / RUC *</label>
                  <input
                    type="text"
                    required
                    value={formData.dni_ruc}
                    onChange={(e) => setFormData({ ...formData, dni_ruc: e.target.value })}
                    placeholder="DNI 8 dígitos o RUC 11 dígitos"
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Celular / WhatsApp (Perú) *</label>
                  <input
                    type="text"
                    required
                    value={formData.phone}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="987654321"
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Correo Electrónico</label>
                  <input
                    type="email"
                    value={formData.email}
                    onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                    placeholder="cliente@gmail.com"
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-slate-300 font-semibold mb-1">Dirección de Instalación *</label>
                  <input
                    type="text"
                    required
                    value={formData.address}
                    onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                    placeholder="Av. / Jr. / Mz. Lt. Urb. Distrito"
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  />
                </div>

                {/* Plan & Router selection */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Plan de Internet Contratado *</label>
                  <select
                    required
                    value={formData.plan_id}
                    onChange={(e) => setFormData({ ...formData, plan_id: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="" disabled>Selecciona un plan activo</option>
                    {activePlans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — S/. {Number(p.price).toFixed(2)}/mes ({p.download_speed_mbps} Mbps)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Router / Nodo MikroTik *</label>
                  <select
                    required
                    value={formData.router_id}
                    onChange={(e) => setFormData({ ...formData, router_id: e.target.value, ipv4_network_id: "" })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="" disabled>Selecciona un MikroTik</option>
                    {mikrotikRouters.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.ip_address})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Red IPv4 asignada</label>
                  <select
                    required={formData.connection_type !== "PPPoE" && Boolean(formData.ip_address)}
                    value={formData.ipv4_network_id}
                    onChange={(e) => setFormData({ ...formData, ipv4_network_id: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="">Sin red asignada</option>
                    {compatibleNetworks.map((network) => (
                      <option key={network.id} value={network.id}>
                        {network.name} — {network.cidr}
                      </option>
                    ))}
                  </select>
                  {formData.router_id && compatibleNetworks.length === 0 && (
                    <p className="text-[10px] text-amber-400 mt-1">No hay redes IPv4 registradas para este MikroTik.</p>
                  )}
                </div>

                {/* Technical network config */}
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Tipo de Conexión (MikroTik)</label>
                  <select
                    data-testid="client-connection-type"
                    value={formData.connection_type}
                    onChange={(e) => setFormData({ ...formData, connection_type: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="PPPoE">PPPoE (secret + perfil)</option>
                    <option value="IP Estática">IP Estática (cola simple + address-list)</option>
                    <option value="DHCP">DHCP (cola simple + address-list)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">IP Asignada (LAN/PPPoE)</label>
                  <input
                    type="text"
                    data-testid="client-ip-input"
                    value={formData.ip_address}
                    onChange={(e) => setFormData({ ...formData, ip_address: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl font-mono text-cyan-300"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Usuario PPPoE</label>
                  <input
                    type="text"
                    data-testid="client-pppoe-user"
                    value={formData.pppoe_user}
                    onChange={(e) => setFormData({ ...formData, pppoe_user: e.target.value })}
                    placeholder="usuario_pppoe"
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl font-mono text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Clave PPPoE</label>
                  <input
                    type="text"
                    data-testid="client-pppoe-password"
                    value={formData.pppoe_password || ""}
                    onChange={(e) => setFormData({ ...formData, pppoe_password: e.target.value })}
                    placeholder="clave del secret"
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl font-mono text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Serie ONU (SN / MAC en la OLT)</label>
                  <input
                    type="text"
                    data-testid="client-onu-sn"
                    value={formData.onu_sn || ""}
                    onChange={(e) => setFormData({ ...formData, onu_sn: e.target.value.trim() })}
                    placeholder="GPON00A1B2C3"
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl font-mono text-slate-100"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Caja NAP</label>
                  <select
                    value={formData.nap_box_id}
                    onChange={(e) => setFormData({ ...formData, nap_box_id: e.target.value, nap_port: "", nap_box: "" })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="">Sin caja NAP asignada</option>
                    {napBoxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Puerto NAP</label>
                  <select
                    disabled={!formData.nap_box_id}
                    value={formData.nap_port}
                    onChange={(e) => setFormData({ ...formData, nap_port: e.target.value === "" ? "" : Number(e.target.value) })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 disabled:opacity-50"
                  >
                    <option value="">Sin puerto asignado</option>
                    {Array.from({ length: napBoxes.find((box) => box.id === formData.nap_box_id)?.ports || 0 }, (_, index) => index + 1).map((port) => <option key={port} value={port}>Puerto {port}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Potencia Óptica (dBm)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.optical_power_dbm}
                    onChange={(e) => setFormData({ ...formData, optical_power_dbm: e.target.value === "" ? "" : parseFloat(e.target.value) })}
                    placeholder="-19.5"
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl font-mono text-slate-100"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold rounded-xl shadow-lg"
                >
                  Guardar Abonado
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {detailClientId && (
        <ClientDetail
          clientId={detailClientId}
          api={API}
          token={token}
          onClose={() => setDetailClientId(null)}
        />
      )}
      {showAddModal && (
        <ClientRegistrationWizard
          selectedClient={selectedClient}
          formData={formData}
          setFormData={setFormData}
          plans={plans}
          routers={routers}
          ipv4Networks={ipv4Networks}
          napBoxes={napBoxes}
          onClose={() => { setShowAddModal(false); setSelectedClient(null); }}
          onSubmit={handleSaveClient}
          api={API}
          token={token}
        />
      )}
    </div>
  );
}
