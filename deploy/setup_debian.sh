#!/bin/bash
# ==============================================================================
# Archivo: deploy/setup_debian.sh
# Función: Instalación y despliegue automático de FibraZ / MikroSmart en Debian 13/12
#          o Ubuntu Server. Instala MariaDB, Python, Node.js, compila el frontend,
#          configura el backend FastAPI bajo Supervisor y publica todo con Nginx en el
#          puerto 80. Es idempotente: se puede volver a ejecutar para actualizar.
# Trabaja con: deploy/mariadb/init.sql.template, deploy/supervisor/mikrosmart_backend.conf.template,
#              deploy/nginx/mikrosmart.conf.template, deploy/env/backend.env.example,
#              backend/requirements.txt, frontend/package.json
# ==============================================================================
set -e

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else
  command -v sudo >/dev/null || { echo "❌ Ejecute como root o instale sudo."; exit 1; }
  SUDO="sudo"
fi

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$DEPLOY_DIR")"
WEB_ROOT="/var/www/mikrosmart_web"
DB_NAME="fibraz_isp_db"
DB_USER="fibraz"

echo "🚀 Instalando FibraZ / MikroSmart ISP"
echo "📂 Aplicación: $APP_DIR"

# ---------------------------------------------------------------- 1. Paquetes base
echo "📦 1/6 Paquetes del sistema..."
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update
$SUDO apt-get install -y curl wget git build-essential python3 python3-pip python3-venv python3-dev \
  nginx supervisor gnupg lsb-release mariadb-server mariadb-client libmariadb-dev pkg-config gettext-base

# ---------------------------------------------------------------- 2. Node.js + Yarn
echo "📦 2/6 Node.js LTS y Yarn..."
if ! command -v node >/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
  $SUDO apt-get install -y nodejs
fi
command -v yarn >/dev/null || $SUDO npm install --global yarn

# ---------------------------------------------------------------- 3. MariaDB
echo "🗄️  3/6 Base de datos MariaDB..."
$SUDO systemctl enable --now mariadb

if [ -f "$APP_DIR/backend/.env" ] && grep -q "^DATABASE_URL=" "$APP_DIR/backend/.env"; then
  DB_PASS="$(grep '^DATABASE_URL=' "$APP_DIR/backend/.env" | sed -E 's#.*://[^:]+:([^@]+)@.*#\1#')"
  echo "   .env existente: se conserva la contraseña de la base de datos."
else
  DB_PASS="$(tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24)"
fi

export DB_NAME DB_USER DB_PASS
envsubst < "$DEPLOY_DIR/mariadb/init.sql.template" | $SUDO mariadb
echo "   Base '$DB_NAME' y usuario '$DB_USER' listos."

# ---------------------------------------------------------------- 4. Backend
echo "🐍 4/6 Backend FastAPI..."
cd "$APP_DIR/backend"
if [ ! -f ".env" ]; then
  export JWT_SECRET="$(tr -dc 'a-f0-9' </dev/urandom | head -c 64)"
  envsubst < "$DEPLOY_DIR/env/backend.env.example" > .env
  echo "   backend/.env generado (admin@fibraz.pe / admin123 — cámbialo en .env)."
fi
[ -d venv ] || python3 -m venv venv
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r requirements.txt

# ---------------------------------------------------------------- 5. Frontend
echo "⚛️  5/6 Compilando frontend React..."
cd "$APP_DIR/frontend"
printf 'REACT_APP_BACKEND_URL=\n' > .env
rm -rf build
yarn install --network-timeout 100000
yarn build
$SUDO mkdir -p "$WEB_ROOT"
$SUDO rm -rf "$WEB_ROOT"/*
$SUDO cp -r build/. "$WEB_ROOT"/
$SUDO chown -R www-data:www-data "$WEB_ROOT"
$SUDO chmod -R 755 "$WEB_ROOT"

# ---------------------------------------------------------------- 6. Supervisor + Nginx
echo "⚙️  6/6 Supervisor y Nginx..."
export APP_DIR WEB_ROOT
envsubst < "$DEPLOY_DIR/supervisor/mikrosmart_backend.conf.template" | $SUDO tee /etc/supervisor/conf.d/mikrosmart_backend.conf >/dev/null
$SUDO supervisorctl reread || true
$SUDO supervisorctl update || true
$SUDO supervisorctl restart mikrosmart_backend || true

echo "   Esperando al backend..."
for i in $(seq 1 20); do
  if curl -fs http://127.0.0.1:8001/api/health >/dev/null 2>&1; then echo "   ✅ Backend respondiendo"; break; fi
  sleep 2
  if [ "$i" -eq 20 ]; then
    echo "   ❌ El backend no responde. Últimas líneas del log:"; $SUDO tail -n 30 /var/log/mikrosmart_backend.err.log
  fi
done

$SUDO rm -f /etc/nginx/sites-enabled/default
envsubst '$WEB_ROOT' < "$DEPLOY_DIR/nginx/mikrosmart.conf.template" | $SUDO tee /etc/nginx/sites-available/mikrosmart >/dev/null
$SUDO ln -sf /etc/nginx/sites-available/mikrosmart /etc/nginx/sites-enabled/mikrosmart
$SUDO nginx -t
$SUDO systemctl restart nginx

IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
echo "========================================================="
echo "🎉 DESPLIEGUE COMPLETADO"
echo "🌐 Panel:    http://${IP:-IP_DEL_SERVIDOR}/"
echo "🔑 Acceso:   $(grep '^ADMIN_EMAIL=' "$APP_DIR/backend/.env" | cut -d= -f2 | tr -d '\"')  /  $(grep '^ADMIN_PASSWORD=' "$APP_DIR/backend/.env" | cut -d= -f2 | tr -d '\"')"
echo "🗄️  MariaDB:  base $DB_NAME, usuario $DB_USER (clave en backend/.env)"
echo "📜 Logs:     /var/log/mikrosmart_backend.err.log"
echo "========================================================="
