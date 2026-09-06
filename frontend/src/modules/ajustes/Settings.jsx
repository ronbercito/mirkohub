/**
 * Archivo: frontend/src/modules/ajustes/Settings.jsx
 * Función: Módulo Ajustes: datos fiscales del ISP (razón social, RUC, contacto), cuentas de cobro Yape/Plin/BCP/BBVA, día de facturación, días de gracia, corte automático y nombre de la address-list de morosos en MikroTik.
 * Trabaja con: backend/app/routers/ajustes/router.py (/api/settings), backend/app/integrations/mikrotik/service.py
 */
import React, { useState, useEffect } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import { Settings as SettingsIcon, Save, Building2, ShieldAlert, Smartphone, Users, MailCog, FileText, ReceiptText, Landmark, Code2, UserRound, BellRing, Headphones, HeartPulse, Upload, Repeat2, LayoutTemplate, MessageSquare, MapPinned, ContactRound, Cloud, Database, Clock3, ScrollText, Wrench, Server, RefreshCw, KeyRound, BadgeInfo } from "lucide-react";
import { toast } from "sonner";

const SECTIONS = [
  { id: "general", label: "General", icon: SettingsIcon, description: "Empresa, cobros y corte" },
  { id: "staff", label: "Gestión personal", icon: Users, description: "Usuarios y permisos" },
  { id: "mail", label: "Servidor de correo", icon: MailCog, description: "SMTP y envío" },
  { id: "billing", label: "Facturación", icon: FileText, description: "Reglas y comprobantes" },
  { id: "electronic", label: "Facturación electrónica", icon: ReceiptText, description: "SUNAT y series" },
  { id: "payments", label: "Pasarelas de pago", icon: Landmark, description: "Cobros en línea" },
  { id: "templates", label: "Editor plantillas", icon: Code2, description: "Diseños y mensajes" },
  { id: "portal", label: "Portal cliente", icon: UserRound, description: "Acceso de abonados" },
  { id: "push", label: "Notificaciones Push", icon: BellRing, description: "Avisos al instante" },
  { id: "tickets", label: "Tickets", icon: Headphones, description: "Soporte y atención" },
  { id: "zendesk", label: "Zendesk Support", icon: HeartPulse, description: "Integración externa" },
  { id: "blacklist", label: "Monitor Blacklist", icon: ShieldAlert, description: "Revisión de IPs" },
  { id: "import", label: "Importar clientes", icon: Upload, description: "Carga masiva" },
  { id: "bulk", label: "Cambios masivos", icon: Repeat2, description: "Actualizar registros" },
  { id: "config_templates", label: "Plantillas configuración", icon: LayoutTemplate, description: "Ajustes reutilizables" },
  { id: "invoice_messages", label: "Mensajes facturas", icon: MessageSquare, description: "Textos de cobro" },
  { id: "locations", label: "Ubicaciones", icon: MapPinned, description: "Zonas y oficinas" },
  { id: "custom_fields", label: "Campos personalizados", icon: ContactRound, description: "Datos adicionales" },
  { id: "messaging", label: "Mensajería", icon: MessageSquare, description: "Canales de contacto" },
  { id: "cloud", label: "Cloud", icon: Cloud, description: "Sincronización" },
  { id: "google", label: "Google", icon: BadgeInfo, description: "Servicios conectados" },
  { id: "database", label: "Base de datos", icon: Database, description: "Respaldo y datos" },
  { id: "crontab", label: "Crontab", icon: Clock3, description: "Tareas programadas" },
  { id: "logs", label: "Logs", icon: ScrollText, description: "Registro del sistema" },
  { id: "system", label: "Sistema", icon: Wrench, description: "Preferencias técnicas" },
  { id: "server", label: "Servidor", icon: Server, description: "Estado y servicios" },
  { id: "migrate", label: "Migrar", icon: RefreshCw, description: "Transferir datos" },
  { id: "freeradius", label: "FreeRADIUS", icon: KeyRound, description: "Autenticación de red" },
  { id: "license", label: "Licencia", icon: BadgeInfo, description: "Información de licencia" },
];

