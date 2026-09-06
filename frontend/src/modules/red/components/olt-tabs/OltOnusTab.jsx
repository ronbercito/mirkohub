/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/OltOnusTab.jsx
 * Pertenece a: Red > OLT > pestaña "ONUs".
 * Función: Orquesta exclusivamente la pestaña ONUs y enlaza el workspace v2 recreado.
 * Regla: Este archivo NO contiene tablas ni parseo. Cada submenú de ONUs vive en
 *        frontend/src/modules/red/components/olt-tabs/onu-v2/ y tiene su propio archivo.
 */
import React from "react";
import OnuWorkspace from "./onu-v2/OnuWorkspace";

export default function OltOnusTab({ router, pon, onAction, refreshSeq, showRaw }) {
  return (
    <OnuWorkspace
      router={router}
      pon={pon}
      onAction={onAction}
      refreshSeq={refreshSeq}
      showRaw={showRaw}
    />
  );
}
