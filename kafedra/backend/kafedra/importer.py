"""Импорт данных из Excel-книги кафедры в БД.

Берутся только вводимые данные; производные значения приложение считает само (kafedra.calc).
Значения ячеек-формул, которые являются вводом по сути (ФИО в «Сводной» — ссылка на «Структуру»),
берутся из кэша книги, поэтому книга должна быть сохранена Excel после пересчёта.

    python -m kafedra.importer <книга.xlsm> [--department "12 кафедра"] [--short 12] [--replace]
"""

from __future__ import annotations

import argparse
import datetime as dt
import re
import sys
import warnings
from decimal import Decimal
from pathlib import Path

import openpyxl
from openpyxl.utils import column_index_from_string, get_column_letter
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from .calc import duty as duty_calc
from .calc import names
from .db import models as m

warnings.filterwarnings("ignore", module="openpyxl")

TIMESHEET_YEAR = 2025
DUTY_TYPES_STAT = "DEFGHI"


class Book:
    """Значения и формулы всех листов книги."""

    def __init__(self, path: Path) -> None:
        wv = openpyxl.load_workbook(path, read_only=True, data_only=True)
        wf = openpyxl.load_workbook(path, read_only=True)
        self.v: dict[str, dict[str, object]] = {}
        self.f: dict[str, dict[str, object]] = {}
        for ws in wv.worksheets:
            if ws.title == "Ветераны":
                rows = ws.iter_rows(max_row=300)
            else:
                rows = ws.iter_rows()
            self.v[ws.title] = {c.coordinate: c.value for row in rows for c in row
                                if hasattr(c, "coordinate") and c.value is not None}  # fmt: skip
        for ws in wf.worksheets:
            rows = ws.iter_rows(max_row=300) if ws.title == "Ветераны" else ws.iter_rows()
            self.f[ws.title] = {c.coordinate: c.value for row in rows for c in row
                                if hasattr(c, "coordinate") and isinstance(c.value, str) and c.value.startswith("=")}  # fmt: skip
        wv.close()
        wf.close()

    def get(self, sheet: str, ref: str):
        v = self.v[sheet].get(ref)
        return None if v == "" else v

    def is_formula(self, sheet: str, ref: str) -> bool:
        return ref in self.f[sheet]


def _date(v) -> dt.date | None:
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    return None


def _str(v) -> str:
    if v is None:
        return ""
    if isinstance(v, dt.datetime):
        return v.strftime("%d.%m.%Y")
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def _dec(v) -> Decimal | None:
    if isinstance(v, int | float) and not isinstance(v, bool):
        return Decimal(str(v))
    try:
        return Decimal(str(v).replace(",", ".")) if v not in (None, "") else None
    except Exception:  # noqa: BLE001
        return None


def _int(v) -> int | None:
    d = _dec(v)
    return int(d) if d is not None else None


def _err(v) -> bool:
    return isinstance(v, str) and v.startswith("#")


def _degree_counted(b: Book, sheet: str, r: int) -> bool:
    """В «Сводной» степень не учитывается, если ячейка ДН/КН (Y/Z) не формула и пуста при наличии степени
    (так в книге помечен переведённый на другую кафедру)."""
    deg = _str(b.get(sheet, f"V{r}")).lower()
    col = "Y" if deg in ("дтн", "двн", "дэн") else "Z" if deg in ("ктн", "квн", "кэн") else None
    return not (col and not b.is_formula(sheet, f"{col}{r}") and b.get(sheet, f"{col}{r}") in (None, ""))


class Report:
    """Расхождения и неоднозначности книги, найденные при импорте (книга противоречит сама себе)."""

    def __init__(self) -> None:
        self.items: dict[str, list[str]] = {}

    def add(self, kind: str, msg: str) -> None:
        self.items.setdefault(kind, []).append(msg)

    def __str__(self) -> str:
        if not self.items:
            return "Расхождений не найдено."
        out = []
        for kind, msgs in self.items.items():
            out.append(f"{kind}: {len(msgs)}")
            out += [f"  - {x}" for x in msgs[:50]]
        return "\n".join(out)


