# backend/app/services/admin_service.py
# -*- coding: utf-8 -*-
from typing import List, Dict, Any
from datetime import datetime
import asyncpg
from ..core.config import settings

# Логины главных супервайзеров (их нельзя удалить)
SUPERADMINS = {
    "24-zhuravlev.a.d",
    settings.initial_admin.lower(),
    "admin",
}


class AdminService:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    async def init_table(self):
        """Создание таблицы администраторов, если её ещё нет."""
        sql = """
        CREATE TABLE IF NOT EXISTS public.argus_admins (
            username VARCHAR(100) PRIMARY KEY,
            added_by VARCHAR(100) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        );
        """
        await self.conn.execute(sql)

    async def is_user_admin(self, username: str) -> bool:
        """Проверка, обладает ли логин правами администратора."""
        u = username.strip().lower()
        if u in SUPERADMINS:
            return True

        await self.init_table()
        row = await self.conn.fetchrow(
            "SELECT 1 FROM public.argus_admins WHERE LOWER(username) = $1",
            u
        )
        return row is not None

    def is_superadmin(self, username: str) -> bool:
        """Проверка, является ли пользователь главным администратором (24-zhuravlev.a.d)."""
        return username.strip().lower() in SUPERADMINS

    async def get_all_admins(self) -> List[Dict[str, Any]]:
        """Получить список всех назначенных администраторов."""
        await self.init_table()
        rows = await self.conn.fetch(
            "SELECT username, added_by, TO_CHAR(created_at, 'YYYY-MM-DD HH24:MI') as created_at FROM public.argus_admins ORDER BY created_at DESC"
        )
        return [dict(r) for r in rows]

    async def add_admin(self, username: str, added_by: str) -> bool:
        """Добавить нового администратора."""
        await self.init_table()
        u = username.strip().lower()
        sql = """
        INSERT INTO public.argus_admins (username, added_by)
        VALUES ($1, $2)
        ON CONFLICT (username) DO NOTHING;
        """
        await self.conn.execute(sql, u, added_by)
        return True

    async def remove_admin(self, username: str) -> bool:
        """Удалить администратора из списка разрешенных."""
        await self.init_table()
        u = username.strip().lower()
        if u in SUPERADMINS:
            return False
        await self.conn.execute("DELETE FROM public.argus_admins WHERE LOWER(username) = $1", u)
        return True