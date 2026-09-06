/**
 * Archivo: frontend/src/modules/red/NapBoxes.jsx
 * Función: Gestión de cajas NAP: registro físico, ubicación, capacidad y visualización
 *          de puertos libres u ocupados por clientes.
 * Alcance: inventario y vínculo con Clientes; no realiza acciones sobre OLT/MikroTik.
 * Trabaja con: backend/app/routers/red/nap_boxes.py, modules/clientes/Clients.jsx.
 */
import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { Box, Plus, Search, MapPin, Pencil, Trash2, X, Cable } from "lucide-react";
import { toast } from "sonner";

const EMPTY = { name: "", location: "", latitude: "", longitude: "", ports: 8, details: "" };

export default function NapBoxes() {
  const { API, token } = useAuth();
  const headers = { Authorization: `Bearer ${token}` };
  const [boxes, setBoxes] = useState([]);
  const [search, setSearch] = useState("");
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);

  const load = async () => {
    try { setBoxes((await axios.get(`${API}/nap-boxes`, { headers })).data); }
    catch (e) { toast.error(e?.response?.data?.detail || "No se pudieron cargar las cajas NAP"); }
  };
  useEffect(() => { load(); }, []);
  const rows = useMemo(() => boxes.filter((box) => [box.name, box.location, box.details].join(" ").toLowerCase().includes(search.toLowerCase())), [boxes, search]);
  const close = () => { setOpen(false); setEditing(null); setForm(EMPTY); };
  const save = async (event) => {
    event.preventDefault();
    const payload = { ...form, latitude: form.latitude === "" ? null : Number(form.latitude), longitude: form.longitude === "" ? null : Number(form.longitude), ports: Number(form.ports) };
    try {
      if (editing) await axios.put(`${API}/nap-boxes/${editing.id}`, payload, { headers });
      else await axios.post(`${API}/nap-boxes`, payload, { headers });
      toast.success(editing ? "Caja NAP actualizada" : "Caja NAP registrada");
      close(); load();
    } catch (e) { toast.error(e?.response?.data?.detail || "No se pudo guardar la caja NAP"); }
  };
  const remove = async (box) => {
    if (!window.confirm(`¿Eliminar la caja "${box.name}"?`)) return;
    try { await axios.delete(`${API}/nap-boxes/${box.id}`, { headers }); toast.success("Caja NAP eliminada"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "No se pudo eliminar la caja"); }
  };

  return <div className="space-y-6 animate-in fade-in duration-200">
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
      <div><h2 className="text-2xl font-bold text-slate-100 flex items-center gap-2"><Box className="w-6 h-6 text-cyan-400" /> Cajas NAP</h2><p className="text-xs text-slate-400 mt-1">Inventario de cajas de distribución y puertos asignados a clientes.</p></div>
      <button onClick={() => { setForm(EMPTY); setEditing(null); setOpen(true); }} className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white text-xs font-semibold rounded-xl flex gap-2 items-center"><Plus className="w-4 h-4" /> Nueva caja NAP</button>
    </div>
    <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
      <div className="p-4 border-b border-slate-800"><div className="relative max-w-md"><Search className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar caja, ubicación o detalle..." className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-slate-100" /></div></div>
      {rows.length === 0 ? <div className="p-10 text-center text-sm text-slate-500">Aún no hay cajas NAP registradas.</div> :
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">{rows.map(box => <div key={box.id} className="rounded-xl border border-slate-800 bg-slate-950/50 p-4">
          <div className="flex justify-between gap-3"><div><h3 className="font-bold text-slate-100">{box.name}</h3><p className="text-xs text-slate-400 mt-1 flex gap-1"><MapPin className="w-3.5 h-3.5" /> {box.location || "Ubicación sin registrar"}</p></div><div className="flex h-fit gap-1"><button onClick={() => { setEditing(box); setForm({ name: box.name, location: box.location, latitude: box.latitude ?? "", longitude: box.longitude ?? "", ports: box.ports, details: box.details }); setOpen(true); }} className="p-1.5 rounded-lg bg-slate-800 text-slate-300"><Pencil className="w-3.5 h-3.5" /></button><button onClick={() => remove(box)} className="p-1.5 rounded-lg bg-slate-800 text-rose-400"><Trash2 className="w-3.5 h-3.5" /></button></div></div>
          <div className="mt-4 flex flex-wrap gap-1.5">{Array.from({ length: box.ports }, (_, i) => i + 1).map(port => { const client = box.assigned_ports[String(port)] || box.assigned_ports[port]; return <span key={port} title={client ? client.client_name : `Puerto ${port} libre`} className={`w-8 h-8 rounded-lg text-xs font-bold flex items-center justify-center ${client ? "bg-rose-500/20 text-rose-300 border border-rose-500/30" : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/25"}`}>{port}</span>; })}</div>
          <div className="mt-3 text-xs text-slate-400 flex justify-between"><span>{box.used_ports} de {box.ports} puertos usados</span><span>{box.details || "Sin detalles"}</span></div>
        </div>)}</div>}
    </div>
    {open && <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm p-4 flex items-center justify-center"><div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl"><div className="flex justify-between pb-3 border-b border-slate-800"><h3 className="font-bold text-slate-100">{editing ? "Editar caja NAP" : "Nueva caja NAP"}</h3><button onClick={close} className="text-slate-400"><X /></button></div><form onSubmit={save} className="pt-4 space-y-3 text-xs"><Field label="Nombre"><input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="Ej. NAP 10" /></Field><Field label="Ubicación"><input value={form.location} onChange={e=>setForm({...form,location:e.target.value})} placeholder="Ej. VR2 / Av. Perú" /></Field><div className="grid grid-cols-2 gap-3"><Field label="Latitud"><input type="number" step="any" value={form.latitude} onChange={e=>setForm({...form,latitude:e.target.value})} placeholder="-8.067" /></Field><Field label="Longitud"><input type="number" step="any" value={form.longitude} onChange={e=>setForm({...form,longitude:e.target.value})} placeholder="-78.985" /></Field></div><Field label="Puertos"><input required type="number" min="1" max="128" value={form.ports} onChange={e=>setForm({...form,ports:e.target.value})} /></Field><Field label="Detalles"><textarea value={form.details} onChange={e=>setForm({...form,details:e.target.value})} placeholder="Poste, splitter, alimentación..." /></Field><div className="flex justify-end gap-2 pt-3"><button type="button" onClick={close} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300">Cancelar</button><button className="px-4 py-2 rounded-xl bg-cyan-500 text-white font-semibold">Guardar caja</button></div></form></div></div>}
  </div>;
}
const Field = ({ label, children }) => <label className="block text-slate-300 font-semibold space-y-1"><span>{label}</span>{React.cloneElement(children, { className: "w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100" })}</label>;
