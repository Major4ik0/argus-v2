"""Чтение данных из БД в виде входов для kafedra.calc (используется API и сквозными тестами)."""

from __future__ import annotations

import datetime as dt

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .calc import names, roster, svodnaya, timesheet, vacations
from .db import models as m


def people_ordered(s: Session, dept_id: int) -> list[m.Person]:
    """Люди табеля и графика отпусков: уникальные «Фамилия И.О.» в порядке справочника."""
    out, seen = [], set()
    for p in s.scalars(select(m.Person).where(m.Person.department_id == dept_id, m.Person.is_active)
                       .order_by(m.Person.sort, m.Person.id)):  # fmt: skip
        key = names.short_name(p.full_name).lower()
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def vacation_periods(s: Session, person_ids: list[int], year: int) -> dict[int, list]:
    plans = s.scalars(
        select(m.VacationPlan).options(selectinload(m.VacationPlan.parts))
        .where(m.VacationPlan.person_id.in_(person_ids), m.VacationPlan.year == year)
    )  # fmt: skip
    out: dict[int, list] = {}
    for pl in plans:
        parts = [vacations.Part(None, None)] * max([4, *(x.part_no for x in pl.parts)])
        for part in pl.parts:
            parts[part.part_no - 1] = vacations.Part(part.start, part.days)
        out[pl.person_id] = vacations.periods(parts, pl.road_part, pl.road_days)
    return out


def day_codes(s: Session, dept: m.Department, day: dt.date) -> dict[int, str]:
    """Код дня табеля для каждого человека: введённый, иначе «о» из графика отпусков (с даты автозаполнения)."""
    people = people_ordered(s, dept.id)
    ids = [p.id for p in people]
    manual = dict(s.execute(select(m.TimesheetEntry.person_id, m.TimesheetEntry.code)
                            .where(m.TimesheetEntry.person_id.in_(ids), m.TimesheetEntry.day == day)).all())  # fmt: skip
    autofill_from = dt.date.fromisoformat(dept.settings.get("timesheet_vacation_autofill_from", "1900-01-01"))
    periods = vacation_periods(s, ids, day.year) if day >= autofill_from else {}
    return {pid: timesheet.effective_code(manual.get(pid), vacations.is_on_vacation(day, periods.get(pid, [])))
            for pid in ids}  # fmt: skip


def roster_people(s: Session, dept: m.Department, day: dt.date) -> list[roster.Person]:
    """Люди для строевой записки на дату (поля Расход!C/D/E = вид, ППС, должность из справочника)."""
    codes = day_codes(s, dept, day)
    return [roster.Person(kind=p.kind, pps=p.pps, position=p.position_short, code=codes[p.id])
            for p in people_ordered(s, dept.id)]  # fmt: skip


SECTION = {m.UnitKind.PPS_MIL: svodnaya.Section.MIL, m.UnitKind.LEADERSHIP: svodnaya.Section.MIL,
           m.UnitKind.PPS_CIV: svodnaya.Section.CIV, m.UnitKind.AUX: svodnaya.Section.AUX}  # fmt: skip


def svodnaya_rows(s: Session, dept_id: int) -> list[svodnaya.Row]:
    """Строки отчёта «Сводная» из штатного расписания (порядок: подразделения → должности → назначения)."""
    units = s.scalars(
        select(m.StaffUnit)
        .options(selectinload(m.StaffUnit.positions).selectinload(m.StaffPosition.assignments))
        .where(m.StaffUnit.department_id == dept_id).order_by(m.StaffUnit.sort)
    ).all()  # fmt: skip
    persons = {p.id: p for p in s.scalars(
        select(m.Person).options(selectinload(m.Person.teaching_periods)).where(m.Person.department_id == dept_id))}  # fmt: skip
    old_codes = {sp.code: sp.old_code for sp in s.scalars(select(m.ScienceSpecialty)
                                                           .where(m.ScienceSpecialty.department_id == dept_id))}  # fmt: skip
    rows: list[svodnaya.Row] = []
    for u in units:
        sec = SECTION[u.kind]
        for pos in u.positions:
            if pos.out_of_staff:  # сверх штата — в «Сводной» нет
                continue
            if pos.is_header:
                rows.append(svodnaya.Row(section=sec, category=None, name=pos.title))
                continue
            for i, a in enumerate(pos.assignments or [None]):
                p = persons.get(a.person_id) if a else None
                done = [tp for tp in (p.teaching_periods if p else []) if tp.end]
                current = next((tp.start for tp in (p.teaching_periods if p else []) if tp.end is None), None)
                rows.append(svodnaya.Row(
                    section=sec,
                    category=pos.category if i == 0 else None,
                    name=(p.full_name if p else a.name_text) if a else None,
                    rate=float(a.rate) if a and a.rate is not None else None,
                    place=a.employment if a else None,
                    code=pos.code if i == 0 else None,
                    birth=p.birth_date if p else None,
                    ped=[(tp.start, tp.end) for tp in done],
                    ped_current=current,
                    degree=(p.degree.upper() if p and p.degree else None),
                    ns_old=old_codes.get(p.science_code) if p and p.science_code else None,
                    flags=dict(a.flags) if a else {},
                    count_degree=a.count_degree if a else True,
                ))  # fmt: skip
    return rows
