# backend/app/api/deps.py
# -*- coding: utf-8 -*-
from typing import AsyncGenerator
import asyncpg
from fastapi import Request
from app.core.config import settings

_pool: asyncpg.Pool | None = None


async def get_db_pool(request: Request = None) -> asyncpg.Pool:
    """Возвращает пул asyncpg: либо из app.state, либо создает глобальный экземпляр."""
    global _pool

    if request and hasattr(request.app.state, "pool") and request.app.state.pool:
        return request.app.state.pool

    if _pool is None or _pool._closed:
        db_url = getattr(settings, "database_url", None) or getattr(settings, "postgres_url", None)
        if db_url:
            _pool = await asyncpg.create_pool(db_url, min_size=1, max_size=10)
        else:
            _pool = await asyncpg.create_pool(
                user=getattr(settings, "postgres_user", getattr(settings, "db_user", "postgres")),
                password=getattr(settings, "postgres_password", getattr(settings, "db_password", "postgres")),
                database=getattr(settings, "postgres_db", getattr(settings, "db_name", "schedule")),
                host=getattr(settings, "postgres_host", getattr(settings, "db_host", "localhost")),
                port=int(getattr(settings, "postgres_port", getattr(settings, "db_port", 5432))),
                min_size=1,
                max_size=10,
            )
    return _pool


async def get_connection(request: Request) -> AsyncGenerator[asyncpg.Connection, None]:
    """Dependency для эндпоинтов: выдает безопасное соединение из пула."""
    pool = await get_db_pool(request)
    async with pool.acquire() as conn:
        yield conn