/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu-v2/OnuWorkspace.jsx
 * Pertenece a: Red > OLT > pestaña "ONUs" (versión 2 recreada desde cero).
 * Función: Orquesta los submenús independientes de ONUs v2, consulta /olt/onus-v2
 *          y luego /olt/onu-descriptions para mezclar el nombre configurado en VSOL.
 * Regla: Este archivo NO parsea CLI ni contiene tablas específicas. Cada submenú
 *        debe vivir en su propio archivo. No reutilizar OnuAdminTable/OnuCardsPanelV2.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { RefreshCw } from "lucide-react";
import { useAuth } from "../../../../../context/AuthContext";

import OnuListView from "./OnuListView";
import OnuStateView from "./OnuStateView";
import OnuAuthView from "./OnuAuthView";
import OnuOpticalView from "./OnuOpticalView";

const SUBTABS = [
  { id: "list", label: "Lista de ONU" },
  { id: "state", label: "Estado de la ONU" },
  { id: "auth", label: "Autorización de ONU" },
  { id: "optical", label: "Potencia Óptica ONU" },
];

const Stat = ({ label, value, className = "text-slate-100" }) => (
  <div className="rounded-xl border border-slate-800 bg-slate-950/45 px-4 py-3">
    <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
    <p className={`mt-1 text-xl font-bold font-mono ${className}`}>{value}</p>
  </div>
);

export default function OnuWorkspace({ router, pon, onAction, refreshSeq = 0, showRaw = false }) {
  const { API, token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [tab, setTab] = useState("list");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [localRefresh, setLocalRefresh] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await axios.get(
        `${API}/routers/${router.id}/olt/onus-v2?pon=${pon}`,
        { headers },
      );

      const base = response.data;
      if (!base?.ok || !Array.isArray(base?.onus) || !base.onus.length) {
        setData(base);
        return;
      }

      // La descripción se consulta DESPUÉS de cerrar la lectura principal de ONUs.
      // Así evitamos sesiones Telnet simultáneas contra la VSOL.
      const ids = base.onus
        .map((onu) => Number(onu.onu_id))
        .filter((id) => Number.isInteger(id) && id > 0)
        .join(",");

      let descriptionData = null;
      try {
        const descriptionResponse = await axios.get(
          `${API}/routers/${router.id}/olt/onu-descriptions?pon=${pon}&ids=${encodeURIComponent(ids)}`,
          { headers },
        );
        descriptionData = descriptionResponse.data;
      } catch (_) {
        // Si falla solo la lectura de nombres, conservar inventario/estado funcional.
        descriptionData = null;
      }

      const descriptions = descriptionData?.descriptions || {};
      const mergedOnus = base.onus.map((onu) => ({
        ...onu,
        // La descripción directa de VSOL tiene prioridad sobre cualquier inferencia.
        description: descriptions[String(onu.onu_id)] || onu.description || "",
      }));

      setData({
        ...base,
        onus: mergedOnus,
        description_source: descriptionData?.source || null,
        description_found: descriptionData?.found ?? 0,
        raw: {
          ...(base.raw || {}),
          descriptions: descriptionData?.raw || null,
        },
      });
    } catch (error) {
      setData({
        ok: false,
        error: error?.response?.data?.detail || "No se pudo consultar ONUs v2",
        onus: [],
        counts: { total: 0, online: 0, offline: 0, unknown: 0 },
        raw: {},
      });
    } finally {
      setLoading(false);
    }
  }, [API, headers, router.id, pon]);

  useEffect(() => {
    load();
  }, [load, refreshSeq, localRefresh]);

  const onus = data?.onus || [];
  const counts = data?.counts || { total: 0, online: 0, offline: 0, unknown: 0 };

  return (
    <div className="space-y-4" data-testid="onu-workspace-v2">
      <div className="rounded-2xl border border-slate-800 bg-slate-950/35 overflow-hidden">
        <div className="flex flex-wrap items-center gap-1 px-3 pt-2 border-b border-slate-800">
          {SUBTABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setTab(item.id)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition ${
                tab === item.id
                  ? "border-cyan-400 text-cyan-300"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {item.label}
            </button>
          ))}

          <button
            type="button"
            onClick={() => setLocalRefresh((x) => x + 1)}
            className="ml-auto mb-1 p-2 rounded-lg border border-slate-700 bg-slate-900 text-slate-300 hover:text-cyan-300"
            title="Actualizar ONUs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Stat label="Total ONU" value={counts.total} />
            <Stat label="En línea" value={counts.online} className="text-emerald-300" />
            <Stat label="Fuera de línea" value={counts.offline} className="text-rose-300" />
            <Stat label="Sin estado" value={counts.unknown} className="text-amber-300" />
          </div>

          {!data?.ok && (
            <div className="rounded-xl border border-amber-900/50 bg-amber-950/25 px-4 py-3 text-xs text-amber-300">
              <p className="font-semibold">No se pudo construir la lista canónica de ONUs.</p>
              <p className="mt-1 text-amber-200/80">{data?.error || "Sin respuesta"}</p>
              <p className="mt-1 text-[10px] text-slate-500">Por seguridad no se muestran IDs inventados ni se usa el parser antiguo como respaldo.</p>
            </div>
          )}

          {data?.ok && tab === "list" && <OnuListView onus={onus} onAction={onAction} />}
          {data?.ok && tab === "state" && <OnuStateView onus={onus} />}
          {data?.ok && tab === "auth" && <OnuAuthView onus={onus} />}
          {data?.ok && tab === "optical" && <OnuOpticalView onus={onus} />}

          {showRaw && (
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-3">
              {[
                ["show onu state", data?.raw?.state],
                ["show onu info", data?.raw?.info],
                ["show pon rx_power", data?.raw?.optical],
                ["Descripción VSOL", data?.raw?.descriptions ? JSON.stringify(data.raw.descriptions, null, 2) : ""],
              ].map(([title, body]) => (
                <div key={title} className="rounded-xl border border-slate-800 bg-black/30 overflow-hidden">
                  <div className="px-3 py-2 border-b border-slate-800 text-[10px] font-semibold text-cyan-300">{title}</div>
                  <pre className="p-3 text-[10px] text-slate-300 font-mono whitespace-pre-wrap break-words max-h-80 overflow-auto">{body || "(sin salida)"}</pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
