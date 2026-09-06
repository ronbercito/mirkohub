/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu-v2/useOnuOpticalScan.js
 * Área: Red > OLT > ONUs > Potencia Óptica ONU.
 * Función: Consultas RX secuenciales con progreso, cancelación y repetición opcional.
 * Alcance: Solo endpoint onu-power. Una petición pendiente por vista, pausa entre ONUs.
 * No modifica inventario, acciones, parsers CLI ni otros submenús.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../../../context/AuthContext";

export default function useOnuOpticalScan(routerId) {
  const { API, token } = useAuth();
  const [samples, setSamples] = useState({});
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [message, setMessage] = useState("");
  const task = useRef(null);
  const stop = useCallback(() => {
    if (task.current) {
      task.current.cancelled = true;
      task.current.controller?.abort();
    }
  }, []);
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", hide);
    };
  }, [stop]);
  const scan = useCallback(async (onus) => {
    if (task.current || document.hidden || !onus.length) return;
    const current = { cancelled: false, controller: null };
    task.current = current;
    setRunning(true);
    setMessage("");
    setProgress({ done: 0, total: onus.length });
    let failures = 0;
    try {
      for (let i = 0; i < onus.length; i++) {
        if (current.cancelled || document.hidden) break;
        const onu = onus[i];
        const key = onu.pon_id + ":" + onu.onu_id;
        current.controller = new AbortController();
        try {
          const res = await axios.get(API + "/routers/" + routerId + "/olt/onu-power", {
            params: { pon: onu.pon_id, onu: onu.onu_id },
            headers: { Authorization: "Bearer " + token },
            signal: current.controller.signal,
            timeout: 30000,
          });
          if (current.cancelled) break;
          const data = res.data;
          setSamples((prev) => ({ ...prev, [key]: data.ok ? data : { ok: false, error: data.error || "Sin lectura" } }));
          failures = 0;
        } catch (e) {
          if (current.cancelled) break;
          failures++;
          setSamples((prev) => ({ ...prev, [key]: { ok: false, error: String(e.response?.data?.detail || "Error de conexión") } }));
          if ([401, 403, 429].includes(e.response?.status) || failures >= 3) {
            setMessage("Consulta detenida por errores o equipo ocupado. Puedes volver a intentarlo.");
            break;
          }
        }
        setProgress({ done: i + 1, total: onus.length });
        // Separar sesiones y nunca lanzar un lote concurrente contra Telnet.
        if (i < onus.length - 1) await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (current.cancelled) setMessage("Consulta detenida. Las lecturas anteriores conservan su hora.");
    } finally {
      task.current = null;
      setRunning(false);
    }
  }, [API, token, routerId]);
  return { samples, running, progress, message, scan, stop };
}
