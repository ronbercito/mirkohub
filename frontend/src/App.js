/**
 * Archivo: frontend/src/App.js
 * Función: Componente raíz de React: envuelve la app con el proveedor de autenticación y muestra Login o el Layout del panel según la sesión; monta el contenedor de notificaciones (toasts).
 * Trabaja con: index.js, context/AuthContext.js, modules/auth/Login.jsx, components/layout/Layout.jsx
 */
import React from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import Login from "./modules/auth/Login";
import Layout from "./components/layout/Layout";
import { Toaster } from "sonner";
import "./App.css";

function MainApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-xs text-slate-400 font-medium">Iniciando FibraZ ISP Telecom...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return <Layout />;
}

export default function App() {
  return (
    <AuthProvider>
      <MainApp />
      <Toaster position="top-right" richColors theme="dark" />
    </AuthProvider>
  );
}
