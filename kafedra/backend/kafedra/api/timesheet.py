"""Табель, строевая записка, дежурства."""

from __future__ import annotations

import calendar
import datetime as dt

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select

from .. import repo
from ..calc import duty as duty_calc
from ..calc import names, roster, timesheet, vacations
from ..db import models as m
from .deps import DB, ReadDept, WriteDept

router = APIRouter(prefix="/api", tags=["табель и строевая записка"])


def holidays(db, dept_id: int) -> list[dt.date]:
    return list(db.scalars(select(m.Holiday.day).where(m.Holiday.department_id == dept_id)))


class DayOut(BaseModel):
    day: dt.date
    day_off: bool


class RowOut(BaseModel):
    person_id: int
    short_name: str
    kind: str
    pps: str
    position: str
    codes: dict[str, str]  # «ГГГГ-ММ-ДД» → код
    auto: list[str]  # дни, где код подставлен из графика отпусков
    absences: int  # дней отсутствия с начала года по дату (NI)
    absence_share: float | None  # % отрыва (NJ)


class TimesheetOut(BaseModel):
    year: int
    month: int
    days: list[DayOut]
    rows: list[RowOut]
    codes: dict[str, str]


@router.get("/timesheet")
def get_timesheet(dept: ReadDept, db: DB, year: int, month: int, as_of: dt.date | None = None) -> TimesheetOut:
    as_of = as_of or dt.date.today()
    hol = holidays(db, dept.id)
    n = calendar.monthrange(year, month)[1]
    days = [dt.date(year, month, d) for d in range(1, n + 1)]
    year_days = [
        dt.date(year, 1, 1) + dt.timedelta(days=i)
        for i in range((dt.date(year, 12, 31) - dt.date(year, 1, 1)).days + 1)
    ]
    people = repo.people_ordered(db, dept.id)
    ids = [p.id for p in people]
    entries: dict[int, dict[dt.date, str]] = {}
    for e in db.scalars(select(m.TimesheetEntry).where(m.TimesheetEntry.person_id.in_(ids),
                                                        m.TimesheetEntry.day.between(year_days[0], year_days[-1]))):  # fmt: skip
        entries.setdefault(e.person_id, {})[e.day] = e.code
    periods = repo.vacation_periods(db, ids, year)
    autofill_from = dt.date.fromisoformat(dept.settings.get("timesheet_vacation_autofill_from", "1900-01-01"))
    end = min(as_of, dt.date(year, 12, 31))
    workdays = timesheet.working_days(dt.date(year, 1, 1), end, hol) if end >= dt.date(year, 1, 1) else 0
    rows = []
    for p in people:
        manual = entries.get(p.id, {})
        eff, auto = {}, []
        for d in year_days:
            on_vac = d >= autofill_from and vacations.is_on_vacation(d, periods.get(p.id, []))
            code = timesheet.effective_code(manual.get(d), on_vac)
            eff[d] = code
            if code and d not in manual and d.month == month:
                auto.append(d.isoformat())
        absent = timesheet.absences(eff, year_days, hol, as_of)
        rows.append(RowOut(
            person_id=p.id, short_name=names.short_name(p.full_name), kind=p.kind, pps=p.pps,
            position=p.position_short, codes={d.isoformat(): eff[d] for d in days if eff[d]}, auto=auto,
            absences=absent, absence_share=timesheet.absence_share(absent, workdays),
        ))  # fmt: skip
    return TimesheetOut(year=year, month=month, days=[DayOut(day=d, day_off=timesheet.is_day_off(d, hol)) for d in days],
                        rows=rows, codes=timesheet.CODES)  # fmt: skip


class CodeIn(BaseModel):
    code: str = Field(default="", max_length=8)


@router.put("/timesheet/{person_id}/{day}")
def set_code(person_id: int, day: dt.date, data: CodeIn, dept: WriteDept, db: DB) -> dict:
    p = db.get(m.Person, person_id)
    if not p or p.department_id != dept.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Нет такого человека")
    code = data.code.strip()
    if not code:
        # «на лицо» в день из графика отпусков: пустая клетка снова показала бы «о», поэтому пишем «+»
        autofill_from = dt.date.fromisoformat(dept.settings.get("timesheet_vacation_autofill_from", "1900-01-01"))
        periods = repo.vacation_periods(db, [person_id], day.year).get(person_id, [])
        if day >= autofill_from and vacations.is_on_vacation(day, periods):
            code = "+"
    db.execute(delete(m.TimesheetEntry).where(m.TimesheetEntry.person_id == person_id, m.TimesheetEntry.day == day))
    if code:
        db.add(m.TimesheetEntry(person_id=person_id, day=day, code=code))
    db.commit()
    return {"ok": True}


# --- строевая записка --------------------------------------------------------------------------------


