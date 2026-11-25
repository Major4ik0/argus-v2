"""Окружение Alembic: URL базы берётся из настроек приложения (KAFEDRA_DATABASE_URL)."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, engine_from_config, pool

from kafedra.db import models  # noqa: F401 — регистрирует таблицы в metadata
from kafedra.db.base import Base
from kafedra.db.session import connect_args
from kafedra.settings import settings

config = context.config
config.set_main_option("sqlalchemy.url", settings.database_url)
# Журналы настраиваем только при запуске из командной строки. Внутри АРГУСа (kafedra.integration.argus)
# fileConfig выключил бы его собственные журналы, в том числе uvicorn.
if config.config_file_name is not None and config.attributes.get("configure_logger", True):
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(url=settings.database_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    schema = settings.db_schema
    if schema:  # общая база АРГУСа: своя схема, там же alembic_version
        # Схему может заранее создать администратор базы (роль без права CREATE на всю базу) —
        # тогда CREATE SCHEMA IF NOT EXISTS упал бы на проверке прав, поэтому сначала смотрим, есть ли она.
        with create_engine(settings.database_url).begin() as c:
            exists = c.exec_driver_sql("SELECT 1 FROM pg_namespace WHERE nspname = %(s)s", {"s": schema}).first()
            if not exists:
                if not c.exec_driver_sql("SELECT has_database_privilege(current_database(), 'CREATE')").scalar():
                    user = c.exec_driver_sql("SELECT current_user").scalar()
                    raise RuntimeError(f"Схемы «{schema}» нет, а у роли «{user}» нет права её создать. "
                                       f'Администратор базы: CREATE SCHEMA "{schema}" AUTHORIZATION "{user}";')
                c.exec_driver_sql(f'CREATE SCHEMA "{schema}"')
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}), prefix="sqlalchemy.", poolclass=pool.NullPool,
        connect_args=connect_args(),
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, version_table_schema=schema or None)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
