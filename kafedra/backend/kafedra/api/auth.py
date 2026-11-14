"""Вход, выход, текущий пользователь, смена своего пароля."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy import delete, select

from ..calc import names
from ..db import models as m
from ..security import (
    MIN_PASSWORD,
    LoginThrottle,
    hash_password,
    new_token,
    normalize_login,
    token_hash,
    verify_password,
)
from ..settings import settings
from .deps import COOKIE, DB, User

router = APIRouter(prefix="/api/auth", tags=["вход"])
throttle = LoginThrottle(settings.login_attempts)


class LoginIn(BaseModel):
    login: str
    password: str


class UserOut(BaseModel):
    id: int
    login: str
    full_name: str
    role: str
    department_id: int | None
    person_id: int | None = None
    person_name: str = ""  # «Фамилия И.О.» человека учётки
    is_active: bool = True

    @classmethod
    def of(cls, u: m.User, person: m.Person | None = None) -> UserOut:
        return cls(
            id=u.id,
            login=u.login,
            full_name=u.full_name,
            role=u.role.value,
            department_id=u.department_id,
            person_id=u.person_id,
            person_name=names.short_name(person.full_name) if person else "",
            is_active=u.is_active,
        )


def _cookie_path(request: Request) -> str:
    """Путь cookie: в АРГУСе приложение подключено по адресу /kafedra (root_path подмонтированного приложения)."""
    return (request.scope.get("root_path") or "").rstrip("/") + "/"


def _open_session(db, request: Request, response: Response, user: m.User, expires: dt.datetime,
                  argus_hash: str | None = None) -> None:  # fmt: skip
    token, digest = new_token()
    db.execute(delete(m.UserSession).where(m.UserSession.expires_at < dt.datetime.now(dt.UTC)))
    db.add(m.UserSession(token_hash=digest, user_id=user.id, expires_at=expires, argus_token_hash=argus_hash))
    db.commit()
    max_age = max(60, int((expires - dt.datetime.now(dt.UTC)).total_seconds()))
    response.set_cookie(COOKIE, token, max_age=max_age, httponly=True, samesite="strict",
                        secure=settings.cookie_secure, path=_cookie_path(request))  # fmt: skip


@router.get("/mode")
def mode() -> dict:
    """Как входить: argus — приложение открыто из АРГУСа (вход по его токену); local_login — кто входит по паролю."""
    return {"argus": settings.argus_sso, "local_login": settings.local_login}


@router.post("/login")
def login(data: LoginIn, request: Request, response: Response, db: DB) -> UserOut:
    key = normalize_login(data.login)
    if throttle.blocked(key):
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Слишком много попыток, попробуйте через 15 минут")
    user = db.scalar(select(m.User).where(m.User.login == key))
    if not user or not user.is_active or not verify_password(user.password_hash, data.password):
        throttle.fail(key)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Неверный логин или пароль")
    throttle.ok(key)
    if settings.local_login == "admin" and user.role is not m.Role.ADMIN:
        raise HTTPException(status.HTTP_403_FORBIDDEN,
                            "Вход по паролю — только для администратора. Войдите через АРГУС")  # fmt: skip
    expires = dt.datetime.now(dt.UTC) + dt.timedelta(hours=settings.session_hours)
    _open_session(db, request, response, user, expires)
    return UserOut.of(user)


class ArgusIn(BaseModel):
    token: str = ""  # токен входа в АРГУС из браузера (localStorage «auth_token»)


NOT_IN_ARGUS = "Войдите в АРГУС под своей доменной учётной записью"


@router.post("/argus")
def argus_login(data: ArgusIn, request: Request, response: Response, db: DB) -> UserOut:
    """Вход по кнопке из АРГУСа: токен АРГУСа → доменный логин (запомнен при входе в АРГУС) → наша учётка.

    Сессия всегда соответствует тому, кто сейчас вошёл в АРГУС в этом браузере: другой человек, гость
    или выход из АРГУСа закрывают прежнюю сессию. Сессия администратора, открытая по паролю, остаётся,
    пока в АРГУС не вошёл кто-то другой (на случай, когда AD недоступен).
    """
    if not settings.argus_sso:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Вход через АРГУС выключен")
    now = dt.datetime.now(dt.UTC)
    digest = token_hash(data.token) if data.token else None
    rec = db.get(m.ArgusToken, digest) if digest else None
    if rec is not None and rec.expires_at <= now:
        rec = None
    cookie = request.cookies.get(COOKIE)
    q = select(m.UserSession).where(m.UserSession.token_hash == token_hash(cookie)) if cookie else None
    sess = db.scalar(q) if q is not None else None
    if sess is not None and sess.expires_at > now and sess.user.is_active:
        same_argus = sess.argus_token_hash is not None and sess.argus_token_hash == digest
        by_password = sess.argus_token_hash is None and (rec is None or rec.login == sess.user.login)
        if same_argus or by_password:
            return UserOut.of(sess.user, db.get(m.Person, sess.user.person_id) if sess.user.person_id else None)
    if sess is not None:  # сессия от другого входа — закрыть
        db.delete(sess)
        db.commit()
    if rec is None:
        response.delete_cookie(COOKIE, path=_cookie_path(request))
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, NOT_IN_ARGUS)
    user = db.scalar(select(m.User).where(m.User.login == rec.login))
    if user is None or not user.is_active:
        response.delete_cookie(COOKIE, path=_cookie_path(request))
        msg = f"Нет доступа к приложению кафедры (логин «{rec.login}») — обратитесь к администратору"
        raise HTTPException(status.HTTP_403_FORBIDDEN, msg)
    expires = min(rec.expires_at, now + dt.timedelta(hours=settings.session_hours))
    _open_session(db, request, response, user, expires, argus_hash=digest)
    return UserOut.of(user, db.get(m.Person, user.person_id) if user.person_id else None)


@router.post("/logout")
def logout(request: Request, response: Response, db: DB, _: User) -> dict:
    token = request.cookies.get(COOKIE)
    if token:
        db.execute(delete(m.UserSession).where(m.UserSession.token_hash == token_hash(token)))
        db.commit()
    response.delete_cookie(COOKIE, path=_cookie_path(request))
    return {"ok": True}


@router.get("/me")
def me(user: User, db: DB) -> UserOut:
    return UserOut.of(user, db.get(m.Person, user.person_id) if user.person_id else None)


class PasswordIn(BaseModel):
    old_password: str
    new_password: str


@router.post("/password")
def change_password(data: PasswordIn, user: User, db: DB) -> dict:
    if not verify_password(user.password_hash, data.old_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Текущий пароль неверен")
    if len(data.new_password) < MIN_PASSWORD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Пароль не короче {MIN_PASSWORD} символов")
    user.password_hash = hash_password(data.new_password)
    db.execute(delete(m.UserSession).where(m.UserSession.user_id == user.id))  # выйти на всех устройствах
    db.commit()
    return {"ok": True}
