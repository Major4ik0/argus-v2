from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import List


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


settings = Settings()