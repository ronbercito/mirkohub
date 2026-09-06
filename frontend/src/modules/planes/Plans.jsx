/**
 * Archivo: frontend/src/modules/planes/Plans.jsx
 * Función: Módulo Planes / Servicios: CRUD de planes de internet (velocidad, precio S/., burst, prioridad). Cada plan se convierte en PPP Profile del MikroTik al sincronizar desde Gestión de Red.
 * Trabaja con: backend/app/routers/planes/router.py (/api/plans), modules/red/Network.jsx (sincronizar planes)
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { Zap, Plus, Edit3, Trash2, CheckCircle2, ArrowDown, ArrowUp, Wifi } from "lucide-react";
import { toast } from "sonner";

export default function Plans() {
  const { API, token } = useAuth();
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);

  const [formData, setFormData] = useState({
    name: "",
    download_speed_mbps: 100,
    upload_speed_mbps: 100,
    price: 70.0,
    type: "Fibra Óptica GPON",
    description: "",
    burst_limit: "",
    priority: 8,
    is_active: true
  });

  const fetchPlans = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/plans`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setPlans(res.data);
    } catch (e) {
      toast.error("Error al cargar los planes");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlans();
  }, []);

  const handleSavePlan = async (e) => {
    e.preventDefault();
    try {
      if (selectedPlan) {
        await axios.put(`${API}/plans/${selectedPlan.id}`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        toast.success("Plan actualizado correctamente");
      } else {
        await axios.post(`${API}/plans`, formData, {
          headers: { Authorization: `Bearer ${token}` }
        });
        toast.success("Nuevo plan de velocidad creado");
      }
      setShowModal(false);
      setSelectedPlan(null);
      fetchPlans();
    } catch (e) {
      toast.error("Error al guardar plan");
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`¿Deseas eliminar el plan "${name}"?`)) return;
    try {
      await axios.delete(`${API}/plans/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Plan eliminado");
      fetchPlans();
    } catch (e) {
      toast.error("Error al eliminar");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Zap className="w-6 h-6 text-cyan-400" /> Planes y Servicios de Internet
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Configuración de perfiles de velocidad, tarifas en Soles (S/.) y colas MikroTik
          </p>
        </div>

        <button
          data-testid={TEST_IDS.BTN_NEW_PLAN}
          onClick={() => {
            setSelectedPlan(null);
            setFormData({
              name: "",
              download_speed_mbps: 100,
              upload_speed_mbps: 100,
              price: 70.0,
              type: "Fibra Óptica GPON",
              description: "100% Fibra simétrica",
              burst_limit: "",
              priority: 6,
              is_active: true
            });
            setShowModal(true);
          }}
          className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-cyan-600/20"
        >
          <Plus className="w-4 h-4" /> Crear Plan
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {plans.map((p) => (
          <div key={p.id} className="bg-slate-900/90 border border-slate-800 rounded-2xl p-5 shadow-xl flex flex-col justify-between hover:border-slate-700 transition">
            <div>
              <div className="flex justify-between items-start mb-3">
                <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 text-[11px] font-bold border border-cyan-500/20">
                  {p.type}
                </span>
                <span className="text-xs text-slate-500 font-mono">Prioridad {p.priority}</span>
              </div>

              <h3 className="text-lg font-bold text-slate-100">{p.name}</h3>
              <p className="text-xs text-slate-400 mt-1 min-h-[36px]">{p.description}</p>

              <div className="my-4 p-3 bg-slate-950 rounded-xl border border-slate-800/80 grid grid-cols-2 gap-2 text-center">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Bajada</span>
                  <span className="text-base font-black text-cyan-400 flex items-center justify-center gap-1">
                    <ArrowDown className="w-3.5 h-3.5" /> {p.download_speed_mbps} M
                  </span>
                </div>
                <div className="border-l border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-500 block">Subida</span>
                  <span className="text-base font-black text-emerald-400 flex items-center justify-center gap-1">
                    <ArrowUp className="w-3.5 h-3.5" /> {p.upload_speed_mbps} M
                  </span>
                </div>
              </div>
            </div>

            <div className="pt-3 border-t border-slate-800 flex items-center justify-between">
              <div>
                <span className="text-xs text-slate-400 font-medium">Precio mensual:</span>
                <div className="text-xl font-black text-slate-100">
                  S/. {Number(p.price).toFixed(2)}
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    setSelectedPlan(p);
                    setFormData(p);
                    setShowModal(true);
                  }}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                >
                  <Edit3 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(p.id, p.name)}
                  className="p-2 rounded-lg bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 border border-slate-700"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Zap className="w-5 h-5 text-cyan-400" /> {selectedPlan ? "Editar Plan" : "Nuevo Plan de Internet"}
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-200">
                ✕
              </button>
            </div>

            <form onSubmit={handleSavePlan} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nombre del Plan *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej. Fibra Gamer 200 Mbps"
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Velocidad Bajada (Mbps) *</label>
                  <input
                    type="number"
                    required
                    value={formData.download_speed_mbps}
                    onChange={(e) => setFormData({ ...formData, download_speed_mbps: parseInt(e.target.value) })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-cyan-400 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Velocidad Subida (Mbps) *</label>
                  <input
                    type="number"
                    required
                    value={formData.upload_speed_mbps}
                    onChange={(e) => setFormData({ ...formData, upload_speed_mbps: parseInt(e.target.value) })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-emerald-400 font-bold"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Precio Mensual (S/.) *</label>
                  <input
                    type="number"
                    step="0.50"
                    required
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-bold text-sm"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Tecnología *</label>
                  <select
                    value={formData.type}
                    onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="Fibra Óptica GPON">Fibra Óptica GPON</option>
                    <option value="Radioenlace Ubiquiti/Mimosa">Radioenlace</option>
                    <option value="Hotspot WiFi Prepago">Hotspot Prepago</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Descripción Comercial</label>
                <textarea
                  rows="2"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
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
                  className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold rounded-xl shadow-lg"
                >
                  Guardar Plan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
