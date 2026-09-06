# Guía de Instalación — FibraZ / MikroSmart ISP (Debian 13 / 12 / Ubuntu)

Panel de gestión ISP: **React (frontend) + FastAPI (backend) + MariaDB (base de datos) + API MikroTik RouterOS (v6/v7)**.

---

## Estructura del proyecto

```
backend/
  server.py                     Punto de entrada FastAPI (uvicorn server:app)
  app/core/                     config (.env), database (MariaDB/SQLAlchemy), security (JWT/bcrypt), seed, utils
  app/models/                   Tablas SQL: user, plan, router, client, invoice, ticket, inventory, hotspot, task, setting
  app/routers/<modulo>/         Rutas por módulo: auth, inicio, clientes, planes, red, facturacion, tickets,
                                almacen, hotspot, tareas, mensajeria, ajustes
  app/integrations/mikrotik/    client.py (API RouterOS con librouteros) y service.py (cortes, PPPoE, colas, perfiles)
  app/integrations/olt/         vsol.py (CLI Telnet/SSH + perfiles de comandos GPON/EPON) y service.py (ONUs, óptica, autorizar)
frontend/src/
  modules/<modulo>/             Una carpeta por módulo (página + componentes propios)
  components/layout/            Sidebar, Navbar, Layout
  context/AuthContext.js        Sesión JWT y URL de la API
deploy/
  setup_debian.sh               Instalador automático (idempotente)
  nginx/ supervisor/ mariadb/ env/   Plantillas de cada configuración
```
Cada archivo tiene en la parte superior un comentario con su función y los archivos con los que trabaja.

---

## Opción 1 — Instalación automática (recomendada)

```bash
# Como root en Debian 13
apt-get update && apt-get install -y git
git clone https://github.com/TU_USUARIO/mikrosmart-isp.git /var/www/mikrosmart
bash /var/www/mikrosmart/setup_debian.sh
```
O con el paquete descargado desde el panel:
```bash
mkdir -p /var/www/mikrosmart && tar -xzf mikrosmart_complete.tar.gz -C /var/www/mikrosmart
bash /var/www/mikrosmart/setup_debian.sh
```

El script:
1. Instala Nginx, Supervisor, Python 3, Node.js 20, Yarn y **MariaDB**.
2. Crea la base `fibraz_isp_db` y el usuario `fibraz` con contraseña aleatoria.
3. Genera `backend/.env` (DATABASE_URL, JWT_SECRET aleatorio, admin inicial).
4. Instala dependencias Python, compila el frontend y lo publica en `/var/www/mikrosmart_web`.
5. Configura Supervisor (backend en 127.0.0.1:8001) y Nginx (puerto 80, `/api/` → backend).

Al terminar: **http://IP_DEL_SERVIDOR/** — usuario `admin@fibraz.pe`, clave `admin123` (cámbiala en `backend/.env` y vuelve a ejecutar el script o reinicia el backend).

### Actualizar a una nueva versión
```bash
cd /var/www/mikrosmart && git pull && bash setup_debian.sh
```

---

## Conectar tu MikroTik (RouterOS v6 / v7)

En el router (Winbox/terminal):
```routeros
/ip service set api disabled=no port=8728
# o mejor, API-SSL:
/ip service set api-ssl disabled=no port=8729
/user group add name=panel policy=read,write,api,test
/user add name=panel group=panel password=CLAVE_SEGURA
```
Luego en el panel → **Gestión de Red → Agregar Router / OLT**: IP, puerto (8728 u 8729 con SSL), usuario y contraseña. El botón *Probar conexión API* lee identidad, versión, CPU, RAM y uptime.

### Cómo trabaja el panel con el MikroTik
| Acción en el panel | Comando RouterOS |
|---|---|
| Crear/editar plan + *Sincronizar planes* | `/ppp profile add name=<plan> rate-limit=<subida>M/<bajada>M` |
| Crear cliente **PPPoE** | `/ppp secret add name=<usuario> password=... profile=<plan> remote-address=<ip>` |
| Crear cliente **IP Estática / DHCP** | `/queue simple add name=cli-<dni> target=<ip>/32 max-limit=<sub>/<baj>` |
| Corte cliente PPPoE | `/ppp secret set disabled=yes` + `/ppp active remove` |
| Corte cliente IP/DHCP | `/ip firewall address-list add list=morosos address=<ip>` |
| Reactivación / pago registrado | Operación inversa (habilita secret o quita de la lista) |
| Fichas Hotspot con router | `/ip hotspot user add name=<pin> password=<pin> limit-uptime=<h>h` |

