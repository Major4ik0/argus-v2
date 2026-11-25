"""Служебные команды.

python -m kafedra.cli create-admin <логин>      — создать администратора (пароль спрашивается)
"""

from __future__ import annotations

import getpass
import sys

from sqlalchemy import select

from .db import models as m
from .db.session import SessionLocal
from .security import MIN_PASSWORD, hash_password


def create_admin(login: str, password: str | None = None) -> None:
    password = password or getpass.getpass("Пароль: ")
    if len(password) < MIN_PASSWORD:
        raise SystemExit(f"Пароль не короче {MIN_PASSWORD} символов")
    with SessionLocal() as s, s.begin():
        u = s.scalar(select(m.User).where(m.User.login == login.lower()))
        if u:
            u.password_hash, u.role, u.is_active = hash_password(password), m.Role.ADMIN, True
            print(f"Пользователь «{login}» обновлён: администратор, пароль задан")
        else:
            s.add(m.User(login=login.lower(), password_hash=hash_password(password), role=m.Role.ADMIN,
                         full_name="Администратор"))  # fmt: skip
            print(f"Создан администратор «{login}»")


def main() -> int:
    if len(sys.argv) >= 3 and sys.argv[1] == "create-admin":
        create_admin(sys.argv[2])
        return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
