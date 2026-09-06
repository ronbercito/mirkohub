"""
Archivo: backend/app/core/config.py
Función: Carga las variables de entorno (.env) y expone la configuración global
         del sistema: conexión a la base de datos MariaDB, secreto JWT, CORS,
         credenciales del administrador inicial y parámetros por defecto de MikroTik.
Trabaja con: backend/.env, backend/app/core/database.py, backend/app/core/security.py,
             backend/server.py
"""
from dotenv import load_dotenv

load_dotenv()

import os

DATABASE_URL = os.environ["DATABASE_URL"]
JWT_SECRET = os.environ["JWT_SECRET"]
JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.environ.get("ACCESS_TOKEN_EXPIRE_MINUTES", "1440"))

ADMIN_EMAIL = os.environ["ADMIN_EMAIL"]
ADMIN_PASSWORD = os.environ["ADMIN_PASSWORD"]

CORS_ORIGINS = [o.strip() for o in os.environ.get("CORS_ORIGINS", "*").split(",") if o.strip()]

MIKROTIK_TIMEOUT = float(os.environ.get("MIKROTIK_TIMEOUT", "6"))
MIKROTIK_CUT_LIST = os.environ.get("MIKROTIK_CUT_LIST", "morosos")
