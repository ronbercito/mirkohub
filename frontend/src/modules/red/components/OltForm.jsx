/**
 * Archivo: frontend/src/modules/red/components/OltForm.jsx
 * Función: Formulario de registro / edición de una OLT VSOL, ordenado como en los paneles
 *          ISP clásicos: Nombre, Modelo (rellena tipo de PON y N° de puertos), Versión de
 *          software, Tipo de PON, IP de conexión, IP privada, puertos SSH / Telnet / SNMP,
 *          comunidades SNMP lectura y lectura-escritura, usuario y contraseña (con ojo para
 *          mostrarla), clave enable, y botones "Guardar" y "Guardar y Comprobar Conexión".
 * Trabaja con: modules/red/components/RouterForm.jsx (lo usa cuando el tipo es OLT),
 *              backend/app/routers/red/router.py (POST/PUT /api/routers?check=),
 *              backend/app/routers/red/schemas.py (RouterIn), backend/app/models/router.py
 */
import React, { useState } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { Eye, EyeOff, Radio, HelpCircle } from "lucide-react";
import { toast } from "sonner";

export const OLT_MODELS = [
  { id: "Vsol-V1600G1", pon: "GPON", ports: 4 }, { id: "Vsol-V1600G2", pon: "GPON", ports: 8 },
  { id: "Vsol-V1600GS", pon: "GPON", ports: 16 }, { id: "Vsol-V1600G-B", pon: "GPON", ports: 8 },
  { id: "Vsol-V1600X", pon: "GPON", ports: 8 }, { id: "Vsol-V2801", pon: "GPON", ports: 1 },
  { id: "Vsol-V2804", pon: "GPON", ports: 4 }, { id: "Vsol-V2808", pon: "GPON", ports: 8 },
  { id: "Vsol-V1600D2", pon: "EPON", ports: 2 }, { id: "Vsol-V1600D4", pon: "EPON", ports: 4 },
  { id: "Vsol-V1600D4-L", pon: "EPON", ports: 4 }, { id: "Vsol-V1600D8", pon: "EPON", ports: 8 },
  { id: "Vsol-V1600D8-L", pon: "EPON", ports: 8 }, { id: "Vsol-V1600D16", pon: "EPON", ports: 16 },
  { id: "Otro / Genérico", pon: "GPON", ports: 8 },
];

export const OLT_EMPTY = {
  name: "", device_type: "olt", ip_address: "", private_ip: "", olt_model: "Vsol-V1600G-B", software_version: "1.x",
  pon_type: "GPON", pon_ports: 8, protocol: "telnet", ssh_port: 22, telnet_port: 23, snmp_port: 161,
  snmp_community: "public", snmp_community_rw: "private", username: "admin", password: "", enable_password: "",
  model: "", location: "", latitude: "", longitude: "", port: 23, use_ssl: false, olt_profile: "vsol_gpon",
};

const Row = ({ label, help, children }) => (
  <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr] gap-1 sm:gap-4 items-center">
    <label className="text-xs text-slate-300 font-semibold flex items-center gap-1">
      {label}{help && <span title={help} className="text-slate-500 cursor-help"><HelpCircle className="w-3.5 h-3.5" /></span>}
    </label>
    <div>{children}</div>
  </div>
);

