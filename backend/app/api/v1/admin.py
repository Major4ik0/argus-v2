# backend/app/api/v1/admin.py
# -*- coding: utf-8 -*-
import os
import sys
import json
import asyncio
import secrets
import platform
from typing import List, Dict, Any, Optional
from datetime import datetime
import cv2
import asyncpg
from fastapi import APIRouter, HTTPException, Depends, status, Request
from pydantic import BaseModel

from ...services.ad_auth import authenticate_ad
from ...core.config import settings, DB_CONFIG_PATH, write_db_config_file, write_security_config_file
from ...core.database import get_db_connection, restart_db_pool
from ...services.camera import camera_service as face_recognition_service
from ...services.settings_service import settings_service, UnifiedConfigSchema
from ...repositories.kiosk import KioskRepository
from .logs import router as logs_router

router = APIRouter()
router.include_router(logs_router)

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "data")
ADMINS_FILE = os.path.join(DATA_DIR, "admins.json")
SETTINGS_FILE = os.path.join(DATA_DIR, "site_settings.json")
os.makedirs(DATA_DIR, exist_ok=True)

SUPERADMINS = {
    "24-zhuravlev.a.d",
    getattr(settings, "initial_admin", "admin").lower(),
    "admin",
}


class AdminPermissions(BaseModel):
    can_view_admin: bool = True
    can_edit_schedule: bool = True
    can_manage_kiosk: bool = True
    can_manage_theming: bool = True


def _load_admins() -> list:
    if os.path.exists(ADMINS_FILE):
        try:
            with open(ADMINS_FILE, "r", encoding="utf-8") as f:
                admins = json.load(f)
        except Exception:
            admins = []
    else:
        admins = []

    for a in admins:
        if "permissions" not in a:
            a["permissions"] = {
                "can_view_admin": True,
                "can_edit_schedule": True,
                "can_manage_kiosk": True,
                "can_manage_theming": True,
            }
        else:
            for k in ["can_view_admin", "can_edit_schedule", "can_manage_kiosk", "can_manage_theming"]:
                if k not in a["permissions"]:
                    a["permissions"][k] = True
    return admins


def _save_admins(admins: list):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(ADMINS_FILE, "w", encoding="utf-8") as f:
        json.dump(admins, f, ensure_ascii=False, indent=2)


def _load_site_settings() -> dict:
    defaults = {
        "site_theme": "light",
        "kiosk_theme": "light",
    }
    if os.path.exists(SETTINGS_FILE):
        try:
            with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                defaults.update(data)
        except Exception:
            pass
    return defaults


def _save_site_settings(data: dict):
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def is_user_admin(username: str) -> bool:
    u = username.strip().lower()
    if u in SUPERADMINS:
        return True
    admins = _load_admins()
    return any(a.get("username", "").lower() == u for a in admins)


def is_superadmin(username: str) -> bool:
    return username.strip().lower() in SUPERADMINS


def get_user_permissions(username: str) -> Dict[str, bool]:
    u = username.strip().lower()
    if is_superadmin(u):
        return {
            "can_view_admin": True,
            "can_edit_schedule": True,
            "can_manage_kiosk": True,
            "can_manage_theming": True,
        }
    admins = _load_admins()
    for a in admins:
        if a.get("username", "").lower() == u:
            perms = a.get("permissions", {})
            return {
                "can_view_admin": bool(perms.get("can_view_admin", True)),
                "can_edit_schedule": bool(perms.get("can_edit_schedule", True)),
                "can_manage_kiosk": bool(perms.get("can_manage_kiosk", True)),
                "can_manage_theming": bool(perms.get("can_manage_theming", True)),
            }
    return {
        "can_view_admin": False,
        "can_edit_schedule": False,
        "can_manage_kiosk": False,
        "can_manage_theming": False,
    }


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
    permissions: AdminPermissions


