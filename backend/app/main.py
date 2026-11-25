import os
import sys
import json
import logging
import asyncio
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
import asyncpg
from starlette.responses import RedirectResponse

from .core.config import settings
from .core import database as db_module
from .core.database import init_db_pool, close_db_pool, get_db_connection
from .api.v1.router import api_router
from .api.v1.logs import setup_log_broadcaster
from .api.v1.admin import resolve_argus_token, get_user_permissions, ARGUS_SESSION_COOKIE
from .services.camera import camera_service as face_recognition_service
from .repositories.kiosk import KioskRepository

logger = logging.getLogger("argus.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Действия при старте
    try:
        await init_db_pool()
    except Exception as e:
        print(f"[PostgreSQL] Ошибка при старте пула БД: {e}")
    app.state.db_pool = db_module.pool

    # Инициализация сервиса распознавания лиц
    loop = asyncio.get_running_loop()
    face_recognition_service.ws_manager.set_loop(loop)
    setup_log_broadcaster(loop)

    def db_log_callback(teacher_id: int, confidence: float):
        async def _log():
            try:
                active_pool = getattr(app.state, "db_pool", None) or db_module.pool
                if active_pool:
                    async with active_pool.acquire() as conn:
                        repo = KioskRepository(conn)
                        await repo.log_recognition(teacher_id, confidence)
            except Exception as e:
                print(f"Ошибка логирования подхода: {e}")
        asyncio.run_coroutine_threadsafe(_log(), loop)

    face_recognition_service.set_log_callback(db_log_callback)

    try:
        active_pool = getattr(app.state, "db_pool", None) or db_module.pool
        if active_pool:
            # Если дисковый кэш был пуст, выполняем синхронизацию из PostgreSQL
            if len(face_recognition_service.known_face_encodings) == 0:
                await face_recognition_service.load_biometrics_from_db(active_pool)

            # 2. Загрузка параметров табло и запуск камеры
            async with active_pool.acquire() as conn:
                repo = KioskRepository(conn)
                settings_dict = await repo.get_settings()
                face_recognition_service.start(
                    camera_source=str(settings_dict.get("camera_source", "0")),
                    threshold=float(settings_dict.get("recognition_threshold", 0.48)),
                    idle_timeout=int(settings_dict.get("idle_timeout", 6)),
                    is_active=bool(settings_dict.get("is_active", True)),
                    flip_horizontal=bool(settings_dict.get("camera_flip", True)),
                )
        else:
            # Если база данных недоступна, запускаем камеру с настройками по умолчанию
            face_recognition_service.start()
    except Exception as e:
        print(f"Ошибка запуска видеоаналитики киоска: {e}")

    yield

    # Действия при остановке
    try:
        from .journal.main import cam as journal_cam
        journal_cam.stop_threads()
    except Exception:
        pass
    face_recognition_service.stop()
    await close_db_pool()


app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# Монтирование директории загруженных фото
UPLOAD_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "uploads"))
os.makedirs(os.path.join(UPLOAD_DIR, "teachers"), exist_ok=True)
os.makedirs(os.path.join(UPLOAD_DIR, "photos"), exist_ok=True)
app.mount("/api/v1/uploads", StaticFiles(directory=UPLOAD_DIR), name="api_uploads")
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")

# Настройка CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Подключение роутера API v1
app.include_router(api_router, prefix=settings.API_V1_STR)