OUT_OF_STAFF = "внештата"


def _out_of_staff(b: Book, unit: m.StaffUnit, by_full: dict[str, m.Person], ranks_short: dict[str, str],
                  report: Report) -> None:  # fmt: skip
    """Военнослужащие сверх штата: строка «внештата» в столбце B листа «Структура кафедры» (звание — D, ФИО — E,
    контракт — F). В «Сводной» и итогах их нет; в приложении — отдельные должности «сверх штата»."""
    sh = "Структура кафедры"
    for r in range(1, 120):
        if _str(b.get(sh, f"B{r}")).lower() != OUT_OF_STAFF:
            continue
        nm = _str(b.get(sh, f"E{r}"))
        if not nm:
            continue
        p = by_full.get(nm.lower())
        rank = _str(b.get(sh, f"D{r}"))
        until = b.get(sh, f"F{r}")
        until = f"{_date(until):%d.%m.%Y}" if _date(until) else _str(until)
        pos = m.StaffPosition(out_of_staff=True, category=ranks_short.get(rank.lower(), rank),
                              code=p.position_short if p else "", rate=Decimal(1), sort=10_000 + r)  # fmt: skip
        pos.assignments.append(m.PositionAssignment(person_id=p.id if p else None, name_text="" if p else nm,
                                                    rate=Decimal(1), contract_until=until,
                                                    sort=10_000 + r))  # fmt: skip
        unit.positions.append(pos)
        if p is None:
            report.add("ФИО нет в справочнике (сохранено текстом)", f"{sh}!E{r}: «{nm}»")