class AdminUserItem(BaseModel):
    username: str
    added_by: str
    created_at: str
    is_superadmin: bool = False
    permissions: AdminPermissions


class AddAdminRequest(BaseModel):
    username: str
    current_user: str
    permissions: Optional[AdminPermissions] = None


class UpdatePermissionsRequest(BaseModel):
    current_user: str
    permissions: AdminPermissions


class SiteSettingsResponse(BaseModel):
    site_theme: str = "light"
    kiosk_theme: str = "light"


class UpdateSiteSettingsRequest(BaseModel):
    site_theme: Optional[str] = None
    kiosk_theme: Optional[str] = None


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
    perms_dict = get_user_permissions(username)

    token = secrets.token_hex(32)

    return LoginResponse(
        success=True,
        is_admin=user_is_admin,
        is_superadmin=user_is_super,
        username=username,
        token=token,
        message="Авторизация успешна",
        permissions=AdminPermissions(**perms_dict)
    )


@router.get("/users", response_model=List[AdminUserItem], summary="Список администраторов с правами")
async def list_admins():
    raw = _load_admins()
    result = []
    # Добавляем суперпользователя в список для видимости
    for sa in sorted(list(SUPERADMINS)):
        if not any(a["username"].lower() == sa.lower() for a in raw):
            result.append(AdminUserItem(
                username=sa,
                added_by="Система",
                created_at="Бессрочно",
                is_superadmin=True,
                permissions=AdminPermissions(
                    can_view_admin=True,
                    can_edit_schedule=True,
                    can_manage_kiosk=True,
                    can_manage_theming=True
                )
            ))

    for a in raw:
        perms = a.get("permissions", {})
        result.append(AdminUserItem(
            username=a["username"],
            added_by=a.get("added_by", "admin"),
            created_at=a.get("created_at", ""),
            is_superadmin=is_superadmin(a["username"]),
            permissions=AdminPermissions(
                can_view_admin=bool(perms.get("can_view_admin", True)),
                can_edit_schedule=bool(perms.get("can_edit_schedule", True)),
                can_manage_kiosk=bool(perms.get("can_manage_kiosk", True)),
                can_manage_theming=bool(perms.get("can_manage_theming", True))
            )
        ))
    return result


@router.post("/users/add", summary="Назначение администратора с выбором прав")
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
    perms_dict = payload.permissions.dict() if payload.permissions else {
        "can_view_admin": True,
        "can_edit_schedule": True,
        "can_manage_kiosk": True,
        "can_manage_theming": True,
    }

    found = False
    for a in admins:
        if a["username"].lower() == target_user:
            a["permissions"] = perms_dict
            found = True
            break

    if not found:
        admins.append({
            "username": target_user,
            "added_by": payload.current_user,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "permissions": perms_dict
        })

    _save_admins(admins)
    return {"success": True, "message": f"Пользователь {target_user} успешно обновлен"}


@router.put("/users/{username}/permissions", summary="Изменение прав пользователя")
async def update_permissions(username: str, payload: UpdatePermissionsRequest):
    if not is_superadmin(payload.current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только главный администратор может изменять права"
        )

    u = username.strip().lower()
    if is_superadmin(u):
        raise HTTPException(status_code=400, detail="Права главного администратора не подлежат ограничению")

    admins = _load_admins()
    updated = False
    for a in admins:
        if a["username"].lower() == u:
            a["permissions"] = payload.permissions.dict()
            updated = True
            break

    if not updated:
        admins.append({
            "username": u,
            "added_by": payload.current_user,
            "created_at": datetime.now().strftime("%Y-%m-%d %H:%M"),
            "permissions": payload.permissions.dict()
        })

    _save_admins(admins)
    return {"success": True, "message": f"Права пользователя {u} обновлены"}


