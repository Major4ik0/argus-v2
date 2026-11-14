"""Штатная структура кафедры (лист «Структура кафедры»): подразделения, должности, итоги укомплектованности.

Подразделение — список строк (должность или второй человек на совмещении) со ставкой и ФИО/«Вакантная».
Номер п/п есть только у строк-должностей; строки без номера — совмещения на той же должности.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

VACANT = "вакантная"


@dataclass
class Slot:
    numbered: bool  # есть номер п/п — штатная должность
    name: object  # ФИО / «Вакантная» / заголовок
    rate: float | None  # ставка (шт. ед.); у военнослужащих ППС — 1


def _vacant(v) -> bool:
    return isinstance(v, str) and v.strip().lower() == VACANT


def _num(v) -> float:
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else 0.0


@dataclass
class Unit:
    name: str
    slots: list[Slot]
    people: float | None = None  # «по списку (реально чел.)» — в книге введено вручную
    extra_positions: int = 0  # руководство (НК, 2 ЗНК) учитывается в ППС-военнослужащих: COUNT(…)+3
    extra_vacant: int = 0  # вакантные должности руководства
    count_vacant_positions: bool = False  # военнослужащие: вакансии — число строк «Вакантная», а не ставок


@dataclass
class UnitTotals:
    positions: float  # по штату
    vacant: float  # вакансий
    listed: float  # по списку (долж. укомплект.) = по штату − вакансий
    people: float | None  # по списку (реально чел.)
    staff_rates: float  # ГП по штату (сумма ставок)
    listed_rates: float  # ГП по списку (сумма ставок без вакантных)

    @property
    def pct(self) -> float:
        return self.listed / self.positions

    @property
    def pct_people(self) -> float | None:
        return None if self.people is None else self.people / self.positions


def totals(u: Unit) -> UnitTotals:
    """Итоги подразделения.

    Ошибка книги (исправлено): «ГП по списку» в книге — SUMIF(ФИО; ">вакантная"; ставки), т.е. сравнение фамилий
    по алфавиту; здесь — сумма ставок всех невакантных строк.
    """
    positions = sum(1 for s in u.slots if s.numbered) + u.extra_positions
    if u.count_vacant_positions:
        vacant = sum(1 for s in u.slots if _vacant(s.name)) + u.extra_vacant
    else:
        vacant = sum(_num(s.rate) for s in u.slots if _vacant(s.name))
    staff_rates = sum(_num(s.rate) for s in u.slots)
    listed_rates = sum(_num(s.rate) for s in u.slots if not _vacant(s.name) and s.name not in (None, "", 0))
    return UnitTotals(positions, vacant, positions - vacant, u.people, staff_rates, listed_rates)


@dataclass
class DeptTotals:
    positions: float
    people: float | None
    listed: float
    vacant: float
    staff_rates: float
    listed_rates: float

    @property
    def pct(self) -> float:
        return self.listed / self.positions

    @property
    def pct_people(self) -> float | None:
        return None if self.people is None else self.people / self.positions


def department(units: list[UnitTotals]) -> DeptTotals:
    """Итоги за кафедру — «ВСЕГО ЗА КАФЕДРУ» (F110:F116) / «За кафедру» (AA33:AA38), M71/M72.

    Ошибка книги (исправлено): F112 («по списку долж.») не включает последний кабинет (+AS18), из-за чего
    на одном листе два разных итога (F112 и AA35).
    """
    ppl = [u.people for u in units]
    return DeptTotals(
        positions=sum(u.positions for u in units),
        people=None if any(p is None for p in ppl) else sum(ppl),
        listed=sum(u.listed for u in units),
        vacant=sum(u.vacant for u in units),
        staff_rates=sum(u.staff_rates for u in units),
        listed_rates=sum(u.listed_rates for u in units),
    )


def caption(d: dt.date, prefix: str = "За кафедру на") -> str:
    """Z32: CONCATENATE("За кафедру на ";DAY(TODAY());".";MONTH(TODAY());".";YEAR(TODAY());" г.")."""
    return f"{prefix} {d.day}.{d.month}.{d.year} г."
