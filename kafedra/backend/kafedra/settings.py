"""Настройки приложения из переменных окружения (префикс KAFEDRA_) или файла .env."""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="KAFEDRA_", env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://kafedra:kafedra_dev@127.0.0.1:5432/kafedra"
    # Схема PostgreSQL для наших таблиц. Пусто — public (своя база). В общей базе АРГУСа (organaizer12) — "kafedra"
    # (внутри АРГУСа — по умолчанию, см. use_argus_database):
    # приложение видит только эту схему и не трогает таблицы АРГУСа в public.
    db_schema: str = ""
    session_hours: int = 12  # срок жизни входа
    cookie_secure: bool = False  # True, если приложение открывается по https
    login_attempts: int = 10  # неудачных попыток входа подряд до блокировки на 15 минут
    frontend_dir: str = str(Path(__file__).resolve().parents[2] / "frontend" / "dist")  # собранный интерфейс
    # Встраивание в АРГУС (kafedra.integration.argus): вход по токену АРГУСа и вход по паролю только администратору.
    argus_sso: bool = False  # True — приложение подключено к АРГУСу
    local_login: str = "all"  # "all" — по паролю входят все; "admin" — только администраторы (в АРГУСе)
    argus_token_hours: int = 12  # сколько действует запомненный вход в АРГУС
    # первый запуск в АРГУСе: папка с книгой *.xlsm (пусто — <данные АРГУСа>/kafedra, см. integration.argus.first_run)
    import_dir: str = ""
    argus_schema: str = "public"  # схема таблиц АРГУСа (people, cathedra_personnel …) для сверки ФИО и званий


def use_argus_database(s: Settings) -> bool:
    """Внутри АРГУСа без KAFEDRA_DATABASE_URL — та же база и учётка, что у АРГУСа, наши таблицы в схеме kafedra.

    Параметры берутся из настроек АРГУСа (переменные DB_* и data/db_config.json, который меняют из его
    админки). Если базу АРГУСа сменили в админке на ходу, приложение кафедры переключится после перезапуска.
    """
    if "database_url" in s.model_fields_set:
        return False
    try:
        from app.core.config import settings as argus  # пакет АРГУСа; вне его образа такого нет
    except ImportError:
        return False
    if not hasattr(argus, "DB_HOST"):
        return False
    from sqlalchemy import URL

    s.database_url = URL.create("postgresql+psycopg", username=argus.DB_USER, password=argus.DB_PASSWORD,
                                host=argus.DB_HOST, port=int(argus.DB_PORT),
                                database=argus.DB_NAME).render_as_string(hide_password=False)
    if "db_schema" not in s.model_fields_set:
        s.db_schema = "kafedra"
    return True


settings = Settings()
use_argus_database(settings)
