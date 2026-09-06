/**
 * Archivo: frontend/src/modules/red/IPv4Networks.jsx
 * Función: Gestión de inventario IPv4: registra subredes por MikroTik, muestra uso
 *          basado en clientes asignados y evita redes superpuestas en cada router.
 * Alcance: planifica y valida direcciones; no crea IPs, pools, DHCP ni rutas en RouterOS.
 * Trabaja con: backend/app/routers/red/ipv4_networks.py, modules/clientes/Clients.jsx.
 */
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { Network, Plus, Search, Router, Users, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";

const EMPTY = { name: "", network_address: "", prefix_length: 24, router_id: "", usage_type: "static" };
const TYPES = { static: "Estática", dhcp: "DHCP", pppoe_pool: "Pool PPPoE" };

export default function IPv4Networks() {
  const { API, token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [networks, setNetworks] = useState([]);
  const [routers, setRouters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  const load = async () => {
    setLoading(true);
    try {
      const [networkRes, routerRes] = await Promise.all([
        axios.get(`${API}/ipv4-networks`, { headers }),
        axios.get(`${API}/routers`, { headers }),
      ]);
      setNetworks(networkRes.data);
      setRouters(routerRes.data.filter((router) => router.device_type === "mikrotik"));
    } catch (error) {
      toast.error(error?.response?.data?.detail || "No se pudieron cargar las redes IPv4");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const rows = useMemo(() => networks.filter((network) => {
    const value = search.trim().toLowerCase();
    return !value || [network.name, network.cidr, network.router_name, TYPES[network.usage_type]]
      .some((field) => String(field || "").toLowerCase().includes(value));
  }), [networks, search]);

  const openNew = () => {
    setEditing(null);
    setForm({ ...EMPTY, router_id: routers[0]?.id || "" });
  };

  const save = async (event) => {
    event.preventDefault();
    try {
      if (editing) {
        await axios.put(`${API}/ipv4-networks/${editing.id}`, form, { headers });
        toast.success("Red IPv4 actualizada");
      } else {
        await axios.post(`${API}/ipv4-networks`, form, { headers });
        toast.success("Red IPv4 registrada");
      }
      setEditing(null);
      await load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "No se pudo guardar la red IPv4");
    }
  };

  const remove = async (network) => {
    if (!window.confirm(`¿Eliminar la red "${network.name}"?`)) return;
    try {
      await axios.delete(`${API}/ipv4-networks/${network.id}`, { headers });
      toast.success("Red IPv4 eliminada");
      load();
    } catch (error) {
      toast.error(error?.response?.data?.detail || "No se pudo eliminar la red");
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200" data-testid="ipv4-networks-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <Network className="w-6 h-6 text-cyan-400" /> Redes IPv4
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Inventario de redes vinculadas a MikroTiks y clientes con IP asignada.
          </p>
        </div>
        <button onClick={openNew} className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-semibold rounded-xl flex items-center gap-2 shadow-lg shadow-cyan-600/20">
          <Plus className="w-4 h-4" /> Nueva red IPv4
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Summary icon={Network} label="Redes registradas" value={networks.length} />
        <Summary icon={Users} label="IPs asignadas" value={networks.reduce((sum, item) => sum + item.used_ips, 0)} />
        <Summary icon={Router} label="MikroTiks vinculados" value={new Set(networks.map((item) => item.router_id)).size} />
      </div>

      <div className="bg-slate-900/90 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between gap-3">
          <div className="relative w-full max-w-md">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar red, CIDR o MikroTik..."
              className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100" />
          </div>
          <span className="text-xs text-slate-500 whitespace-nowrap">{rows.length} red(es)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase border-b border-slate-800">
              <tr><th className="p-3">Nombre / Red</th><th className="p-3">Uso de IPs</th><th className="p-3">MikroTik</th><th className="p-3">Tipo</th><th className="p-3 text-right">Acciones</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {loading ? <tr><td colSpan="5" className="p-8 text-center text-slate-500">Cargando redes...</td></tr>
                : rows.length === 0 ? <tr><td colSpan="5" className="p-8 text-center text-slate-500">Aún no hay redes IPv4 registradas.</td></tr>
                : rows.map((network) => <tr key={network.id} className="hover:bg-slate-800/40">
                  <td className="p-3"><p className="font-bold text-slate-100">{network.name}</p><p className="font-mono text-cyan-300 mt-1">{network.cidr}</p></td>
                  <td className="p-3 min-w-44"><div className="flex justify-between text-[11px] text-slate-400 mb-1"><span>{network.used_ips} asignadas</span><span>{network.usable_hosts} disponibles</span></div><div className="h-2 rounded-full bg-slate-800 overflow-hidden"><div className="h-full bg-cyan-500" style={{ width: `${Math.min(network.usage_percent, 100)}%` }} /></div></td>
                  <td className="p-3 text-slate-200">{network.router_name}</td>
                  <td className="p-3"><span className="px-2 py-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 font-semibold">{TYPES[network.usage_type] || network.usage_type}</span></td>
                  <td className="p-3"><div className="flex justify-end gap-2"><button onClick={() => { setEditing(network); setForm({ name: network.name, network_address: network.network_address, prefix_length: network.prefix_length, router_id: network.router_id, usage_type: network.usage_type }); }} className="p-1.5 rounded-lg bg-slate-800 text-slate-300 border border-slate-700"><Pencil className="w-3.5 h-3.5" /></button><button onClick={() => remove(network)} className="p-1.5 rounded-lg bg-slate-800 text-rose-400 border border-slate-700"><Trash2 className="w-3.5 h-3.5" /></button></div></td>
                </tr>)}
            </tbody>
          </table>
        </div>
      </div>

      {(editing !== null || editing === null && form !== EMPTY) && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm p-4 flex items-center justify-center">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl">
            <div className="flex justify-between items-center pb-3 border-b border-slate-800"><h3 className="font-bold text-slate-100">{editing ? "Editar red IPv4" : "Nueva red IPv4"}</h3><button onClick={() => { setEditing(null); setForm(EMPTY); }} className="text-slate-400"><X className="w-5 h-5" /></button></div>
            <form onSubmit={save} className="pt-4 space-y-4 text-xs">
              <Field label="Nombre de la red"><input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ej. RED 15" className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100" /></Field>
              <Field label="MikroTik"><select required value={form.router_id} onChange={(e) => setForm({ ...form, router_id: e.target.value })} className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"><option value="" disabled>Selecciona un MikroTik</option>{routers.map((router) => <option key={router.id} value={router.id}>{router.name} ({router.ip_address})</option>)}</select></Field>
              <div className="grid grid-cols-3 gap-3"><div className="col-span-2"><Field label="Dirección de red"><input required value={form.network_address} onChange={(e) => setForm({ ...form, network_address: e.target.value })} placeholder="192.168.15.0" className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-mono" /></Field></div><Field label="CIDR"><select value={form.prefix_length} onChange={(e) => setForm({ ...form, prefix_length: Number(e.target.value) })} className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100">{[30,29,28,27,26,25,24,23,22,21,20,19,18,17,16].map((prefix) => <option key={prefix} value={prefix}>/{prefix}</option>)}</select></Field></div>
              <Field label="Tipo de uso"><select value={form.usage_type} onChange={(e) => setForm({ ...form, usage_type: e.target.value })} className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"><option value="static">IP estática</option><option value="dhcp">DHCP</option><option value="pppoe_pool">Pool PPPoE</option></select></Field>
              <p className="text-[11px] text-slate-500">Esta acción registra el inventario y su vínculo con el MikroTik; no modifica la configuración RouterOS.</p>
              <div className="flex justify-end gap-2 pt-2"><button type="button" onClick={() => { setEditing(null); setForm(EMPTY); }} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300">Cancelar</button><button type="submit" className="px-4 py-2 rounded-xl bg-cyan-500 text-white font-semibold">Guardar red</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
const Summary = ({ icon: Icon, label, value }) => <div className="rounded-xl border border-slate-800 bg-slate-900/90 p-4"><p className="text-[10px] uppercase tracking-wide text-slate-500 flex gap-1 items-center"><Icon className="w-3 h-3" /> {label}</p><p className="text-xl font-black text-slate-100 mt-2">{value}</p></div>;
const Field = ({ label, children }) => <label className="block text-slate-300 font-semibold space-y-1"><span>{label}</span>{children}</label>;
