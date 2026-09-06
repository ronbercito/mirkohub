/**
 * Archivo: frontend/src/modules/tareas/Tasks.jsx
 * Función: Módulo Tareas Técnicas: órdenes de trabajo en campo (instalación, mantenimiento, reconexión) con técnico, fecha, estado y potencia óptica.
 * Trabaja con: backend/app/routers/tareas/router.py (/api/tasks)
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { Wrench, Plus, CheckCircle2, Clock, Calendar, User, MapPin } from "lucide-react";
import { toast } from "sonner";

export default function Tasks() {
  const { API, token, user } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const [formData, setFormData] = useState({
    title: "",
    task_type: "Instalación Nueva",
    client_name: "",
    address: "",
    technician_name: "",
    scheduled_date: "",
    status: "pending",
    notes: "",
    optical_power_dbm: null
  });

  const fetchTasks = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/tasks`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setTasks(res.data);
    } catch (e) {
      toast.error("Error al cargar tareas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, []);

  const handleSaveTask = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/tasks`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Tarea técnica programada con éxito");
      setShowModal(false);
      fetchTasks();
    } catch (e) {
      toast.error("Error al crear tarea");
    }
  };

  const handleCompleteTask = async (taskId) => {
    try {
      await axios.put(`${API}/tasks/${taskId}`, {
        status: "completed",
        notes: `Completado por ${user?.name || "Técnico"} con señal óptima.`
      }, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Tarea completada");
      fetchTasks();
    } catch (e) {
      toast.error("Error al actualizar tarea");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Wrench className="w-6 h-6 text-cyan-400" /> Tareas Técnicas y Órdenes de Trabajo
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Programación de instalaciones de fibra óptica, fusiones, traslados y mediciones de potencia dBm
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-cyan-600/20"
        >
          <Plus className="w-4 h-4" /> Nueva Orden de Trabajo
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {tasks.map((t) => (
          <div key={t.id} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 text-[11px] font-bold border border-cyan-500/20">
                  {t.task_type}
                </span>

                {t.status === "completed" ? (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-bold text-[10px]">
                    <CheckCircle2 className="w-3 h-3" /> COMPLETADA
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-bold text-[10px]">
                    <Clock className="w-3 h-3" /> PENDIENTE
                  </span>
                )}
              </div>

              <h3 className="text-base font-bold text-slate-100 mt-2">{t.title}</h3>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-slate-500" /> Abonado: <span className="text-slate-200 font-medium">{t.client_name || "Cliente general"}</span>
              </p>
              <p className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-slate-500" /> {t.address}
              </p>

              <div className="mt-4 p-3 bg-slate-950 rounded-xl border border-slate-800/80 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Técnico Asignado</span>
                  <span className="font-semibold text-slate-200">{t.technician_name}</span>
                </div>
                <div>
                  <span className="text-slate-500 text-[10px] uppercase font-bold block">Fecha Programada</span>
                  <span className="font-semibold text-cyan-400">{t.scheduled_date}</span>
                </div>
              </div>

              {t.notes && (
                <p className="text-[11px] text-slate-400 mt-3 italic bg-slate-800/30 p-2 rounded-lg">
                  "{t.notes}"
                </p>
              )}
            </div>

            <div className="pt-4 mt-4 border-t border-slate-800 flex items-center justify-between">
              <div>
                {t.optical_power_dbm && (
                  <span className="text-[11px] font-mono px-2 py-1 rounded bg-slate-950 text-emerald-400 border border-slate-800">
                    Potencia: {t.optical_power_dbm} dBm
                  </span>
                )}
              </div>

              {t.status !== "completed" && (
                <button
                  onClick={() => handleCompleteTask(t.id)}
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md transition"
                >
                  Finalizar Trabajo
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Wrench className="w-5 h-5 text-cyan-400" /> Registrar Tarea Técnica
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-200">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveTask} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Título de la Tarea *</label>
                <input
                  type="text"
                  required
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  placeholder="Ej. Instalación de acometida y fusionado de fibra"
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Tipo de Tarea *</label>
                  <select
                    value={formData.task_type}
                    onChange={(e) => setFormData({ ...formData, task_type: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="Instalación Nueva">Instalación Nueva</option>
                    <option value="Mantenimiento Óptico">Mantenimiento Óptico</option>
                    <option value="Reconexión">Reconexión</option>
                    <option value="Retiro de Equipos">Retiro de Equipos</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Técnico *</label>
                  <input
                    type="text"
                    required
                    value={formData.technician_name}
                    onChange={(e) => setFormData({ ...formData, technician_name: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nombre del Abonado</label>
                <input
                  type="text"
                  value={formData.client_name}
                  onChange={(e) => setFormData({ ...formData, client_name: e.target.value })}
                  placeholder="Juan Pérez"
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Dirección de Trabajo *</label>
                <input
                  type="text"
                  required
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                  placeholder="Av. Universitaria 3200, Los Olivos"
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Fecha y Hora Programada</label>
                  <input
                    type="text"
                    value={formData.scheduled_date}
                    onChange={(e) => setFormData({ ...formData, scheduled_date: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Potencia Óptica (dBm)</label>
                  <input
                    type="number"
                    step="0.1"
                    value={formData.optical_power_dbm}
                    onChange={(e) => setFormData({ ...formData, optical_power_dbm: e.target.value === "" ? null : parseFloat(e.target.value) })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-mono"
                  />
                </div>
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
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold rounded-xl shadow-lg"
                >
                  Guardar Tarea
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
