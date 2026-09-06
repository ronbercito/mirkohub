/**
 * Archivo: frontend/src/components/layout/Sidebar.jsx
 * Función: Navegación lateral persistente con submenús en acordeón.
 * Alcance: abre un único grupo a la vez y conserva la sección activa gestionada por Layout.
 * Trabaja con: components/layout/Layout.jsx, context/AuthContext.js, constants/testIds.js.
 */
import React, { useEffect, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import {
  Home, Server, Zap, Users, Wifi, Calendar, DollarSign, Package, Headphones,
  MessageSquare, Settings, ChevronRight, LogOut, ShieldCheck, ChevronLeft,
  Network, Box, ChevronDown, Radio, MapPin
} from "lucide-react";

const menuItems = [
  { id: "inicio", label: "Inicio", icon: Home, testId: TEST_IDS.NAV_INICIO },
  { id: "red", label: "Gestión de Red", icon: Server, testId: TEST_IDS.NAV_RED, children: [
    { id: "red_ipv4", label: "Redes IPv4", icon: Network },
    { id: "nap_boxes", label: "Cajas NAP", icon: Box },
    { id: "monitoring", label: "Monitoreo", icon: Radio },
  ]},
  { id: "servicios", label: "Servicios / Planes", icon: Zap, testId: TEST_IDS.NAV_SERVICIOS },
  { id: "clientes", label: "Clientes", icon: Users, testId: TEST_IDS.NAV_CLIENTES, children: [
    { id: "client_users", label: "Usuarios", icon: Users },
    { id: "client_zones", label: "Zonas", icon: MapPin },
  ]},
  { id: "facturacion", label: "Finanzas / Facturación", icon: DollarSign, testId: TEST_IDS.NAV_FACTURACION },
  { id: "hotspot", label: "Fichas Hotspot", icon: Wifi, testId: TEST_IDS.NAV_HOTSPOT },
  { id: "tareas", label: "Tareas", icon: Calendar, testId: TEST_IDS.NAV_TAREAS },
  { id: "almacen", label: "Almacén", icon: Package, testId: TEST_IDS.NAV_ALMACEN },
  { id: "tickets", label: "Tickets", icon: Headphones, testId: TEST_IDS.NAV_TICKETS },
  { id: "mensajeria", label: "Mensajería", icon: MessageSquare, testId: TEST_IDS.NAV_MENSAJERIA },
  { id: "ajustes", label: "Ajustes", icon: Settings, testId: TEST_IDS.NAV_AJUSTES },
];

export default function Sidebar({ activeTab, setActiveTab, isOpen, setIsOpen }) {
  const { user, logout } = useAuth();
  const groupForTab = (tab) => { const parent = menuItems.find((item) => item.id === tab || item.children?.some((child) => child.id === tab)); return parent?.children ? parent.id : null; };
  const [openGroup, setOpenGroup] = useState(() => groupForTab(activeTab));

  useEffect(() => {
    setOpenGroup(groupForTab(activeTab));
  }, [activeTab]);

  const itemClass = (active) => `w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 group ${active ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm" : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"}`;

  const selectLeaf = (id) => {
    setActiveTab(id);
    setOpenGroup(groupForTab(id));
  };

  return <aside className={`fixed inset-y-0 left-0 z-40 bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col justify-between ${isOpen ? "w-64" : "w-20"}`}>
    <div>
      <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="h-9 w-9 min-w-[36px] rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20"><Wifi className="w-5 h-5 text-white" /></div>
          {isOpen && <div><span className="text-xl font-black tracking-tight text-white flex items-center">Fibra<span className="text-cyan-400">Z</span></span><span className="text-[10px] text-cyan-400 font-bold block -mt-1 tracking-widest uppercase">ISP PORTAL</span></div>}
        </div>
        <button onClick={() => setIsOpen(!isOpen)} className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition">{isOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</button>
      </div>

      <div className="p-4 border-b border-slate-800/60 flex items-center gap-3">
        <div className="h-10 w-10 min-w-[40px] rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400 font-bold text-sm">{user?.name?.charAt(0) || "A"}</div>
        {isOpen && <div className="overflow-hidden"><h4 className="text-xs font-bold text-slate-100 truncate">{user?.name || "Administrador principal"}</h4><p className="text-[10px] text-cyan-400/90 font-medium capitalize flex items-center gap-1"><ShieldCheck className="w-3 h-3" /> {user?.role || "Administrador"}</p></div>}
      </div>

      <div className="p-3">
        {isOpen && <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-2">Menú principal</p>}
        <nav className="space-y-1">
          {menuItems.map((item) => {
            const Icon = item.icon;
            const hasChildren = Boolean(item.children?.length);
            const groupActive = activeTab === item.id || item.children?.some((child) => child.id === activeTab);
            const expanded = openGroup === item.id;
            return <div key={item.id}>
              <button data-testid={item.testId} onClick={() => {
                if (hasChildren) {
                  setActiveTab(item.id);
                  setOpenGroup(expanded ? null : item.id);
                } else selectLeaf(item.id);
              }} className={itemClass(groupActive)} title={!isOpen ? item.label : ""}>
                <Icon className={`w-4 h-4 min-w-[16px] ${groupActive ? "text-cyan-400" : "text-slate-400 group-hover:text-slate-200"}`} />
                {isOpen && <><span className="truncate flex-1 text-left">{item.label}</span>{hasChildren && <ChevronDown className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`} />}</>}
              </button>
              {isOpen && hasChildren && expanded && <div className="mt-1 ml-5 border-l border-slate-700/70 pl-2 space-y-1">
                {item.children.map((child) => {
                  const ChildIcon = child.icon;
                  const active = activeTab === child.id;
                  return <button key={child.id} onClick={() => selectLeaf(child.id)} className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold transition ${active ? "bg-cyan-500/15 text-cyan-300" : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"}`}><ChildIcon className="w-3.5 h-3.5" /><span>{child.label}</span></button>;
                })}
              </div>}
            </div>;
          })}
        </nav>
      </div>
    </div>

    <div className="p-3 border-t border-slate-800">
      <button data-testid={TEST_IDS.LOGOUT_BTN} onClick={logout} className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 transition" title="Cerrar sesión"><LogOut className="w-4 h-4 min-w-[16px]" />{isOpen && <span>Cerrar sesión</span>}</button>
    </div>
  </aside>;
}