"""Личный состав (лист Database): вводимые поля + расчётные на дату."""

from __future__ import annotations

import collections
import datetime as dt
from decimal import Decimal

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, model_validator
from sqlalchemy import func, select
from sqlalchemy.orm import selectinload

from ..calc import excel, names, personnel
from ..db import models as m
from ..integration.argus_sync import FIELDS as ARGUS_FIELDS
from ..integration.argus_sync import TITLES as ARGUS_TITLES
from .deps import DB, ReadDept, WriteDept

VACANT = "Вакантная"

router = APIRouter(prefix="/api/persons", tags=["личный состав"])

GP = "ГП"  # гражданский персонал: и вид, и «звание»


class PersonIn(BaseModel):
    kind: str = ""
    position_short: str = ""
    position_full: str = ""
    rank: str = ""
    full_name: str
    rate: Decimal | None = None
    personal_number: str = ""
    sex: str = ""
    birth_date: dt.date | None = None
    combat_veteran: str = ""
    service_start: dt.date | None = None
    service_bonus_days: int = 0
    extra_vacation_days: int = 0
    pmk: str = ""
    pps: str = ""
    degree: str = ""
    defense_date: str = ""
    science_code: str = ""
    academic_title: str = ""
    cabinet: str = ""
    phones: list[str] = []
    class_rating: str = ""
    class_start: dt.date | None = None
    class_term: int | None = None
    is_active: bool = True

    @model_validator(mode="after")
    def _rank_required(self):
        """Звание не бывает пустым: у гражданского персонала — «ГП», у военнослужащего — из справочника."""
        self.full_name = " ".join(self.full_name.split())
        if not self.full_name:
            raise ValueError("Укажите ФИО")
        if self.kind == GP or self.rank.strip().upper() == GP:
            self.kind, self.rank = GP, GP
        elif not self.rank.strip():
            raise ValueError("Укажите воинское звание (для гражданского персонала — «ГП»)")
        return self


class PersonOut(PersonIn):
    id: int
    argus_mid: int | None = None  # связан с АРГУСом: ФИО, звание и ПМК — оттуда, в карточке не меняются
    # расчётные (как в книге)
    rank_short: str
    short_name: str
    genitive: str
    initial_surname: str
    rank_and_name: str
    age: int | None
    service_years: float | None
    service_text: str | None
    vacation_days: float
    science_title: str
    work_phone: str
    duty_count: int
    detail_count: int
    class_end: dt.date | None


def _lookups(db, dept_id: int):
    ranks = [
        (r.name, r.short)
        for r in db.scalars(select(m.Rank).where(m.Rank.department_id == dept_id).order_by(m.Rank.sort))
    ]
    specs = [
        (s.code, s.title)
        for s in db.scalars(select(m.ScienceSpecialty).where(m.ScienceSpecialty.department_id == dept_id))
    ]
    cabs = [(c.number, c.phone) for c in db.scalars(select(m.Cabinet).where(m.Cabinet.department_id == dept_id))]
    duty = dict(db.execute(
        select(m.DutyEntry.person_id, func.count()).where(m.DutyEntry.department_id == dept_id,
                                                          m.DutyEntry.kind == m.DutyKind.DEPARTMENT)
        .group_by(m.DutyEntry.person_id)).all())  # fmt: skip
    detail = dict(db.execute(
        select(m.DutyEntry.person_id, func.count()).where(m.DutyEntry.department_id == dept_id,
                                                          m.DutyEntry.kind == m.DutyKind.DETAIL)
        .group_by(m.DutyEntry.person_id)).all())  # fmt: skip
    return ranks, specs, cabs, duty, detail


def to_out(p: m.Person, as_of: dt.date, lk) -> PersonOut:
    ranks, specs, cabs, duty, detail = lk
    short = names.short_name(p.full_name)
    rank_short = excel.index_match(p.rank, ranks)
    if p.service_periods:
        periods = [(sp.start, sp.end) for sp in p.service_periods]
        years = personnel.service_years_from_periods(periods, p.service_bonus_days, as_of)
        text = personnel.service_text_from_periods(periods, p.service_bonus_days, as_of)
    else:
        years = personnel.service_years(p.service_start, as_of)
        text = personnel.service_text(p.service_start, as_of)
    base = PersonIn.model_validate(p, from_attributes=True).model_dump()
    return PersonOut(
        **base,
        id=p.id,
        argus_mid=p.argus_mid,
        rank_short=str(rank_short or ""),
        short_name=short,
        genitive=names.genitive_case(p.full_name),
        initial_surname=names.initial_surname(p.full_name),
        rank_and_name=f"{rank_short} {short}" if rank_short else "",
        age=personnel.age(p.birth_date, as_of),
        service_years=years,
        service_text=text,
        vacation_days=personnel.vacation_days(p.kind, p.pps, years, p.extra_vacation_days),
        science_title=str(excel.index_match(p.science_code, specs) or ""),
        work_phone=str(excel.index_match(p.cabinet, cabs) or ""),
        duty_count=duty.get(p.id, 0),
        detail_count=detail.get(p.id, 0),
        class_end=personnel.class_end(p.class_start, p.class_term),
    )


