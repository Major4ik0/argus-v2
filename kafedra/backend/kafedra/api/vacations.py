"""График отпусков (лист «Отпуска») и статистика дежурств/нарядов по месяцам (лист «Расчетный» U:AJ)."""

from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from .. import repo
from ..calc import duty, names, personnel, vacations
from ..db import models as m
from .deps import DB, ReadDept, WriteDept

router = APIRouter(prefix="/api", tags=["отпуска и дежурства"])


VACATION_PARTS = 4  # частей отпуска в книге
MAX_VACATION_PARTS = 10


def vacation_parts(dept: m.Department) -> int:
    """Сколько частей отпуска показывать: 4 как в книге или больше, если кафедра добавила."""
    return max(VACATION_PARTS, int(dept.settings.get("vacation_parts", VACATION_PARTS)))


class PartIn(BaseModel):
    part_no: int = Field(ge=1, le=MAX_VACATION_PARTS)
    start: dt.date | None = None
    days: int | None = Field(default=None, ge=0, le=365)


class PartOut(PartIn):
    end: dt.date | None


class PlanIn(BaseModel):
    road_part: int | None = Field(default=None, ge=1, le=MAX_VACATION_PARTS)
    road_days: int | None = Field(default=None, ge=0, le=60)
    parts: list[PartIn] = []


class PlanOut(BaseModel):
    person_id: int
    short_name: str
    position: str
    service_text: str | None
    entitled: float  # положено суток (Database!U)
    road_part: int | None
    road_days: int | None
    parts: list[PartOut]
    planned_days: int


def _service(p: m.Person, as_of: dt.date) -> tuple[float | None, str | None]:
    if p.service_periods:
        pr = [(s.start, s.end) for s in p.service_periods]
        return (personnel.service_years_from_periods(pr, p.service_bonus_days, as_of),
                personnel.service_text_from_periods(pr, p.service_bonus_days, as_of))  # fmt: skip
    return personnel.service_years(p.service_start, as_of), personnel.service_text(p.service_start, as_of)


@router.get("/vacations")
def list_vacations(dept: ReadDept, db: DB, year: int, as_of: dt.date | None = None) -> list[PlanOut]:
    as_of = as_of or dt.date.today()
    people = repo.people_ordered(db, dept.id)
    db.scalars(select(m.Person).options(selectinload(m.Person.service_periods))
               .where(m.Person.id.in_([p.id for p in people]))).all()  # fmt: skip
    plans = {pl.person_id: pl for pl in db.scalars(
        select(m.VacationPlan).options(selectinload(m.VacationPlan.parts))
        .where(m.VacationPlan.person_id.in_([p.id for p in people]), m.VacationPlan.year == year))}  # fmt: skip
    n_parts = vacation_parts(dept)
    out = []
    for p in people:
        pl = plans.get(p.id)
        parts = {pt.part_no: pt for pt in (pl.parts if pl else [])}
        road_part, road_days = (pl.road_part, pl.road_days) if pl else (None, None)
        part_out = []
        for no in range(1, max([n_parts, *parts]) + 1):
            pt = parts.get(no)
            calc_part = vacations.Part(pt.start if pt else None, pt.days if pt else None)
            part_out.append(PartOut(part_no=no, start=calc_part.start, days=calc_part.days,
                                    end=vacations.part_end(calc_part, no, road_part, road_days)))  # fmt: skip
        years, text = _service(p, as_of)
        out.append(PlanOut(
            person_id=p.id, short_name=names.short_name(p.full_name), position=p.position_short, service_text=text,
            entitled=personnel.vacation_days(p.kind, p.pps, years, p.extra_vacation_days),
            road_part=road_part, road_days=road_days, parts=part_out,
            planned_days=sum(x.days or 0 for x in part_out),
        ))  # fmt: skip
    return out


@router.put("/vacations/{person_id}/{year}")
def save_plan(person_id: int, year: int, data: PlanIn, dept: WriteDept, db: DB) -> dict:
    p = db.get(m.Person, person_id)
    if not p or p.department_id != dept.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Нет такого человека")
    pl = db.scalar(select(m.VacationPlan).where(m.VacationPlan.person_id == person_id, m.VacationPlan.year == year))
    if pl is None:
        pl = m.VacationPlan(person_id=person_id, year=year)
        db.add(pl)
    n_parts = vacation_parts(dept)
    if any(x.part_no > n_parts and (x.start or x.days) for x in data.parts) or (data.road_part or 0) > n_parts:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"У кафедры {n_parts} частей отпуска — добавьте столбец")
    pl.road_part, pl.road_days = data.road_part, data.road_days
    pl.parts.clear()
    db.flush()
    for part in data.parts:
        if part.start or part.days:
            pl.parts.append(m.VacationPart(part_no=part.part_no, start=part.start, days=part.days))
    db.commit()
    return {"ok": True}


class DutyStatOut(BaseModel):
    person_id: int
    short_name: str
    before: int  # до начала года
    months: list[int]  # январь…декабрь
    total: int


@router.get("/duty/stats")
def duty_stats(dept: ReadDept, db: DB, year: int, kind: m.DutyKind = m.DutyKind.DEPARTMENT) -> list[DutyStatOut]:
    """Расчетный!V:AI — дежурства (kind=department) или наряды (kind=detail) по месяцам."""
    entries = list(db.execute(select(m.DutyEntry.day, m.DutyEntry.person_id)
                              .where(m.DutyEntry.department_id == dept.id, m.DutyEntry.kind == kind)).all())  # fmt: skip
    out = []
    for p in repo.people_ordered(db, dept.id):
        mine = [(d, "x") for d, pid in entries if pid == p.id]
        before = duty.count_for(mine, "x", None, dt.date(year - 1, 12, 31))
        months = []
        for mo in range(1, 13):
            start = dt.date(year, mo, 1)
            end = dt.date(year + (mo == 12), mo % 12 + 1, 1) - dt.timedelta(days=1)
            months.append(duty.count_for(mine, "x", start, end))
        out.append(DutyStatOut(person_id=p.id, short_name=names.short_name(p.full_name), before=before,
                               months=months, total=before + sum(months)))  # fmt: skip
    return out
