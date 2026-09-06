/**
 * Archivo: frontend/src/modules/almacen/Inventory.jsx
 * Función: Módulo Almacén: inventario de ONUs, routers WiFi, cable drop, splitters y herramientas con stock, costo y ubicación.
 * Trabaja con: backend/app/routers/almacen/router.py (/api/inventory)
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { Package, Plus, Edit3, Trash2, CheckCircle2, AlertTriangle, Layers, MapPin } from "lucide-react";
import { toast } from "sonner";

export default function Inventory() {
  const { API, token } = useAuth();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const [formData, setFormData] = useState({
    item_code: "",
    name: "",
    category: "ONU GPON",
    brand_model: "",
    serial_number: "",
    mac_address: "",
    stock: 0,
    unit: "Unidad",
    unit_cost: 0,
    status: "in_stock",
    location: "Almacén Central"
  });

  const fetchItems = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/inventory`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setItems(res.data);
    } catch (e) {
      toast.error("Error al cargar inventario");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchItems();
  }, []);

  const handleSaveItem = async (e) => {
    e.preventDefault();
    try {
      await axios.post(`${API}/inventory`, formData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Equipo / Material agregado al almacén");
      setShowModal(false);
      fetchItems();
    } catch (e) {
      toast.error("Error al guardar en inventario");
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`¿Deseas eliminar "${name}" del almacén?`)) return;
    try {
      await axios.delete(`${API}/inventory/${id}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Artículo eliminado");
      fetchItems();
    } catch (e) {
      toast.error("Error al eliminar");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Package className="w-6 h-6 text-amber-400" /> Almacén e Inventario de Equipos
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Control de ONUs GPON, bobinas de cable drop, routers Wi-Fi y splitters ópticos
          </p>
        </div>

        <button
          data-testid={TEST_IDS.BTN_NEW_ITEM}
          onClick={() => {
            setFormData({
              item_code: `INV-${Math.floor(1000 + Math.random() * 9000)}`,
              name: "",
              category: "ONU GPON",
              brand_model: "",
              serial_number: "",
              mac_address: "",
              stock: 0,
              unit: "Unidad",
              unit_cost: 0,
              status: "in_stock",
              location: "Almacén Central"
            });
            setShowModal(true);
          }}
          className="px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-amber-600/20"
        >
          <Plus className="w-4 h-4" /> Agregar al Almacén
        </button>
      </div>

      <div className="bg-slate-900/90 border border-slate-800 rounded-xl shadow-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
              <tr>
                <th className="py-3 px-4">Código / Equipo</th>
                <th className="py-3 px-4">Categoría / Marca</th>
                <th className="py-3 px-4">Serie / MAC</th>
                <th className="py-3 px-4">Stock Disponible</th>
                <th className="py-3 px-4">Costo Unit. (S/.)</th>
                <th className="py-3 px-4">Ubicación</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {items.map((i) => (
                <tr key={i.id} className="hover:bg-slate-800/40 transition">
                  <td className="py-3 px-4">
                    <div className="font-mono text-cyan-400 font-bold">{i.item_code}</div>
                    <div className="font-semibold text-slate-100">{i.name}</div>
                  </td>

                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded bg-slate-800 text-[10px] text-amber-300 font-medium mr-1.5">
                      {i.category}
                    </span>
                    <span className="text-slate-400">{i.brand_model}</span>
                  </td>

                  <td className="py-3 px-4 font-mono text-slate-300">
                    <div>{i.serial_number || "-"}</div>
                    <div className="text-[10px] text-slate-500">{i.mac_address}</div>
                  </td>

                  <td className="py-3 px-4">
                    <span className={`font-black text-sm ${i.stock < 10 ? "text-rose-400" : "text-emerald-400"}`}>
                      {i.stock} {i.unit}
                    </span>
                  </td>

                  <td className="py-3 px-4 font-bold text-slate-200">
                    S/. {Number(i.unit_cost).toFixed(2)}
                  </td>

                  <td className="py-3 px-4 text-slate-400">
                    {i.location}
                  </td>

                  <td className="py-3 px-4 text-center">
                    <button
                      onClick={() => handleDelete(i.id, i.name)}
                      className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/40 text-slate-400 hover:text-rose-400 border border-slate-700"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                <Package className="w-5 h-5 text-amber-400" /> Registrar Equipo en Almacén
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-200">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveItem} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Nombre del Producto / Equipo *</label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Ej. ONU XPON Gigabit Dual Band"
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Categoría *</label>
                  <select
                    value={formData.category}
                    onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="ONU GPON">ONU GPON</option>
                    <option value="Router WiFi">Router WiFi</option>
                    <option value="Cable Drop">Cable Drop</option>
                    <option value="Splitters">Splitters</option>
                    <option value="Conectores">Conectores Ópticos</option>
                    <option value="Herramientas">Herramientas / Fusionadora</option>
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Marca / Modelo *</label>
                  <input
                    type="text"
                    required
                    value={formData.brand_model}
                    onChange={(e) => setFormData({ ...formData, brand_model: e.target.value })}
                    placeholder="V-SOL / Huawei / TP-Link"
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Stock Inicial *</label>
                  <input
                    type="number"
                    required
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: parseInt(e.target.value) })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-emerald-400 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Costo Unitario (S/.) *</label>
                  <input
                    type="number"
                    step="0.10"
                    required
                    value={formData.unit_cost}
                    onChange={(e) => setFormData({ ...formData, unit_cost: parseFloat(e.target.value) })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-bold"
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
                  className="px-5 py-2 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-white font-semibold rounded-xl shadow-lg"
                >
                  Guardar en Almacén
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