@router.get("")
def list_persons(
    dept: ReadDept, db: DB, as_of: dt.date | None = None, include_inactive: bool = False
) -> list[PersonOut]:
    as_of = as_of or dt.date.today()
    q = (select(m.Person).options(selectinload(m.Person.service_periods))
         .where(m.Person.department_id == dept.id).order_by(m.Person.sort, m.Person.id))  # fmt: skip
    if not include_inactive:
        q = q.where(m.Person.is_active)
    lk = _lookups(db, dept.id)
    return [to_out(p, as_of, lk) for p in db.scalars(q)]


def _get(db, dept: m.Department, person_id: int) -> m.Person:
    p = db.get(m.Person, person_id)
    if not p or p.department_id != dept.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Нет такого человека")
    return p


@router.get("/suggest")
def suggest(dept: ReadDept, db: DB) -> dict:
    """Подсказки для карточки: варианты значений полей и типичные значения по сокращённой должности."""
    people = list(db.scalars(select(m.Person).where(m.Person.department_id == dept.id)))
    fields = ("position_short", "position_full", "combat_veteran", "pmk", "class_rating", "cabinet")
    values = {f: sorted({str(getattr(p, f)).strip() for p in people if str(getattr(p, f) or "").strip()},
                        key=str.lower) for f in fields}  # fmt: skip
    cabs = {c.number for c in db.scalars(select(m.Cabinet).where(m.Cabinet.department_id == dept.id)) if c.number}
    values["cabinet"] = sorted(set(values["cabinet"]) | cabs, key=str.lower)
    # по сокращённой должности — самые частые: полное название, вид, ППС
    by_pos: dict[str, dict[str, collections.Counter]] = {}
    for p in people:
        if p.position_short.strip():
            empty = {k: collections.Counter() for k in ("position_full", "kind", "pps")}
            d = by_pos.setdefault(p.position_short.strip(), empty)
            for k in d:
                d[k][getattr(p, k) or ""] += 1
    positions = {pos: {k: c.most_common(1)[0][0] for k, c in d.items()} for pos, d in by_pos.items()}
    return {"values": values, "positions": positions}


@router.get("/{person_id}")
def get_person(person_id: int, dept: ReadDept, db: DB, as_of: dt.date | None = None) -> PersonOut:
    return to_out(_get(db, dept, person_id), as_of or dt.date.today(), _lookups(db, dept.id))


@router.post("", status_code=201)
def create_person(data: PersonIn, dept: WriteDept, db: DB) -> PersonOut:
    sort = (db.scalar(select(func.max(m.Person.sort)).where(m.Person.department_id == dept.id)) or 0) + 1
    p = m.Person(department_id=dept.id, sort=sort, extra={}, **data.model_dump())
    db.add(p)
    db.commit()
    return to_out(p, dt.date.today(), _lookups(db, dept.id))


@router.put("/{person_id}")
def update_person(person_id: int, data: PersonIn, dept: WriteDept, db: DB) -> PersonOut:
    p = _get(db, dept, person_id)
    if p.argus_mid is not None:
        for f in ARGUS_FIELDS:
            if (getattr(data, f) or "") != (getattr(p, f) or ""):
                raise HTTPException(status.HTTP_409_CONFLICT,
                                    f"«{ARGUS_TITLES[f]}» берётся из АРГУСа — измените там и выполните сверку "
                                    "(или отвяжите человека в разделе «Сверка с АРГУСом»)")
    leaving = p.is_active and not data.is_active
    for k, v in data.model_dump().items():
        setattr(p, k, v)
    if leaving:
        release_positions(db, p.id)
    db.commit()
    return to_out(p, dt.date.today(), _lookups(db, dept.id))


def release_positions(db, person_id: int) -> None:
    """Человек убран из списков — его штатные должности освобождаются: единственный на должности становится
    «Вакантная», совместитель просто убирается, должность сверх штата удаляется."""
    q = select(m.PositionAssignment).options(selectinload(m.PositionAssignment.position)
                                             .selectinload(m.StaffPosition.assignments)).where(
        m.PositionAssignment.person_id == person_id)  # fmt: skip
    for a in db.scalars(q).all():
        pos = a.position
        if pos.out_of_staff and len(pos.assignments) == 1:
            db.delete(pos)
        elif len(pos.assignments) > 1:
            pos.assignments.remove(a)
        else:
            a.person_id, a.name_text, a.employment, a.contract_until, a.flags = None, VACANT, "", "", {}


@router.delete("/{person_id}", status_code=204)
def deactivate_person(person_id: int, dept: WriteDept, db: DB) -> None:
    """Не удаляем (история табеля и отпусков), а убираем из списков; штатная должность освобождается."""
    p = _get(db, dept, person_id)
    if p.is_active:
        release_positions(db, p.id)
    p.is_active = False
    db.commit()
