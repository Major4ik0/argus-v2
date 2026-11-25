"""Наряды подразделений («Стат»), «Обязанности», настройки строевой записки."""

from __future__ import annotations

import calendar
import datetime as dt
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.orm import selectinload

from .. import repo
from ..calc import duty, names, roster, stats
from ..db import models as m
from . import timesheet as ts_api
from . import vacations as vac_api
from .deps import DB, ReadDept, WriteDept

router = APIRouter(prefix="/api", tags=["наряды подразделений, обязанности, настройки"])

DUTY_TYPES = ["ДА", "ПДА", "НДС", "ДПГ", "П79", "СтПУ"]


# --- «Стат» -------------------------------------------------------------------------------------------


@router.get("/unit-duty")
def unit_duty(dept: ReadDept, db: DB, year: int, month: int) -> dict[str, Any]:
    n = calendar.monthrange(year, month)[1]
    days = [dt.date(year, month, d) for d in range(1, n + 1)]
    units = {u.id: u.name for u in db.scalars(select(m.OrgUnit).where(m.OrgUnit.department_id == dept.id)
                                               .order_by(m.OrgUnit.sort))}  # fmt: skip
    entries = db.scalars(select(m.UnitDutyEntry).where(m.UnitDutyEntry.department_id == dept.id,
                                                        m.UnitDutyEntry.day.between(days[0], days[-1])))  # fmt: skip
    grid: dict[dt.date, dict[str, str]] = {d: {} for d in days}
    for e in entries:
        grid[e.day][e.duty_type] = units.get(e.unit_id, e.unit_text)
    counts = []
    for name in units.values():
        row = {"unit": name, "by_type": {}}
        for t in DUTY_TYPES:
            row["by_type"][t] = stats.unit_counts([(d, grid[d].get(t)) for d in days], name)
        row["total"] = sum(v[0] for v in row["by_type"].values())
        row["weekend"] = sum(v[1] for v in row["by_type"].values())
        counts.append(row)
    return {
        "types": DUTY_TYPES,
        "units": list(units.values()),
        "days": [
            {"day": d, "weekday": duty.weekday_short(d), "weekend": stats.weekend_mark(d) != "", "entries": grid[d]}
            for d in days
        ],  # fmt: skip
        "counts": counts,
    }


class UnitDutyIn(BaseModel):
    unit: str = ""


@router.put("/unit-duty/{day}/{duty_type}")
def set_unit_duty(day: dt.date, duty_type: str, data: UnitDutyIn, dept: WriteDept, db: DB) -> dict:
    if duty_type not in DUTY_TYPES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Вид наряда: {', '.join(DUTY_TYPES)}")
    db.execute(delete(m.UnitDutyEntry).where(m.UnitDutyEntry.department_id == dept.id, m.UnitDutyEntry.day == day,
                                             m.UnitDutyEntry.duty_type == duty_type))  # fmt: skip
    if data.unit.strip():
        u = db.scalar(select(m.OrgUnit).where(m.OrgUnit.department_id == dept.id, m.OrgUnit.name == data.unit.strip()))
        if u is None:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Подразделение не из списка")
        db.add(m.UnitDutyEntry(department_id=dept.id, day=day, duty_type=duty_type, unit_id=u.id))
    db.commit()
    return {"ok": True}


# --- «Обязанности» ----------------------------------------------------------------------------------------


class MemberIO(BaseModel):
    id: int | None = None
    person_id: int | None = None
    rank_text: str = ""
    name_text: str = ""
    period1_start: dt.date | None = None
    period1_days: int | None = None
    period2_start: dt.date | None = None
    period2_days: int | None = None
    display_name: str = ""  # только в ответе
    period1_end: dt.date | None = None  # только в ответе
    period2_end: dt.date | None = None  # только в ответе


class ListIO(BaseModel):
    id: int | None = None
    section: m.AssignmentSection
    title: str
    duty_type: str = ""  # только для суточного наряда: вид наряда в графике дежурств
    sort: int = 0
    members: list[MemberIO] = []


@router.get("/assignments")
def list_assignments(dept: ReadDept, db: DB) -> list[ListIO]:
    persons = {
        p.id: names.short_name(p.full_name)
        for p in db.scalars(select(m.Person).where(m.Person.department_id == dept.id))
    }
    lists = db.scalars(select(m.AssignmentList).options(selectinload(m.AssignmentList.members))
                       .where(m.AssignmentList.department_id == dept.id)
                       .order_by(m.AssignmentList.section, m.AssignmentList.sort))  # fmt: skip
    return [ListIO(id=lst.id, section=lst.section, title=lst.title, duty_type=lst.duty_type, sort=lst.sort, members=[
        MemberIO(id=x.id, person_id=x.person_id, rank_text=x.rank_text, name_text=x.name_text,
                 period1_start=x.period1_start, period1_days=x.period1_days, period2_start=x.period2_start,
                 period2_days=x.period2_days, display_name=persons.get(x.person_id, x.name_text),
                 period1_end=duty.period_end(x.period1_start, x.period1_days),
                 period2_end=duty.period_end(x.period2_start, x.period2_days)) for x in lst.members])
            for lst in lists]  # fmt: skip


