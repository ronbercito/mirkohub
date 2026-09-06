/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/onu/OnuSummaryCounters.jsx
 * Pertenece a: Red > OLT > ONUs > contadores superiores.
 * Función: Muestra total, online, offline y ONUs con nombre del PON seleccionado.
 * Regla: Este componente sólo maneja los contadores; no modifica tarjetas, detalle,
 *        óptica, acciones ONU ni ninguna otra pestaña de la OLT.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { Power, Radio, User, Wifi } from "lucide-react";
import { useAuth } from "../../../../../context/AuthContext";

const Stat = ({ icon: Icon, label, value, valueClass = "text-slate-100", loading = false }) => (
  <div className="rounded-2xl border border-slate-800 bg-slate-950/55 p-3.5">
    <div className="flex items-center justify-between gap-2">
      <div>
        <p className="text-[9px] uppercase tracking-wider text-slate-500">{label}</p>
        <p className={`text-xl font-bold font-mono mt-1 ${valueClass}`}>
          {loading ? "…" : value}
        </p>
      </div>
      <div className="w-9 h-9 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-center text-cyan-400">
        <Icon className="w-4 h-4" />
      </div>
    </div>
  </div>
);

export default function OnuSummaryCounters({ router, pon, total = 0, refreshKey = 0 }) {
  const { API, token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const [data, setData] = useState({ total, online: 0, offline: 0, named: 0 });
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!router?.id) return;
    setLoading(true);
    try {
      const response = await axios.get(
        `${API}/routers/${router.id}/olt/onu-summary?pon=${pon}&total=${total}`,
        { headers }
      );

      if (response.data?.ok) {
        setData({
          total,
          online: Number(response.data.online || 0),
          offline: Number(response.data.offline || 0),
          named: Number(response.data.named || 0),
        });
      } else {
        setData((prev) => ({ ...prev, total }));
      }
    } catch (error) {
      console.warn("No se pudieron actualizar los contadores ONU", error);
      setData((prev) => ({ ...prev, total }));
    } finally {
      setLoading(false);
    }
  }, [API, headers, router?.id, pon, total]);

  useEffect(() => {
    setData({ total, online: 0, offline: 0, named: 0 });
    load();
  }, [load, refreshKey, total]);

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="onu-summary-counters">
      <Stat icon={Radio} label="ONUs en este PON" value={data.total} />
      <Stat icon={Wifi} label="Online" value={data.online} loading={loading} valueClass="text-emerald-300" />
      <Stat
        icon={Power}
        label="Offline"
        value={data.offline}
        loading={loading}
        valueClass={data.offline ? "text-rose-300" : "text-slate-100"}
      />
      <Stat icon={User} label="Con nombre en OLT" value={data.named} loading={loading} valueClass="text-cyan-300" />
    </div>
  );
}
