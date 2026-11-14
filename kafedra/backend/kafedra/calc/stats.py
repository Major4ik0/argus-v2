"""Статистика дежурств подразделений (лист «Стат») и счёт ПВО-ПРО (лист «Счет ПВО-ПРО»)."""

from __future__ import annotations

import datetime as dt
from collections.abc import Iterable

from .duty import weekday_short

WEEKEND = "вых"


def weekend_mark(d: dt.date) -> str:
    """Стат!C: IF(OR(день="Сб"; день="Вс"); "вых"; "") — здесь выходные суббота и воскресенье."""
    return WEEKEND if weekday_short(d) in ("Сб", "Вс") else ""


def unit_counts(days: Iterable[tuple[dt.date, str | None]], unit: str) -> tuple[int, int]:
    """Сколько раз подразделение в наряде за период: всего и в выходные — COUNTIF / COUNTIFS(…;"вых")."""
    total = weekend = 0
    key = unit.lower()
    for d, who in days:
        if who is not None and str(who).lower() == key:
            total += 1
            if weekend_mark(d):
                weekend += 1
    return total, weekend