@router.post("/assignments", status_code=201)
def create_list(data: ListIO, dept: WriteDept, db: DB) -> dict:
    lst = m.AssignmentList(department_id=dept.id, section=data.section, title=data.title, sort=data.sort,
                           duty_type=data.duty_type.strip())  # fmt: skip
    _fill_members(lst, data, db, dept)
    db.add(lst)
    db.commit()
    return {"id": lst.id}


@router.put("/assignments/{list_id}")
def save_list(list_id: int, data: ListIO, dept: WriteDept, db: DB) -> dict:
    lst = db.get(m.AssignmentList, list_id)
    if not lst or lst.department_id != dept.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Список не найден")
    lst.section, lst.title, lst.sort, lst.duty_type = data.section, data.title, data.sort, data.duty_type.strip()
    lst.members.clear()
    db.flush()
    _fill_members(lst, data, db, dept)
    db.commit()
    return {"ok": True}


@router.delete("/assignments/{list_id}", status_code=204)
def delete_list(list_id: int, dept: WriteDept, db: DB) -> None:
    lst = db.get(m.AssignmentList, list_id)
    if lst and lst.department_id == dept.id:
        db.delete(lst)
        db.commit()


def _fill_members(lst: m.AssignmentList, data: ListIO, db, dept) -> None:
    valid = set(db.scalars(select(m.Person.id).where(m.Person.department_id == dept.id)))
    for i, x in enumerate(data.members):
        if x.person_id is not None and x.person_id not in valid:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Человек не из этой кафедры")
        lst.members.append(m.AssignmentMember(
            person_id=x.person_id, rank_text=x.rank_text, name_text=x.name_text, period1_start=x.period1_start,
            period1_days=x.period1_days, period2_start=x.period2_start, period2_days=x.period2_days, sort=i))  # fmt: skip


# --- настройки строевой записки ----------------------------------------------------------------------------


@router.get("/settings/roster-staff")
def get_roster_staff(dept: ReadDept) -> dict[str, Any]:
    """«По штату» — числа, вводимые вручную, по вариантам записки.

    list_a («по списку, офицеры ППС» записки 6, как в книге) хранится, но больше не используется — считается по табелю.
    """
    return {"variants": [v.value for v in roster.Variant], "values": dept.settings.get("roster_staff", {})}


@router.put("/settings/roster-staff")
def set_roster_staff(data: dict[str, dict[str, int | None]], dept: WriteDept, db: DB) -> dict:
    allowed = {v.value for v in roster.Variant}
    if not set(data) <= allowed or any(set(v) - {"a", "b", "c", "list_a"} for v in data.values()):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неизвестный вариант записки или поле")
    dept.settings = {**dept.settings, "roster_staff": {**dept.settings.get("roster_staff", {}), **data}}
    db.commit()
    return {"ok": True}


# Прочие числа печатной записки, которые в книге вводят руками прямо в форме: «сержанты», оружие, ВиВТ и
# пустые колонки вариантов только с офицерами. Хранятся по варианту → строке → колонке.
ROSTER_COLUMNS = {"офицеры", "сержанты", "ГП", "офицеры ППС", "ГП ППС", "ГП ИТС", "пистолеты", "карабины",
                  "ручные пулеметы", "ротные пулеметы", "БМП-2", "БТР-80", "танки"}  # fmt: skip


@router.get("/settings/roster-cells")
def get_roster_cells(dept: ReadDept) -> dict[str, Any]:
    return dept.settings.get("roster_cells", {})


@router.put("/settings/roster-cells")
def set_roster_cells(data: dict[str, dict[str, dict[str, float | None]]], dept: WriteDept, db: DB) -> dict:
    """Частичное обновление: присланные клетки заменяются, null — очистить клетку."""
    variants = {v.value for v in roster.Variant}
    cur = {v: {r: dict(c) for r, c in rows.items()} for v, rows in dept.settings.get("roster_cells", {}).items()}
    for v, rows in data.items():
        bad_cols = any(set(c) - ROSTER_COLUMNS for c in rows.values())
        if v not in variants or not set(rows) <= set(roster.ROWS) or bad_cols:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Неизвестный вариант записки, строка или колонка")
        for r, cells in rows.items():
            row = cur.setdefault(v, {}).setdefault(r, {})
            for col, val in cells.items():
                if val is None:
                    row.pop(col, None)
                else:
                    row[col] = val
    dept.settings = {**dept.settings, "roster_cells": cur}
    db.commit()
    return {"ok": True}


# --- подпись под строевой запиской (как на листе «Сводная», AI107/AH109/AK109) ---------------------------

HEAD_CODES = ("нк",)  # краткая должность начальника кафедры


