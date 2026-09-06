/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/OltOnusTab.jsx
 * Pertenece a: Red > OLT > pestaña "ONUs".
 * Función: Orquesta exclusivamente la pestaña ONUs: enlaza sus contadores aislados
 *          y el inventario gráfico ya existente, sin tocar otras pestañas.
 * Regla: Cada bloque nuevo de ONUs debe vivir en su propio archivo hijo cuando tenga
 *        lógica propia. No modificar Resumen, Puertos PON, Auto-find, Óptica o Consola.
 */
import React from "react";
import OnuCardsPanelV2 from "../OnuCardsPanelV2";
import OnuSummaryCounters from "./onu/OnuSummaryCounters";

export default function OltOnusTab({ router, pon, res, onAction, onRefresh }) {
  const rows = res?.rows || [];

  return (
    <div className="space-y-4 onu-tab-isolated">
      <OnuSummaryCounters
        router={router}
        pon={pon}
        total={rows.length}
      />

      {/*
        OnuCardsPanelV2 todavía conserva su resumen antiguo por compatibilidad.
        Lo ocultamos SOLO dentro de esta pestaña para no editar ese componente
        mientras resolvemos los contadores por partes.
      */}
      <style>{`
        .onu-tab-isolated [data-testid="onu-cards-panel-v3"] > div:first-child {
          display: none;
        }
      `}</style>

      <OnuCardsPanelV2
        router={router}
        pon={pon}
        rows={rows}
        raw={res?.raw || ""}
        onAction={onAction}
        onRefresh={onRefresh}
      />
    </div>
  );
}
