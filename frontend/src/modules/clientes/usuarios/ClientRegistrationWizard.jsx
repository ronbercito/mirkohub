/**
 * Archivo: frontend/src/modules/clientes/usuarios/ClientRegistrationWizard.jsx
 * Función: Registro guiado de clientes en tres pasos: datos personales,
 *          facturación y servicio técnico.
 * Alcance: organiza la interfaz; conserva el guardado y aprovisionamiento definidos
 *          en Clients.jsx, sin alterar la lógica de MikroTik, NAP o redes IPv4.
 * Trabaja con: ../Clients.jsx, planes, routers, redes IPv4 y cajas NAP.
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { Check, ChevronLeft, ChevronRight, CreditCard, UserRound, Wifi, X } from "lucide-react";
import { toast } from "sonner";

const Step = ({ number, label, subtitle, active, done, onClick }) => (
  <button type="button" onClick={onClick} className={`flex-1 min-w-44 text-left p-4 border-b-2 transition ${active ? "border-cyan-400 bg-cyan-500/10" : "border-transparent hover:bg-slate-800/50"}`}>
    <div className="flex gap-2 items-center"><span className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${active ? "bg-cyan-500 text-white" : done ? "bg-emerald-500 text-slate-950" : "bg-slate-800 text-slate-400"}`}>{done ? <Check className="w-4 h-4" /> : number}</span><div><p className="text-xs font-bold text-slate-100">{label}</p><p className="text-[10px] text-slate-400">{subtitle}</p></div></div>
  </button>
);

export default function ClientRegistrationWizard({ selectedClient, formData, setFormData, plans, routers, ipv4Networks, napBoxes, onClose, onSubmit, api, token }) {
  const [step, setStep] = useState(1);
  const activePlans = plans.filter((plan) => plan.is_active);
  const mikrotiks = routers.filter((router) => router.device_type === "mikrotik");
  const connectionUsage = { "PPPoE": "pppoe_pool", "IP Estática": "static", "DHCP": "dhcp" }[formData.connection_type] || "pppoe_pool";
  const networks = ipv4Networks.filter((network) => network.router_id === formData.router_id && network.usage_type === connectionUsage);
  const nap = napBoxes.find((box) => box.id === formData.nap_box_id);
  const [availableAddresses, setAvailableAddresses] = useState([]);
  const [loadingAddresses, setLoadingAddresses] = useState(false);

  useEffect(() => {
    if (!formData.ipv4_network_id || formData.connection_type === "PPPoE") {
      setAvailableAddresses([]);
      return;
    }
    let active = true;
    setLoadingAddresses(true);
    axios.get(`${api}/ipv4-networks/${formData.ipv4_network_id}/available-addresses`, {
      params: { exclude_client_id: selectedClient?.id || "" },
      headers: { Authorization: `Bearer ${token}` }
    }).then((response) => {
      if (active) setAvailableAddresses(response.data.addresses || []);
    }).catch(() => {
      if (active) {
        setAvailableAddresses([]);
        toast.error("No se pudieron consultar las IPs disponibles.");
      }
    }).finally(() => { if (active) setLoadingAddresses(false); });
    return () => { active = false; };
  }, [api, token, selectedClient?.id, formData.connection_type, formData.ipv4_network_id]);

  const next = () => {
    if (step === 1 && (!formData.full_name?.trim() || !formData.dni_ruc?.trim() || !formData.address?.trim() || !formData.phone?.trim())) {
      toast.error("Completa nombre, identificación, dirección y celular antes de continuar.");
      return;
    }
    setStep((value) => Math.min(3, value + 1));
  };

  return <div className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm overflow-y-auto p-4">
    <div className="max-w-5xl mx-auto my-6 bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800"><div><h3 className="text-lg font-bold text-slate-100">{selectedClient ? "Editar usuario" : "Nuevo usuario"}</h3><p className="text-xs text-slate-400">Registro guiado de abonado y aprovisionamiento de servicio.</p></div><button onClick={onClose} className="text-slate-400 hover:text-slate-100"><X /></button></div>
      <div className="flex overflow-x-auto bg-slate-950/40"><Step number="1" label="Datos personales" subtitle="Nombre, dirección y contacto" active={step === 1} done={step > 1} onClick={() => setStep(1)} /><Step number="2" label="Facturación" subtitle="Cobro y primera factura" active={step === 2} done={step > 2} onClick={() => setStep(2)} /><Step number="3" label="Servicio" subtitle="Plan, red, NAP y MikroTik" active={step === 3} done={false} onClick={() => setStep(3)} /></div>
      <form onSubmit={onSubmit}>
        <div className="p-6 min-h-[400px]">
          {step === 1 && <div className="max-w-3xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-4"><Field label="Nombre completo / Razón social *"><input required value={formData.full_name} onChange={e=>setFormData({...formData,full_name:e.target.value})} placeholder="Ej. Carlos Pérez / Empresa SAC" /></Field><Field label="DNI / RUC *"><input required value={formData.dni_ruc} onChange={e=>setFormData({...formData,dni_ruc:e.target.value})} placeholder="DNI o RUC" /></Field><div className="md:col-span-2"><Field label="Dirección principal *"><input required value={formData.address} onChange={e=>setFormData({...formData,address:e.target.value})} placeholder="Av. / Jr. / Mz. Lt. / distrito" /></Field></div><Field label="Celular / WhatsApp *"><input required value={formData.phone} onChange={e=>setFormData({...formData,phone:e.target.value})} placeholder="987654321" /></Field><Field label="Correo electrónico"><input type="email" value={formData.email || ""} onChange={e=>setFormData({...formData,email:e.target.value})} placeholder="cliente@correo.com" /></Field><div className="md:col-span-2"><Field label="Referencia de instalación"><input value={formData.reference || ""} onChange={e=>setFormData({...formData,reference:e.target.value})} placeholder="Casa de dos pisos, portón negro..." /></Field></div></div>}
          {step === 2 && <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-5">
            <Card title="Facturación" icon={CreditCard}>
              <Field label="Tipo de servicio"><select value={formData.billing_type || "prepaid"} onChange={e=>setFormData({...formData,billing_type:e.target.value})}><option value="prepaid">Prepago (adelantado)</option><option value="postpaid">Postpago</option></select></Field>
              <Field label="Día de pago"><select value={formData.billing_day ?? 5} onChange={e=>setFormData({...formData,billing_day:Number(e.target.value)})}>{Array.from({length:30},(_,index)=>index+1).map(day=><option key={day} value={day}>Día {day} de cada mes</option>)}</select></Field>
              <Field label="Crear factura"><select value={formData.invoice_lead_days ?? 5} onChange={e=>setFormData({...formData,invoice_lead_days:Number(e.target.value)})}>{Array.from({length:20},(_,index)=>index+1).map(day=><option key={day} value={day}>{day} día{day !== 1 ? "s" : ""} antes</option>)}</select></Field>
              <Field label="Días de gracia"><select value={formData.grace_days ?? 5} onChange={e=>setFormData({...formData,grace_days:Number(e.target.value)})}>{Array.from({length:20},(_,index)=>index+1).map(day=><option key={day} value={day}>{day} día{day !== 1 ? "s" : ""}</option>)}</select></Field>
              <Field label="Aplicar corte"><select value={formData.cut_after_months ?? 1} onChange={e=>setFormData({...formData,cut_after_months:Number(e.target.value)})}>{Array.from({length:6},(_,index)=>index+1).map(month=><option key={month} value={month}>{month} mes{month !== 1 ? "es" : ""} vencido{month !== 1 ? "s" : ""}</option>)}</select></Field>
              <label className="flex gap-3 items-center text-xs text-slate-300"><input type="checkbox" checked={formData.create_first_invoice !== false} onChange={e=>setFormData({...formData,create_first_invoice:e.target.checked})} /> Crear primera factura al registrar</label>
              <Field label="Estado inicial"><select value={formData.status || "active"} onChange={e=>setFormData({...formData,status:e.target.value})}><option value="active">Activo</option><option value="pending_install">Pendiente de instalación</option><option value="suspended">Suspendido</option></select></Field>
            </Card>
            <Card title="Notificaciones" icon={UserRound}>
              <p className="text-xs text-slate-400">Los avisos usarán los datos de contacto del usuario.</p>
              <Field label="Aviso de nueva factura"><select value={formData.invoice_notification_channel || "none"} onChange={e=>setFormData({...formData,invoice_notification_channel:e.target.value})}><option value="none">Desactivado</option><option value="whatsapp">WhatsApp</option><option value="email">Correo</option><option value="sms">SMS</option></select></Field>
              <Field label="Recordatorios de pago"><select value={formData.payment_reminder_channel || "none"} onChange={e=>setFormData({...formData,payment_reminder_channel:e.target.value})}><option value="none">Desactivado</option><option value="whatsapp">WhatsApp</option><option value="email">Correo</option><option value="sms">SMS</option></select></Field>
              <Reminder label="Recordatorio #1" field="reminder_1_days" value={formData.reminder_1_days} setFormData={setFormData} formData={formData} />
              <Reminder label="Recordatorio #2" field="reminder_2_days" value={formData.reminder_2_days} setFormData={setFormData} formData={formData} />
              <Reminder label="Recordatorio #3" field="reminder_3_days" value={formData.reminder_3_days} setFormData={setFormData} formData={formData} />
              <div className="pt-2 text-[11px] text-cyan-300"><p>Celular: {formData.phone || "Sin registrar"}</p><p className="mt-1">Correo: {formData.email || "Sin registrar"}</p></div>
            </Card>
          </div>}
          {step === 3 && <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-5"><Card title="Internet y MikroTik" icon={Wifi}><Field label="MikroTik *"><select required value={formData.router_id} onChange={e=>setFormData({...formData,router_id:e.target.value,ipv4_network_id:""})}><option value="" disabled>Selecciona un MikroTik</option>{mikrotiks.map(router=><option key={router.id} value={router.id}>{router.name}</option>)}</select></Field><Field label="Plan de internet *"><select required value={formData.plan_id} onChange={e=>setFormData({...formData,plan_id:e.target.value})}><option value="" disabled>Selecciona un plan</option>{activePlans.map(plan=><option key={plan.id} value={plan.id}>{plan.name} — S/. {Number(plan.price).toFixed(2)}</option>)}</select></Field><Field label="Tipo de conexión"><select value={formData.connection_type} onChange={e=>setFormData({...formData,connection_type:e.target.value,ipv4_network_id:"",ip_address:""})}><option value="PPPoE">PPPoE</option><option value="IP Estática">IP estática</option><option value="DHCP">DHCP</option></select></Field>
              <Field label={formData.connection_type === "PPPoE" ? "Pool PPPoE" : formData.connection_type === "DHCP" ? "Pool DHCP" : "Red IP estática"}><select value={formData.ipv4_network_id || ""} onChange={e=>setFormData({...formData,ipv4_network_id:e.target.value,ip_address:""})}><option value="">Selecciona {formData.connection_type === "PPPoE" ? "un pool PPPoE" : "una red"}</option>{networks.map(network=><option key={network.id} value={network.id}>{network.name} — {network.cidr}</option>)}</select></Field>
              {formData.connection_type !== "PPPoE" && <><Field label={formData.connection_type === "DHCP" ? "IP disponible / reserva DHCP" : "IP disponible del cliente"}><select disabled={!formData.ipv4_network_id || loadingAddresses} value={formData.ip_address || ""} onChange={e=>setFormData({...formData,ip_address:e.target.value})}><option value="">{loadingAddresses ? "Consultando IPs disponibles..." : !formData.ipv4_network_id ? "Primero selecciona una red" : "Selecciona una IP disponible"}</option>{formData.ip_address && !availableAddresses.includes(formData.ip_address) && <option value={formData.ip_address}>{formData.ip_address} (asignada a este cliente)</option>}{availableAddresses.map(address=><option key={address} value={address}>{address}</option>)}</select></Field><p className="text-[11px] text-slate-400 -mt-2">Solo se muestran direcciones libres de la red seleccionada.</p></>}
              {formData.connection_type === "PPPoE" && <><Field label="Usuario PPPoE"><input required value={formData.pppoe_user || ""} onChange={e=>setFormData({...formData,pppoe_user:e.target.value})} placeholder="usuario_pppoe" /></Field><Field label="Clave PPPoE"><input required type="password" value={formData.pppoe_password || ""} onChange={e=>setFormData({...formData,pppoe_password:e.target.value})} placeholder="Clave del usuario PPPoE" /></Field><p className="text-[11px] text-slate-400 -mt-2">El plan se aplicará como perfil PPPoE en el MikroTik.</p></>}</Card><Card title="Fibra y ubicación" icon={Wifi}><Field label="Caja NAP"><select value={formData.nap_box_id || ""} onChange={e=>setFormData({...formData,nap_box_id:e.target.value,nap_port:"",nap_box:""})}><option value="">Sin caja NAP</option>{napBoxes.map(box=><option key={box.id} value={box.id}>{box.name}</option>)}</select></Field><Field label="Puerto NAP"><select disabled={!nap} value={formData.nap_port ?? ""} onChange={e=>setFormData({...formData,nap_port:e.target.value === "" ? "" : Number(e.target.value)})}><option value="">Sin puerto</option>{Array.from({length:nap?.ports || 0},(_,i)=>i+1).map(port=><option key={port} value={port}>Puerto {port}</option>)}</select></Field><Field label="Serie ONU"><input value={formData.onu_sn || ""} onChange={e=>setFormData({...formData,onu_sn:e.target.value})} placeholder="SN / MAC de la ONU" /></Field><Field label="Potencia óptica (dBm)"><input type="number" step="0.1" value={formData.optical_power_dbm ?? ""} onChange={e=>setFormData({...formData,optical_power_dbm:e.target.value})} placeholder="-19.5" /></Field></Card></div>}
        </div>
        <div className="flex justify-between gap-3 p-5 bg-slate-950/50 border-t border-slate-800"><button type="button" onClick={step === 1 ? onClose : () => setStep(step - 1)} className="px-4 py-2 rounded-xl bg-slate-800 text-slate-300 flex items-center gap-1"><ChevronLeft className="w-4 h-4" /> {step === 1 ? "Cancelar" : "Anterior"}</button>{step < 3 ? <button type="button" onClick={next} className="px-4 py-2 rounded-xl bg-cyan-500 text-white font-semibold flex items-center gap-1">Siguiente <ChevronRight className="w-4 h-4" /></button> : <button type="submit" className="px-5 py-2 rounded-xl bg-cyan-500 text-white font-semibold">Registrar usuario</button>}</div>
      </form>
    </div>
  </div>;
}
const Field = ({ label, children }) => <label className="block text-xs text-slate-300 font-semibold space-y-1"><span>{label}</span>{React.cloneElement(children,{className:"w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-normal disabled:opacity-50"})}</label>;
const Reminder = ({ label, field, value, formData, setFormData }) => <Field label={label}><select value={value ?? ""} onChange={e=>setFormData({...formData,[field]:e.target.value === "" ? null : Number(e.target.value)})}><option value="">Desactivado</option>{Array.from({length:20},(_,index)=>index+1).map(day=><option key={day} value={day}>{day} día{day !== 1 ? "s" : ""} antes</option>)}</select></Field>;
const Card = ({ title, icon: Icon, children }) => <section className="p-5 rounded-2xl bg-slate-950/40 border border-slate-800 space-y-4"><h4 className="text-sm font-bold text-slate-100 flex items-center gap-2"><Icon className="w-4 h-4 text-cyan-400" /> {title}</h4>{children}</section>;
