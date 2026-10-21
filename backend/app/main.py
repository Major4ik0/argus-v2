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
from .core.database import init_db_pool, close_db_pool, get_db_connection, pool
from .api.v1.router import api_router
from .services.camera import camera_service as face_recognition_service
from .repositories.kiosk import KioskRepository


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Действия при старте
    await init_db_pool()

    # Инициализация сервиса распознавания лиц
    loop = asyncio.get_running_loop()
    face_recognition_service.ws_manager.set_loop(loop)

    def db_log_callback(teacher_id: int, confidence: float):
        async def _log():
            try:
                if pool:
                    async with pool.acquire() as conn:
                        repo = KioskRepository(conn)
                        await repo.log_recognition(teacher_id, confidence)
            except Exception as e:
                print(f"Ошибка логирования подхода: {e}")
        asyncio.run_coroutine_threadsafe(_log(), loop)

    face_recognition_service.set_log_callback(db_log_callback)

    try:
        if pool:
            async with pool.acquire() as conn:
                repo = KioskRepository(conn)
                settings_dict = await repo.get_settings()
                embs = await repo.get_all_embeddings()
                face_recognition_service.reload_embeddings(embs)
                face_recognition_service.start(
                    camera_source=str(settings_dict.get("camera_source", "0")),
                    threshold=float(settings_dict.get("recognition_threshold", 0.48)),
                    idle_timeout=int(settings_dict.get("idle_timeout", 20)),
                    is_active=bool(settings_dict.get("is_active", True)),
                )
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
UPLOADS_DIR = os.path.join(os.path.dirname(__file__), "..", "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=UPLOADS_DIR), name="uploads")

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


# Монтирование статики React для оффлайн Docker-образа
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
