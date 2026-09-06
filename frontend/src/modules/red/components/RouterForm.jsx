/**
 * Archivo: frontend/src/modules/red/components/RouterForm.jsx
 * Función: Formulario modal para registrar o editar un MikroTik: IP, puerto API (8728 / 8729 SSL),
 *          usuario/contraseña RouterOS, modelo y ubicación. Si el tipo elegido es "OLT" delega
 *          en OltForm.jsx (formulario específico de OLT VSOL).
 *          Al guardar un MikroTik, el backend intenta conectarse de inmediato y devuelve el resultado.
 * Trabaja con: modules/red/Network.jsx, backend/app/routers/red/router.py (POST/PUT /api/routers),
 *              backend/app/routers/red/schemas.py (RouterIn)
 */
import React, { useState } from "react";
import OltForm from "./OltForm";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { Server } from "lucide-react";
import { toast } from "sonner";

const EMPTY = { name: "", device_type: "mikrotik", ip_address: "", port: 8728, use_ssl: false, username: "admin", password: "", model: "", location: "" };

export default function RouterForm({ initial, onClose, onSaved }) {
  const { API, token } = useAuth();
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState({ ...EMPTY, ...initial, password: "" });
  const [saving, setSaving] = useState(false);
  const isOlt = form.device_type === "olt";
  const changeType = (t) => setForm((f) => ({ ...f, device_type: t, port: t === "olt" ? 23 : 8728 }));
  if (isOlt) {
    return <OltForm initial={isEdit ? initial : { name: form.name, ip_address: form.ip_address }} onClose={onClose} onSaved={onSaved} onSwitchType={() => changeType("mikrotik")} />;
  }
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const input = "w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 text-xs focus:border-cyan-500 outline-none";

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const res = isEdit
        ? await axios.put(`${API}/routers/${initial.id}`, form, { headers })
        : await axios.post(`${API}/routers`, form, { headers });
      if (res.data.connection) {
        res.data.connection.ok ? toast.success(res.data.connection.message) : toast.warning(`Equipo guardado. ${res.data.connection.message}`);
      } else {
        toast.success("Equipo actualizado");
      }
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Error al guardar el equipo");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4" data-testid="router-form-modal">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-400" /> {isEdit ? "Editar equipo" : "Registrar MikroTik / OLT"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200" data-testid="router-form-close">✕</button>
        </div>

        <form onSubmit={submit} className="space-y-3 text-xs">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Nombre descriptivo *</label>
              <input data-testid="router-name-input" required value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Ej. MikroTik Core Nodo Central" className={input} />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Tipo</label>
              <select data-testid="router-type-select" value={form.device_type} onChange={(e) => changeType(e.target.value)} className={input}>
                <option value="mikrotik">MikroTik (API RouterOS)</option>
                <option value="olt">OLT VSOL (CLI Telnet/SSH)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Dirección IP *</label>
              <input data-testid="router-ip-input" required value={form.ip_address} onChange={(e) => set("ip_address", e.target.value)} placeholder="192.168.88.1" className={`${input} font-mono text-cyan-300`} />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Puerto API</label>
              <input data-testid="router-port-input" type="number" value={form.port} onChange={(e) => set("port", parseInt(e.target.value) || 8728)} className={`${input} font-mono`} />
            </div>
          </div>


          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Usuario API</label>
              <input data-testid="router-user-input" value={form.username} onChange={(e) => set("username", e.target.value)} className={`${input} font-mono`} />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Contraseña {isEdit && <span className="text-slate-500">(vacío = mantener)</span>}</label>
              <input data-testid="router-password-input" type="password" value={form.password} onChange={(e) => set("password", e.target.value)} className={`${input} font-mono`} />
            </div>
          </div>

          <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
            <input data-testid="router-ssl-checkbox" type="checkbox" checked={form.use_ssl} onChange={(e) => { set("use_ssl", e.target.checked); set("port", e.target.checked ? 8729 : 8728); }} className="accent-cyan-500" />
            Usar API-SSL (puerto 8729)
          </label>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Modelo</label>
              <input data-testid="router-model-input" value={form.model} onChange={(e) => set("model", e.target.value)} placeholder="CCR2004 / RB4011 / hEX" className={input} />
            </div>
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Ubicación / Nodo</label>
              <input data-testid="router-location-input" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Nodo Central" className={input} />
            </div>
          </div>

          <p className="text-[11px] text-slate-500 bg-slate-950/60 border border-slate-800 rounded-lg p-2">
            En el MikroTik: <span className="font-mono text-slate-300">/ip service enable api</span> (o api-ssl) y un usuario con políticas <span className="font-mono text-slate-300">read, write, api</span>. Permite el acceso desde la IP de este servidor.
          </p>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
            <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold rounded-xl">Cancelar</button>
            <button data-testid="router-form-submit" type="submit" disabled={saving} className="px-5 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-semibold rounded-xl shadow-lg disabled:opacity-60">
              {saving ? "Conectando..." : isEdit ? "Guardar cambios" : "Guardar y probar conexión"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
