import asyncpg
from typing import AsyncGenerator, Optional
from .config import settings

pool: Optional[asyncpg.Pool] = None


async def init_db_pool() -> None:
    """Инициализация пула подключений к PostgreSQL."""
    global pool
    pool = await asyncpg.create_pool(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        database=settings.DB_NAME,
        min_size=2,
        max_size=10,
    )


async def close_db_pool() -> None:
    """Закрытие пула при остановке сервера."""
    global pool
    if pool:
        await pool.close()


async def get_db_connection() -> AsyncGenerator[asyncpg.Connection, None]:
    """Dependency для эндпоинтов FastAPI: выдает соединение из пула."""
    if pool is None:
        raise RuntimeError("Пул подключений к базе данных не инициализирован.")

    async with pool.acquire() as connection:
        yield connection