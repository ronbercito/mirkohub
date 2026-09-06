/**
 * Archivo: frontend/src/modules/red/monitoring/Monitoring.jsx
 * Función: Inventario de equipos inalámbricos disponibles para instalaciones.
 * Trabaja con: backend/app/routers/red/monitoring.py.
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../context/AuthContext";
import { Radio, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function Monitoring() {
  const { API, token } = useAuth(), headers = { Authorization: `Bearer ${token}` };
  const empty={name:"",ip_address:"",equipment_type:"",location:"",details:""};
  const [rows,setRows]=useState([]),[form,setForm]=useState(empty);
  const load=async()=>{try{setRows((await axios.get(`${API}/monitoring-equipment`,{headers})).data)}catch{toast.error("No se pudieron cargar los equipos")}};
  useEffect(()=>{load()},[]);
  const save=async e=>{e.preventDefault();try{await axios.post(`${API}/monitoring-equipment`,form,{headers});setForm(empty);toast.success("Equipo registrado");load()}catch(e){toast.error(e.response?.data?.detail||"No se pudo guardar el equipo")}};
  const remove=async row=>{if(!window.confirm(`¿Eliminar "${row.name}"?`))return;try{await axios.delete(`${API}/monitoring-equipment/${row.id}`,{headers});load()}catch{toast.error("No se pudo eliminar")}};
  const field=(key,label,placeholder)=><label className="text-xs text-slate-300 font-semibold space-y-1"><span>{label}</span><input value={form[key]} onChange={e=>setForm({...form,[key]:e.target.value})} placeholder={placeholder} className="block w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100" /></label>;
  return <div className="space-y-6"><div><h2 className="text-2xl font-bold text-slate-100 flex gap-2 items-center"><Radio className="text-cyan-400" /> Monitoreo</h2><p className="text-xs text-slate-400 mt-1">Equipos y nodos inalámbricos disponibles para conectar abonados.</p></div><form onSubmit={save} className="rounded-2xl bg-slate-900 border border-slate-800 p-5 grid grid-cols-1 md:grid-cols-2 gap-3">{field("name","Nombre *","AP Cerro / Torre Norte")}{field("ip_address","IP del equipo","192.168.x.x")}{field("equipment_type","Tipo de equipo","Rocket, LiteAP, BaseBox...")}{field("location","Ubicación","Zona / torre")}{field("details","Detalles","Sector, frecuencia, observación...")}<button className="md:col-span-2 px-4 py-2 bg-cyan-500 text-white rounded-xl text-sm font-semibold flex gap-2 justify-center"><Plus className="w-4 h-4" /> Registrar equipo</button></form><div className="rounded-2xl bg-slate-900 border border-slate-800 divide-y divide-slate-800">{rows.length?rows.map(row=><div key={row.id} className="p-4 flex justify-between"><div><b className="text-slate-100">{row.name}</b><p className="text-xs text-cyan-300 mt-1">{row.ip_address||"Sin IP"} · {row.equipment_type||"Sin tipo"} · {row.location||"Sin ubicación"}</p></div><button onClick={()=>remove(row)} className="text-rose-400"><Trash2 className="w-4 h-4"/></button></div>):<p className="p-8 text-center text-sm text-slate-500">Aún no hay equipos registrados.</p>}</div></div>;
}
