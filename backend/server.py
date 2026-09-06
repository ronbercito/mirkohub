"""
Archivo: backend/server.py
Función: Punto de entrada del backend FastAPI (uvicorn server:app). Configura CORS,
         monta todas las rutas de los módulos bajo /api, crea las tablas en MariaDB y
         siembra el administrador inicial al arrancar.
Trabaja con: backend/app/core/config.py, database.py, seed.py,
             backend/app/routers/<modulo>/router.py (auth, inicio, clientes, planes, red,
             facturacion, tickets, almacen, hotspot, tareas, mensajeria, ajustes)

Regla de rutas OLT:
- Las rutas específicas de submódulos OLT deben montarse ANTES del router genérico
  de Red, porque Red contiene /routers/{router_id}/olt/{action}. FastAPI resuelve
  rutas por orden; si el genérico va primero, una ruta como /olt/onus-v2 queda
  capturada como action y nunca llega a su archivo independiente.
"""
from app.core.config import CORS_ORIGINS  # carga .env primero

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI
from starlette.middleware.cors import CORSMiddleware

from app.core.database import init_db
from app.core import database
from app.core.seed import seed_initial_data
from app.routers.ajustes.router import router as ajustes_router
from app.routers.almacen.router import router as almacen_router
from app.routers.auth.router import router as auth_router
from app.routers.clientes.router import router as clientes_router
from app.routers.facturacion.router import router as facturacion_router
from app.routers.hotspot.router import router as hotspot_router
from app.routers.inicio.router import router as inicio_router
from app.routers.mensajeria.router import router as mensajeria_router
from app.routers.planes.router import router as planes_router
from app.routers.red.router import router as red_router
from app.routers.red.olt_onu_summary import router as olt_onu_summary_router
from app.routers.red.olt_onu_inventory import router as olt_onu_inventory_router
from app.routers.red.olt_onu_v2 import router as olt_onu_v2_router
from app.routers.tareas.router import router as tareas_router
from app.routers.tickets.router import router as tickets_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")


@asynccontextmanager
async def lifespan(_: FastAPI):
    await init_db()
    await seed_initial_data()
    yield
    await database.engine.dispose()


app = FastAPI(title="FibraZ / MikroSmart ISP API", version="3.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials="*" not in CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")

# IMPORTANTE: estas rutas específicas deben ir antes de red_router.
api.include_router(olt_onu_v2_router, prefix="/routers", tags=["Red / OLT / ONUs v2"])
api.include_router(olt_onu_summary_router, prefix="/routers", tags=["Red / OLT / ONUs"])
api.include_router(olt_onu_inventory_router, prefix="/routers", tags=["Red / OLT / ONUs"])

for r in (auth_router, inicio_router, clientes_router, planes_router, red_router, facturacion_router,
          tickets_router, almacen_router, hotspot_router, tareas_router, mensajeria_router, ajustes_router):
    api.include_router(r)


@api.get("/health")
async def health():
    return {"status": "ok"}


app.include_router(api)