class FormOut(BaseModel):
    variant: str
    title: str  # полное название варианта
    caption: str
    listed: int
    present: int
    absent: int
    by_code: dict[str, int]
    check: str
    table: dict[str, dict[str, float | None]]
    causes: dict[str, str]
    lists: dict[str, list[str]]  # код причины → «звание Фамилия И.О.»


@router.get("/roster")
def get_roster(dept: ReadDept, db: DB, day: dt.date | None = None) -> list[FormOut]:
    day = day or dt.date.today()
    people_db = repo.people_ordered(db, dept.id)
    codes = repo.day_codes(db, dept, day)
    ranks = {r.name.lower(): r.short for r in db.scalars(select(m.Rank).where(m.Rank.department_id == dept.id))}
    people = [roster.Person(kind=p.kind, pps=p.pps, position=p.position_short, code=codes[p.id]) for p in people_db]
    counts = {v: roster.count(v, people) for v in roster.Variant}
    six = roster.six_groups(people)
    six_total = roster.count_group(people, roster.six_member)
    staff = dept.settings.get("roster_staff", {})
    out = []
    for v in roster.Variant:
        c = roster.form_counts(v, counts, six_total)
        lists: dict[str, list[str]] = {code: [] for code in roster.CAUSES}
        for p_db, p in zip(people_db, people, strict=True):
            if roster.form_member(v, p) and p.code in lists:
                lists[p.code].append(f"{ranks.get(p_db.rank.lower(), '')} {names.short_name(p_db.full_name)}".strip())
        out.append(FormOut(variant=v.value, title=roster.TITLES[v], caption=roster.caption(day), listed=c.listed,
                           present=c.present, absent=c.absent, by_code=c.by_code, check=c.check,
                           table=roster.form_table(v, counts, staff.get(v.value, {}), six),
                           causes=roster.causes_line(c), lists=lists))  # fmt: skip
    return out


# --- дежурства -----------------------------------------------------------------------------------------


class DutyOut(BaseModel):
    day: dt.date
    weekday: str
    kind: str
    slot: int
    person_id: int | None
    name: str
    detail_type: str
    rank_short: str = ""  # Дежурства!D
    cabinet: str = ""  # Дежурства!F
    phone: str = ""  # Дежурства!G


@router.get("/duty")
def list_duty(dept: ReadDept, db: DB, date_from: dt.date, date_to: dt.date) -> list[DutyOut]:
    persons = {p.id: p for p in db.scalars(select(m.Person).where(m.Person.department_id == dept.id))}
    ranks = {r.name.lower(): r.short for r in db.scalars(select(m.Rank).where(m.Rank.department_id == dept.id))}
    phones = {c.number: c.phone for c in db.scalars(select(m.Cabinet).where(m.Cabinet.department_id == dept.id))}
    q = (select(m.DutyEntry).where(m.DutyEntry.department_id == dept.id, m.DutyEntry.day.between(date_from, date_to))
         .order_by(m.DutyEntry.day, m.DutyEntry.kind, m.DutyEntry.slot))  # fmt: skip
    out = []
    for e in db.scalars(q):
        p = persons.get(e.person_id)
        out.append(DutyOut(
            day=e.day, weekday=duty_calc.weekday_short(e.day), kind=e.kind.value, slot=e.slot, person_id=e.person_id,
            name=names.short_name(p.full_name) if p else e.name_text, detail_type=e.detail_type,
            rank_short=ranks.get(p.rank.lower(), "") if p else "", cabinet=p.cabinet if p else "",
            phone=phones.get(p.cabinet, "") if p else "",
        ))  # fmt: skip
    return out


DETAIL_SLOTS = 3  # столбцов нарядов в книге (Дежурства!H/J/L)
MAX_DETAIL_SLOTS = 10


def detail_slots(dept: m.Department) -> int:
    """Сколько столбцов нарядов в графике: 3 как в книге или больше, если кафедра добавила."""
    return max(DETAIL_SLOTS, int(dept.settings.get("duty_detail_slots", DETAIL_SLOTS)))


class DutyIn(BaseModel):
    kind: m.DutyKind = m.DutyKind.DEPARTMENT
    slot: int = Field(default=1, ge=1, le=MAX_DETAIL_SLOTS)
    person_id: int | None = None
    name_text: str = ""
    detail_type: str = ""


DETAIL_CODE = "н"  # код табеля «Наряд»
FREE_CODES = ("", timesheet.PRESENT, DETAIL_CODE)  # такие клетки табеля наряд может переписать


