"""Ветераны кафедры (лист «Ветераны»): возраст и стаж."""

from __future__ import annotations

import datetime as dt

from . import personnel


def age(birth: dt.date | None, as_of: dt.date) -> int | None:
    """D: IF(C<>""; ROUNDDOWN((TODAY()-C)/365.25; 0); "") — как возраст в Database."""
    return personnel.age(birth, as_of)


def years_between(start: dt.date | None, end: dt.date | None) -> float | None:
    """L/N/P: IF((конец−начало)/365>0; (конец−начало)/365; "").

    L — стаж в последней должности (J..K), N — всего лет в академии (M..K), P — всего лет в ВС РФ (O..K).
    Ошибка книги (исправлено): пустая дата в Excel = 0 (1900 год) — при пустом «В ВС РФ с» стаж получается
    ~110 лет. Здесь без обеих дат — None.
    """
    if start is None or end is None:
        return None
    y = (end - start).days / 365
    return y if y > 0 else None
