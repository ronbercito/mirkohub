/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/OltOnusTab.jsx
 * Pertenece a: Red > OLT > pestaña "ONUs".
 * Función: Orquesta exclusivamente la pestaña ONUs y enlaza la vista administrativa
 *          independiente de la lista de ONU.
 * Regla: Cada bloque, menú o submenú nuevo de ONUs debe vivir en su propio archivo hijo.
 *        No modificar Resumen, Puertos PON, Auto-find, Óptica ONU ni Consola desde aquí.
 */
import React from "react";
import OnuAdminTable from "./onu/OnuAdminTable";

export default function OltOnusTab({ router, pon, res, onAction, onRefresh }) {
  const rows = res?.rows || [];

  return (
    <div className="space-y-4 onu-tab-isolated">
      <OnuAdminTable
        router={router}
        pon={pon}
        rows={rows}
        onAction={onAction}
        onRefresh={onRefresh}
      />
    </div>
  );
}
