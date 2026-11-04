import json
import os
from pathlib import Path
from typing import List, Dict, Any, Optional
from pydantic_settings import BaseSettings, SettingsConfigDict

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"
DB_CONFIG_PATH = DATA_DIR / "db_config.json"


def read_db_config_file() -> Dict[str, Any]:
    """Чтение пользовательской конфигурации БД из JSON-файла, если он существует."""
    if DB_CONFIG_PATH.exists():
        try:
            with open(DB_CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Ошибка чтения конфигурации БД {DB_CONFIG_PATH}: {e}")
    return {}


def write_db_config_file(data: Dict[str, Any]) -> None:
    """Запись пользовательской конфигурации БД в JSON-файл."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    with open(DB_CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


class Settings(BaseSettings):
    PROJECT_NAME: str = "АРГУС API"
    API_V1_STR: str = "/api/v1"

    # Параметры БД
    DB_HOST: str = "217.60.98.50"
    DB_PORT: int = 5432
    DB_USER: str = "postgres"
    DB_PASSWORD: str = "12345678"
    DB_NAME: str = "organaizer12"
    # Active Directory / LDAP
    dev_mode: bool = True
    dev_password: str = "12345678"
    initial_admin: str = "admin"
    ad_server: str = "127.0.0.1"
    ad_domain: str = "academy.org"

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ]

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    def __init__(self, **values):
        super().__init__(**values)
        self.apply_custom_db_config()

    def apply_custom_db_config(self) -> bool:
        """Применяет параметры подключения из файла data/db_config.json при его наличии."""
        custom = read_db_config_file()
        if custom:
            if "host" in custom and custom["host"]:
                self.DB_HOST = str(custom["host"])
            if "port" in custom and custom["port"]:
                try:
                    self.DB_PORT = int(custom["port"])
                except (ValueError, TypeError):
                    pass
            if "user" in custom and custom["user"]:
                self.DB_USER = str(custom["user"])
            if "password" in custom and custom["password"] is not None:
                self.DB_PASSWORD = str(custom["password"])
            if "db_name" in custom and custom["db_name"]:
                self.DB_NAME = str(custom["db_name"])
            return True
        return False


settings = Settings()
