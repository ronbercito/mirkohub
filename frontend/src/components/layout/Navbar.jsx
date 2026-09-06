/**
 * Archivo: frontend/src/components/layout/Navbar.jsx
 * Función: Barra superior del panel con buscador/accesos rápidos y datos del usuario autenticado.
 * Trabaja con: components/layout/Layout.jsx, context/AuthContext.js
 */
import React from "react";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { Search, Bell, Shield, DollarSign, Wifi, Globe, User } from "lucide-react";

export default function Navbar({ setActiveTab }) {
  const { user } = useAuth();

  return (
    <header className="h-16 bg-slate-900/80 backdrop-blur-md border-b border-slate-800 sticky top-0 z-30 px-4 sm:px-6 flex items-center justify-between">
      {/* Search Input Bar (Top bar in screenshot) */}
      <div className="relative w-72 sm:w-96">
        <Search className="w-4 h-4 text-slate-500 absolute left-3.5 top-2.5" />
        <input
          type="text"
          placeholder="Buscar abonado, IP, recibo..."
          onFocus={() => setActiveTab("clientes")}
          className="w-full pl-10 pr-4 py-1.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 transition-colors"
        />
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1 bg-slate-950 border border-slate-800 rounded-lg text-xs text-cyan-400 font-mono font-semibold">
          <Globe className="w-3.5 h-3.5 text-cyan-400" /> Moneda: Soles (S/.)
        </div>

        {/* Notifications */}
        <button
          onClick={() => setActiveTab("facturacion")}
          className="relative p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
          title="Facturas vencidas"
        >
          <Bell className="w-4 h-4" />
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">
            1
          </span>
        </button>

        {/* User Role Tag */}
        <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
          <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-white font-bold text-xs shadow-md">
            {user?.name?.charAt(0) || "U"}
          </div>
          <div className="hidden md:block text-left">
            <span className="text-xs font-bold text-slate-200 block leading-tight">{user?.name || "Administrador"}</span>
            <span className="text-[10px] text-cyan-400 uppercase font-semibold">{user?.role || "Admin"}</span>
          </div>
        </div>
      </div>
    </header>
  );
}