def default_head_title(dept_name: str) -> str:
    """«12 кафедра» → «Начальник 12 кафедры»."""
    name = dept_name.strip()
    if name.lower().endswith("кафедра"):
        name = name[:-1] + "ы"
    return f"Начальник {name}"


def head_of_department(db, dept_id: int) -> m.Person | None:
    """Начальник кафедры из личного состава: краткая должность «НК» или полная «Начальник кафедры…»."""
    people = repo.people_ordered(db, dept_id)
    for p in people:
        if p.position_short.strip().lower() in HEAD_CODES:
            return p
    for p in people:
        if p.position_full.strip().lower().startswith("начальник кафедры"):
            return p
    return None


class SignatureIO(BaseModel):
    title: str = ""  # «Начальник 12 кафедры»
    subtitle: str = ""  # «(оценки эффективности боевых действий)»
    person_id: int | None = None  # кто подписывает; пусто — начальник кафедры из личного состава


@router.get("/settings/roster-signature")
def get_signature(dept: ReadDept, db: DB) -> dict[str, Any]:
    s = dept.settings.get("roster_signature", {})
    pid = s.get("person_id")
    p = db.get(m.Person, pid) if pid else None
    if p is None or p.department_id != dept.id:
        pid, p = None, head_of_department(db, dept.id)
    return {
        "title": s.get("title") or default_head_title(dept.name),
        "subtitle": s.get("subtitle", ""),
        "person_id": pid,  # выбран вручную (null — подставлен сам)
        "auto_person_id": p.id if p and pid is None else None,
        "rank": (p.rank or "").strip().lower() if p and (p.rank or "").upper() != "ГП" else "",
        "name": names.initial_surname(p.full_name).strip() if p else "",
    }


@router.put("/settings/roster-signature")
def set_signature(data: SignatureIO, dept: WriteDept, db: DB) -> dict:
    if data.person_id is not None:
        p = db.get(m.Person, data.person_id)
        if not p or p.department_id != dept.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Человек не из этой кафедры")
    title = data.title.strip()
    dept.settings = {**dept.settings, "roster_signature": {
        "title": "" if title == default_head_title(dept.name) else title,
        "subtitle": data.subtitle.strip(), "person_id": data.person_id}}  # fmt: skip
    db.commit()
    return {"ok": True}


# --- сколько столбцов нарядов в графике дежурств и частей в графике отпусков ---------------------------


class ColumnsIO(BaseModel):
    duty_detail_slots: int
    vacation_parts: int


@router.get("/settings/columns")
def get_columns(dept: ReadDept) -> ColumnsIO:
    return ColumnsIO(duty_detail_slots=ts_api.detail_slots(dept), vacation_parts=vac_api.vacation_parts(dept))


@router.put("/settings/columns")
def set_columns(data: ColumnsIO, dept: WriteDept, db: DB) -> ColumnsIO:
    """Добавить или убрать столбцы.

    Меньше, чем в книге (3 наряда, 4 части), нельзя; убрать можно только пустой столбец.
    """
    if not ts_api.DETAIL_SLOTS <= data.duty_detail_slots <= ts_api.MAX_DETAIL_SLOTS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"Столбцов нарядов — от {ts_api.DETAIL_SLOTS} до {ts_api.MAX_DETAIL_SLOTS}")  # fmt: skip
    if not vac_api.VACATION_PARTS <= data.vacation_parts <= vac_api.MAX_VACATION_PARTS:
        lo, hi = vac_api.VACATION_PARTS, vac_api.MAX_VACATION_PARTS
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Частей отпуска — от {lo} до {hi}")
    q = select(func.max(m.DutyEntry.slot)).where(m.DutyEntry.department_id == dept.id,
                                                 m.DutyEntry.kind == m.DutyKind.DETAIL)  # fmt: skip
    used_slot = db.scalar(q) or 0
    if data.duty_detail_slots < used_slot:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            f"В столбце «Наряд {used_slot}» есть записи — сначала очистите его")  # fmt: skip
    used_part = db.scalar(
        select(func.max(m.VacationPart.part_no)).join(m.VacationPlan, m.VacationPart.plan_id == m.VacationPlan.id)
        .join(m.Person, m.VacationPlan.person_id == m.Person.id).where(m.Person.department_id == dept.id)
    ) or 0  # fmt: skip
    used_part = max(used_part, db.scalar(
        select(func.max(m.VacationPlan.road_part)).join(m.Person, m.VacationPlan.person_id == m.Person.id)
        .where(m.Person.department_id == dept.id)) or 0)  # fmt: skip
    if data.vacation_parts < used_part:
        raise HTTPException(status.HTTP_409_CONFLICT, f"В части {used_part} отпуска есть записи — сначала очистите её")
    dept.settings = {**dept.settings, "duty_detail_slots": data.duty_detail_slots,
                     "vacation_parts": data.vacation_parts}  # fmt: skip
    db.commit()
    return data
