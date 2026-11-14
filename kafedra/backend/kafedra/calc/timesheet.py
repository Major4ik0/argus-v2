"""Табель присутствия (лист «Расход», ячейки людей × дни).

Коды дня: «+» на лицо, «н» наряд, «о» отпуск, «б» болен, «к» командировка, «з» занятия,
«х» откомандирован. Строка 103 книги: «в» — воскресенье или праздник.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable

PRESENT = "+"
WEEKEND = "в"
CODES = {
    "х": "Откомандирован",
    "к": "Командировка",
    "з": "Занятия",
    "о": "Отпуск",
    "б": "Болен",
    "н": "Наряд",
    "+": "На лицо",
}


def is_day_off(day: dt.date, holidays: Iterable[dt.date]) -> bool:
    """Строка 103: IF(OR(WEEKDAY(день;2)=7; день ∈ праздники); "в"; "") — выходной только воскресенье."""
    return day.isoweekday() == 7 or day in set(holidays)


def day_off_mark(day: dt.date, holidays: Iterable[dt.date]) -> str:
    return WEEKEND if is_day_off(day, holidays) else ""


def effective_code(manual: str | None, on_vacation: bool) -> str:
    """Значение ячейки табеля: введённый код, иначе «о» из графика отпусков, иначе пусто.

    В книге часть ячеек (с 23.03) — формулы INDEX('Отпуска 2025'!…), часть — введённые коды.
    """
    if manual not in (None, ""):
        return manual
    return "о" if on_vacation else ""


def absences(codes: dict[dt.date, str], days: Iterable[dt.date], holidays: Iterable[dt.date], as_of: dt.date,
             empty_is_present: bool = True) -> int:
    """Дней отсутствия — NI: COUNTIFS(дни;"<>+"; строка103;"<>в"; даты;"<="&TODAY()).

    В книге пустой рабочий день считается отсутствием. В приложении пустая клетка — «на лицо»
    (решение 2026-11-07); empty_is_present=False — как в книге (для сверки с Excel).
    """
    hol = set(holidays)
    present = {PRESENT, ""} if empty_is_present else {PRESENT}
    return sum(1 for d in days if d <= as_of and not is_day_off(d, hol) and codes.get(d, "") not in present)


def working_days(start: dt.date, end: dt.date, holidays: Iterable[dt.date]) -> int:
    """NETWORKDAYS.INTL(start; end; 11; праздники) — рабочие все дни, кроме воскресений и праздников."""
    hol = set(holidays)
    n, d = 0, start
    while d <= end:
        if d.isoweekday() != 7 and d not in hol:
            n += 1
        d += dt.timedelta(days=1)
    return n


def absence_share(absent: int, workdays: int) -> float | None:
    """Процент отрыва — NJ: NI / NK5 (доля, в книге форматируется как %)."""
    return absent / workdays if workdays else None
