"""Расчёты по личному составу (лист Database: колонки O, R, S, U, AY)."""

from __future__ import annotations

import datetime as dt

from . import excel


def age(birth: dt.date | None, as_of: dt.date) -> int | None:
    """Возраст — Database!O: IF(N<>"", ROUNDDOWN((TODAY()-N)/365.25, 0), "")."""
    if birth is None:
        return None
    return int(excel.rounddown((as_of - birth).days / 365.25))


def service_years(start: dt.date | None, as_of: dt.date) -> float | None:
    """Выслуга в годах с точностью 0.1 — Database!R: FLOOR((TODAY()-Q)/365, 0.1).

    Ошибка книги (исправлено): при пустой дате начала службы Excel считает от 1900 г. (~125 лет);
    здесь — None.
    """
    if start is None:
        return None
    return excel.floor((as_of - start).days / 365, 0.1)


def service_text(start: dt.date | None, as_of: dt.date) -> str | None:
    """«N лет M мес» — Database!S: DATEDIF(,TODAY()-Q,"y")&" лет "&DATEDIF(,TODAY()-Q,"ym")&" мес".

    Длительность (TODAY()-Q) трактуется Excel как дата от 00.01.1900 — повторяем это.
    Ошибка книги (исправлено): пустая дата начала → None вместо «125 лет …».
    """
    if start is None:
        return None
    n = (as_of - start).days
    return f"{excel.datedif(0, n, 'y')} лет {excel.datedif(0, n, 'ym')} мес"


def service_days_from_periods(periods: list[tuple[dt.date, dt.date | None]], bonus_days: int, as_of: dt.date) -> int:
    """Выслуга в днях по периодам службы (лист Расчетный, блоки «… выслуга»):
    J = окончание − начало (открытый период — до TODAY()), + льготные дни, J_итог = SUM(J)."""
    return sum(((end or as_of) - start).days for start, end in periods) + (bonus_days or 0)


def service_years_from_periods(periods, bonus_days: int, as_of: dt.date) -> float:
    """Database!R для людей с перерывами в службе: =Расчетный!K14 → ROUNDDOWN(J_итог/365, 1)."""
    return excel.rounddown(service_days_from_periods(periods, bonus_days, as_of) / 365, 1)


def service_text_from_periods(periods, bonus_days: int, as_of: dt.date) -> str:
    """Database!S для людей с перерывами: DATEDIF(,J_итог,"y")&" лет "&DATEDIF(,J_итог,"ym")&" мес"."""
    n = service_days_from_periods(periods, bonus_days, as_of)
    return f"{excel.datedif(0, n, 'y')} лет {excel.datedif(0, n, 'ym')} мес"


def vacation_days(kind: str | None, pps: str | None, service: float | None, extra_days: float | None) -> float:
    """Положено суток отпуска — Database!U:
    IF(AND(A="ГП",W="ппс"),56, IF(AND(A="ГП",W=""),28, IF(R<10,30,IF(R<15,35,IF(R<20,40,45)))+T))

    A — вид (всл/ГП), W — признак ППС, R — выслуга, T — доп. сутки.
    """
    k = (kind or "").lower()
    p = (pps or "").lower()
    if k == "гп" and p == "ппс":
        return 56
    if k == "гп" and p == "":
        return 28
    r = service if service is not None else 0
    base = 30 if r < 10 else 35 if r < 15 else 40 if r < 20 else 45
    return base + (extra_days or 0)


def class_end(start: dt.date | None, term: float | None) -> dt.date | None:
    """Дата окончания классности — Database!AY:
    IF(AW<>"", IF(AX=6, DATE(Y, M+AX, D), DATE(Y+AX, M, D)), "")  (6 — это полгода, иначе годы)."""
    if start is None:
        return None
    t = int(term or 0)
    if t == 6:
        return excel.date(start.year, start.month + t, start.day)
    return excel.date(start.year + t, start.month, start.day)
