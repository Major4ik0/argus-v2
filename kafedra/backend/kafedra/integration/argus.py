"""Приложение кафедры внутри АРГУСа (https://github.com/Major4ik0/argus-v2).

В ``backend/app/main.py`` АРГУСа — до правила, которое отдаёт его интерфейс на любой путь::

    from kafedra.integration.argus import attach as attach_kafedra  # «Личный состав» (приложение кафедр)
    attach_kafedra(app)

Что делает ``attach``:

* применяет миграции: по умолчанию база и учётка — те же, что у АРГУСа, таблицы — в схеме ``kafedra``
  (``kafedra.settings.use_argus_database``; ``KAFEDRA_DATABASE_URL`` / ``KAFEDRA_DB_SCHEMA`` это переопределяют);
* подключает наше приложение по адресу ``/kafedra`` (API — ``/kafedra/api``, интерфейс собран с base ``/kafedra/``);
* запоминает успешные входы в АРГУС: сервер АРГУСа проверил пароль в AD и выдал токен — храним SHA-256 токена
  и доменный логин. Кнопка «Личный состав» в АРГУСе открывает ``/kafedra/``, наш интерфейс отправляет токен
  из localStorage АРГУСа на ``/kafedra/api/auth/argus`` и получает сессию той учётки, у которой такой логин;
* включает режим «по паролю входит только администратор».

Сам АРГУС токены не проверяет, поэтому доверяем только тем, что прошли через его сервер при входе.
Вход гостем и вход «прямо в браузере» токена от сервера не получают — к нам с ними не войти.
"""

from __future__ import annotations

import datetime as dt
import json
import logging
from pathlib import Path

import anyio
from sqlalchemy import delete
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..db import models as m
from ..db.session import get_db
from ..main import app as kafedra_app
from ..security import normalize_login, token_hash
from ..settings import settings

log = logging.getLogger("kafedra.argus")
startup_log = logging.getLogger("uvicorn.error")  # видно в журнале АРГУСа (uvicorn), как его собственные сообщения

PREFIX = "/kafedra"
ARGUS_LOGIN = "/api/v1/admin/login"  # вход АРГУСа (settings.API_V1_STR + /admin/login)
BACKEND_DIR = Path(__file__).resolve().parents[2]  # папка с alembic.ini


def _db():
    """Сессия нашей БД; в тестах — подменённая через dependency_overrides, как у API."""
    factory = kafedra_app.dependency_overrides.get(get_db, get_db)
    gen = factory()
    return gen, next(gen)


def remember_argus_login(token: str, username: str) -> None:
    """Запомнить успешный вход в АРГУС: SHA-256 токена → доменный логин на settings.argus_token_hours."""
    login = normalize_login(username)
    if not token or not login:
        return
    now = dt.datetime.now(dt.UTC)
    gen, db = _db()
    try:
        db.execute(delete(m.ArgusToken).where(m.ArgusToken.expires_at < now))
        db.merge(m.ArgusToken(token_hash=token_hash(token), login=login,
                              expires_at=now + dt.timedelta(hours=settings.argus_token_hours)))  # fmt: skip
        db.commit()
    finally:
        gen.close()


class ArgusLoginRecorder:
    """ASGI-прослойка АРГУСа: видит ответ на успешный вход и запоминает токен. Ответ не меняет."""

    def __init__(self, app: ASGIApp, login_path: str = ARGUS_LOGIN) -> None:
        self.app = app
        self.login_path = login_path

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] != "POST" or scope["path"] != self.login_path:
            await self.app(scope, receive, send)
            return
        status_code, body = 0, bytearray()

        async def capture(message: Message) -> None:
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            elif message["type"] == "http.response.body":
                body.extend(message.get("body", b""))
                if not message.get("more_body", False) and status_code == 200:
                    await self._record(bytes(body))  # до отправки ответа: к щелчку по кнопке токен уже есть
            await send(message)

        await self.app(scope, receive, capture)

    @staticmethod
    async def _record(raw: bytes) -> None:
        try:
            data = json.loads(raw)
            if data.get("success") and data.get("token") and data.get("username"):
                await anyio.to_thread.run_sync(remember_argus_login, str(data["token"]), str(data["username"]))
        except Exception:  # noqa: BLE001 — вход в АРГУС не должен ломаться из-за нашей базы
            log.exception("Не удалось запомнить вход в АРГУС для приложения кафедры")


