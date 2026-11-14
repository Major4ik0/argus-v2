"""Зависимости API: сессия БД, текущий пользователь, права по ролям и кафедре.

Роли: user — просмотр своей кафедры; deputy — редактирование своей кафедры; admin — всё и учётные записи.
Защита от CSRF: изменяющие запросы (POST/PUT/PATCH/DELETE) обязаны иметь заголовок X-Requested-With —
браузер не пришлёт его с чужого сайта без разрешения CORS (а CORS не включён).
"""

from __future__ import annotations

import datetime as dt
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import models as m
from ..db.session import get_db
from ..security import token_hash

COOKIE = "kafedra_session"
UNSAFE = {"POST", "PUT", "PATCH", "DELETE"}

DB = Annotated[Session, Depends(get_db)]


def current_user(request: Request, db: DB) -> m.User:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Требуется вход")
    sess = db.scalar(select(m.UserSession).where(m.UserSession.token_hash == token_hash(token)))
    if not sess or sess.expires_at < dt.datetime.now(dt.UTC) or not sess.user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Сессия истекла, войдите снова")
    if request.method in UNSAFE and request.headers.get("x-requested-with") != "kafedra":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет заголовка X-Requested-With")
    return sess.user


User = Annotated[m.User, Depends(current_user)]


def require_admin(user: User) -> m.User:
    if user.role is not m.Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Только для администратора")
    return user


Admin = Annotated[m.User, Depends(require_admin)]


def department_for(user: m.User, db: Session, department_id: int | None, *, write: bool) -> m.Department:
    """Кафедра запроса с проверкой прав: не-админ работает только со своей кафедрой, пишет только deputy/admin."""
    if user.role is not m.Role.ADMIN:
        if department_id not in (None, user.department_id):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Нет доступа к другой кафедре")
        department_id = user.department_id
        if write and user.role is not m.Role.DEPUTY:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Редактирование доступно заместителю начальника кафедры")
    if department_id is None:
        department_id = db.scalar(select(m.Department.id).order_by(m.Department.id))
    dept = db.get(m.Department, department_id) if department_id else None
    if dept is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Кафедра не найдена")
    return dept


def reader(user: User, db: DB, department_id: int | None = None) -> m.Department:
    return department_for(user, db, department_id, write=False)


def writer(user: User, db: DB, department_id: int | None = None) -> m.Department:
    return department_for(user, db, department_id, write=True)


ReadDept = Annotated[m.Department, Depends(reader)]
WriteDept = Annotated[m.Department, Depends(writer)]
