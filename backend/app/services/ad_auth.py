# backend/app/services/ad_auth.py
# -*- coding: utf-8 -*-
import asyncio
from ldap3 import Server, Connection, SIMPLE, NONE
from ..core.config import settings


def _sync_authenticate_ad(username: str, password: str) -> bool:
    """Проверка учетных данных в OpenLDAP и Active Directory."""
    clean_user = username.strip()
    clean_pass = password.strip()

    # 1. Резервный dev-режим
    if getattr(settings, "dev_mode", False):
        dev_pass = getattr(settings, "dev_password", "admin")
        initial_admin = getattr(settings, "initial_admin", "admin")
        if clean_user.lower() == initial_admin.lower() and clean_pass == dev_pass:
            print(f"🔧 [AUTH DEV] Вход через DEV-пароль: {clean_user}")
            return True

    server_ip = settings.ad_server
    domain = settings.ad_domain
    dc_suffix = ",".join([f"dc={part}" for part in domain.split(".")])

    # 2. Формируем список возможных DN для OpenLDAP и Windows AD
    principals_to_try = []

    if clean_user.startswith("cn=") or clean_user.startswith("uid="):
        principals_to_try.append(clean_user)
    else:
        # Для учетной записи администратора контейнера
        if clean_user.lower() == "admin":
            principals_to_try.append(f"cn=admin,{dc_suffix}")

        # Для обычных пользователей OpenLDAP
        principals_to_try.append(f"cn={clean_user},{dc_suffix}")
        principals_to_try.append(f"uid={clean_user},{dc_suffix}")

        # Для Windows Server 2012 (UPN)
        if "@" in clean_user or "\\" in clean_user:
            principals_to_try.append(clean_user)
        else:
            principals_to_try.append(f"{clean_user}@{domain}")

    # 3. Подключение к LDAP (get_info=NONE предотвращает сбой на чтении схемы)
    try:
        server = Server(server_ip, port=389, get_info=NONE, connect_timeout=4)

        for principal in principals_to_try:
            print(f"[AUTH LDAP] Попытка bind: {principal} на {server_ip}")
            try:
                conn = Connection(
                    server,
                    user=principal,
                    password=clean_pass,
                    authentication=SIMPLE,
                    auto_bind=False
                )

                bound = conn.bind()

                if bound:
                    conn.unbind()
                    print(f"✅ [AUTH LDAP] Успешная авторизация: {principal}")
                    return True
                else:
                    # Выводим точный ответ от сервера
                    res = conn.result or {}
                    desc = res.get("description", "unknown error")
                    code = res.get("result", -1)
                    print(f"   ↳ Отказ для {principal}: [{code}] {desc}")
            except Exception as conn_err:
                print(f"   ↳ Ошибка при попытке {principal}: {conn_err}")
                continue

        print(f"❌ [AUTH LDAP] Доступ запрещен для пользователя: {clean_user}")
        return False

    except Exception as e:
        print(f"❌ [AUTH LDAP] Ошибка сетевого соединения с {server_ip}: {e}")
        return False


async def authenticate_ad(username: str, password: str) -> bool:
    """Асинхронный вызов без блокировки основного потока FastAPI."""
    return await asyncio.to_thread(_sync_authenticate_ad, username, password)