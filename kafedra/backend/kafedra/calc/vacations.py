"""График отпусков (лист «Отпуска 2025»).

Отпуск человека — несколько частей (в книге 4, в приложении можно добавить ещё; начало, сутки). Сутки на дорогу (W) добавляются к одной части,
номер которой указан в V. Календарь ставит «о» в дни, попадающие в любую часть.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

VACATION_MARK = "о"


@dataclass(frozen=True)
class Part:
    start: dt.date | None
    days: int | None


def part_end(part: Part, part_no: int, road_part: int | None, road_days: int | None) -> dt.date | None:
    """Окончание части — L/O/R/U: IF(K>0, J+K-1+IF(V=№,W,0), "")."""
    if not part.days or part.days <= 0 or part.start is None:
        return None
    extra = (road_days or 0) if road_part == part_no else 0
    return part.start + dt.timedelta(days=part.days - 1 + extra)


def periods(parts: list[Part], road_part: int | None, road_days: int | None) -> list[tuple[dt.date, dt.date | None]]:
    """Периоды отпуска (начало, окончание) по частям; окончание None — дни не указаны."""
    return [(p.start, part_end(p, i, road_part, road_days)) for i, p in enumerate(parts, start=1) if p.start]


def is_on_vacation(day: dt.date, vac_periods: list[tuple[dt.date, dt.date | None]]) -> bool:
    """Ячейка календаря — Y3: IF(OR(AND(день>=J, день<=L, J<>""), …), "о", "").

    Особенность Excel (сохранена): если дни части не указаны, окончание пустое, а число <= "" в Excel
    истинно — часть длится до конца календаря.
    """
    return any(day >= start and (end is None or day <= end) for start, end in vac_periods)


def calendar(days: list[dt.date], vac_periods) -> list[str]:
    return [VACATION_MARK if is_on_vacation(d, vac_periods) else "" for d in days]
