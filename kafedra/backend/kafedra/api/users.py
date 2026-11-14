"""Учётные записи и кафедры (управляет администратор).

Администратор создаёт кафедру и сразу (или потом) назначает ей ЗНК — учётку с ролью deputy.
Новая кафедра пустая: копируются только справочник воинских званий и праздничные дни (общие для всех).
"""

from __future__ import annotations

import secrets

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from ..db import models as m
from ..security import MIN_PASSWORD, hash_password, normalize_login
from ..settings import settings
from .auth import UserOut
from .deps import DB, Admin, User

router = APIRouter(prefix="/api", tags=["учётные записи и кафедры"])


class UserIn(BaseModel):
    login: str = Field(min_length=2, max_length=64)
    full_name: str = ""
    role: m.Role = m.Role.USER
    department_id: int | None = None
    person_id: int | None = None
    password: str | None = None
    is_active: bool = True


def _out(db, u: m.User) -> UserOut:
    return UserOut.of(u, db.get(m.Person, u.person_id) if u.person_id else None)


@router.get("/users")
def list_users(_: Admin, db: DB) -> list[UserOut]:
    return [_out(db, u) for u in db.scalars(select(m.User).order_by(m.User.login))]


def _check(data: UserIn, db) -> None:
    if data.role is not m.Role.ADMIN and data.department_id is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Для пользователя и ЗНК нужна кафедра")
    if data.department_id is not None and db.get(m.Department, data.department_id) is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Кафедра не найдена")
    if data.person_id is not None:
        p = db.get(m.Person, data.person_id)
        if not p or p.department_id != data.department_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Человек не из выбранной кафедры")
    if data.password is not None and data.password != "" and len(data.password) < MIN_PASSWORD:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Пароль не короче {MIN_PASSWORD} символов")


def _create_user(db, data: UserIn) -> m.User:
    _check(data, db)
    password = data.password
    if not password:
        # с АРГУСом пользователи и ЗНК входят по доменному логину — свой пароль нужен только администратору
        if settings.local_login == "admin" and data.role is not m.Role.ADMIN:
            password = secrets.token_urlsafe(24)
        else:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нужен пароль")
    login = normalize_login(data.login)
    if db.scalar(select(m.User).where(m.User.login == login)):
        raise HTTPException(status.HTTP_409_CONFLICT, f"Логин «{login}» уже есть")
    u = m.User(login=login, full_name=data.full_name.strip(), role=data.role, department_id=data.department_id,
               person_id=data.person_id, password_hash=hash_password(password),
               is_active=data.is_active)  # fmt: skip
    db.add(u)
    return u


@router.post("/users", status_code=201)
def create_user(data: UserIn, _: Admin, db: DB) -> UserOut:
    u = _create_user(db, data)
    db.commit()
    return _out(db, u)


@router.put("/users/{user_id}")
def update_user(user_id: int, data: UserIn, admin: Admin, db: DB) -> UserOut:
    u = db.get(m.User, user_id)
    if not u:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Нет такого пользователя")
    _check(data, db)
    if u.id == admin.id and (data.role is not m.Role.ADMIN or not data.is_active):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя снять права администратора с себя")
    u.full_name, u.role, u.department_id, u.is_active = data.full_name, data.role, data.department_id, data.is_active
    u.person_id = data.person_id
    if data.password:
        u.password_hash = hash_password(data.password)
    if data.password or not data.is_active:
        db.execute(delete(m.UserSession).where(m.UserSession.user_id == u.id))
    db.commit()
    return _out(db, u)


@router.delete("/users/{user_id}", status_code=204)
def delete_user(user_id: int, admin: Admin, db: DB) -> None:
    if user_id == admin.id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Нельзя удалить себя")
    u = db.get(m.User, user_id)
    if u:
        db.delete(u)
        db.commit()


# --- кафедры -------------------------------------------------------------------------------------------


class DepartmentOut(BaseModel):
    id: int
    name: str
    short_name: str


@router.get("/departments")
def departments(user: User, db: DB) -> list[DepartmentOut]:
    q = select(m.Department).order_by(m.Department.id)
    if user.role is not m.Role.ADMIN:
        q = q.where(m.Department.id == user.department_id)
    return [DepartmentOut(id=d.id, name=d.name, short_name=d.short_name) for d in db.scalars(q)]


class Account(BaseModel):
    id: int
    login: str
    full_name: str
    role: str
    is_active: bool


