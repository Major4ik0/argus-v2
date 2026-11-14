"""Типовой CRUD для простых таблиц кафедры: список / создать / изменить / удалить.

Права как везде: читать — любой пользователь своей кафедры, менять — ЗНК своей кафедры и администратор.
"""

import datetime as dt
from collections.abc import Callable
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, create_model
from sqlalchemy import select

from .deps import DB, ReadDept, WriteDept


def crud(
    router: APIRouter,
    path: str,
    model: type,
    schema: type[BaseModel],
    order_by: tuple = (),
    computed: Callable[[Any, dt.date], dict[str, Any]] | None = None,
    computed_fields: dict[str, Any] | None = None,
) -> type[BaseModel]:
    """Регистрирует GET/POST {path} и PUT/DELETE {path}/{id}. Возвращает модель ответа."""
    out_fields: dict[str, Any] = {"id": (int, ...)}
    for k, t in (computed_fields or {}).items():
        out_fields[k] = (t, None)
    Out = create_model(f"{model.__name__}Out", __base__=schema, **out_fields)  # noqa: N806

    def to_out(obj, as_of: dt.date):
        data = schema.model_validate(obj, from_attributes=True).model_dump()
        return Out(id=obj.id, **data, **(computed(obj, as_of) if computed else {}))

    def get(db, dept, obj_id: int):
        obj = db.get(model, obj_id)
        if obj is None or obj.department_id != dept.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Запись не найдена")
        return obj

    @router.get(path, response_model=list[Out], name=f"{model.__name__}: список")
    def list_(dept: ReadDept, db: DB, as_of: dt.date | None = None):
        q = select(model).where(model.department_id == dept.id).order_by(*order_by, model.id)
        return [to_out(o, as_of or dt.date.today()) for o in db.scalars(q)]

    @router.post(path, response_model=Out, status_code=201, name=f"{model.__name__}: создать")
    def create(data: schema, dept: WriteDept, db: DB):  # type: ignore[valid-type]
        obj = model(department_id=dept.id, **data.model_dump())
        db.add(obj)
        db.commit()
        return to_out(obj, dt.date.today())

    @router.put(path + "/{obj_id}", response_model=Out, name=f"{model.__name__}: изменить")
    def update(obj_id: int, data: schema, dept: WriteDept, db: DB):  # type: ignore[valid-type]
        obj = get(db, dept, obj_id)
        for k, v in data.model_dump().items():
            setattr(obj, k, v)
        db.commit()
        return to_out(obj, dt.date.today())

    @router.delete(path + "/{obj_id}", status_code=204, name=f"{model.__name__}: удалить")
    def delete(obj_id: int, dept: WriteDept, db: DB) -> None:
        db.delete(get(db, dept, obj_id))
        db.commit()

    return Out
