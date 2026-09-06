/**
 * Archivo: frontend/src/components/layout/Layout.jsx
 * Función: Estructura principal del panel una vez autenticado: barra lateral, barra
 *          superior y el área de contenido que muestra el módulo activo (pestaña).
 * Trabaja con: components/layout/Sidebar.jsx, components/layout/Navbar.jsx,
 *              modules/<modulo>/*.jsx (Dashboard, Network, Plans, Clients, Billing,
 *              Hotspot, Tasks, Inventory, Tickets, Messaging, Settings)
 */
import React, { useState } from "react";
import Sidebar from "./Sidebar";
import Navbar from "./Navbar";
import Dashboard from "../../modules/inicio/Dashboard";
import Network from "../../modules/red/Network";
import IPv4Networks from "../../modules/red/ipv4/IPv4Networks";
import NapBoxes from "../../modules/red/nap_boxes/NapBoxes";
import Plans from "../../modules/planes/Plans";
import Users from "../../modules/clientes/usuarios/Users";
import Billing from "../../modules/facturacion/Billing";
import Hotspot from "../../modules/hotspot/Hotspot";
import Tasks from "../../modules/tareas/Tasks";
import Inventory from "../../modules/almacen/Inventory";
import Tickets from "../../modules/tickets/Tickets";
import Messaging from "../../modules/mensajeria/Messaging";
import Settings from "../../modules/ajustes/Settings";

export default function Layout() {
  const [activeTab, setActiveTab] = useState("inicio");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const renderContent = () => {
    switch (activeTab) {
      case "inicio":
        return <Dashboard setActiveTab={setActiveTab} />;
      case "red":
        return <Network />;
      case "red_ipv4":
        return <IPv4Networks />;
      case "nap_boxes":
        return <NapBoxes />;
      case "servicios":
        return <Plans />;
      case "clientes":
      case "client_users":
        return <Users />;
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
