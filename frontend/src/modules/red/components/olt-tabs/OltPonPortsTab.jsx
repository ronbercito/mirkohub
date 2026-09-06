/**
 * Archivo: frontend/src/modules/red/components/olt-tabs/OltPonPortsTab.jsx
 * Pertenece a: Red > OLT > pestaña "Puertos PON".
 * Función: Contenedor exclusivo de la vista óptica/gráfica del puerto PON seleccionado.
 * Regla: No agregar aquí lógica de ONUs, auto-find, resumen ni consola.
 */
import React from "react";
import PonOpticalPanel from "../PonOpticalPanel";

export default function OltPonPortsTab({ res, pon, loading }) {
  return <PonOpticalPanel res={res} pon={pon} loading={loading} />;
}