@router.delete("/users/{username}", summary="Отзыв прав администратора")
async def remove_admin(username: str, current_user: str):
    if not is_superadmin(current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Недостаточно прав для выполнения операции"
        )

    u = username.strip().lower()
    if is_superadmin(u):
        raise HTTPException(status_code=400, detail="Невозможно удалить главного администратора")

    admins = _load_admins()
    new_admins = [a for a in admins if a["username"].lower() != u]
    _save_admins(new_admins)

    return {"success": True, "message": f"Права пользователя {username} отозваны"}


@router.get("/settings", response_model=SiteSettingsResponse, summary="Текущие настройки тем оформления сайта и табло")
async def get_site_settings():
    return _load_site_settings()


@router.post("/settings", response_model=SiteSettingsResponse, summary="Сохранение настроек тем оформления сайта и табло")
async def update_site_settings(payload: UpdateSiteSettingsRequest):
    current = _load_site_settings()
    if payload.site_theme in ("light", "dark"):
        current["site_theme"] = payload.site_theme
    if payload.kiosk_theme in ("light", "dark"):
        current["kiosk_theme"] = payload.kiosk_theme
    _save_site_settings(current)

    # Оповещаем все открытые экраны табло через WebSocket об изменении темы
    try:
        face_recognition_service.ws_manager.broadcast_from_thread({
            "event": "THEME_CHANGED",
            "kiosk_theme": current["kiosk_theme"],
            "site_theme": current["site_theme"],
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })
    except Exception:
        pass

    return current


# =====================================================================
# ЕДИНАЯ КОНФИГУРАЦИЯ ТЕРМИНАЛА И ТАБЛО (public.kiosk_settings)
# =====================================================================

@router.get("/config", summary="Получить полную конфигурацию терминала")
async def get_admin_config(conn: Optional[asyncpg.Connection] = Depends(get_db_connection)):
    """
    Отдает полный объект конфигурации из public.kiosk_settings.
    При недоступности БД возвращает дефолтные параметры без ошибки 500.
    """
    return await settings_service.get_config(conn=conn)


@router.put("/config", summary="Обновить конфигурацию терминала")
async def update_admin_config(
    payload: Dict[str, Any],
    conn: Optional[asyncpg.Connection] = Depends(get_db_connection),
):
    """
    Обновляет параметры конфигурации в PostgreSQL и рассылает WebSocket-сообщение
    SETTINGS_UPDATED на все подключенные экраны /display.
    """
    return await settings_service.update_config(payload, conn=conn)


@router.post("/kiosk/reload", summary="Перезагрузка всех подключенных экранов табло")
async def reload_kiosk_screens():
    """
    Отправляет в WebSocket событие RELOAD_PAGE, при получении которого
    клиенты /display выполняют window.location.reload().
    """
    await face_recognition_service.ws_manager.broadcast({"event": "RELOAD_PAGE"})
    return {
        "success": True,
        "message": "Команда перезагрузки отправлена на экраны табло",
        "screens_notified": len(face_recognition_service.ws_manager.active_connections),
    }


class SecurityConfigPayload(BaseModel):
    ad_server: str
    ad_domain: str
    initial_admin: str = "admin"
    dev_mode: bool = True
    dev_password: Optional[str] = None


@router.get("/security/config", summary="Параметры безопасности и доменной авторизации")
async def get_security_config():
    return {
        "ad_server": settings.ad_server,
        "ad_domain": settings.ad_domain,
        "initial_admin": settings.initial_admin,
        "dev_mode": settings.dev_mode,
        "dev_password": settings.dev_password,
    }


@router.post("/security/config", summary="Сохранение параметров безопасности и доменной авторизации")
async def save_security_config(payload: SecurityConfigPayload):
    data = {
        "ad_server": payload.ad_server.strip(),
        "ad_domain": payload.ad_domain.strip(),
        "initial_admin": payload.initial_admin.strip(),
        "dev_mode": payload.dev_mode,
        "dev_password": payload.dev_password or settings.dev_password,
    }
    write_security_config_file(data)
    settings.apply_custom_security_config()
    return {"success": True, "message": "Параметры безопасности сохранены"}


