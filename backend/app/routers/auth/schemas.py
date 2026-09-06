"""
Archivo: backend/app/routers/auth/schemas.py
Función: Esquemas Pydantic (validación de entrada) del módulo de autenticación:
         datos de login y creación de usuarios del panel.
Trabaja con: backend/app/routers/auth/router.py
"""
from pydantic import BaseModel


class LoginRequest(BaseModel):
    email: str
    password: str


class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    role: str = "tecnico"  # admin | tecnico | cobrador
    phone: str = ""
