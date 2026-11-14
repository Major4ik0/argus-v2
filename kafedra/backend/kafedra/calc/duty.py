"""Дежурства по кафедре и наряды (листы «Дежурства», «Расчетный» U:AJ)."""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable

WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"]

# Вид наряда в графике для групп «Обязанности» → «Суточный наряд» (в книге у групп только полные названия).
# Используется при импорте и миграции; дальше вид наряда группы правится в разделе «Обязанности».
DAILY_DUTY_TYPES = {
    "дежурный по академии": "ДА",
    "помощник дежурного по академии": "ПДА",
    "патруль": "П79",
    "старший на пункте управления": "СтПУ",
    "областной сборный пункт": "ОСП",
}


def daily_duty_type(title: str) -> str:
    """Сокращение вида наряда по названию группы суточного наряда; не знаем — пусто."""
    return DAILY_DUTY_TYPES.get(" ".join(title.split()).lower(), "")


def weekday_short(d: dt.date) -> str:
    """Дежурства!C: IF(WEEKDAY(A;2)=1;"Пн";…)."""
    return WEEKDAYS[d.isoweekday() - 1]


def on_duty(day: dt.date, schedule: dict[dt.date, str]) -> str | None:
    """Дежурный на дату — Дежурства!N1: INDEX(E:E; MATCH(TODAY(); A:A; 0)).

    Ошибка книги (исправлено): если даты нет в графике, Excel показывает #N/A; здесь — None.
    """
    return schedule.get(day)


def count_for(entries: Iterable[tuple[dt.date, str | None]], name: str,
              start: dt.date | None = None, end: dt.date | None = None) -> int:  # fmt: skip
    """Число записей человека в графике за период (включительно) —
    Расчетный!V:AH: COUNTIFS(Дежурства!E:E; имя; Дежурства!A:A; ">=01.01.2025"; Дежурства!A:A; "<=31.01.2025").
    """
    key = name.lower()
    return sum(
        1
        for d, who in entries
        if who and who.lower() == key and (start is None or d >= start) and (end is None or d <= end)
    )


def unique_people(short_names: Iterable[str | None]) -> list[str]:
    """Список людей для табеля и графика отпусков — уникальные «Фамилия И.О.» в порядке Database
    (Расчетный!A:C → Расход!A,G: COUNTIF(...)=1 → нумерация → VLOOKUP)."""
    seen, out = set(), []
    for n in short_names:
        if n and n not in seen:
            seen.add(n)
            out.append(n)
    return out


def period_end(start: dt.date | None, days: int | None) -> dt.date | None:
    """Обязанности!Q/T: IF(начало<>""; начало+срок−1; "")."""
    if start is None:
        return None
    return start + dt.timedelta(days=(days or 0) - 1)
