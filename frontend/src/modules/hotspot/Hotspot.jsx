/**
 * Archivo: frontend/src/modules/hotspot/Hotspot.jsx
 * Función: Módulo Fichas Hotspot: generación de lotes de pines prepago por perfil (1h, 1d, 1sem, 1mes), creación opcional de los usuarios en un MikroTik real (/ip/hotspot/user), venta e impresión de tarjetas.
 * Trabaja con: backend/app/routers/hotspot/router.py (/api/hotspot/*), backend/app/routers/red/router.py (/api/routers)
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { Wifi, Plus, Printer, CheckCircle2, DollarSign, Clock, ShieldCheck, QrCode } from "lucide-react";
import { toast } from "sonner";

export default function Hotspot() {
  const { API, token } = useAuth();
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const [batchData, setBatchData] = useState({
    profile_name: "1 Día (S/. 3.00)",
    duration_hours: 24,
    price: 3.0,
    download_mbps: 15,
    upload_mbps: 8,
    quantity: 10,
    comment: "",
    router_id: "",
    hotspot_profile: "default"
  });
  const [routers, setRouters] = useState([]);

  const fetchVouchers = async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API}/hotspot/vouchers`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setVouchers(res.data);
    } catch (e) {
      toast.error("Error al cargar fichas");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVouchers();
    axios.get(`${API}/routers`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => setRouters(r.data.filter((x) => x.device_type === "mikrotik")))
      .catch(() => {});
  }, []);

  const handleProfileChange = (val) => {
    if (val === "1h") {
      setBatchData(prev => ({ ...prev, profile_name: "1 Hora (S/. 1.00)", duration_hours: 1, price: 1.0, download_mbps: 10, upload_mbps: 5 }));
    } else if (val === "1d") {
      setBatchData(prev => ({ ...prev, profile_name: "1 Día (S/. 3.00)", duration_hours: 24, price: 3.0, download_mbps: 15, upload_mbps: 8 }));
    } else if (val === "1w") {
      setBatchData(prev => ({ ...prev, profile_name: "1 Semana (S/. 10.00)", duration_hours: 168, price: 10.0, download_mbps: 20, upload_mbps: 10 }));
    } else if (val === "1m") {
      setBatchData(prev => ({ ...prev, profile_name: "1 Mes (S/. 25.00)", duration_hours: 720, price: 25.0, download_mbps: 25, upload_mbps: 10 }));
    }
  };

  const handleGenerateBatch = async (e) => {
    e.preventDefault();
    try {
      const res = await axios.post(`${API}/hotspot/generate-batch`, batchData, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success(res.data.message);
      if (res.data.mikrotik) (res.data.mikrotik.ok ? toast.success : toast.warning)(res.data.mikrotik.message);
      setShowModal(false);
      fetchVouchers();
    } catch (e) {
      toast.error("Error al generar lote de fichas");
    }
  };

  const handleMarkSold = async (id) => {
    try {
      await axios.post(`${API}/hotspot/vouchers/${id}/mark-sold`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      toast.success("Ficha marcada como vendida");
      fetchVouchers();
    } catch (e) {
      toast.error("Error al actualizar");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Wifi className="w-6 h-6 text-cyan-400" /> Fichas Hotspot y Pines Wi-Fi Prepago
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Generador de pines por tiempo, venta en bodegas e impresión de tarjetas de acceso
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => window.print()}
            className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold rounded-xl flex items-center gap-1.5 transition"
          >
            <Printer className="w-4 h-4 text-cyan-400" /> Imprimir Fichas
          </button>
          <button
            data-testid={TEST_IDS.BTN_GENERATE_HOTSPOT}
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-cyan-600/20"
          >
            <Plus className="w-4 h-4" /> Generar Lote de Fichas
          </button>
        </div>
      </div>

      {/* Cards Grid formatted for voucher distribution */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {vouchers.map((v) => (
          <div
            key={v.id}
            className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-xl relative overflow-hidden flex flex-col justify-between"
          >
            <div className="flex justify-between items-start mb-2">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  <Wifi className="w-4 h-4" />
                </div>
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">FibraZ Hotspot</span>
                  <h4 className="text-sm font-bold text-slate-100">{v.profile_name}</h4>
                </div>
              </div>

              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                v.status === "available" ? "bg-emerald-500/20 text-emerald-300" : "bg-slate-800 text-slate-400"
              }`}>
                {v.status === "available" ? "DISPONIBLE" : "VENDIDA"}
              </span>
            </div>

            <div className="my-3 p-3 bg-slate-950 rounded-xl border border-dashed border-cyan-500/40 text-center">
              <p className="text-[10px] text-slate-400 uppercase font-medium">PIN DE ACCESO</p>
              <p className="text-xl font-mono font-black tracking-widest text-cyan-300">{v.pin_code}</p>
              <p className="text-[10px] text-slate-500 mt-0.5">{v.download_mbps}M / {v.upload_mbps}M de velocidad</p>
            </div>

            <div className="pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
              <div>
                <span className="text-slate-400 text-[11px]">Precio: </span>
                <span className="font-bold text-emerald-400 text-sm">S/. {Number(v.price).toFixed(2)}</span>
              </div>

              {v.status === "available" ? (
                <button
                  onClick={() => handleMarkSold(v.id)}
                  className="px-2.5 py-1 bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 rounded-lg text-[11px] font-bold border border-cyan-500/30"
                >
                  Vender S/.
                </button>
              ) : (
                <span className="text-[11px] text-slate-500 font-medium">Vendida</span>
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
                <Wifi className="w-5 h-5 text-cyan-400" /> Generador Masivo de Fichas Wi-Fi
              </h3>
              <button onClick={() => setShowModal(false)} className="text-slate-400 hover:text-slate-200">
                ✕
              </button>
            </div>

            <form onSubmit={handleGenerateBatch} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-semibold mb-1">Tipo de Plan / Tarifa *</label>
                <select
                  onChange={(e) => handleProfileChange(e.target.value)}
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                >
                  <option value="1d">1 Día Completo — S/. 3.00 (15 Mbps)</option>
                  <option value="1h">1 Hora — S/. 1.00 (10 Mbps)</option>
                  <option value="1w">1 Semana — S/. 10.00 (20 Mbps)</option>
                  <option value="1m">1 Mes Prepago — S/. 25.00 (25 Mbps)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Cantidad de Fichas *</label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    required
                    value={batchData.quantity}
                    onChange={(e) => setBatchData({ ...batchData, quantity: parseInt(e.target.value) })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-cyan-400 font-bold"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Precio Unitario (S/.) *</label>
                  <input
                    type="number"
                    step="0.50"
                    required
                    value={batchData.price}
                    onChange={(e) => setBatchData({ ...batchData, price: parseFloat(e.target.value) })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Punto de Venta / Comentario</label>
                <input
                  type="text"
                  value={batchData.comment}
                  onChange={(e) => setBatchData({ ...batchData, comment: e.target.value })}
                  placeholder="Ej. Bodega Don Lucho - Plaza Principal"
                  className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Crear en MikroTik (opcional)</label>
                  <select
                    data-testid="hotspot-router-select"
                    value={batchData.router_id}
                    onChange={(e) => setBatchData({ ...batchData, router_id: e.target.value })}
                    className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
                  >
                    <option value="">Solo en el panel</option>
                    {routers.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.ip_address})</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Perfil Hotspot (RouterOS)</label>
                  <input
                    type="text"
                    data-testid="hotspot-profile-input"
                    value={batchData.hotspot_profile}
                    onChange={(e) => setBatchData({ ...batchData, hotspot_profile: e.target.value })}
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
                  Generar {batchData.quantity} Fichas
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
