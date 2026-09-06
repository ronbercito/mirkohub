/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/OltOnusTab.jsx
 * Pertenece a: Red > OLT > pestaña "ONUs".
 * Función: Renderiza exclusivamente el inventario gráfico/expandible de ONUs del PON seleccionado.
 * Regla: Cualquier cambio visual o funcional de la pestaña ONUs debe entrar por este archivo o por sus componentes hijos.
 */
import React from "react";
import OnuCardsPanelV2 from "../OnuCardsPanelV2";

export default function OltOnusTab({ router, pon, res, onAction, onRefresh }) {
  return (
    <OnuCardsPanelV2
      router={router}
      pon={pon}
      rows={res?.rows || []}
      raw={res?.raw || ""}
      onAction={onAction}
      onRefresh={onRefresh}
    />
  );
}
