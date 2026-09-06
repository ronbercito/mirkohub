/**
 * Archivo: frontend/src/modules/clientes/usuarios/Users.jsx
 * Función: Entrada del submódulo Usuarios dentro de Clientes.
 * Alcance: Reutiliza el registro funcional de abonados existente; no modifica su
 *          integración con planes, MikroTik, redes IPv4 ni cajas NAP.
 * Trabaja con: frontend/src/modules/clientes/Clients.jsx, components/layout/Layout.jsx.
 */
import React from "react";
import Clients from "../Clients";

export default function Users() {
  return <Clients />;
}
