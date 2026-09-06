#!/bin/bash
# Archivo: setup_debian.sh (raíz del proyecto)
# Función: Acceso directo al instalador real ubicado en deploy/setup_debian.sh, para poder
#          ejecutar `bash setup_debian.sh` desde la raíz del proyecto.
# Trabaja con: deploy/setup_debian.sh
exec bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy/setup_debian.sh" "$@"
