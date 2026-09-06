/**
 * Archivo: frontend/src/components/layout/Layout.jsx
 * Función: Estructura principal del panel una vez autenticado: barra lateral, barra
 *          superior y el área de contenido que muestra el módulo activo (pestaña).
 * Trabaja con: components/layout/Sidebar.jsx, components/layout/Navbar.jsx,
 *              modules/<modulo>/*.jsx (Dashboard, Network, Plans, Clients, Billing,
 *              Hotspot, Tasks, Inventory, Tickets, Messaging, Settings)
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useAuth } from "../../context/AuthContext";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import Dashboard from "../../modules/inicio/Dashboard";
import Network from "../../modules/red/Network";
import IPv4Networks from "../../modules/red/ipv4/IPv4Networks";
import NapBoxes from "../../modules/red/nap_boxes/NapBoxes";
import Monitoring from "../../modules/red/monitoring/Monitoring";
import Plans from "../../modules/planes/Plans";
import Users from "../../modules/clientes/usuarios/Users";
import Zones from "../../modules/clientes/zonas/Zones";
import Billing from "../../modules/facturacion/Billing";
import Hotspot from "../../modules/hotspot/Hotspot";
import Tasks from "../../modules/tareas/Tasks";
import Inventory from "../../modules/almacen/Inventory";
import Tickets from "../../modules/tickets/Tickets";
import Messaging from "../../modules/mensajeria/Messaging";
import Settings from "../../modules/ajustes/Settings";

export default function Layout() {
  const { API, token } = useAuth();
  const [companyName, setCompanyName] = useState(() => localStorage.getItem("fibraz_company_name") || "FibraZ");
  const [activeTab, setActiveTab] = useState(() => localStorage.getItem("fibraz_active_tab") || "inicio");
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem("fibraz_sidebar_open") !== "false");

  useEffect(() => { localStorage.setItem("fibraz_active_tab", activeTab); }, [activeTab]);
  useEffect(() => { localStorage.setItem("fibraz_sidebar_open", String(sidebarOpen)); }, [sidebarOpen]);

  useEffect(() => {
    const loadCompanyName = async () => {
      try {
        const response = await axios.get(`${API}/settings`, { headers: { Authorization: `Bearer ${token}` } });
        const name = response.data.company_name?.trim() || "FibraZ";
        setCompanyName(name);
        localStorage.setItem("fibraz_company_name", name);
      } catch (_) {
        // Se conserva el último nombre conocido si el backend no está disponible.
      }
    };
    loadCompanyName();
  }, [API, token]);

  useEffect(() => {
    const syncName = (event) => {
      const name = event.detail?.companyName?.trim() || "FibraZ";
      setCompanyName(name);
      localStorage.setItem("fibraz_company_name", name);
    };
    window.addEventListener("fibraz-company-name", syncName);
    return () => window.removeEventListener("fibraz-company-name", syncName);
  }, []);

  useEffect(() => { document.title = `Panel · ${companyName}`; }, [companyName]);

  const renderContent = () => {
    switch (activeTab) {
      case "inicio":
        return <Dashboard setActiveTab={setActiveTab} />;
      case "red":
      case "routers_olts":
        return <Network />;
      case "red_ipv4":
        return <IPv4Networks />;
      case "nap_boxes":
        return <NapBoxes />;
      case "monitoring":
        return <Monitoring />;
      case "servicios":
        return <Plans />;
      case "clientes":
      case "client_users":
        return <Users />;
      case "client_zones":
        return <Zones />;
      case "facturacion":
        return <Billing />;
      case "hotspot":
        return <Hotspot />;
      case "tareas":
        return <Tasks />;
      case "almacen":
        return <Inventory />;
      case "tickets":
        return <Tickets />;
      case "mensajeria":
        return <Messaging />;
      case "ajustes":
        return <Settings />;
      default:
        return <Dashboard setActiveTab={setActiveTab} />;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex font-sans">
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpen={sidebarOpen}
        setIsOpen={setSidebarOpen}
        companyName={companyName}
      />
      <div className={`flex-1 flex flex-col transition-all duration-300 ${
        sidebarOpen ? "ml-64" : "ml-20"
      }`}>
        <Navbar setActiveTab={setActiveTab} />
        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {renderContent()}
        </main>
      </div>
    </div>
  );
}
