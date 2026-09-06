/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/OltOnusTab.jsx
 * Pertenece a: Red > OLT > pestaña "ONUs".
 * Función: Renderiza exclusivamente el inventario de ONUs y carga los contadores
 *          superiores (total, online, offline y con nombre) desde su endpoint aislado.
 * Regla: Cualquier cambio visual o funcional de la pestaña ONUs debe entrar por este
 *        archivo o por sus componentes hijos; no modificar otras pestañas para esto.
 */
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useAuth } from "../../../../context/AuthContext";
import OnuCardsPanelV2 from "../OnuCardsPanelV2";

export default function OltOnusTab({ router, pon, res, onAction, onRefresh }) {
  const { API, token } = useAuth();
  const headers = useMemo(() => ({ Authorization: `Bearer ${token}` }), [token]);
  const total = Array.isArray(res?.rows) ? res.rows.length : 0;
  const [summaryCounts, setSummaryCounts] = useState(null);

  const loadSummary = useCallback(async () => {
    if (!router?.id) return;
    try {
      const response = await axios.get(
        `${API}/routers/${router.id}/olt/onu-summary?pon=${pon}&total=${total}`,
        { headers }
      );
      if (response.data?.ok) {
        setSummaryCounts({
          total,
          online: Number(response.data.online || 0),
          offline: Number(response.data.offline || 0),
          named: Number(response.data.named || 0),
          source: response.data.source || "none",
        });
      } else {
        setSummaryCounts(null);
      }
    } catch (error) {
      console.warn("No se pudo cargar el resumen ONU del PON", error);
      setSummaryCounts(null);
    }
  }, [API, headers, router?.id, pon, total]);

  useEffect(() => {
    setSummaryCounts(null);
    loadSummary();
  }, [loadSummary]);

  const refresh = useCallback(async () => {
    if (onRefresh) await onRefresh();
    await loadSummary();
  }, [onRefresh, loadSummary]);

  return (
    <OnuCardsPanelV2
      router={router}
      pon={pon}
      rows={res?.rows || []}
      raw={res?.raw || ""}
      summaryCounts={summaryCounts}
      onAction={onAction}
      onRefresh={refresh}
    />
  );
}
