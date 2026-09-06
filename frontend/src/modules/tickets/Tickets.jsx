/**
 * Archivo: frontend/src/modules/tickets/Tickets.jsx
 * Función: Módulo Tickets de Soporte: registro y seguimiento de averías por cliente, prioridad, técnico asignado y notas de resolución.
 * Trabaja con: backend/app/routers/tickets/router.py (/api/tickets), backend/app/routers/clientes/router.py (lista de clientes)
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { Headphones, Plus, CheckCircle2, Clock, AlertTriangle, User, Phone, MapPin } from "lucide-react";
import { toast } from "sonner";

export default function Tickets() {
  const { API, token, user } = useAuth();
  const [tickets, setTickets] = useState([]);
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const [formData, setFormData] = useState({
    client_id: "",
    client_name: "",
    client_phone: "",
    client_address: "",
    category: "Sin servicio",
    priority: "media",
    subject: "",
    description: "",
    assigned_to: ""
  });

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const [resT, resC] = await Promise.all([
        axios.get(`${API}/tickets`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/clients`, { headers: { Authorization: `Bearer ${token}` } })
      ]);
      setTickets(resT.data);
      setClients(resC.data);
      if (resC.data.length > 0 && !formData.client_id) {
        const c0 = resC.data[0];
        setFormData(prev => ({
          ...prev,
          client_id: c0.id,
          client_name: c0.full_name,
          client_phone: c0.phone,
          client_address: c0.address
        }));
      }
    } catch (e) {
      toast.error("Error al cargar tickets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTickets();
  }, []);

  const handleClientSelect = (clientId) => {
    const c = clients.find(item => item.id === clientId);
    if (c) {
      setFormData({
        ...formData,
        client_id: c.id,
        client_name: c.full_name,
        client_phone: c.phone,
        client_address: c.address
      });
    }
  };

  const handleCreateTicket = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/tickets`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Ticket de soporte registrado correctamente");
      setShowModal(false);
      fetchTickets();
    } catch (e) {
      toast.error("Error al crear ticket");
    }
  };

  const handleResolveTicket = async (ticketId) => {
    try {
      await axios.put(`${API}/tickets/${ticketId}`, {
        status: "resolved",
        resolution_notes: `Resuelto por ${user?.name || "Administrador"} - señal restablecida.`
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Ticket marcado como Resuelto");
      fetchTickets();
    } catch (e) {
      toast.error("Error al actualizar ticket");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Headphones className="w-6 h-6 text-purple-400" /> Tickets de Soporte y Averías
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Atención de incidencias de fibra, lentitud, cortes y asignación a técnicos
          </p>
        </div>

        <button
          data-testid={TEST_IDS.BTN_NEW_TICKET}
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-purple-600/20"
        >
          <Plus className="w-4 h-4" /> Nuevo Ticket
        </button>
      </div>

      <div className="bg-slate-900/90 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">N° Ticket / Fecha</th>
                <th className="py-3 px-4">Abonado / Contacto</th>
                <th className="py-3 px-4">Categoría / Asunto</th>
                <th className="py-3 px-4">Prioridad</th>
                <th className="py-3 px-4">Técnico Asignado</th>
                <th className="py-3 px-4">Estado</th>
                <th className="py-3 px-4 text-center">Acción</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {tickets.length === 0 ? (
                <tr>
                  <td colSpan="7" className="py-8 text-center text-slate-500">
                    No hay tickets de soporte registrados.
                  </td>
                </tr>
              ) : (
                tickets.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-800/40 transition">
                    <td className="py-3 px-4 font-mono">
                      <div className="font-bold text-slate-100">{t.ticket_number}</div>
                      <div className="text-[10px] text-slate-400">{t.created_at ? t.created_at.split("T")[0] : "Reciente"}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-200">{t.client_name}</div>
                      <div className="text-[11px] text-slate-400">{t.client_phone}</div>
                    </td>

                    <td className="py-3 px-4">
                      <div className="font-bold text-cyan-300">{t.subject}</div>
                      <div className="text-[11px] text-slate-400">{t.category}</div>
                    </td>

                    <td className="py-3 px-4">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                        t.priority === "alta" || t.priority === "urgente"
                          ? "bg-rose-500/20 text-rose-300 border border-rose-500/30"
                          : "bg-amber-500/20 text-amber-300 border border-amber-500/30"
                      }`}>
                        {t.priority}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-slate-300">
                      {t.assigned_to || "No asignado"}
                    </td>

                    <td className="py-3 px-4">
                      {t.status === "resolved" || t.status === "closed" ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                          <CheckCircle2 className="w-3 h-3" /> Resuelto
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold text-[10px]">
                          <Clock className="w-3 h-3" /> En Proceso
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-center">
                      {t.status !== "resolved" && (
                        <button
                          onClick={() => handleResolveTicket(t.id)}
                          className="px-2.5 py-1 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 rounded-lg text-[11px] font-bold"
                        >
                          Resolver
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Headphones className="w-5 h-5 text-purple-400" /> Abrir Ticket de Soporte
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-200">
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateTicket} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Seleccionar Abonado *</label>
                <select
                  value={formData.client_id}
                  onChange={(e) => handleClientSelect(e.target.value)}
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                >
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} ({c.dni_ruc})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Categoría *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="Sin servicio">Sin servicio de internet</option>
                    <option value="Lentitud">Lentitud / Alta latencia</option>
                    <option value="Fallo de Router / ONU">Fallo de Router / ONU</option>
                    <option value="Cambio de clave WiFi">Cambio de clave WiFi</option>
                    <option value="Facturación">Consulta de Facturación</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Prioridad *</label>
                  <select
                    value={formData.priority}
                    onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="baja">Baja</option>
                    <option value="media">Media</option>
                    <option value="alta">Alta</option>
                    <option value="urgente">Urgente</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Asunto / Resumen *</label>
                <input
                  type="text"
                  required
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  placeholder="Ej. ONU con luz LOS en rojo"
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Descripción de la Avería</label>
                <textarea
                  rows="3"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Detalles reportados por el cliente..."
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                ></textarea>
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-gradient-to-r from-purple-500 to-indigo-600 hover:from-purple-400 hover:to-indigo-500 text-white font-semibold rounded-xl shadow-lg"
                >
                  Abrir Ticket
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
