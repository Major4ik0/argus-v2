"""Штатное расписание и укомплектованность («Структура кафедры», «Сводная», «ИТОГ», «Прил. 1», «Ученые»)."""

from __future__ import annotations

import datetime as dt
from decimal import Decimal
from typing import Any

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .. import repo
from ..calc import itog, names, scientists, structure, svodnaya
from ..db import models as m
from .deps import DB, ReadDept, WriteDept

router = APIRouter(prefix="/api", tags=["штатное расписание"])

VACANT = "вакантная"


# --- дерево --------------------------------------------------------------------------------------------


class AssignmentIO(BaseModel):
    id: int | None = None
    person_id: int | None = None
    name_text: str = ""
    rate: Decimal | None = None
    employment: str = ""
    contract_until: str = ""
    count_degree: bool = True
    flags: dict[str, Any] = {}
    display_name: str = ""  # только в ответе


class PositionIO(BaseModel):
    id: int | None = None
    is_header: bool = False
    out_of_staff: bool = False  # сверх штата: в итоги не входит
    title: str = ""
    code: str = ""
    category: str = ""
    staff_number: str = ""
    vus: str = ""
    secrecy: str = ""
    rate: Decimal | None = None
    sort: int = 0
    assignments: list[AssignmentIO] = []


class UnitIO(BaseModel):
    id: int | None = None
    kind: m.UnitKind
    title: str
    people_manual: Decimal | None = None
    sort: int = 0
    positions: list[PositionIO] = []


def _units(db, dept_id: int) -> list[m.StaffUnit]:
    return list(db.scalars(
        select(m.StaffUnit)
        .options(selectinload(m.StaffUnit.positions).selectinload(m.StaffPosition.assignments))
        .where(m.StaffUnit.department_id == dept_id).order_by(m.StaffUnit.sort)))  # fmt: skip


@router.get("/staffing")
def get_staffing(dept: ReadDept, db: DB) -> list[UnitIO]:
    persons = {p.id: p.full_name for p in db.scalars(select(m.Person).where(m.Person.department_id == dept.id))}
    out = []
    for u in _units(db, dept.id):
        positions = []
        for p in u.positions:
            ass = [AssignmentIO(id=a.id, person_id=a.person_id, name_text=a.name_text, rate=a.rate,
                                employment=a.employment, contract_until=a.contract_until,
                                count_degree=a.count_degree, flags=a.flags,
                                display_name=persons.get(a.person_id, a.name_text))
                   for a in p.assignments]  # fmt: skip
            positions.append(PositionIO(id=p.id, is_header=p.is_header, out_of_staff=p.out_of_staff, title=p.title,
                                        code=p.code,
                                        category=p.category, staff_number=p.staff_number, vus=p.vus,
                                        secrecy=p.secrecy, rate=p.rate, sort=p.sort, assignments=ass))  # fmt: skip
        out.append(UnitIO(id=u.id, kind=u.kind, title=u.title, people_manual=u.people_manual, sort=u.sort,
                          positions=positions))  # fmt: skip
    return out


@router.put("/staffing/units/{unit_id}")
def save_unit(unit_id: int, data: UnitIO, dept: WriteDept, db: DB) -> dict:
    """Сохранить подразделение целиком (должности и назначения заменяются присланными)."""
    u = db.get(m.StaffUnit, unit_id)
    if not u or u.department_id != dept.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Подразделение не найдено")
    valid_persons = set(db.scalars(select(m.Person.id).where(m.Person.department_id == dept.id)))
    u.kind, u.title, u.people_manual, u.sort = data.kind, data.title, data.people_manual, data.sort
    u.positions.clear()
    db.flush()
    for i, p in enumerate(data.positions):
        pos = m.StaffPosition(is_header=p.is_header, out_of_staff=p.out_of_staff and not p.is_header, title=p.title,
                              code=p.code, category=p.category,
                              staff_number=p.staff_number, vus=p.vus, secrecy=p.secrecy, rate=p.rate,
                              sort=p.sort or i)  # fmt: skip
        for j, a in enumerate(p.assignments):
            if a.person_id is not None and a.person_id not in valid_persons:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Человек не из этой кафедры")
            pos.assignments.append(m.PositionAssignment(
                person_id=a.person_id, name_text=a.name_text, rate=a.rate, employment=a.employment,
                contract_until=a.contract_until, count_degree=a.count_degree, flags=a.flags, sort=j))  # fmt: skip
        u.positions.append(pos)
    db.commit()
    return {"ok": True}


# --- отчёт укомплектованности --------------------------------------------------------------------------


