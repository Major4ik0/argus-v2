"""Журналы и справочники: задачи, ветераны, счёт ПВО-ПРО, звания, научные специальности, кабинеты, праздники,
подразделения академии."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter
from pydantic import BaseModel

from ..calc import veterans
from ..db import models as m
from .crud import crud

router = APIRouter(prefix="/api", tags=["журналы и справочники"])


class TaskIn(BaseModel):
    source: str = ""
    received_on: dt.date | None = None
    incoming_number: str = ""
    content: str = ""
    issued_by: str = ""
    due: str = ""
    assigned_to: str = ""
    status: str = ""
    outgoing_number: str = ""


crud(router, "/tasks", m.Task, TaskIn, order_by=(m.Task.received_on.desc().nulls_last(),))


class VeteranIn(BaseModel):
    rank: str = ""
    full_name: str
    birth_date: dt.date | None = None
    phone_mobile: str = ""
    phone_city: str = ""
    address: str = ""
    workplace: str = ""
    last_position: str = ""
    position_start: dt.date | None = None
    position_end: dt.date | None = None
    academy_start: dt.date | None = None
    army_start: dt.date | None = None


def _veteran(v: m.Veteran, as_of: dt.date) -> dict:
    return {
        "age": veterans.age(v.birth_date, as_of),
        "position_years": veterans.years_between(v.position_start, v.position_end),
        "academy_years": veterans.years_between(v.academy_start, v.position_end),
        "army_years": veterans.years_between(v.army_start, v.position_end),
    }


crud(router, "/veterans", m.Veteran, VeteranIn, order_by=(m.Veteran.full_name,), computed=_veteran,
     computed_fields={"age": int | None, "position_years": float | None, "academy_years": float | None,
                      "army_years": float | None})  # fmt: skip


class RankIn(BaseModel):
    name: str
    short: str
    sort: int = 0


class SpecialtyIn(BaseModel):
    code: str
    title: str = ""
    old_code: str | None = None


class CabinetIn(BaseModel):
    number: str
    phone: str = ""


class HolidayIn(BaseModel):
    day: dt.date


class OrgUnitIn(BaseModel):
    name: str
    sort: int = 0


crud(router, "/ranks", m.Rank, RankIn, order_by=(m.Rank.sort,))
crud(router, "/specialties", m.ScienceSpecialty, SpecialtyIn, order_by=(m.ScienceSpecialty.code,))
crud(router, "/cabinets", m.Cabinet, CabinetIn, order_by=(m.Cabinet.number,))
crud(router, "/holidays", m.Holiday, HolidayIn, order_by=(m.Holiday.day,))
crud(router, "/org-units", m.OrgUnit, OrgUnitIn, order_by=(m.OrgUnit.sort,))