export default function OltForm({ initial, onClose, onSaved, onSwitchType }) {
  const { API, token } = useAuth();
  const isEdit = Boolean(initial?.id);
  const [form, setForm] = useState({ ...OLT_EMPTY, ...initial, password: "", enable_password: "" });
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const input = "w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 text-xs focus:border-cyan-500 outline-none";

  const changeModel = (id) => {
    const m = OLT_MODELS.find((x) => x.id === id);
    setForm((f) => ({ ...f, olt_model: id, model: id, pon_type: m?.pon || f.pon_type, pon_ports: m?.ports || f.pon_ports }));
  };

  const save = async (check) => {
    if (!form.name || !form.ip_address) return toast.error("Nombre e IP de conexión son obligatorios");
    setSaving(check ? "check" : "save");
    try {
      const headers = { Authorization: `Bearer ${token}` };
      const res = isEdit
        ? await axios.put(`${API}/routers/${initial.id}?check=${check}`, form, { headers })
        : await axios.post(`${API}/routers?check=${check}`, form, { headers });
      const c = res.data.connection;
      if (c) (c.ok ? toast.success : toast.warning)(c.ok ? c.message : `OLT guardada, pero no respondió: ${c.message}`);
      else toast.success(isEdit ? "OLT actualizada" : "OLT registrada");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Error al guardar la OLT");
    } finally {
      setSaving("");
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 max-h-[95vh] overflow-y-auto" data-testid="olt-form-modal">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <Radio className="w-5 h-5 text-cyan-400" /> {isEdit ? "Editar OLT" : "Registrar OLT VSOL"}
          </h3>
          <div className="flex items-center gap-3">
            {!isEdit && <button type="button" data-testid="olt-switch-mikrotik" onClick={onSwitchType} className="text-[11px] text-cyan-400 hover:underline">¿Es un MikroTik?</button>}
            <button onClick={onClose} className="text-slate-400 hover:text-slate-200" data-testid="olt-form-close">✕</button>
          </div>
        </div>

        <div className="space-y-3">
          <Row label="Nombre">
            <input data-testid="olt-name-input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="VSOL 8P Nodo Central" className={input} />
          </Row>
          <Row label="Modelo">
            <select data-testid="olt-model-select" value={form.olt_model} onChange={(e) => changeModel(e.target.value)} className={input}>
              {OLT_MODELS.map((m) => <option key={m.id} value={m.id}>{m.id} — {m.pon} {m.ports} PON</option>)}
            </select>
          </Row>
          <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr_auto_1fr] gap-1 sm:gap-4 items-center">
            <label className="text-xs text-slate-300 font-semibold">Software Version</label>
            <select data-testid="olt-software-select" value={form.software_version} onChange={(e) => set("software_version", e.target.value)} className={input}>
              <option value="1.x">1.x</option><option value="2.x">2.x</option>
            </select>
            <label className="text-xs text-slate-300 font-semibold">Tipo de PON</label>
            <select data-testid="olt-pon-type-select" value={form.pon_type} onChange={(e) => set("pon_type", e.target.value)} className={input}>
              <option value="GPON">GPON</option><option value="EPON">EPON</option>
            </select>
          </div>
          <Row label="N° puertos PON">
            <input data-testid="olt-pon-ports-input" type="number" min="1" max="64" value={form.pon_ports} onChange={(e) => set("pon_ports", parseInt(e.target.value) || 1)} className={`${input} font-mono`} />
          </Row>

          <div className="border-t border-slate-800 pt-3" />
          <Row label="IP Conexión" help="IP con la que este servidor llega a la OLT (puede ser pública o de la VPN).">
            <input data-testid="olt-ip-input" value={form.ip_address} onChange={(e) => set("ip_address", e.target.value)} placeholder="192.168.8.200" className={`${input} font-mono text-cyan-300`} />
          </Row>
          <Row label="IP Privada de la OLT" help="IP LAN real de la OLT si la IP de conexión es un NAT o VPN (solo informativa).">
            <input data-testid="olt-private-ip-input" value={form.private_ip} onChange={(e) => set("private_ip", e.target.value)} placeholder="192.168.8.200" className={`${input} font-mono`} />
          </Row>
          <Row label="Conectar por">
            <div className="flex gap-2">
              {["telnet", "ssh"].map((p) => (
                <button key={p} type="button" data-testid={`olt-proto-${p}`} onClick={() => set("protocol", p)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold border ${form.protocol === p ? "bg-cyan-600/20 text-cyan-300 border-cyan-600/50" : "bg-slate-950 text-slate-400 border-slate-700"}`}>
                  {p.toUpperCase()}
                </button>
              ))}
            </div>
          </Row>
          <Row label="Puerto SSH"><input data-testid="olt-ssh-port" type="number" value={form.ssh_port} onChange={(e) => set("ssh_port", parseInt(e.target.value) || 22)} className={`${input} font-mono`} /></Row>
          <Row label="Puerto Telnet"><input data-testid="olt-telnet-port" type="number" value={form.telnet_port} onChange={(e) => set("telnet_port", parseInt(e.target.value) || 23)} className={`${input} font-mono`} /></Row>
          <Row label="Puerto SNMP"><input data-testid="olt-snmp-port" type="number" value={form.snmp_port} onChange={(e) => set("snmp_port", parseInt(e.target.value) || 161)} className={`${input} font-mono`} /></Row>
          <Row label="Comunidad SNMP de Lectura"><input data-testid="olt-snmp-ro" value={form.snmp_community} onChange={(e) => set("snmp_community", e.target.value)} className={`${input} font-mono`} /></Row>
          <Row label="Comunidad SNMP Lectura y Escritura"><input data-testid="olt-snmp-rw" value={form.snmp_community_rw} onChange={(e) => set("snmp_community_rw", e.target.value)} className={`${input} font-mono`} /></Row>

          <div className="border-t border-slate-800 pt-3" />
          <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr_auto_1fr] gap-1 sm:gap-4 items-center">
            <label className="text-xs text-slate-300 font-semibold">Usuario</label>
            <input data-testid="olt-user-input" value={form.username} onChange={(e) => set("username", e.target.value)} className={`${input} font-mono`} />
            <label className="text-xs text-slate-300 font-semibold">Contraseña</label>
            <div className="flex">
              <input data-testid="olt-password-input" type={showPass ? "text" : "password"} value={form.password} onChange={(e) => set("password", e.target.value)} placeholder={isEdit ? "(vacío = mantener)" : ""} className={`${input} font-mono rounded-r-none`} />
              <button type="button" onClick={() => setShowPass(!showPass)} className="px-3 bg-slate-800 border border-l-0 border-slate-700 rounded-r-xl text-slate-300" data-testid="olt-toggle-pass">
                {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>
          <Row label="Clave enable" help="Clave del modo privilegiado (#). Si se deja vacía se usa la misma contraseña.">
            <input data-testid="olt-enable-password-input" type={showPass ? "text" : "password"} value={form.enable_password} onChange={(e) => set("enable_password", e.target.value)} placeholder={isEdit ? "(vacío = mantener)" : "igual a la contraseña"} className={`${input} font-mono`} />
          </Row>
          <Row label="Ubicación / Nodo">
            <input data-testid="olt-location-input" value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="Nodo Central" className={input} />
          </Row>
          <div className="grid grid-cols-1 sm:grid-cols-[190px_1fr_auto_1fr] gap-1 sm:gap-4 items-center">
            <label className="text-xs text-slate-300 font-semibold">Latitud</label>
            <input type="number" step="any" value={form.latitude ?? ""} onChange={(e) => set("latitude", e.target.value === "" ? "" : Number(e.target.value))} placeholder="-8.0679" className={`${input} font-mono`} />
            <label className="text-xs text-slate-300 font-semibold">Longitud</label>
            <input type="number" step="any" value={form.longitude ?? ""} onChange={(e) => set("longitude", e.target.value === "" ? "" : Number(e.target.value))} placeholder="-78.9859" className={`${input} font-mono`} />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-800">
          <button type="button" onClick={onClose} className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-xl">Cancelar</button>
          <button type="button" data-testid="olt-save-btn" disabled={!!saving} onClick={() => save(false)} className="px-4 py-2 bg-violet-600/80 hover:bg-violet-500 text-white text-xs font-semibold rounded-xl disabled:opacity-60">
            {saving === "save" ? "Guardando..." : "Guardar"}
          </button>
          <button type="button" data-testid="olt-save-check-btn" disabled={!!saving} onClick={() => save(true)} className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-xs font-semibold rounded-xl shadow-lg disabled:opacity-60">
            {saving === "check" ? "Conectando a la OLT..." : "Guardar y Comprobar Conexión"}
          </button>
        </div>
      </div>
    </div>
  );
}
