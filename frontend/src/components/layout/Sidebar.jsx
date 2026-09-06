/**
 * Archivo: frontend/src/components/layout/Sidebar.jsx
 * Función: Barra lateral de navegación del panel: logo, tarjeta del usuario, menú de módulos (Inicio, Red, Planes, Clientes, Facturación, Hotspot, Tareas, Almacén, Tickets, Mensajería, Ajustes) y botón de cerrar sesión.
 * Trabaja con: components/layout/Layout.jsx, context/AuthContext.js, constants/testIds.js
 */
import React from "react";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { 
  Home, Server, Zap, Users, Wifi, Calendar, 
  DollarSign, Package, Headphones, MessageSquare, Settings, 
  ChevronRight, LogOut, ShieldCheck, ChevronLeft
} from "lucide-react";

export default function Sidebar({ activeTab, setActiveTab, isOpen, setIsOpen }) {
  const { user, logout } = useAuth();

  const menuItems = [
    { id: "inicio", label: "Inicio", icon: Home, testId: TEST_IDS.NAV_INICIO },
    { id: "red", label: "Gestión de Red", icon: Server, testId: TEST_IDS.NAV_RED },
    { id: "servicios", label: "Servicios / Planes", icon: Zap, testId: TEST_IDS.NAV_SERVICIOS },
    { id: "clientes", label: "Clientes", icon: Users, testId: TEST_IDS.NAV_CLIENTES },
    { id: "facturacion", label: "Finanzas / Facturación", icon: DollarSign, testId: TEST_IDS.NAV_FACTURACION },
    { id: "hotspot", label: "Fichas Hotspot", icon: Wifi, testId: TEST_IDS.NAV_HOTSPOT },
    { id: "tareas", label: "Tareas", icon: Calendar, testId: TEST_IDS.NAV_TAREAS },
    { id: "almacen", label: "Almacén", icon: Package, testId: TEST_IDS.NAV_ALMACEN },
    { id: "tickets", label: "Tickets", icon: Headphones, testId: TEST_IDS.NAV_TICKETS },
    { id: "mensajeria", label: "Mensajería", icon: MessageSquare, testId: TEST_IDS.NAV_MENSAJERIA },
    { id: "ajustes", label: "Ajustes", icon: Settings, testId: TEST_IDS.NAV_AJUSTES },
  ];

  return (
    <aside className={`fixed inset-y-0 left-0 z-40 bg-slate-900 border-r border-slate-800 transition-all duration-300 flex flex-col justify-between ${
      isOpen ? "w-64" : "w-20"
    }`}>
      {/* Brand & Logo matching FibraZ */}
      <div>
        <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="h-9 w-9 min-w-[36px] rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
              <Wifi className="w-5 h-5 text-white" />
            </div>
            {isOpen && (
              <div className="transition-opacity duration-200">
                <span className="text-xl font-black tracking-tight text-white flex items-center">
                  Fibra<span className="text-cyan-400">Z</span>
                </span>
                <span className="text-[10px] text-cyan-400 font-bold block -mt-1 tracking-widest uppercase">ISP PORTAL</span>
              </div>
            )}
          </div>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition"
          >
            {isOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          </button>
        </div>

        {/* User Card */}
        <div className="p-4 border-b border-slate-800/60 flex items-center gap-3">
          <div className="h-10 w-10 min-w-[40px] rounded-full bg-slate-800 border border-slate-700 flex items-center justify-center text-cyan-400 font-bold text-sm">
            {user?.name?.charAt(0) || "A"}
          </div>
          {isOpen && (
            <div className="overflow-hidden">
              <h4 className="text-xs font-bold text-slate-100 truncate">{user?.name || "Administrador principal"}</h4>
              <p className="text-[10px] text-cyan-400/90 font-medium capitalize flex items-center gap-1">
                <ShieldCheck className="w-3 h-3 inline" /> {user?.role || "Administrador"}
              </p>
            </div>
          )}
        </div>

        {/* Navigation Menu */}
        <div className="p-3">
          {isOpen && (
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider px-3 mb-2">
              Menú Principal
            </p>
          )}
          <nav className="space-y-1">
            {menuItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  data-testid={item.testId}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all duration-150 group ${
                    isActive
                      ? "bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 shadow-sm"
                      : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/60"
                  }`}
                  title={!isOpen ? item.label : ""}
                >
                  <Icon className={`w-4 h-4 min-w-[16px] transition-colors ${
                    isActive ? "text-cyan-400" : "text-slate-400 group-hover:text-slate-200"
                  }`} />
                  {isOpen && <span className="truncate flex-1 text-left">{item.label}</span>}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Logout button */}
      <div className="p-3 border-t border-slate-800">
        <button
          data-testid={TEST_IDS.LOGOUT_BTN}
          onClick={logout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-semibold text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 transition"
          title="Cerrar Sesión"
        >
          <LogOut className="w-4 h-4 min-w-[16px]" />
          {isOpen && <span>Cerrar Sesión</span>}
        </button>
      </div>
    </aside>
  );
}
