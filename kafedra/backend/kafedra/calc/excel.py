"""Excel-совместимые примитивы: серийные даты, DATEDIF, FLOOR, ROUNDDOWN, DATE."""

from __future__ import annotations

import datetime as dt
import math

_EPOCH = dt.date(1899, 12, 30)


def to_serial(d: dt.date) -> int:
    """Серийный номер даты Excel (для дат с 01.03.1900)."""
    return (d - _EPOCH).days


def serial_ymd(n: int) -> tuple[int, int, int]:
    """Дата Excel по серийному номеру как (год, месяц, день), с учётом ошибки Lotus 1-2-3.

    0 → 00.01.1900, 60 → 29.02.1900 (несуществующий день), остальные — обычные даты.
    """
    if n == 0:
        return 1900, 1, 0
    if n == 60:
        return 1900, 2, 29
    d = dt.date(1899, 12, 31) + dt.timedelta(days=n) if n < 60 else _EPOCH + dt.timedelta(days=n)
    return d.year, d.month, d.day


def datedif(start: int, end: int, unit: str) -> int:
    """DATEDIF(start; end; "y"|"m"|"ym"|"md"|"d") по серийным номерам."""
    if end < start:
        raise ValueError("#NUM!")
    y1, m1, d1 = serial_ymd(start)
    y2, m2, d2 = serial_ymd(end)
    unit = unit.lower()
    if unit == "d":
        return end - start
    months = (y2 - y1) * 12 + (m2 - m1) - (1 if d2 < d1 else 0)
    if unit == "m":
        return months
    if unit == "y":
        return months // 12
    if unit == "ym":
        return months % 12
    if unit == "md":
        if d2 >= d1:
            return d2 - d1
        # дней от d1 предыдущего месяца до d2
        py, pm = (y2, m2 - 1) if m2 > 1 else (y2 - 1, 12)
        prev_len = (dt.date(py + (pm == 12), pm % 12 + 1, 1) - dt.date(py, pm, 1)).days
        return prev_len - d1 + d2
    raise ValueError(f"unit {unit}")


def floor(x: float, significance: float) -> float:
    """FLOOR(x; significance) для положительных аргументов.

    Как Excel: результат = significance * n (поэтому FLOOR(30.27;0.1) = 30.200000000000003).
    """
    q = x / significance
    return math.floor(round(q, 9)) * significance


def rounddown(x: float, digits: int = 0) -> float:
    f = 10**digits
    return math.trunc(round(x * f, 9)) / f


def _key(v):
    return v.lower() if isinstance(v, str) else v


def index_match(key, table: list[tuple], default="") -> object:
    """IFERROR(INDEX(значения; MATCH(key; ключи; 0)); default).

    MATCH без учёта регистра; INDEX пустой ячейки в Excel даёт 0.
    """
    if key is None or key == "":
        return default
    for k, v in table:
        if k is not None and _key(k) == _key(key):
            return 0 if v is None or v == "" else v
    return default


def countif_eq(values, key) -> int:
    """COUNTIF(диапазон; key) для текстового ключа без операторов и подстановочных знаков."""
    k = _key(key)
    return sum(1 for v in values if v is not None and _key(v) == k)


def date(year: int, month: int, day: int) -> dt.date:
    """DATE(год; месяц; день) с переносом переполнения месяца и дня, как в Excel."""
    year += (month - 1) // 12
    month = (month - 1) % 12 + 1
    return dt.date(year, month, 1) + dt.timedelta(days=day - 1)


def text(v) -> str:
    """Число как текст в CONCATENATE (общий формат, русская локаль): 21.5 → «21,5», 4.0 → «4»."""
    if isinstance(v, bool) or not isinstance(v, int | float):
        return "" if v is None else str(v)
    if float(v).is_integer():
        return str(int(v))
    return f"{v:.10g}".replace(".", ",")