def person_duty_types(db, dept_id: int) -> dict[int, str]:
    """Вид наряда по умолчанию для человека — из первой группы «Суточного наряда» («Обязанности»), где он есть."""
    q = (select(m.AssignmentMember.person_id, m.AssignmentList.duty_type)
         .join(m.AssignmentList, m.AssignmentMember.list_id == m.AssignmentList.id)
         .where(m.AssignmentList.department_id == dept_id,
                m.AssignmentList.section == m.AssignmentSection.DAILY_DUTY,
                m.AssignmentList.duty_type != "", m.AssignmentMember.person_id.is_not(None))
         .order_by(m.AssignmentList.sort, m.AssignmentMember.sort))  # fmt: skip
    out: dict[int, str] = {}
    for pid, code in db.execute(q):
        out.setdefault(pid, code)
    return out


def _timesheet_code(db, person_id: int, day: dt.date) -> m.TimesheetEntry | None:
    q = select(m.TimesheetEntry).where(m.TimesheetEntry.person_id == person_id, m.TimesheetEntry.day == day)
    return db.scalar(q)


def _sync_detail_marks(db, dept_id: int, person_id: int, days) -> list[tuple[dt.date, str]]:
    """Привести отметки «н» в табеле за эти дни к графику: день в наряде, если человек заступил в него
    в этот день или накануне. Занятые другим кодом дни («о», «б»…) не трогаем — возвращаем их."""
    busy = []
    for d in days:
        covered = db.scalar(select(m.DutyEntry.id).where(
            m.DutyEntry.department_id == dept_id, m.DutyEntry.kind == m.DutyKind.DETAIL,
            m.DutyEntry.person_id == person_id, m.DutyEntry.day.in_((d, d - dt.timedelta(days=1)))).limit(1))
        e = _timesheet_code(db, person_id, d)
        if covered:
            if e is None:
                db.add(m.TimesheetEntry(person_id=person_id, day=d, code=DETAIL_CODE))
            elif e.code in FREE_CODES:
                e.code = DETAIL_CODE
            else:
                busy.append((d, e.code))
        elif e is not None and e.code == DETAIL_CODE:
            db.delete(e)
    db.flush()
    return busy


@router.put("/duty/{day}")
def set_duty(day: dt.date, data: DutyIn, dept: WriteDept, db: DB) -> dict:
    """Назначить дежурного по кафедре (kind=department) или наряд (kind=detail, slot 1–3); пусто — снять.

    Наряд (не дежурство по кафедре) суточный: в табеле кодом «н» отмечаются день заступления и следующий день,
    снятие наряда эти отметки убирает (если человек не в наряде накануне или в тот же день по другому столбцу).
    Новому человеку в наряде вид наряда ставится из его группы суточного наряда; потом его можно поменять.
    """
    if data.kind is m.DutyKind.DETAIL and data.slot > detail_slots(dept):
        n = detail_slots(dept)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"В графике {n} столбцов нарядов — добавьте столбец")
    p = None
    if data.person_id is not None:
        p = db.get(m.Person, data.person_id)
        if not p or p.department_id != dept.id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Человек не из этой кафедры")
    where = (m.DutyEntry.department_id == dept.id, m.DutyEntry.day == day,
             m.DutyEntry.kind == data.kind, m.DutyEntry.slot == data.slot)  # fmt: skip
    old = db.scalar(select(m.DutyEntry).where(*where))
    old_pid = old.person_id if old else None
    detail_type = data.detail_type.strip()
    if data.kind is m.DutyKind.DETAIL and p is not None and p.id != old_pid:
        detail_type = person_duty_types(db, dept.id).get(p.id, detail_type)
    db.execute(delete(m.DutyEntry).where(*where))
    if data.person_id is not None or data.name_text.strip():
        db.add(m.DutyEntry(department_id=dept.id, day=day, kind=data.kind, slot=data.slot, person_id=data.person_id,
                           name_text=data.name_text.strip(), detail_type=detail_type))  # fmt: skip
    db.flush()
    warning = None
    if data.kind is m.DutyKind.DETAIL and old_pid != data.person_id:
        days = (day, day + dt.timedelta(days=1))  # наряд суточный — день заступления и следующий
        if old_pid is not None:
            _sync_detail_marks(db, dept.id, old_pid, days)
        if p is not None:
            busy = _sync_detail_marks(db, dept.id, p.id, days)
            if busy:
                warning = "; ".join(f"на {d:%d.%m.%Y} стоит «{c}» ({timesheet.CODES.get(c, 'другой код')})"
                                    for d, c in busy)  # fmt: skip
                warning = f"В табеле у {names.short_name(p.full_name)} {warning} — эти дни табеля не изменены"
    db.commit()
    return {"ok": True, "detail_type": detail_type, "warning": warning}


