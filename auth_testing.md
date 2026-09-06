# Testing Playbook - FibraZ ISP Authentication & Core Modules

## Verification Steps:
1. Backend Auth Check:
   - Login with `admin@fibraz.pe` / `admin123` -> returns JWT token and user info
   - Verify `/api/auth/me` with Bearer token
2. Dashboard and Metrics Check:
   - `GET /api/dashboard/summary` returns ISP stats (clientes activos, suspendidos, routers, facturación S/., tráfico 7 días)
3. Clients & MikroTik Simulation:
   - `GET /api/clients`
   - `POST /api/clients/:id/toggle-status` (Cortar / Reactivar servicio)
   - `POST /api/routers/sync-cuts` (Sincronizar cortes en routers MikroTik)
4. Billing & Payments:
   - `GET /api/invoices`
   - `POST /api/payments` (Registrar pago con Yape, Plin, Efectivo)
5. Plans, Routers, Tickets, Almacen, Hotspot, Tareas:
   - CRUD endpoints under `/api/...`