@router.get("/monitoring", summary="Сводный мониторинг работы сайта, БД и камеры")
async def get_system_monitoring(conn: asyncpg.Connection = Depends(get_db_connection)):
    """
    Возвращает статус работоспособности всех узлов:
    - База данных PostgreSQL (количество занятий, преподавателей, звонков)
    - Видеосервис и распознавание лиц (статус камеры, модель, эталоны, порог)
    - Статистика терминала (посещения за сегодня, неделю, всего)
    - Последние логи фиксаций в реальном времени
    - Сведения об операционной системе и окружении
    """
    repo = KioskRepository(conn)
    kiosk_stats = await repo.get_stats()

    # База данных
    lessons_count = await conn.fetchval("SELECT count(*) FROM public.nnz_schedule;")
    teachers_count = await conn.fetchval("SELECT count(DISTINCT mid) FROM public.cathedra_personnel WHERE id_pmk IN (1, 2);")
    enrolled_count = await conn.fetchval("SELECT count(*) FROM public.teacher_biometrics WHERE embedding IS NOT NULL;")

    # Камера и AI
    vision_status = {
        "is_active": face_recognition_service.is_active,
        "is_running": face_recognition_service._running,
        "camera_source": face_recognition_service.camera_source,
        "recognition_threshold": face_recognition_service.recognition_threshold,
        "detector_model": getattr(face_recognition_service, "detector_model_name", "InsightFace SCRFD (det_10g.onnx)"),
        "recognizer_model": getattr(face_recognition_service, "recognizer_model_name", "InsightFace ArcFace (w600k_r50.onnx)"),
        "enrolled_teachers_count": len(face_recognition_service.known_teachers),
        "active_teacher_id": face_recognition_service._active_teacher_id,
        "ws_active_clients": len(face_recognition_service.ws_manager.active_connections),
    }

    # Последние подходы
    recent_logs = await conn.fetch("""
        SELECT 
            kl.id,
            kl.teacher_id,
            TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
            ad.shortname AS academic_degree,
            kl.confidence,
            kl.recognized_at
        FROM public.kiosk_recognition_logs kl
        JOIN public.people p ON kl.teacher_id = p.mid
        LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
        ORDER BY kl.recognized_at DESC
        LIMIT 10;
    """)

    logs_list = []
    for r in recent_logs:
        logs_list.append({
            "id": r["id"],
            "teacher_id": r["teacher_id"],
            "teacher_name": r["full_name"],
            "academic_degree": r["academic_degree"],
            "confidence": round(float(r["confidence"] or 0.0), 3),
            "recognized_at": r["recognized_at"].strftime("%d.%m.%Y %H:%M:%S") if r["recognized_at"] else "",
        })

    return {
        "status": "healthy",
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "database": {
            "status": "connected",
            "total_lessons": lessons_count or 0,
            "total_department_teachers": teachers_count or 0,
            "teachers_with_biometrics": enrolled_count or 0,
        },
        "vision": vision_status,
        "kiosk_stats": kiosk_stats,
        "recent_logs": logs_list,
        "system": {
            "os": f"{platform.system()} {platform.release()}",
            "python": sys.version.split()[0],
            "opencv": getattr(cv2, "__version__", "unknown"),
        },
    }


# =====================================================================
# НАСТРОЙКИ ПОДКЛЮЧЕНИЯ К POSTGRESQL И УПРАВЛЕНИЕ ПУЛОМ
# =====================================================================

class DatabaseConfigResponse(BaseModel):
    host: str
    port: int
    db_name: str
    user: str
    password: str = "••••••••"
    is_custom: bool = False


class DatabaseConfigPayload(BaseModel):
    host: str
    port: int = 5432
    db_name: str
    user: str
    password: Optional[str] = None


