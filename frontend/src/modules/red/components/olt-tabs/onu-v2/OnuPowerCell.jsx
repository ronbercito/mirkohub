/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu-v2/OnuPowerCell.jsx
 * Área: Red > OLT > ONUs > Lista > RX.
 * Función: Consulta optical_info al seleccionar una ONU y repite tras 30 segundos.
 * Alcance: Una celda; el orquestador permite una sola seleccionada.
 * No modifica inventario, acciones, estados ni otras pestañas. Pausa si la página se oculta.
 */
import React, { useEffect, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../../../context/AuthContext";

export default function OnuPowerCell({ routerId, pon, onu, active, onToggle }) {
  const { API, token } = useAuth();
  const [sample, setSample] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!active) return undefined;
    let stopped = false;
    let timer;
    let inFlight = false;
    let controller;
    const read = async () => {
      if (stopped || inFlight || document.hidden) return;
      inFlight = true;
      controller = new AbortController();
      setLoading(true);
      try {
        const res = await axios.get(API + "/routers/" + routerId + "/olt/onu-power", {
          params: { pon, onu },
          headers: { Authorization: "Bearer " + token },
          signal: controller.signal,
          timeout: 30000,
        });
        if (stopped) return;
        if (!res.data.ok) throw new Error(res.data.error || "Sin lectura");
        setSample(res.data);
        setError("");
      } catch (e) {
        if (!stopped) {
          setSample(null);
          setError(String(e.response?.data?.detail || e.message || "Sin lectura"));
        }
      } finally {
        inFlight = false;
        if (!stopped) {
          setLoading(false);
          timer = setTimeout(read, 30000);
        }
      }
    };
    const visibility = () => {
      clearTimeout(timer);
      if (!document.hidden) read();
    };
    read();
    document.addEventListener("visibilitychange", visibility);
    return () => {
      stopped = true;
      clearTimeout(timer);
      controller?.abort();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active, routerId, pon, onu, API, token]);
  return (
    <div className="min-w-[145px] space-y-1">
      <div className="font-mono text-cyan-200">
        {active && loading ? "Leyendo…" : sample ? sample.rx_dbm.toFixed(2) + " dBm" : "—"}
      </div>
      {sample && <div className="text-[9px] text-slate-400" title={"TX: " + (sample.tx_dbm ?? "—") + " dBm"}>
        {active ? "Lectura: " : "Última: "}{new Date(sample.measured_at).toLocaleTimeString()}
      </div>}
      {error && <div className="text-[9px] text-amber-300" title={error}>Sin lectura válida</div>}
      <button type="button" onClick={onToggle} className="text-[10px] text-cyan-400 underline">
        {active ? "Detener seguimiento" : "Consultar / seguir"}
      </button>
    </div>
  );
}
