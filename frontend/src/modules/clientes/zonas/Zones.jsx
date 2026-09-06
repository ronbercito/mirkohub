/**
 * Archivo: frontend/src/modules/clientes/zonas/Zones.jsx
 * Función: Administración del catálogo de zonas para clientes.
 * Trabaja con: backend/app/routers/clientes/zones.py.
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Zones() {
  const { API, token } = useAuth(), headers = { Authorization: `Bearer ${token}` };
  const [rows, setRows] = useState([]), [name, setName] = useState(""), [description, setDescription] = useState("");
  const load = async () => { try { setRows((await axios.get(`${API}/zones`, { headers })).data); } catch { toast.error("No se pudieron cargar las zonas"); } };
  useEffect(() => { load(); }, []);
  const save = async (e) => { e.preventDefault(); try { await axios.post(`${API}/zones`, { name, description }, { headers }); setName(""); setDescription(""); toast.success("Zona registrada"); load(); } catch (e) { toast.error(e.response?.data?.detail || "No se pudo guardar la zona"); } };
  const remove = async (row) => { if (!window.confirm(`¿Eliminar la zona "${row.name}"?`)) return; try { await axios.delete(`${API}/zones/${row.id}`, { headers }); load(); } catch { toast.error("No se pudo eliminar"); } };
  return <div className="space-y-6"><div><h2 className="text-2xl font-bold text-slate-100 flex gap-2 items-center"><MapPin className="text-cyan-400" /> Zonas</h2><p className="text-xs text-slate-400 mt-1">Clasifica las instalaciones para asignarlas a cada abonado.</p></div><form onSubmit={save} className="rounded-2xl bg-slate-900 border border-slate-800 p-5 grid grid-cols-1 md:grid-cols-[1fr_2fr_auto] gap-3"><input required value={name} onChange={e=>setName(e.target.value)} placeholder="Nombre de zona, ej. VR2" className="p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100" /><input value={description} onChange={e=>setDescription(e.target.value)} placeholder="Referencia o detalle opcional" className="p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-sm text-slate-100" /><button className="px-4 py-2 bg-cyan-500 text-white rounded-xl text-sm font-semibold flex gap-2 items-center justify-center"><Plus className="w-4 h-4" /> Agregar</button></form><div className="rounded-2xl bg-slate-900 border border-slate-800 divide-y divide-slate-800">{rows.length ? rows.map(row=><div key={row.id} className="p-4 flex justify-between gap-3"><div><b className="text-slate-100">{row.name}</b><p className="text-xs text-slate-400 mt-1">{row.description || "Sin detalle"}</p></div><button onClick={()=>remove(row)} className="text-rose-400"><Trash2 className="w-4 h-4" /></button></div>) : <p className="p-8 text-center text-sm text-slate-500">Aún no hay zonas registradas.</p>}</div></div>;
}
