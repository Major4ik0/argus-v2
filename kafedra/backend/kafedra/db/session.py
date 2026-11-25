from collections.abc import Iterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from ..settings import settings


def connect_args() -> dict:
    """search_path = только наша схема, если она задана (KAFEDRA_DB_SCHEMA)."""
    return {"options": f"-csearch_path={settings.db_schema}"} if settings.db_schema else {}


engine = create_engine(settings.database_url, pool_pre_ping=True, connect_args=connect_args())
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def get_db() -> Iterator[Session]:
    with SessionLocal() as s:
        yield s
