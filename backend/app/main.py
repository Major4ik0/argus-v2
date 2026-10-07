import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import asyncpg
from starlette.responses import RedirectResponse

from .core.config import settings
from .core.database import init_db_pool, close_db_pool, get_db_connection
from .api.v1.router import api_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Действия при старте
    await init_db_pool()
    yield
    # Действия при остановке
    await close_db_pool()


app = FastAPI(
    title=settings.PROJECT_NAME,
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

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


@app.get("/", include_in_schema=False)
async def root():
    """Перенаправление с корня на документацию Swagger в режиме разработки."""
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


# Монтирование статики React для оффлайн Docker-образа
STATIC_DIR = os.path.join(os.path.dirname(__file__), "..", "static_dist")

if os.path.exists(STATIC_DIR):
    app.mount("/assets", StaticFiles(directory=os.path.join(STATIC_DIR, "assets")), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    async def serve_react_app(full_path: str):
        file_path = os.path.join(STATIC_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(STATIC_DIR, "index.html"))