class DepartmentInfo(DepartmentOut):
    persons: int  # человек в личном составе (в списках; убранные не считаются)
    accounts: list[Account]  # учётки кафедры (ЗНК — первыми)


@router.get("/admin/departments")
def departments_info(_: Admin, db: DB) -> list[DepartmentInfo]:
    counts = dict(db.execute(select(m.Person.department_id, func.count()).where(m.Person.is_active)
                             .group_by(m.Person.department_id)).all())  # fmt: skip
    users: dict[int, list[m.User]] = {}
    for u in db.scalars(select(m.User).where(m.User.department_id.is_not(None)).order_by(m.User.login)):
        users.setdefault(u.department_id, []).append(u)
    order = {m.Role.DEPUTY: 0, m.Role.ADMIN: 1, m.Role.USER: 2}
    return [DepartmentInfo(
        id=d.id, name=d.name, short_name=d.short_name, persons=counts.get(d.id, 0),
        accounts=[Account(id=u.id, login=u.login, full_name=u.full_name, role=u.role.value, is_active=u.is_active)
                  for u in sorted(users.get(d.id, []), key=lambda u: order[u.role])],
    ) for d in db.scalars(select(m.Department).order_by(m.Department.id))]  # fmt: skip


class DeputyIn(BaseModel):
    login: str = Field(min_length=2, max_length=64)
    full_name: str = ""
    password: str


class DepartmentIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)  # «13 кафедра» — в шапке и в документах
    short_name: str = Field(min_length=1, max_length=50)  # «13»
    deputy: DeputyIn | None = None  # сразу создать учётку ЗНК


def _check_dept(db, data: DepartmentIn, dept_id: int | None = None) -> tuple[str, str]:
    name, short = data.name.strip(), data.short_name.strip()
    if not name or not short:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Укажите название и краткое имя кафедры")
    other = db.scalar(select(m.Department).where(func.lower(m.Department.short_name) == short.lower()))
    if other and other.id != dept_id:
        raise HTTPException(status.HTTP_409_CONFLICT, f"Кафедра с кратким именем «{short}» уже есть")
    return name, short


def _seed(db, dept: m.Department) -> None:
    """Справочник званий и праздничные дни — из первой кафедры, где они заполнены (у всех одинаковые)."""
    src = db.scalar(select(m.Rank.department_id).where(m.Rank.department_id != dept.id).order_by(m.Rank.department_id))
    if src is None:
        return
    for r in db.scalars(select(m.Rank).where(m.Rank.department_id == src)):
        db.add(m.Rank(department_id=dept.id, name=r.name, short=r.short, sort=r.sort))
    for h in db.scalars(select(m.Holiday).where(m.Holiday.department_id == src)):
        db.add(m.Holiday(department_id=dept.id, day=h.day))


@router.post("/departments", status_code=201)
def create_department(data: DepartmentIn, _: Admin, db: DB) -> DepartmentOut:
    name, short = _check_dept(db, data)
    d = m.Department(name=name, short_name=short, settings={})
    db.add(d)
    db.flush()
    _seed(db, d)
    if data.deputy:
        _create_user(db, UserIn(login=data.deputy.login, full_name=data.deputy.full_name, role=m.Role.DEPUTY,
                                department_id=d.id, password=data.deputy.password))  # fmt: skip
    db.commit()
    return DepartmentOut(id=d.id, name=d.name, short_name=d.short_name)


@router.put("/departments/{dept_id}")
def update_department(dept_id: int, data: DepartmentIn, _: Admin, db: DB) -> DepartmentOut:
    d = db.get(m.Department, dept_id)
    if not d:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Кафедра не найдена")
    d.name, d.short_name = _check_dept(db, data, dept_id)
    db.commit()
    return DepartmentOut(id=d.id, name=d.name, short_name=d.short_name)


@router.delete("/departments/{dept_id}", status_code=204)
def delete_department(dept_id: int, _: Admin, db: DB) -> None:
    """Удалить можно только пустую кафедру: без личного состава и учётных записей."""
    d = db.get(m.Department, dept_id)
    if not d:
        return
    if db.scalar(select(func.count()).select_from(m.Person).where(m.Person.department_id == dept_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "В кафедре есть личный состав — удалить нельзя")
    if db.scalar(select(func.count()).select_from(m.User).where(m.User.department_id == dept_id)):
        raise HTTPException(status.HTTP_409_CONFLICT, "Сначала удалите или переведите учётные записи этой кафедры")
    db.delete(d)
    db.commit()

