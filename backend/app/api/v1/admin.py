# backend/app/api/v1/admin.py
# -*- coding: utf-8 -*-
import os
import json
import secrets
from typing import List
from datetime import datetime
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel

from ...services.ad_auth import authenticate_ad
from ...core.config import settings

router = APIRouter()

ADMINS_FILE = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data", "admins.json")

SUPERADMINS = {
    "24-zhuravlev.a.d",
    getattr(settings, "initial_admin", "admin").lower(),
    "admin",
}


def _load_admins() -> list:
    if os.path.exists(ADMINS_FILE):
        try:
            with open(ADMINS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return []
    return []


def _save_admins(admins: list):
    os.makedirs(os.path.dirname(ADMINS_FILE), exist_ok=True)
    with open(ADMINS_FILE, "w", encoding="utf-8") as f:
        json.dump(admins, f, ensure_ascii=False, indent=2)


def is_user_admin(username: str) -> bool:
    u = username.strip().lower()
    if u in SUPERADMINS:
        return True
    admins = _load_admins()
    return any(a.get("username", "").lower() == u for a in admins)


def is_superadmin(username: str) -> bool:
    return username.strip().lower() in SUPERADMINS


class LoginRequest(BaseModel):
    login: str
    password: str


class LoginResponse(BaseModel):
    success: bool
    is_admin: bool
    is_superadmin: bool
    username: str
    token: str
    message: str


class AdminUserItem(BaseModel):
    username: str
    added_by: str
    created_at: str


class AddAdminRequest(BaseModel):
    username: str
    current_user: str


@router.post("/login", response_model=LoginResponse, summary="Авторизация через доменную сеть")
async def login(payload: LoginRequest):
    username = payload.login.strip()
    password = payload.password.strip()

    if not username or not password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Введите логин и пароль"
        )

    # 1. Проверка пароля в Active Directory / OpenLDAP
    is_authenticated = await authenticate_ad(username, password)
    if not is_authenticated:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный логин или пароль доменной сети"
        )

    # 2. Определение прав
    user_is_admin = is_user_admin(username)
    user_is_super = is_superadmin(username)

    token = secrets.token_hex(32)

    return LoginResponse(
        success=True,
        is_admin=user_is_admin,
        is_superadmin=user_is_super,
        username=username,
        token=token,
        message="Авторизация успешна"
    )


@router.get("/users", response_model=List[AdminUserItem], summary="Список администраторов")
async def list_admins():
    return _load_admins()


@router.post("/users/add", summary="Назначение администратора")
async def add_admin(payload: AddAdminRequest):
    if not is_superadmin(payload.current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только главный администратор может назначать пользователей"
        )

    target_user = payload.username.strip().lower()
    if not target_user:
        raise HTTPException(status_code=400, detail="Укажите логин")

    admins = _load_admins()
    if not any(a["username"].lower() == target_user for a in admins):
        admins.append({
            "username": target_user,
            "added_by": payload.current_user,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M")
        })
        _save_admins(admins)

    return {"success": True, "message": f"Пользователь {target_user} добавлен"}


@router.delete("/users/{username}", summary="Отзыв прав администратора")
async def remove_admin(username: str, current_user: str):
    if not is_superadmin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для выполнения операции"
        )

    u = username.strip().lower()
    if u in SUPERADMINS:
        raise HTTPException(status_code=400, detail="Невозможно удалить главного администратора")

    admins = _load_admins()
    new_admins = [a for a in admins if a["username"].lower() != u]
    _save_admins(new_admins)

    return {"success": True, "message": f"Права пользователя {username} отозваны"}