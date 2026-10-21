import asyncpg
from typing import AsyncGenerator, Optional
from .config import settings

pool: Optional[asyncpg.Pool] = None


async def init_kiosk_tables() -> None:
    """Создание таблиц для умного табло и биометрии, если они не существуют."""
    global pool
    if not pool:
        return
    sql = """
    CREATE TABLE IF NOT EXISTS public.teacher_biometrics (
        teacher_id INTEGER PRIMARY KEY REFERENCES public.people(mid) ON DELETE CASCADE,
        photo_path VARCHAR(255),
        embedding BYTEA NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    ALTER TABLE public.teacher_biometrics ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;

    CREATE TABLE IF NOT EXISTS public.kiosk_recognition_logs (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES public.people(mid) ON DELETE CASCADE,
        confidence REAL NOT NULL,
        recognized_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS public.kiosk_settings (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL
    );

    INSERT INTO public.kiosk_settings (key, value)
    VALUES 
        ('camera_source', '0'),
        ('recognition_threshold', '0.48'),
        ('similarity_threshold', '0.48'),
        ('carousel_interval', '12'),
        ('idle_timeout', '20'),
        ('person_timeout', '20'),
        ('is_active', 'true'),
        ('active', 'true')
    ON CONFLICT (key) DO NOTHING;
    """
    try:
        async with pool.acquire() as conn:
            await conn.execute(sql)
    except Exception as e:
        print(f"Ошибка инициализации таблиц киоска: {e}")


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
    await init_kiosk_tables()


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