> Para que el corte por address-list funcione, crea en el router una regla que bloquee o redirija
> el tráfico de esa lista, por ejemplo:
> `/ip firewall filter add chain=forward src-address-list=morosos action=drop comment="Corte panel"`
> El nombre de la lista se configura en **Ajustes → Address-list de corte** (por defecto `morosos`).

---

## Conectar tu OLT VSOL (V1600G / V1600D / V1600GS / V2800 / V1600X)

1. Habilita Telnet o SSH en la OLT (Web → *System → Login Management*, o en CLI:
   `no login-access-list deny telnet 0.0.0.0 0.0.0.0`). Usuario/clave por defecto `admin / admin`, IP por defecto `192.168.8.200`.
2. Panel → **Gestión de Red → Agregar Router / OLT** → Tipo **OLT VSOL**, protocolo Telnet (23) o SSH (22),
   **familia de OLT** (GPON o EPON: define los comandos que usa el panel), N° de puertos PON, usuario, clave y clave *enable*.
3. Pestañas disponibles: **Resumen** (`show version`), **Puertos PON** (óptica del puerto), **ONUs** (`show onu info` / `show onu auth-info`),
   **Pendientes** (`show onu auto-find` + botón *Autorizar ONU* por SN/MAC), **Óptica ONUs** (potencia RX/TX), **Consola** (cualquier comando `show ...`).
4. En **Clientes**, registra la *Serie ONU (SN)* del abonado y usa el botón de antena para ver su estado y potencia óptica en la OLT.

> Los comandos varían por firmware. Si una pestaña muestra "Unknown command", prueba el comando correcto en **Consola**
> y ajústalo en `backend/app/integrations/olt/vsol.py` (diccionario `OLT_PROFILES`). Para pruebas sin equipo:
> `python3 backend/tests/fake_olt_server.py 2323` simula una OLT VSOL GPON en 127.0.0.1:2323.

## Opción 2 — Instalación manual resumida

```bash
apt-get install -y nginx supervisor python3 python3-venv python3-dev build-essential mariadb-server libmariadb-dev gettext-base
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt-get install -y nodejs && npm i -g yarn

# MariaDB
mariadb -e "CREATE DATABASE fibraz_isp_db CHARACTER SET utf8mb4; CREATE USER 'fibraz'@'localhost' IDENTIFIED BY 'TU_CLAVE'; GRANT ALL ON fibraz_isp_db.* TO 'fibraz'@'localhost'; FLUSH PRIVILEGES;"

# Backend
cd /var/www/mikrosmart/backend
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
cat > .env <<EOF
DATABASE_URL="mysql+aiomysql://fibraz:TU_CLAVE@127.0.0.1:3306/fibraz_isp_db"
JWT_SECRET="$(tr -dc a-f0-9 </dev/urandom | head -c 64)"
ADMIN_EMAIL="admin@fibraz.pe"
ADMIN_PASSWORD="admin123"
CORS_ORIGINS="*"
EOF

# Frontend
cd /var/www/mikrosmart/frontend
printf 'REACT_APP_BACKEND_URL=\n' > .env
yarn install && yarn build
mkdir -p /var/www/mikrosmart_web && cp -r build/. /var/www/mikrosmart_web/ && chown -R www-data:www-data /var/www/mikrosmart_web

# Supervisor y Nginx: usa las plantillas de deploy/supervisor y deploy/nginx
export APP_DIR=/var/www/mikrosmart WEB_ROOT=/var/www/mikrosmart_web
envsubst < deploy/supervisor/mikrosmart_backend.conf.template > /etc/supervisor/conf.d/mikrosmart_backend.conf
envsubst '$WEB_ROOT' < deploy/nginx/mikrosmart.conf.template > /etc/nginx/sites-available/mikrosmart
ln -sf /etc/nginx/sites-available/mikrosmart /etc/nginx/sites-enabled/ && rm -f /etc/nginx/sites-enabled/default
supervisorctl reread && supervisorctl update && nginx -t && systemctl restart nginx
```

---

## Solución de problemas
- **404 Not Found (nginx)**: vuelve a ejecutar `bash setup_debian.sh` (reconstruye el frontend y la configuración).
- **Backend no arranca**: `tail -n 50 /var/log/mikrosmart_backend.err.log`. Verifica `DATABASE_URL` en `backend/.env` y que MariaDB esté activa (`systemctl status mariadb`).
- **No conecta al MikroTik**: comprueba `/ip service print` (api/api-ssl habilitado), firewall de entrada del router, y que el usuario tenga política `api`.
- **Respaldo de la base de datos**: `mariadb-dump fibraz_isp_db > respaldo_$(date +%F).sql`