@router.get("/database/config", response_model=DatabaseConfigResponse)
async def get_database_config():
    """Текущие параметры подключения к PostgreSQL."""
    is_custom = DB_CONFIG_PATH.exists()
    return DatabaseConfigResponse(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        db_name=settings.DB_NAME,
        user=settings.DB_USER,
        password="••••••••",
        is_custom=is_custom,
    )


@router.post("/database/test")
async def test_database_connection(payload: DatabaseConfigPayload):
    """Тестовое подключение к PostgreSQL с переданными реквизитами."""
    actual_password = payload.password
    if not actual_password or actual_password == "••••••••":
        actual_password = settings.DB_PASSWORD

    try:
        conn = await asyncio.wait_for(
            asyncpg.connect(
                host=payload.host.strip(),
                port=int(payload.port),
                user=payload.user.strip(),
                password=str(actual_password),
                database=payload.db_name.strip(),
                timeout=3.0,
            ),
            timeout=3.5,
        )
        await conn.fetchval("SELECT 1")
        await conn.close()
        return {
            "success": True,
            "message": "Соединение с базой данных успешно установлено",
        }
    except asyncio.TimeoutError:
        return {
            "success": False,
            "detail": "Превышено время ожидания ответа от сервера БД (таймаут 3 сек)",
        }
    except Exception as e:
        err_msg = str(e).strip() or type(e).__name__
        return {
            "success": False,
            "detail": f"Ошибка подключения к БД: {err_msg}",
        }


@router.post("/database/save")
async def save_database_config(payload: DatabaseConfigPayload, request: Request):
    """Сохранение конфигурации БД, перезапуск пула и автозагрузка биометрии."""
    if not payload.host or not payload.db_name or not payload.user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Поля 'Хост', 'Имя базы данных' и 'Пользователь' обязательны для заполнения",
        )

    actual_password = payload.password
    if not actual_password or actual_password == "••••••••":
        actual_password = settings.DB_PASSWORD

    # 1. Проверяем соединение перед сохранением
    try:
        conn = await asyncio.wait_for(
            asyncpg.connect(
                host=payload.host.strip(),
                port=int(payload.port),
                user=payload.user.strip(),
                password=str(actual_password),
                database=payload.db_name.strip(),
                timeout=3.0,
            ),
            timeout=3.5,
        )
        await conn.fetchval("SELECT 1")
        await conn.close()
    except asyncio.TimeoutError:
        return {
            "success": False,
            "detail": "Не удалось подключиться: превышено время ожидания ответа сервера (таймаут 3 сек)",
        }
    except Exception as e:
        err_msg = str(e).strip() or type(e).__name__
        return {
            "success": False,
            "detail": f"Не удалось подключиться с указанными параметрами: {err_msg}",
        }

    # 2. Сохраняем в backend/data/db_config.json
    config_dict = {
        "host": payload.host.strip(),
        "port": int(payload.port),
        "db_name": payload.db_name.strip(),
        "user": payload.user.strip(),
        "password": str(actual_password),
    }
    write_db_config_file(config_dict)

    # 3. Обновляем settings в памяти
    settings.DB_HOST = config_dict["host"]
    settings.DB_PORT = config_dict["port"]
    settings.DB_NAME = config_dict["db_name"]
    settings.DB_USER = config_dict["user"]
    settings.DB_PASSWORD = config_dict["password"]

    # 4. Горячая перезагрузка пула соединений
    try:
        new_pool = await restart_db_pool()
        request.app.state.db_pool = new_pool
    except Exception as e:
        return {
            "success": False,
            "detail": f"Конфигурация сохранена, но возникла ошибка при перезапуске пула: {str(e)}",
        }

    # 5. Автозагрузка биометрии из новой базы данных
    try:
        await face_recognition_service.load_biometrics_from_db(new_pool)
    except Exception as e:
        print(f"Предупреждение: ошибка перезагрузки биометрии после смены БД: {e}")

    return {
        "success": True,
        "message": "Настройки сохранены. Пул соединений обновлен.",
    }
