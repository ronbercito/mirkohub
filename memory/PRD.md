# PRD - FibraZ / MikroSmart ISP Telecom Management & Billing Platform

## 1. Resumen del Proyecto
Panel integral de facturación, gestión de clientes (abonados), red MikroTik (API RouterOS real), planes en Soles (S/.), soporte técnico, almacén, fichas Hotspot, tareas, mensajería y ajustes. Se exporta para instalar en un servidor Debian 13 propio (script `setup_debian.sh`) y subir a GitHub.

Idioma del usuario: **Español**.

## 2. Arquitectura (v3 — jun 2026)
- **Frontend**: React 19 + Tailwind + Lucide + Recharts + Sonner. Carpeta por módulo en `frontend/src/modules/<modulo>/`; layout en `components/layout/`.
- **Backend**: FastAPI, `backend/server.py` monta `app/routers/<modulo>/router.py` bajo `/api`.
  - `app/core/` config (.env), database (SQLAlchemy 2 async), security (JWT HS256 + bcrypt), seed, utils.
  - `app/models/` una tabla por archivo: users, plans, routers, clients, invoices, tickets, inventory, hotspot_vouchers, tasks, settings(JSON).
  - `app/integrations/mikrotik/` client.py (librouteros async, v6 token/v7 plain, API 8728 / API-SSL 8729) y service.py (aprovisionar, cortar, reactivar, sync planes).
- **Base de datos**: **MariaDB** vía `DATABASE_URL=mysql+aiomysql://...` (usuario eligió MariaDB; MongoDB eliminado). En el pod corre MariaDB local por supervisor `mariadb`; si no responde, respaldo SQLite en `backend/data/`.
- **Despliegue**: `deploy/setup_debian.sh` (idempotente) + plantillas `deploy/nginx`, `deploy/supervisor`, `deploy/mariadb`, `deploy/env`. `setup_debian.sh` raíz es un wrapper. Paquetes descargables en `frontend/public/downloads/`.
- Todos los archivos llevan comentario de cabecera (función + archivos relacionados).
- El sistema inicia **vacío** (solo admin y ajustes por defecto), a pedido del usuario.

## 3. Integración MikroTik (real)
- Clientes PPPoE → `/ppp secret` (perfil = plan, rate-limit sub/baj); IP Estática/DHCP → `/queue simple` target ip/32.
- Corte: PPPoE deshabilita secret + cierra sesión; IP/DHCP agrega a address-list (Ajustes → `mikrotik_cut_list`, por defecto `morosos`). Pago sin deuda reactiva automáticamente.
- Red: test-connection (identity, versión, board, CPU, RAM, uptime), ping TCP, interfaces con monitor-traffic, PPPoE activos/secrets/toggle, colas, DHCP leases (make-static), address-list add/remove, hotspot users/active, sync-plans (PPP profiles), sync-cuts masivo.
- Lecturas en vivo GET responden 200 `{ok, data | error}`; escrituras 502 si el router no responde. Operaciones de clientes/hotspot devuelven `mikrotik:{ok,message}` y persisten en BD aunque el router esté apagado.
- Sin router real en el entorno de pruebas; el usuario tiene MikroTik v6/v7 para probar localmente.

## 3b. Integración OLT VSOL (CLI Telnet/SSH)
- `app/integrations/olt/vsol.py`: OltClient (telnet asyncio con negociación IAC / SSH asyncssh), login + enable, manejo de --More--, `OLT_PROFILES` (vsol_gpon, vsol_epon) con comandos por acción, parser genérico de tablas y clave:valor.
- Router: campos protocol, enable_password, olt_profile, pon_ports, snmp_community (migración ligera `_add_missing_columns` en database.py).
- Endpoints: GET /api/routers/olt-profiles, GET /{id}/olt/{system|pon_optical|pon_stats|onu_list|onu_autofind|onu_optical|onu_detail}?pon=, POST /{id}/olt/onu/{authorize|reboot|deactivate|activate|delete}, POST /{id}/olt/command (bloquea reboot/reload/erase), GET /api/clients/{id}/onu-status.
- Frontend: OltForm.jsx (estilo AdminOLT: Nombre, Modelo→auto PON/puertos, Software Version 1.x/2.x, Tipo PON GPON/EPON, IP conexión, IP privada, Telnet/SSH, puertos SSH/Telnet/SNMP, comunidades RO/RW, usuario/clave con ojo, clave enable; botones Guardar / Guardar y Comprobar Conexión → ?check=). RouterForm delega en OltForm cuando tipo=OLT. Campos router: private_ip, olt_model, software_version, pon_type, ssh_port, telnet_port, snmp_port, snmp_community_rw; cli_port derivado del protocolo; OltLiveTabs (Resumen, PON, ONUs, Pendientes+autorizar, Óptica, Consola, salida cruda); botón ONU en fila de cliente; campo Serie ONU en formulario.
- Probado con `backend/tests/fake_olt_server.py` (OLT simulada). PENDIENTE: validar comandos con la OLT real del usuario y ajustar OLT_PROFILES.

## 4. Historial
- 2026-06 (sesiones previas): MVP completo con MongoDB; export Debian; fixes sudo/GPG/requirements; Nginx 404 (frontend .env cloud) corregido.
- 2026-06 (esta sesión): migración a MariaDB, API MikroTik real, reorganización de carpetas, comentarios de cabecera, datos de ejemplo eliminados, deploy/ con plantillas, paquetes regenerados. Testing agent iteración 2: 32/32 backend OK, UI OK. Usuario decidió NO integrar ChatGPT.

## 5. Backlog
- P1: MikroTik real ya conecta (confirmado por usuario). Validar OLT VSOL real: comandos exactos de su firmware.
- P2: Pasarela de pago Culqi/MercadoPago; backups automáticos MariaDB en el script; HTTPS Let's Encrypt; soporte OLT por Telnet/SNMP.
- Regla: tras cambios en código/script, regenerar `frontend/public/downloads/*.tar.gz|zip` excluyendo .env, node_modules, .git, .emergent, build, venv, data, tests, test_reports.
