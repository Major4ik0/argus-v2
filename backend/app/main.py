import os
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import asyncpg
from starlette.responses import RedirectResponse

from .core.config import settings
from .core import database as db_module
from .core.database import init_db_pool, close_db_pool, get_db_connection
from .api.v1.router import api_router
from .api.v1.logs import setup_log_broadcaster
from .services.camera import camera_service as face_recognition_service
from .repositories.kiosk import KioskRepository


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
