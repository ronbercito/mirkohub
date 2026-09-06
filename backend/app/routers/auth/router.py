"""
Archivo: backend/app/routers/auth/router.py
Función: Rutas de autenticación: POST /api/auth/login (email + contraseña => JWT en
         cookie httpOnly y en la respuesta), GET /api/auth/me (usuario actual),
         POST /api/auth/logout, y gestión de usuarios del panel (solo admin).
Trabaja con: backend/app/core/security.py, backend/app/models/user.py,
             frontend/src/context/AuthContext.js, frontend/src/modules/auth/Login.jsx
"""
from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import create_access_token, get_current_user, hash_password, require_role, verify_password
from app.core.utils import get_or_404
from app.models.user import User
from app.routers.auth.schemas import LoginRequest, UserCreate

router = APIRouter(prefix="/auth", tags=["Autenticación"])


@router.post("/login")
async def login(req: LoginRequest, response: Response, db: AsyncSession = Depends(get_db)):
    email = req.email.strip().lower()
    user = (await db.execute(select(User).where(User.email == email))).scalar_one_or_none()
    if not user or not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenciales incorrectas")
    token = create_access_token(user.id, user.email, user.role)
    response.set_cookie("access_token", token, httponly=True, secure=False, samesite="lax", max_age=86400, path="/")
    return {"token": token, "user": user.to_dict(exclude=("password_hash",)), "message": f"Bienvenido {user.name}"}


@router.get("/me")
async def me(current_user: dict = Depends(get_current_user)):
    return {"user": current_user}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie("access_token", path="/")
    return {"message": "Sesión cerrada correctamente"}


@router.get("/users", dependencies=[Depends(require_role("admin"))])
async def list_users(db: AsyncSession = Depends(get_db)):
    users = (await db.execute(select(User).order_by(User.created_at))).scalars().all()
    return [u.to_dict(exclude=("password_hash",)) for u in users]


@router.post("/users", dependencies=[Depends(require_role("admin"))])
async def create_user(data: UserCreate, db: AsyncSession = Depends(get_db)):
    email = data.email.strip().lower()
    if (await db.execute(select(User).where(User.email == email))).scalar_one_or_none():
        raise HTTPException(status_code=400, detail="El correo ya está registrado")
    user = User(email=email, password_hash=hash_password(data.password), name=data.name, role=data.role, phone=data.phone)
    db.add(user)
    await db.commit()
    return user.to_dict(exclude=("password_hash",))


@router.delete("/users/{user_id}", dependencies=[Depends(require_role("admin"))])
async def delete_user(user_id: str, current_user: dict = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    if user_id == current_user["id"]:
        raise HTTPException(status_code=400, detail="No puede eliminar su propio usuario")
    user = await get_or_404(db, User, user_id, "Usuario")
    await db.delete(user)
    await db.commit()
    return {"message": "Usuario eliminado"}