class KafedraAccessMiddleware:
    """ASGI-прослойка контроля доступа к модулю «Личный состав» (/kafedra) по праву can_view_kafedra."""

    def __init__(self, wrapped_app) -> None:
        self.app = wrapped_app

    @staticmethod
    def _extract_cookie(scope, name: str) -> Optional[str]:
        for k, v in scope.get("headers", []):
            if k.lower() == b"cookie":
                for part in v.decode("latin1").split(";"):
                    if "=" in part:
                        ck, cv = part.strip().split("=", 1)
                        if ck == name:
                            return cv.strip()
        return None

    @staticmethod
    async def _send_forbidden(scope, receive, send, detail: str) -> None:
        resp = JSONResponse({"detail": detail}, status_code=403)
        resp.delete_cookie("kafedra_session", path="/kafedra/")
        await resp(scope, receive, send)

    async def __call__(self, scope, receive, send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if not path.startswith("/kafedra/api"):
            await self.app(scope, receive, send)
            return

        if path in ("/kafedra/api/auth/mode", "/kafedra/api/auth/logout"):
            await self.app(scope, receive, send)
            return

        argus_cookie = self._extract_cookie(scope, ARGUS_SESSION_COOKIE)
        if argus_cookie:
            argus_user = resolve_argus_token(argus_cookie)
            if argus_user and not get_user_permissions(argus_user).get("can_view_kafedra", False):
                await self._send_forbidden(
                    scope,
                    receive,
                    send,
                    f"Доступ к разделу «Личный состав» запрещен для учетной записи «{argus_user}»",
                )
                return

        if scope.get("method") == "POST" and path in ("/kafedra/api/auth/argus", "/kafedra/api/auth/login"):
            chunks = []
            more = True
            while more:
                msg = await receive()
                chunks.append(msg.get("body", b""))
                more = msg.get("more_body", False)
            raw_body = b"".join(chunks)

            try:
                payload = json.loads(raw_body.decode("utf-8")) if raw_body else {}
            except Exception:
                payload = {}

            if isinstance(payload, dict):
                if path == "/kafedra/api/auth/argus":
                    tok = str(payload.get("token", "")).strip()
                    u = resolve_argus_token(tok)
                    if u and not get_user_permissions(u).get("can_view_kafedra", False):
                        await self._send_forbidden(
                            scope,
                            receive,
                            send,
                            f"Доступ к разделу «Личный состав» запрещен для учетной записи «{u}»",
                        )
                        return
                elif path == "/kafedra/api/auth/login":
                    login_name = str(payload.get("login", "")).strip()
                    if login_name and not get_user_permissions(login_name).get("can_view_kafedra", False):
                        await self._send_forbidden(
                            scope,
                            receive,
                            send,
                            f"Доступ к разделу «Личный состав» запрещен для учетной записи «{login_name}»",
                        )
                        return

            sent = False

            async def replay_receive():
                nonlocal sent
                if not sent:
                    sent = True
                    return {"type": "http.request", "body": raw_body, "more_body": False}
                return await receive()

            await self.app(scope, replay_receive, send)
            return

        await self.app(scope, receive, send)


# Приложение 12 кафедры (папка kafedra/): адрес /kafedra, вход по кнопке в меню пользователя
kafedra_backend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "kafedra", "backend"))
if os.path.exists(kafedra_backend_path) and kafedra_backend_path not in sys.path:
    sys.path.insert(0, kafedra_backend_path)

try:
    from kafedra.integration.argus import attach as attach_kafedra  # noqa: E402
    attach_kafedra(app)
    app.add_middleware(KafedraAccessMiddleware)
except Exception as e:
    logger.warning(f"Модуль кафедры не подключен: {e}")

# Электронный журнал посещаемости (VisionAttend): адрес /journal
try:
    from .journal import journal_app
    app.mount("/journal", journal_app)
except Exception as e:
    logger.warning(f"Модуль электронного журнала не подключен: {e}")


# Монтирование статики React для офлайн Docker-образа
STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static_dist")


@app.get("/", include_in_schema=False)
async def root():
    """Перенаправление с корня на React-приложение (в Docker) или Swagger /docs (в разработке)."""
    if os.path.exists(STATIC_DIR) and os.path.isfile(os.path.join(STATIC_DIR, "index.html")):
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
    return RedirectResponse(url="/docs")


@app.get(f"{settings.API_V1_STR}/health", tags=["Системные"])
async def health_check(conn: asyncpg.Connection = Depends(get_db_connection)):
    """Проверка доступности API и подключения к базе данных."""
    db_version = await conn.fetchval("SELECT version();")
    return {
        "status": "ok",
        "database": "connected",
        "postgres_version": db_version,
    }


if os.path.exists(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_react_app(full_path: str):
        file_path = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
