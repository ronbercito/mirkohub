#!/bin/bash
# ==============================================================================
# Archivo: setup_debian.sh (raíz del proyecto)
# Función: Actualiza el checkout desde origin/main y ejecuta el instalador real.
#          Esto evita que `git pull` se detenga cuando las ramas han divergido.
#          Los archivos locales no versionados (por ejemplo backend/.env) se conservan.
# Trabaja con: deploy/setup_debian.sh
# ==============================================================================
set -e

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Si estamos dentro de un checkout Git, sincronizar primero con GitHub.
# Se usa reset --hard sobre los archivos VERSIONADOS para que el servidor quede
# exactamente en origin/main. Los archivos no versionados, como backend/.env,
# no se eliminan.
if git -C "$ROOT_DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "🔄 Sincronizando MikroHub con GitHub (origin/main)..."
  git -C "$ROOT_DIR" fetch origin main
  git -C "$ROOT_DIR" checkout main 2>/dev/null || true
  git -C "$ROOT_DIR" reset --hard origin/main
  echo "✅ Código actualizado desde origin/main"
else
  echo "⚠️  No se detectó un checkout Git; se ejecutará el instalador local."
fi

exec bash "$ROOT_DIR/deploy/setup_debian.sh" "$@"