def import_book(session: Session, path: Path, dept_name: str = "12 кафедра", short: str = "12",
                report: Report | None = None) -> m.Department:  # fmt: skip
    report = report if report is not None else Report()
    b = Book(path)
    dept = m.Department(name=dept_name, short_name=short, settings={})
    session.add(dept)
    session.flush()
    D = dept.id

    # --- справочники --------------------------------------------------------------------------
    db = "Database"
    seen = set()
    ranks_short: dict[str, str] = {}
    for r in range(2, 43):
        name, sh = b.get(db, f"BA{r}"), b.get(db, f"BB{r}")
        if name and str(name).strip().lower() not in seen:
            seen.add(str(name).strip().lower())
            ranks_short[str(name).strip().lower()] = _str(sh)
            session.add(m.Rank(department_id=D, name=_str(name), short=_str(sh), sort=r))
    specs: dict[str, m.ScienceSpecialty] = {}
    for r in range(2, 43):
        code = _str(b.get(db, f"BD{r}"))
        if code and code not in specs:
            specs[code] = m.ScienceSpecialty(department_id=D, code=code, title=_str(b.get(db, f"BE{r}")))
    for r in range(3, 13):
        old, new = _str(b.get("Инф.", f"A{r}")), _str(b.get("Инф.", f"B{r}"))
        if not old:
            continue
        key = new or f"(старый) {old}"
        sp = specs.setdefault(key, m.ScienceSpecialty(department_id=D, code=key, title=""))
        sp.old_code = old
    session.add_all(specs.values())
    cabs = set()
    for r in range(2, 25):
        num = _str(b.get(db, f"BG{r}"))
        if num and num not in cabs:
            cabs.add(num)
            session.add(m.Cabinet(department_id=D, number=num, phone=_str(b.get(db, f"BH{r}"))))
    hol = set()
    for col in "PQ":
        for r in range(5, 41):
            d = _date(b.get("Расчетный", f"{col}{r}"))
            if d and d not in hol:
                hol.add(d)
                session.add(m.Holiday(department_id=D, day=d))
    units: dict[str, m.OrgUnit] = {}
    for r in range(2, 19):
        n = _str(b.get("Стат", f"L{r}"))
        if n:
            units[n.lower()] = m.OrgUnit(department_id=D, name=n, sort=r)
    session.add_all(units.values())

    # --- личный состав ------------------------------------------------------------------------
    extra_cols = {"AO": _str(b.get(db, "AO1")), "AR": _str(b.get(db, "AR1")), "AS": _str(b.get(db, "AS1")),
                  "AT": _str(b.get(db, "AT1"))}  # fmt: skip
    persons: list[m.Person] = []
    by_full: dict[str, m.Person] = {}
    by_short: dict[str, m.Person] = {}
    db_rows = sorted({int(k[1:]) for k in b.v[db] if re.fullmatch(r"F\d+", k) and int(k[1:]) > 1})
    for r in db_rows:
        g = lambda col, r=r: b.get(db, f"{col}{r}")  # noqa: E731
        full = _str(g("F"))
        if not full:
            continue
        first = by_full.get(full.lower())
        if first is not None:
            # совместитель записан второй строкой: только дополнительная должность и ставка
            first.extra = {
                **first.extra,
                "совмещения": [
                    *first.extra.get("совмещения", []),
                    {"должность": _str(g("B")), "ставка": float(_dec(g("K")) or 0), "ппс": _str(g("W"))},
                ],
            }
            report.add("Совместитель в Database второй строкой (объединён с первой)", f"Database!F{r}: {full}")
            continue
        kind = _str(g("A"))
        p = m.Person(
            department_id=D, kind=kind, position_short=_str(g("B")), position_full=_str(g("C")),
            rank=_str(g("D")) or ("ГП" if kind.upper() == "ГП" else ""),  # у гражданского персонала звание «ГП»
            full_name=full, rate=_dec(g("K")), personal_number=_str(g("L")), sex=_str(g("M")),
            birth_date=_date(g("N")), combat_veteran=_str(g("P")), service_start=_date(g("Q")),
            extra_vacation_days=_int(g("T")) or 0, service_bonus_days=0, pmk=_str(g("V")), pps=_str(g("W")), degree=_str(g("X")),
            defense_date=_str(g("Y")), science_code=_str(g("Z")), academic_title=_str(g("AB")),
            contract_number=_str(g("AC")), contract_date=_str(g("AD")), contract_addendum=_str(g("AE")),
            appointment_order=_str(g("AF")), appointment_order_date=_str(g("AG")), cabinet=_str(g("AH")),
            phones=[_str(g(c)) for c in ("AJ", "AK", "AL") if g(c) not in (None, "")],
            clearance_form=_str(g("AP")), clearance=_str(g("AQ")), class_rating=_str(g("AU")),
            class_order=_str(g("AV")), class_start=_date(g("AW")), class_term=_int(g("AX")),
            extra={label: _str(g(c)) for c, label in extra_cols.items() if label and g(c) not in (None, "")},
            sort=r,
        )  # fmt: skip
        # выслуга по периодам: Database!R ссылается на блок листа «Расчетный»
        ref = re.fullmatch(r"=Расчетный!K(\d+)", str(b.f[db].get(f"R{r}", "")))
        if ref:
            total_row = int(ref.group(1))
            start = total_row - 1
            while "выслуга" not in _str(b.get("Расчетный", f"H{start}")):
                start -= 1
            for rr in range(start + 1, total_row - 1):
                begin = _date(b.get("Расчетный", f"H{rr}"))
                if begin:
                    end_today = "TODAY" in str(b.f["Расчетный"].get(f"I{rr}", ""))
                    end = None if end_today else _date(b.get("Расчетный", f"I{rr}"))
                    p.service_periods.append(m.ServicePeriod(start=begin, end=end))
                elif b.get("Расчетный", f"J{rr}") is not None:
                    p.service_bonus_days += _int(b.get("Расчетный", f"J{rr}")) or 0
        persons.append(p)
        by_full.setdefault(full.lower(), p)
        by_short.setdefault(names.short_name(full).lower(), p)
    session.add_all(persons)
    session.flush()

    def person_by_short(v, where: str = "") -> m.Person | None:
        if not v:
            return None
        p = by_short.get(_str(v).lower())
        if p is None and where:
            report.add("ФИО нет в справочнике (сохранено текстом)", f"{where}: «{_str(v)}»")
        return p

    # --- табель: только введённые коды (формулы — подстановка из графика отпусков) -----------------
    rs = "Расход"
    for r in range(5, 103):
        p = person_by_short(b.get(rs, f"G{r}"))
        if not p:
            continue
        for i in range(column_index_from_string("H"), column_index_from_string("NH") + 1):
            col = get_column_letter(i)
            day = _date(b.get(rs, f"{col}3"))
            v = b.get(rs, f"{col}{r}")
            if day and v not in (None, "") and not b.is_formula(rs, f"{col}{r}"):
                session.add(m.TimesheetEntry(person_id=p.id, day=day, code=_str(v)))

    # --- отпуска --------------------------------------------------------------------------------------
    vs = "Отпуска 2025"
    done = set()
    for r in range(3, 101):
        p = person_by_short(b.get(vs, f"G{r}"))
        if not p or p.id in done:
            continue
        done.add(p.id)
        plan = m.VacationPlan(person_id=p.id, year=TIMESHEET_YEAR, road_part=_int(b.get(vs, f"V{r}")),
                              road_days=_int(b.get(vs, f"W{r}")))  # fmt: skip
        for no, (sc, dc) in enumerate((("J", "K"), ("M", "N"), ("P", "Q"), ("S", "T")), start=1):
            start, days = _date(b.get(vs, f"{sc}{r}")), _int(b.get(vs, f"{dc}{r}"))
            if start or days:
                plan.parts.append(m.VacationPart(part_no=no, start=start, days=days))
        session.add(plan)

    # --- дежурства и наряды -----------------------------------------------------------------------------
    ds = "Дежурства"
    for r in range(2, 459):
        day = _date(b.get(ds, f"A{r}"))
        if not day:
            continue
        name = b.get(ds, f"E{r}")
        if name not in (None, "") and not _err(name):
            p = person_by_short(name, f"Дежурства!E{r}")
            session.add(m.DutyEntry(department_id=D, day=day, kind=m.DutyKind.DEPARTMENT, slot=1,
                                    person_id=p.id if p else None, name_text="" if p else _str(name)))  # fmt: skip
        for slot, (nc, tc) in enumerate((("H", "I"), ("J", "K"), ("L", "M")), start=1):
            who = b.get(ds, f"{nc}{r}")
            if who in (None, ""):
                continue
            p = person_by_short(who)
            session.add(m.DutyEntry(department_id=D, day=day, kind=m.DutyKind.DETAIL, slot=slot,
                                    person_id=p.id if p else None, name_text="" if p else _str(who),
                                    detail_type=_str(b.get(ds, f"{tc}{r}"))))  # fmt: skip
    st = "Стат"
    types = {c: _str(b.get(st, f"{c}1")) for c in DUTY_TYPES_STAT}
    for r in range(2, 33):
        day = _date(b.get(st, f"A{r}"))
        if not day:
            continue
        for c in DUTY_TYPES_STAT:
            v = _str(b.get(st, f"{c}{r}"))
            if v:
                u = units.get(v.lower())
                if u is None:
                    report.add("Подразделение не из списка (наряд не учитывается в подсчёте)", f"Стат!{c}{r}: «{v}»")
                session.add(m.UnitDutyEntry(department_id=D, day=day, duty_type=types[c],
                                            unit_id=u.id if u else None, unit_text="" if u else v))  # fmt: skip

    # --- штатное расписание (по «Сводной») ---------------------------------------------------------------
    sv = "Сводная"
    sections = [
        (m.UnitKind.PPS_MIL, "C3", range(4, 34), None),
        (m.UnitKind.PPS_CIV, "C35", range(36, 96), "F46"),
        (m.UnitKind.AUX, "C96", range(97, 112), "T26"),
        (m.UnitKind.AUX, "C112", range(113, 125), "AA23"),
        (m.UnitKind.AUX, "C125", range(126, 135), "AG20"),
        (m.UnitKind.AUX, "C135", range(136, 142), "AM17"),
        (m.UnitKind.AUX, "C142", range(143, 149), "AS17"),
    ]
    for sort, (kind, title_ref, rows, people_ref) in enumerate(sections):
        unit = m.StaffUnit(department_id=D, kind=kind, title=_str(b.get(sv, title_ref)), sort=sort,
                           people_manual=_dec(b.get("Структура кафедры", people_ref)) if people_ref else None)  # fmt: skip
        pos: m.StaffPosition | None = None
        for r in rows:
            g = lambda col, r=r: b.get(sv, f"{col}{r}")  # noqa: E731
            name, rate, cat = g("C"), g("D"), g("B")
            rate_ok = isinstance(rate, int | float) and not isinstance(rate, bool)
            if cat in (None, "") and not rate_ok:
                if isinstance(name, str) and name.strip():
                    unit.positions.append(m.StaffPosition(is_header=True, title=name.strip(), sort=r))
                continue
            if cat not in (None, ""):
                pos = m.StaffPosition(
                    category=_str(cat), code=_str(g("J")), rate=_dec(rate) if rate_ok else None, sort=r
                )
                unit.positions.append(pos)
            if pos is None or name in (None, "", 0):
                continue
            nm = _str(name)
            p = by_full.get(nm.lower())
            a = m.PositionAssignment(
                person_id=p.id if p else None, name_text="" if p else nm, rate=_dec(rate) if rate_ok else None,
                employment=_str(g("E")), sort=r,
                count_degree=_degree_counted(b, sv, r),
                flags={c: g(c) for c in ("AA", "AB", "AC", "AD", "AE", "AJ", "AK", "AL") if g(c) not in (None, "")},
            )  # fmt: skip
            pos.assignments.append(a)
            if p is None and nm.strip().lower() != "вакантная":
                report.add("ФИО нет в справочнике (сохранено текстом)", f"Сводная!C{r}: «{nm}»")
            if p and _date(g("N")) and p.birth_date and _date(g("N")) != p.birth_date:
                report.add(
                    "Дата рождения в «Сводной» отличается от Database (берётся Database)",
                    f"Сводная!N{r}: {p.full_name}: {_date(g('N')):%d.%m.%Y} ≠ {p.birth_date:%d.%m.%Y}",
                )
            if p and g("V") and _str(g("V")).lower() != p.degree.lower():
                report.add(
                    "Учёная степень в «Сводной» отличается от Database (берётся Database)",
                    f"Сводная!V{r}: {p.full_name}: «{_str(g('V'))}» ≠ «{p.degree}»",
                )
            if p and not p.teaching_periods:
                for sc, ec in (("P", "Q"), ("R", "S")):
                    if _date(g(sc)):
                        p.teaching_periods.append(m.TeachingPeriod(start=_date(g(sc)), end=_date(g(ec))))
                if _date(g("T")):
                    p.teaching_periods.append(m.TeachingPeriod(start=_date(g("T")), end=None))
                if g("AN"):
                    session.add(m.Award(person_id=p.id, title=_str(g("AN")), awarded_on=_date(g("AO"))))
        if kind is m.UnitKind.PPS_MIL:
            _out_of_staff(b, unit, by_full, ranks_short, report)
        session.add(unit)

    # --- план «Прил. 1», настройки -------------------------------------------------------------------------
    pr = "Прил. 1"
    for yc, ac, dc in (("K", "K", "L"), ("M", "M", "N"), ("O", "O", "P")):
        year = _int(re.sub(r"\D", "", _str(b.get(pr, f"{yc}11"))))
        if year:
            session.add(m.PlanYear(department_id=D, year=year, appointed=_dec(b.get(pr, f"{ac}25")) or 0,
                                   defended=_dec(b.get(pr, f"{dc}25")) or 0,
                                   pps_rates_text=_str(b.get(pr, f"{ac}15"))))  # fmt: skip
    rv = lambda ref: _int(b.get(rs, ref))  # noqa: E731
    dept.settings = {
        "roster_staff": {
            "Общая": {"a": rv("PI112"), "b": rv("PK112")},
            "всл": {"a": rv("PI140")},
            "ппс": {"a": rv("PI166"), "b": rv("PK166")},
            "всл ппс": {"a": rv("PI192")},
            "всл без А": {"a": rv("PI218")},
            "без адъюнктов": {"a": rv("PI244"), "b": rv("PJ244"), "c": rv("PK244"), "list_a": rv("PI245")},
        },
        "timesheet_vacation_autofill_from": "2025-03-23",
    }

    # --- журналы --------------------------------------------------------------------------------------------
    zt = "Задачи"
    for r in range(2, 200):
        if not any(b.get(zt, f"{c}{r}") not in (None, "") for c in "ABCDEFGHI"):
            continue
        g = lambda c, r=r: b.get(zt, f"{c}{r}")  # noqa: E731
        session.add(m.Task(department_id=D, source=_str(g("A")), received_on=_date(g("B")),
                           incoming_number=_str(g("C")), content=_str(g("D")), issued_by=_str(g("E")),
                           due=_str(g("F")), assigned_to=_str(g("G")), status=_str(g("H")),
                           outgoing_number=_str(g("I"))))  # fmt: skip
    vt = "Ветераны"
    for r in range(2, 300):
        g = lambda c, r=r: b.get(vt, f"{c}{r}")  # noqa: E731
        if not g("B"):
            continue
        session.add(m.Veteran(department_id=D, rank=_str(g("A")), full_name=_str(g("B")), birth_date=_date(g("C")),
                              phone_mobile=_str(g("E")), phone_city=_str(g("F")), address=_str(g("G")),
                              workplace=_str(g("H")), last_position=_str(g("I")), position_start=_date(g("J")),
                              position_end=_date(g("K")), academy_start=_date(g("M")), army_start=_date(g("O"))))  # fmt: skip

    # --- «Обязанности»: три раздела списков ----------------------------------------------------------------
    ob = "Обязанности 24-25"
    for section, title_col, rank_col, name_col, periods in (
        (m.AssignmentSection.WORKLOAD, "B", "C", "D", False),
        (m.AssignmentSection.DAILY_DUTY, "G", "H", "I", False),
        (m.AssignmentSection.SHIFT, "L", "M", "N", True),
    ):
        cur: m.AssignmentList | None = None
        for r in range(4, 120):
            title = _str(b.get(ob, f"{title_col}{r}"))
            if title:
                cur = m.AssignmentList(department_id=D, section=section, title=title, sort=r,
                                      duty_type=duty_calc.daily_duty_type(title) if section is m.AssignmentSection.DAILY_DUTY else "")  # fmt: skip
                session.add(cur)
            nm, rk = b.get(ob, f"{name_col}{r}"), b.get(ob, f"{rank_col}{r}")
            if cur is None or nm in (None, "") or (r == 4 and section is m.AssignmentSection.WORKLOAD):
                continue
            p = person_by_short(nm)
            mem = m.AssignmentMember(person_id=p.id if p else None, rank_text=_str(rk),
                                     name_text="" if p else _str(nm), sort=r)  # fmt: skip
            if periods:
                mem.period1_start, mem.period1_days = _date(b.get(ob, f"O{r}")), _int(b.get(ob, f"P{r}"))
                mem.period2_start, mem.period2_days = _date(b.get(ob, f"R{r}")), _int(b.get(ob, f"S{r}"))
            cur.members.append(mem)

    session.flush()
    return dept


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("book")
    ap.add_argument("--department", default="12 кафедра")
    ap.add_argument("--short", default="12")
    ap.add_argument("--replace", action="store_true", help="удалить кафедру с таким кратким именем перед импортом")
    a = ap.parse_args()
    from .db.session import engine  # с search_path нашей схемы (KAFEDRA_DB_SCHEMA)

    with Session(engine) as s, s.begin():
        old = s.scalar(select(m.Department).where(m.Department.short_name == a.short))
        if old:
            if not a.replace:
                print(f"Кафедра «{a.short}» уже есть в БД; запустите с --replace, чтобы заменить данные.")
                return 1
            s.execute(delete(m.Department).where(m.Department.id == old.id))
        rep = Report()
        d = import_book(s, Path(a.book), a.department, a.short, rep)
        print(f"Импортирована кафедра «{d.name}» (id={d.id})")
        print(rep)
    return 0


if __name__ == "__main__":
    sys.exit(main())