@router.get("/duty/detail-types")
def detail_types(dept: ReadDept, db: DB) -> list[str]:
    """Виды нарядов из графика и из групп суточного наряда — для выпадающего списка."""
    rows = db.scalars(select(m.DutyEntry.detail_type).where(m.DutyEntry.department_id == dept.id,
                                                            m.DutyEntry.detail_type != "").distinct())  # fmt: skip
    groups = db.scalars(select(m.AssignmentList.duty_type).where(m.AssignmentList.department_id == dept.id,
                                                                 m.AssignmentList.duty_type != ""))  # fmt: skip
    return sorted(set(rows) | set(groups), key=str.lower)


class BoardPerson(BaseModel):
    name: str  # «Фамилия Имя Отчество» (или как вписано в график)
    rank: str = ""  # звание полностью («ГП» — пусто)
    position: str = ""
    cabinet: str = ""
    phone: str = ""  # телефон кабинета (как Дежурства!G)
    detail_type: str = ""  # вид наряда: ДА, П79…
    detail_title: str = ""  # вид наряда полностью


class BoardDay(BaseModel):
    day: dt.date
    weekday: str
    duty: BoardPerson | None
    details: list[BoardPerson]


class BoardOut(BaseModel):
    today: BoardDay
    tomorrow: BoardDay


def detail_titles(db, dept_id: int) -> dict[str, str]:
    """Полное название вида наряда: из групп суточного наряда («Обязанности»), иначе — известные сокращения книги."""
    out = {v: k[:1].upper() + k[1:] for k, v in duty_calc.DAILY_DUTY_TYPES.items()}
    q = (select(m.AssignmentList.duty_type, m.AssignmentList.title)
         .where(m.AssignmentList.department_id == dept_id, m.AssignmentList.duty_type != "")
         .order_by(m.AssignmentList.sort))  # fmt: skip
    seen = set()
    for code, title in db.execute(q):
        if code not in seen and title.strip():
            seen.add(code)
            out[code] = " ".join(title.split())
    return out


@router.get("/duty/board")
def duty_board(dept: ReadDept, db: DB, day: dt.date | None = None) -> BoardOut:
    """Режим демонстрации: дежурный по кафедре и наряды на день и на следующий день."""
    day = day or dt.date.today()
    nxt = day + dt.timedelta(days=1)
    persons = {p.id: p for p in db.scalars(select(m.Person).where(m.Person.department_id == dept.id))}
    phones = {c.number: c.phone for c in db.scalars(select(m.Cabinet).where(m.Cabinet.department_id == dept.id))}
    titles = detail_titles(db, dept.id)
    q = (select(m.DutyEntry).where(m.DutyEntry.department_id == dept.id, m.DutyEntry.day.in_((day, nxt)))
         .order_by(m.DutyEntry.day, m.DutyEntry.slot))  # fmt: skip
    days = {d: BoardDay(day=d, weekday=duty_calc.weekday_short(d), duty=None, details=[]) for d in (day, nxt)}
    for e in db.scalars(q):
        p = persons.get(e.person_id)
        if p is None and not e.name_text.strip():
            continue
        x = BoardPerson(name=p.full_name if p else e.name_text.strip())
        if p is not None:
            x.rank = "" if p.rank.upper() == "ГП" else p.rank
            x.position = p.position_full or p.position_short
            x.cabinet = p.cabinet
            x.phone = phones.get(p.cabinet, "")
        if e.kind is m.DutyKind.DEPARTMENT:
            days[e.day].duty = x
        else:
            x.detail_type = e.detail_type
            x.detail_title = titles.get(e.detail_type, "")
            days[e.day].details.append(x)
    return BoardOut(today=days[day], tomorrow=days[nxt])


@router.get("/duty/on")
def on_duty(dept: ReadDept, db: DB, day: dt.date | None = None) -> dict:
    """Дежурный по кафедре на дату (Дежурства!N1) со званием, кабинетом и телефоном (как Дежурства!D/F/G).

    Нет в графике или не назначен — name: null.
    """
    day = day or dt.date.today()
    e = db.scalar(select(m.DutyEntry).where(m.DutyEntry.department_id == dept.id, m.DutyEntry.day == day,
                                             m.DutyEntry.kind == m.DutyKind.DEPARTMENT))  # fmt: skip
    out = {"day": day, "name": None, "rank_short": "", "cabinet": "", "phone": ""}
    if not e:
        return out
    p = db.get(m.Person, e.person_id) if e.person_id else None
    if p is None:
        return {**out, "name": e.name_text or None}
    rank = db.scalar(select(m.Rank.short).where(m.Rank.department_id == dept.id,
                                                func.lower(m.Rank.name) == p.rank.lower()))  # fmt: skip
    phone = db.scalar(select(m.Cabinet.phone).where(m.Cabinet.department_id == dept.id, m.Cabinet.number == p.cabinet))
    gp = "ГП" if p.rank.upper() == "ГП" else ""
    return {**out, "name": names.short_name(p.full_name), "rank_short": rank or gp, "cabinet": p.cabinet,
            "phone": phone or ""}  # fmt: skip