def structure_units(db, dept_id: int) -> list[tuple[m.StaffUnit, structure.Unit]]:
    persons = {p.id: p.full_name for p in db.scalars(select(m.Person).where(m.Person.department_id == dept_id))}
    out = []
    for u in _units(db, dept_id):
        slots = []
        for p in u.positions:
            if p.is_header or p.out_of_staff:  # сверх штата в укомплектованность не входит
                continue
            for i, a in enumerate(p.assignments or [None]):
                name = (persons.get(a.person_id) or a.name_text) if a else None
                rate = float(a.rate) if a and a.rate is not None else None
                slots.append(structure.Slot(numbered=i == 0, name=name, rate=rate))
        mil = u.kind in (m.UnitKind.PPS_MIL, m.UnitKind.LEADERSHIP)
        unit = structure.Unit(u.title, slots, people=float(u.people_manual) if u.people_manual is not None else None,
                              count_vacant_positions=mil)  # fmt: skip
        if mil:
            unit.people = structure.totals(unit).listed  # военнослужащие: «выполняют обязанности» = по списку
        out.append((u, unit))
    return out


class UnitTotalsOut(BaseModel):
    title: str
    kind: str
    positions: float
    people: float | None
    listed: float
    vacant: float
    pct: float
    pct_people: float | None
    staff_rates: float
    listed_rates: float


class ReportOut(BaseModel):
    as_of: dt.date
    svodnaya: dict[str, Any]
    itog: dict[str, Any]
    pril1: dict[str, Any]
    plan_years: list[int]
    units: list[UnitTotalsOut]
    department: UnitTotalsOut


@router.get("/staffing/report")
def staffing_report(dept: ReadDept, db: DB, as_of: dt.date | None = None) -> ReportOut:
    as_of = as_of or dt.date.today()
    rows = repo.svodnaya_rows(db, dept.id)
    ns = {sp.old_code: sp.code for sp in db.scalars(select(m.ScienceSpecialty)
                                                     .where(m.ScienceSpecialty.department_id == dept.id)) if sp.old_code}  # fmt: skip
    comp = svodnaya.compute(rows, as_of, ns)
    units = structure_units(db, dept.id)
    totals = [(u, structure.totals(x)) for u, x in units]

    def out(title, kind, t) -> UnitTotalsOut:
        return UnitTotalsOut(title=title, kind=kind, positions=t.positions, people=t.people, listed=t.listed,
                             vacant=t.vacant, pct=t.pct, pct_people=t.pct_people, staff_rates=t.staff_rates,
                             listed_rates=t.listed_rates)  # fmt: skip

    d = structure.department([t for _, t in totals])
    pps = [t for u, t in totals if u.kind in (m.UnitKind.PPS_MIL, m.UnitKind.PPS_CIV, m.UnitKind.LEADERSHIP)]
    plan_rows = list(
        db.scalars(select(m.PlanYear).where(m.PlanYear.department_id == dept.id).order_by(m.PlanYear.year))
    )
    plan = [(float(p.appointed), float(p.defended)) for p in plan_rows]
    pril = itog.pril1(sum(t.positions for t in pps), sum(t.people or 0 for t in pps), comp, plan)
    return ReportOut(
        as_of=as_of,
        plan_years=[p.year for p in plan_rows],
        svodnaya=comp.totals,
        itog=itog.itog(rows, comp),
        pril1=pril,
        units=[out(u.title, u.kind.value, t) for u, t in totals],
        department=out("За кафедру", "department", d),
    )


# --- учёные ------------------------------------------------------------------------------------------


@router.get("/scientists")
def get_scientists(dept: ReadDept, db: DB) -> dict[str, Any]:
    """Лист «Ученые»: ключи — ячейки книги (C2 «всего по списку» … C21 «оценка»)."""
    members = [scientists.Member(has_fio=bool(p.full_name), kind=p.kind, rate=float(p.rate) if p.rate is not None else None,
                                 pps=p.pps, degree=p.degree, title=p.academic_title)
               for p in db.scalars(select(m.Person).where(m.Person.department_id == dept.id, m.Person.is_active))]  # fmt: skip
    return {"values": scientists.compute(members)}


# --- вспомогательное для интерфейса -------------------------------------------------------------------------


@router.get("/persons-short")
def persons_short(dept: ReadDept, db: DB) -> list[dict]:
    """Список для выпадающих полей: id, «Фамилия И.О.», ФИО, вид, звание (полное и сокращённое; у ГП — «ГП»)."""
    ranks = {r.name.lower(): r.short for r in db.scalars(select(m.Rank).where(m.Rank.department_id == dept.id))}
    return [{"id": p.id, "short_name": names.short_name(p.full_name), "full_name": p.full_name, "kind": p.kind,
             "rank": p.rank, "rank_short": ranks.get(p.rank.lower(), p.rank)}
            for p in repo.people_ordered(db, dept.id)]  # fmt: skip
