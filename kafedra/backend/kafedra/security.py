"""Пароли (argon2), токены сессий, ограничение попыток входа."""

from __future__ import annotations

import hashlib
import secrets
import time
from collections import defaultdict

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError

_ph = PasswordHasher()
MIN_PASSWORD = 8


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    try:
        return _ph.verify(password_hash, password)
    except VerificationError:
        return False
    except Exception:  # noqa: BLE001 — повреждённый хэш
        return False


def new_token() -> tuple[str, str]:
    """(токен для cookie, его SHA-256 для БД)."""
    token = secrets.token_urlsafe(32)
    return token, token_hash(token)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def normalize_login(login: str) -> str:
    """Доменный логин без домена, строчными: «ACADEMY\\Ivanov», «ivanov@academy.org» → «ivanov»."""
    s = login.strip()
    if "\\" in s:
        s = s.rsplit("\\", 1)[1]
    if "@" in s:
        s = s.split("@", 1)[0]
    return s.strip().lower()


class LoginThrottle:
    """Блокировка входа на 15 минут после N неудач подряд для логина (в памяти процесса)."""

    def __init__(self, limit: int, window: float = 15 * 60) -> None:
        self.limit, self.window = limit, window
        self.fails: dict[str, list[float]] = defaultdict(list)

    def blocked(self, login: str) -> bool:
        now = time.monotonic()
        self.fails[login] = [t for t in self.fails[login] if now - t < self.window]
        return len(self.fails[login]) >= self.limit

    def fail(self, login: str) -> None:
        self.fails[login].append(time.monotonic())

    def ok(self, login: str) -> None:
        self.fails.pop(login, None)