export default function Settings() {
  const { API, token } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeSection, setActiveSection] = useState("general");

  const [settings, setSettings] = useState({
    company_name: "",
    logo_data: "",
    ruc: "",
    phone: "",
    email: "",
    address: "",
    currency: "PEN",
    currency_symbol: "S/.",
    auto_cut_enabled: true,
    grace_days: 3,
    billing_day: 5,
    yape_number: "",
    plin_number: "",
    bcp_account: "",
    bbva_account: "",
    mikrotik_cut_list: "morosos"
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await axios.get(`${API}/settings`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        setSettings(res.data);
      } catch (e) {
        toast.error("Error al cargar ajustes");
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, [API, token]);

  const handleLogoChange = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Selecciona un archivo de imagen.");
      return;
    }
    if (file.size > 700 * 1024) {
      toast.error("El logo debe pesar como máximo 700 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setSettings((value) => ({ ...value, logo_data: String(reader.result || "") }));
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const response = await axios.put(`${API}/settings`, settings, {
        headers: { Authorization: `Bearer ${token}` }
      });
      window.dispatchEvent(new CustomEvent("fibraz-branding", { detail: { companyName: response.data.company_name, logoData: response.data.logo_data || "" } }));
      toast.success("Configuración del ISP actualizada correctamente");
    } catch (e) {
      toast.error("Error al guardar ajustes");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-2xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
          <SettingsIcon className="w-6 h-6 text-cyan-400" /> Ajustes · {settings.company_name || "MikroHub"}
        </h2>
        <p className="text-xs text-slate-400 mt-0.5">Selecciona una categoría para administrar la configuración del sistema.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {SECTIONS.map((section) => {
          const Icon = section.icon;
          const active = activeSection === section.id;
          return <button key={section.id} type="button" onClick={() => setActiveSection(section.id)}
            className={`group min-h-28 rounded-2xl border p-4 text-left transition-all hover:-translate-y-0.5 ${active ? "border-cyan-400 bg-cyan-500/15 shadow-lg shadow-cyan-950/40" : "border-slate-800 bg-slate-900 hover:border-slate-700 hover:bg-slate-800"}`}>
            <span className={`mb-3 flex h-10 w-10 items-center justify-center rounded-xl ${active ? "bg-cyan-500 text-white" : "bg-slate-800 text-cyan-300 group-hover:bg-slate-700"}`}><Icon className="h-5 w-5" /></span>
            <span className="block text-xs font-bold text-slate-100">{section.label}</span>
            <span className="mt-1 block text-[10px] leading-tight text-slate-500">{section.description}</span>
          </button>;
        })}
      </div>

      {activeSection === "general" ? <form onSubmit={handleSubmit} className="space-y-6 max-w-4xl">
        {/* Company Info Box */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 pb-2 border-b border-slate-800 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-cyan-400" /> Datos de la Empresa (Impresión en Recibos)
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Razón Social / Nombre Comercial *</label>
              <input
                type="text"
                required
                value={settings.company_name}
                onChange={(e) => setSettings({ ...settings, company_name: e.target.value })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">RUC (Perú) *</label>
              <input
                type="text"
                required
                value={settings.ruc}
                onChange={(e) => setSettings({ ...settings, ruc: e.target.value })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-mono"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Teléfono Central de Soporte</label>
              <input
                type="text"
                value={settings.phone}
                onChange={(e) => setSettings({ ...settings, phone: e.target.value })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Correo de Contacto</label>
              <input
                type="email"
                value={settings.email}
                onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Dirección Fiscal / Oficina</label>
              <input
                type="text"
                value={settings.address}
                onChange={(e) => setSettings({ ...settings, address: e.target.value })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
              />
            </div>
          </div>
          <div className="mt-4 border-t border-slate-800 pt-4">
            <label className="block text-xs font-semibold text-slate-300 mb-2">Logo del panel y pantalla de inicio</label>
            <div className="flex flex-wrap items-center gap-3">
              <div className="h-14 w-14 rounded-xl border border-slate-700 bg-slate-950 flex items-center justify-center overflow-hidden">
                {settings.logo_data ? <img src={settings.logo_data} alt="Vista previa del logo" className="h-full w-full object-contain" /> : <Building2 className="w-6 h-6 text-slate-500" />}
              </div>
              <div>
                <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={handleLogoChange} className="block text-xs text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-cyan-500 file:px-3 file:py-2 file:text-xs file:font-bold file:text-white hover:file:bg-cyan-400" />
                <p className="mt-1 text-[11px] text-slate-500">PNG, JPG, WEBP o SVG. Máximo 700 KB.</p>
              </div>
              {settings.logo_data && <button type="button" onClick={() => setSettings({ ...settings, logo_data: "" })} className="text-xs font-semibold text-rose-300 hover:text-rose-200">Quitar logo</button>}
            </div>
          </div>
        </div>

        {/* Payment & Collection Details */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 pb-2 border-b border-slate-800 flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-emerald-400" /> Canales de Cobro para Abonados
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Número de Yape</label>
              <input
                type="text"
                value={settings.yape_number}
                onChange={(e) => setSettings({ ...settings, yape_number: e.target.value })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-emerald-400 font-bold"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Número de Plin</label>
              <input
                type="text"
                value={settings.plin_number}
                onChange={(e) => setSettings({ ...settings, plin_number: e.target.value })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-cyan-400 font-bold"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-300 font-semibold mb-1">Cuenta Corriente BCP / CCI</label>
              <input
                type="text"
                value={settings.bcp_account}
                onChange={(e) => setSettings({ ...settings, bcp_account: e.target.value })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-mono"
              />
            </div>
          </div>
        </div>

        {/* Billing & Auto-cut configuration */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-6 shadow-xl space-y-4">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 pb-2 border-b border-slate-800 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-rose-400" /> Reglas de Facturación y Corte Automático
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-slate-300 font-semibold mb-1">Moneda del Sistema</label>
              <input
                type="text"
                disabled
                value="Soles Peruanos (S/.)"
                className="w-full p-2.5 bg-slate-950 border border-slate-800 rounded-xl text-slate-400 font-bold"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Día de Emisión de Facturas</label>
              <input
                type="number"
                min="1"
                max="28"
                value={settings.billing_day}
                onChange={(e) => setSettings({ ...settings, billing_day: parseInt(e.target.value) })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Días de Gracia antes del Corte</label>
              <input
                type="number"
                min="0"
                max="15"
                value={settings.grace_days}
                onChange={(e) => setSettings({ ...settings, grace_days: parseInt(e.target.value) })}
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100"
              />
            </div>

            <div>
              <label className="block text-slate-300 font-semibold mb-1">Address-list de corte en MikroTik</label>
              <input
                type="text"
                data-testid="settings-cut-list"
                value={settings.mikrotik_cut_list || ""}
                onChange={(e) => setSettings({ ...settings, mikrotik_cut_list: e.target.value })}
                placeholder="morosos"
                className="w-full p-2.5 bg-slate-950 border border-slate-700 rounded-xl text-slate-100 font-mono"
              />
              <p className="text-[10px] text-slate-500 mt-1">Crea en el MikroTik una regla de firewall que bloquee/redirija <span className="font-mono">src-address-list</span> con este nombre.</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs rounded-xl flex items-center gap-2 shadow-lg shadow-cyan-600/20"
          >
            <Save className="w-4 h-4" />
            {saving ? "Guardando..." : "Guardar Cambios"}
          </button>
        </div>
      </form> : <section className="max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
        {(() => {
          const section = SECTIONS.find((item) => item.id === activeSection);
          const Icon = section?.icon || SettingsIcon;
          return <div className="text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-cyan-500/10 text-cyan-300"><Icon className="h-7 w-7" /></div>
            <h3 className="mt-4 text-lg font-bold text-slate-100">{section?.label}</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-400">Este acceso ya está organizado en Ajustes. Su configuración se habilitará en una próxima mejora, sin modificar la información actual del sistema.</p>
            <button type="button" onClick={() => setActiveSection("general")} className="mt-5 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-slate-200 hover:bg-slate-700">Volver a General</button>
          </div>;
        })()}
      </section>}
    </div>
  );
}
