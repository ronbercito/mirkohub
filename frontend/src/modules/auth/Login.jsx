/**
 * Archivo: frontend/src/modules/auth/Login.jsx
 * Función: Pantalla de inicio de sesión (correo + contraseña). Llama a login() del AuthContext y muestra errores del backend.
 * Trabaja con: context/AuthContext.js, backend/app/routers/auth/router.py, constants/testIds.js
 */
import React, { useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { TEST_IDS } from "../../constants/testIds";
import { Radio, Lock, Mail, Server, ShieldCheck, CheckCircle2, Wifi } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("admin@fibraz.pe");
  const [password, setPassword] = useState("admin123");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password);
      toast.success("¡Bienvenido al Panel de Control FibraZ!");
    } catch (err) {
      const msg = err.response?.data?.detail || "Error al iniciar sesión. Verifique credenciales.";
      setError(typeof msg === "string" ? msg : JSON.stringify(msg));
      toast.error(typeof msg === "string" ? msg : "Error de acceso");
    } finally {
      setLoading(false);
    }
  };

  const setDemoCredentials = (roleEmail, rolePass) => {
    setEmail(roleEmail);
    setPassword(rolePass);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-4 relative overflow-hidden font-sans">
      {/* Background glow effects */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-cyan-600/10 rounded-full blur-3xl pointer-events-none"></div>
      <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl pointer-events-none"></div>

      <div className="w-full max-w-md bg-slate-900/90 backdrop-blur-xl border border-slate-800 rounded-2xl shadow-2xl p-8 relative z-10">
        <div className="flex flex-col items-center text-center mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/30">
              <Wifi className="w-7 h-7 text-white" />
            </div>
            <div className="text-left">
              <h1 className="text-2xl font-bold tracking-tight text-white flex items-center gap-1">
                Fibra<span className="text-cyan-400">Z</span>
              </h1>
              <p className="text-xs text-cyan-400/80 font-medium tracking-wide uppercase">ISP Telecom Perú</p>
            </div>
          </div>
          <p className="text-sm text-slate-400 mt-2">
            Panel de Facturación, Control de Clientes y Gestión MikroTik / OLT
          </p>
        </div>

        {error && (
          <div className="mb-6 p-3.5 bg-rose-500/15 border border-rose-500/30 rounded-xl text-xs text-rose-300 font-medium">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
              Correo Electrónico
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              <input
                data-testid={TEST_IDS.LOGIN_EMAIL}
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@fibraz.pe"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-700/80 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5 uppercase tracking-wider">
              Contraseña
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-500 absolute left-3.5 top-3.5" />
              <input
                data-testid={TEST_IDS.LOGIN_PASSWORD}
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-950/60 border border-slate-700/80 rounded-xl text-sm text-white focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition-colors"
              />
            </div>
          </div>

          <button
            data-testid={TEST_IDS.LOGIN_SUBMIT}
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white text-sm font-semibold rounded-xl shadow-lg shadow-cyan-600/30 transition-all duration-200 transform active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
          >
            {loading ? (
              <span className="inline-block animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full"></span>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                Ingresar al Sistema
              </>
            )}
          </button>
        </form>

        {/* Demo Quick Access */}
        <div className="mt-8 pt-6 border-t border-slate-800">
          <p className="text-xs text-slate-400 text-center mb-3 font-medium">Accesos Rápidos Demo:</p>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setDemoCredentials("admin@fibraz.pe", "admin123")}
              type="button"
              className="px-2 py-2 bg-slate-800/70 hover:bg-slate-800 border border-slate-700 rounded-lg text-[11px] text-cyan-300 font-medium text-center transition"
            >
              Admin
            </button>
            <button
              onClick={() => setDemoCredentials("tecnico@fibraz.pe", "tec123")}
              type="button"
              className="px-2 py-2 bg-slate-800/70 hover:bg-slate-800 border border-slate-700 rounded-lg text-[11px] text-emerald-300 font-medium text-center transition"
            >
              Técnico
            </button>
            <button
              onClick={() => setDemoCredentials("cobrador@fibraz.pe", "cob123")}
              type="button"
              className="px-2 py-2 bg-slate-800/70 hover:bg-slate-800 border border-slate-700 rounded-lg text-[11px] text-purple-300 font-medium text-center transition"
            >
              Cobrador
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
