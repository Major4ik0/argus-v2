# -*- coding: utf-8 -*-
import calendar
import re
from datetime import date, datetime
from typing import Tuple, Dict, Any, Optional


def get_month_bounds(year: int, month: int) -> Tuple[date, date]:
    """Возвращает первый и последний день указанного месяца."""
    last_day_num = calendar.monthrange(year, month)[1]
    return date(year, month, 1), date(year, month, last_day_num)


def get_academic_year_info(target_date: date) -> Dict[str, Any]:
    """
    Определяет учебный год по дате (учебный год стартует 1 сентября).
    """
    year = target_date.year
    if target_date.month >= 9:
        start_year = year
        end_year = year + 1
    else:
        start_year = year - 1
        end_year = year

    return {
        "start_year": start_year,
        "end_year": end_year,
        "academic_year_start": date(start_year, 9, 1),
        "study_year_full": f"{start_year}-{end_year}"
    }

def format_period_time(start_minutes: Optional[int], stop_minutes: Optional[int]) -> str:
    """Конвертирует минуты от начала дня в формат '09:00 - 10:35'."""
    if start_minutes is None or stop_minutes is None:
        return ""
    start_h, start_m = divmod(start_minutes, 60)
    stop_h, stop_m = divmod(stop_minutes, 60)
    return f"{start_h:02d}:{start_m:02d} - {stop_h:02d}:{stop_m:02d}"


def extract_pair_number(short_time: Optional[str]) -> Optional[int]:
    """Извлекает порядковый номер пары из строки вида '1 пара' или '1-я'."""
    if not short_time:
        return None
    match = re.search(r'\d+', str(short_time))
    return int(match.group(0)) if match else None


def resolve_faculty(fac_str: Optional[str], db_color: Optional[str] = None) -> Tuple[str, str]:
    """
    Сопоставление названия факультета и цвета из БД или канонической палитры:
    АСУ, РЭС (#FFAAFF), ПиПК (#FFFF00), СФ (#AAFF00), ВВОТП (#95E7FF).
    """
    if not fac_str:
        return "АСУ, РЭС", (db_color if db_color else "#FFAAFF")
    s = fac_str.upper()
    if "АСУ" in s or "РЭС" in s:
        name = "АСУ, РЭС"
        default_c = "#FFAAFF"
    elif "ПИПК" in s or "ППК" in s:
        name = "ПиПК"
        default_c = "#FFFF00"
    elif "СФ" in s:
        name = "СФ"
        default_c = "#AAFF00"
    elif "ВВОТП" in s or "ВВ" in s:
        name = "ВВОТП"
        default_c = "#95E7FF"
    else:
        name = fac_str
        default_c = "#FFAAFF"

    color = db_color if (db_color and db_color.strip()) else default_c
    return name, color