def migrate() -> None:
    """alembic upgrade head для нашей базы (журналы АРГУСа не трогаем)."""
    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.attributes["configure_logger"] = False
    command.upgrade(cfg, "head")


def _argus_config():
    """Настройки АРГУСа (app.core.config) или None вне его образа."""
    try:
        from app.core import config  # пакет АРГУСа
    except ImportError:
        return None
    return config


def book_dir() -> Path | None:
    """Папка, из которой при первом запуске берётся книга: KAFEDRA_IMPORT_DIR или <данные АРГУСа>/kafedra."""
    if settings.import_dir:
        return Path(settings.import_dir)
    config = _argus_config()
    return Path(config.DATA_DIR) / "kafedra" if config and hasattr(config, "DATA_DIR") else None


def first_run(folder: Path | None = None, initial_admin: str | None = None) -> None:
    """Первый запуск (в базе нет ни одной кафедры): загрузить книгу из папки и завести администратора.

    Книга (*.xlsm) кладётся в папку данных АРГУСа (том /app/backend/data → kafedra/) — в образ и в git
    она не попадает. Администратор приложения кафедры — главный администратор АРГУСа (его INITIAL_ADMIN):
    войдя в АРГУС, он открывает «Личный состав» уже администратором и назначает ЗНК.
    """
    from sqlalchemy import func, select

    from .. import importer
    from ..security import hash_password

    folder = folder if folder is not None else book_dir()
    if initial_admin is None:
        config = _argus_config()
        initial_admin = getattr(getattr(config, "settings", None), "initial_admin", "") if config else ""
    gen, db = _db()
    try:
        if not db.scalar(select(func.count()).select_from(m.Department)):
            books = sorted(folder.glob("*.xlsm")) if folder and folder.is_dir() else []
            if books:
                dept = importer.import_book(db, books[0])
                db.commit()
                startup_log.info("Кафедра: книга загружена: %s → «%s»", books[0].name, dept.name)
            else:
                startup_log.info("Кафедра: книга не найдена (%s/*.xlsm) — данные можно загрузить позже", folder)
        login = normalize_login(initial_admin or "")
        if login and not db.scalar(select(func.count()).select_from(m.User)):
            import secrets

            db.add(m.User(login=login, password_hash=hash_password(secrets.token_urlsafe(24)), role=m.Role.ADMIN,
                          full_name="Администратор АРГУСа"))  # fmt: skip
            db.commit()
            startup_log.info("Кафедра: администратор %s (вход через АРГУС)", login)
    finally:
        gen.close()


def attach(argus_app, prefix: str = PREFIX, login_path: str = ARGUS_LOGIN, run_migrations: bool = True) -> None:
    """Подключить приложение кафедры к приложению FastAPI АРГУСа (вызывать до его правила «любой путь → index.html»)."""
    settings.argus_sso = True
    settings.local_login = "admin"
    if run_migrations:
        try:
            migrate()
        except Exception:  # noqa: BLE001 — АРГУС должен запуститься, даже если наша база недоступна
            log.exception("Миграции базы кафедры не применены — проверьте KAFEDRA_DATABASE_URL")
        else:
            try:
                first_run()
            except Exception:  # noqa: BLE001
                log.exception("Первичная загрузка данных кафедры не выполнена")
    argus_app.add_middleware(ArgusLoginRecorder, login_path=login_path)
    argus_app.mount(prefix, kafedra_app)
