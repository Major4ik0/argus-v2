import asyncio
from typing import AsyncGenerator, Optional
import asyncpg
from fastapi import HTTPException
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

    CREATE TABLE IF NOT EXISTS public.teacher_photos (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER NOT NULL REFERENCES public.people(mid) ON DELETE CASCADE,
        file_path TEXT NOT NULL,
        embedding BYTEA NOT NULL,
        is_primary BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_teacher_photos_teacher_id ON public.teacher_photos(teacher_id);

    INSERT INTO public.teacher_photos (teacher_id, file_path, embedding, is_primary, created_at)
    SELECT tb.teacher_id, COALESCE(tb.photo_path, ''), tb.embedding, TRUE, COALESCE(tb.created_at, NOW())
    FROM public.teacher_biometrics tb
    WHERE tb.embedding IS NOT NULL
      AND NOT EXISTS (
          SELECT 1 FROM public.teacher_photos tp WHERE tp.teacher_id = tb.teacher_id
      );

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
        ('carousel_interval', '6'),
        ('carousel_active', 'true'),
        ('start_day_mode', 'today'),
        ('font_scale', 'normal'),
        ('font_scale_display', 'normal'),
        ('font_scale_schedule', 'normal'),
        ('idle_timeout', '6'),
        ('person_timeout', '6'),
        ('is_active', 'true'),
        ('active', 'true'),
        ('camera_flip', 'false')
    ON CONFLICT (key) DO NOTHING;
    """
    try:
        async with pool.acquire() as conn:
            await conn.execute(sql)
    except Exception as e:
        print(f"Ошибка инициализации таблиц киоска: {e}")


async def init_db_pool() -> Optional[asyncpg.Pool]:
    """Инициализация пула подключений к PostgreSQL с защитой от сбоев сети и недоступности БД."""
    global pool
    try:
        pool = await asyncpg.create_pool(
            host=settings.DB_HOST,
            port=settings.DB_PORT,
            user=settings.DB_USER,
            password=settings.DB_PASSWORD,
            database=settings.DB_NAME,
            min_size=1,
            max_size=10,
            timeout=5.0,
            command_timeout=10.0,
        )
        await init_kiosk_tables()
        print(f"[PostgreSQL] Пул подключений успешно инициализирован ({settings.DB_HOST}:{settings.DB_PORT}/{settings.DB_NAME})")
        return pool
    except (asyncio.TimeoutError, TimeoutError) as e:
        pool = None
        print(f"[PostgreSQL] Превышено время ожидания подключения к БД ({settings.DB_HOST}:{settings.DB_PORT}): {e}")
        print("[PostgreSQL] Сервер запущен в автономном режиме. Параметры подключения к БД можно настроить в панели администратора.")
        return None
    except Exception as e:
        pool = None
        print(f"[PostgreSQL] Внимание: не удалось подключиться к базе данных ({settings.DB_HOST}:{settings.DB_PORT}): {e}")
        print("[PostgreSQL] Сервер запущен в автономном режиме. Параметры подключения к БД можно настроить в панели администратора.")
        return None


async def close_db_pool() -> None:
    """Закрытие пула при остановке сервера."""
    global pool
    if pool:
        try:
            await pool.close()
        except Exception as e:
            print(f"[PostgreSQL] Предупреждение при закрытии пула: {e}")
        finally:
            pool = None


async def restart_db_pool() -> asyncpg.Pool:
    """Горячая перезагрузка пула подключений к PostgreSQL с новыми параметрами settings."""
    global pool
    if pool:
        try:
            await pool.close()
        except Exception as e:
            print(f"Предупреждение при закрытии предыдущего пула: {e}")
        pool = None

    pool = await asyncpg.create_pool(
        host=settings.DB_HOST,
        port=settings.DB_PORT,
        user=settings.DB_USER,
        password=settings.DB_PASSWORD,
        database=settings.DB_NAME,
        min_size=1,
        max_size=10,
        timeout=5.0,
        command_timeout=10.0,
    )
    await init_kiosk_tables()
    return pool


async def get_db_connection() -> AsyncGenerator[asyncpg.Connection, None]:
    """Dependency для эндпоинтов FastAPI: выдает соединение из пула."""
    global pool
    if pool is None:
        try:
            await init_db_pool()
        except Exception:
            pass
    if pool is None:
        raise HTTPException(
            status_code=503,
            detail="База данных временно недоступна. Проверьте параметры подключения к PostgreSQL в панели администратора.",
        )

    async with pool.acquire() as connection:
        yield connection