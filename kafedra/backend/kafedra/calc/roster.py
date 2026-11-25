"""Строевая записка («расход» на дату) — лист «Расход», блок NS:NT и печатные формы PH107:PS265.

Шесть вариантов записки отличаются фильтром людей; внутри фильтра считаются коды дня табеля.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from enum import Enum

ADJUNCT = "адъюнкт"
CAUSES = ["х", "к", "з", "о", "б", "н"]  # откомандирован, командировка, занятия, отпуск, болен, наряд
PRESENT = "+"

MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
              "сентября", "октября", "ноября", "декабря"]  # fmt: skip


@dataclass(frozen=True)
class Person:
    kind: str  # «всл» (военнослужащий) или «ГП» (гражданский персонал) — Расход!C
    pps: str  # «ппс» или пусто — Расход!D
    position: str  # должность (сокр.) — Расход!E
    code: str = ""  # код дня табеля на дату записки


def _l(s: str | None) -> str:
    return (s or "").strip().lower()


class Variant(Enum):
    """Варианты записки (подпись в книге справа от формы)."""

    TOTAL = "Общая"
    VSL = "всл"
    PPS = "ппс"
    VSL_PPS = "всл ппс"
    VSL_NO_ADJ = "всл без А"
    ALL_NO_ADJ = "без адъюнктов"


# Полные названия вариантов для экрана (в книге — сокращения справа от формы)
TITLES = {
    Variant.TOTAL: "Общая",
    Variant.VSL: "Военнослужащие",
    Variant.PPS: "Профессорско-преподавательский состав",
    Variant.VSL_PPS: "Военнослужащие из профессорско-преподавательского состава",
    Variant.VSL_NO_ADJ: "Военнослужащие без адъюнктов",
    Variant.ALL_NO_ADJ: "Все без адъюнктов",
}


def in_list(v: Variant, p: Person) -> bool:
    """Кто входит в «по списку» варианта (NT8, NT21, NT33, NT45, NT57, NT68)."""
    k, pps, adj = _l(p.kind), _l(p.pps), _l(p.position) == ADJUNCT
    return {
        Variant.TOTAL: k in ("всл", "гп"),
        Variant.VSL: k == "всл",
        Variant.PPS: pps == "ппс",
        Variant.VSL_PPS: k == "всл" and pps == "ппс",
        Variant.VSL_NO_ADJ: k == "всл" and not adj,
        Variant.ALL_NO_ADJ: (k == "всл" and not adj) or k == "гп",
    }[v]


def counted(v: Variant, p: Person) -> bool:
    """Чьи коды дня считаются в варианте (NT9…, NT22… и т.д.).

    Совпадает с in_list, кроме «Общая» (коды всех строк табеля) и «без адъюнктов»
    (все, кто не адъюнкт) — так в формулах книги.
    """
    if v is Variant.TOTAL:
        return True
    if v is Variant.ALL_NO_ADJ:
        return _l(p.position) != ADJUNCT
    return in_list(v, p)


@dataclass
class Counts:
    listed: int
    by_code: dict[str, int] = field(default_factory=dict)

    @property
    def present(self) -> int:
        return self.by_code.get(PRESENT, 0)

    @property
    def absent(self) -> int:
        return sum(self.by_code.get(c, 0) for c in CAUSES)

    @property
    def check(self) -> str:
        """NT17: IF(SUM(причины и на лицо) <> по списку; "ОШИБКА"; "ВЕРНО")."""
        return "ВЕРНО" if self.absent + self.present == self.listed else "ОШИБКА"


def count_group(people: list[Person], member, empty_is_present: bool = True) -> Counts:
    """Счётчики по произвольной группе людей (member(p) — входит ли): по списку, на лицо и причины."""
    group = [p for p in people if member(p)]
    c = Counts(listed=len(group))
    for k in [*CAUSES, PRESENT]:
        c.by_code[k] = sum(1 for p in group if (_l(p.code) or (PRESENT if empty_is_present else "")) == k)
    return c


def _no_adj(p: Person) -> bool:
    return _l(p.position) != ADJUNCT


# Колонки записки 6 («всл, гп ппс, итс без А»), как в шапке книги: офицеры ППС, ГП ППС, ГП ИТС (ГП не из ППС).
# Адъюнкты и военнослужащие не из ППС (начальники лабораторий) в записку 6 не входят.
SIX_GROUPS = {
    "a": lambda p: _l(p.kind) == "всл" and _l(p.pps) == "ппс" and _no_adj(p),
    "b": lambda p: _l(p.kind) == "гп" and _l(p.pps) == "ппс" and _no_adj(p),
    "c": lambda p: _l(p.kind) == "гп" and _l(p.pps) != "ппс" and _no_adj(p),
}


def six_member(p: Person) -> bool:
    return any(f(p) for f in SIX_GROUPS.values())


def six_groups(people: list[Person], empty_is_present: bool = True) -> dict[str, Counts]:
    """Счётчики колонок записки 6 (SIX_GROUPS)."""
    return {k: count_group(people, f, empty_is_present) for k, f in SIX_GROUPS.items()}


def form_member(v: Variant, p: Person) -> bool:
    """Кто попадает в печатную записку (таблица и списки причин): записка 6 — по её колонкам, остальные —
    как счётчики книги."""
    return six_member(p) if v is Variant.ALL_NO_ADJ else counted(v, p)


def count(v: Variant, people: list[Person], empty_is_present: bool = True) -> Counts:
    """Счётчики варианта. В книге «на лицо» — только «+», пустая клетка не считается нигде.
    В приложении пустая клетка табеля — «на лицо» (решение 2026-11-07); empty_is_present=False — как в книге.
    """
    def code(p: Person) -> str:
        # пустая клетка «на лицо» только у человека из списка варианта (пустые строки табеля не считаются)
        return _l(p.code) or (PRESENT if empty_is_present and in_list(v, p) else "")

    c = Counts(listed=sum(1 for p in people if in_list(v, p)))
    for k in [*CAUSES, PRESENT]:
        c.by_code[k] = sum(1 for p in people if counted(v, p) and code(p) == k)
    return c


def caption(d: dt.date) -> str:
    """PH108: ="на «"&TEXT(TODAY();"Д")&"» "&месяц_род&" "&TEXT(TODAY();"ГГГГ")&" г." """
    return f"на «{d.day}» {MONTHS_GEN[d.month - 1]} {d.year} г."


def causes_line(c: Counts) -> dict[str, str]:
    """Строка причин под таблицей записки: «Болен - N» и т.д. (в книге «Комнадировка» в одной форме — опечатка)."""
    return {
        "б": f"Болен - {c.by_code['б']}",
        "н": f"Наряд - {c.by_code['н']}",
        "к": f"Командировка - {c.by_code['к']}",
        "о": f"Отпуск - {c.by_code['о']}",
        "з": f"Занятия - {c.by_code['з']}",
        "х": f"Откомандировано - {c.by_code['х']}",
    }


ROWS = ("По штату", "По списку", "В строю", "Отсутствуют")


def form_table(
    v: Variant, counts: dict[Variant, Counts], staff: dict[str, int | None], six: dict[str, Counts] | None = None
) -> dict[str, dict[str, int | None]]:
    """Таблица «Личный состав» печатной записки (без колонок оружия и ВиВТ — они в книге пустые).

    Колонки: для записок 1–5 — «офицеры» (a), «ГП» (b), «всего»; для записки 6 — «офицеры ППС» (a),
    «ГП ППС» (b), «ГП ИТС» (c), «всего». staff — введённые вручную числа (в книге константы):
    «по штату» по колонкам. Формулы записок 1–5 повторяют ячейки PI113…PK235 книги.

    Ошибка книги (исправлено), записка 6: «по списку, офицеры ППС» введено вручную (PI245), «в строю» —
    все военнослужащие без адъюнктов (с начальниками лабораторий), «отсутствуют» — военнослужащие ППС, а колонки
    ГП получаются вычитанием этих чисел из счётчиков ППС. Наборы людей в строках разные, поэтому «по списку» ≠
    «в строю» + «отсутствуют» (на реальных данных: по списку 21, в строю 23). Здесь каждая колонка — одна группа
    людей по шапке (SIX_GROUPS): офицеры ППС, ГП ППС, ГП ИТС; по списку = в строю + отсутствуют.
    """
    c = counts
    T, VSL, PPS, VP = c[Variant.TOTAL], c[Variant.VSL], c[Variant.PPS], c[Variant.VSL_PPS]
    sa, sb, sc = staff.get("a"), staff.get("b"), staff.get("c")
    if v is Variant.TOTAL:
        rows = {
            "По штату": (sa, sb),
            "По списку": (VSL.listed, T.listed - VSL.listed),
            "В строю": (VSL.present, T.present - VSL.present),
            "Отсутствуют": (VSL.absent, T.absent - VSL.absent),
        }
    elif v is Variant.PPS:
        rows = {
            "По штату": (sa, sb),
            "По списку": (VP.listed, PPS.listed - VP.listed),
            "В строю": (VP.present, PPS.present - VP.present),
            "Отсутствуют": (VP.absent, PPS.absent - VP.absent),
        }
    elif v in (Variant.VSL, Variant.VSL_PPS, Variant.VSL_NO_ADJ):
        x = c[v]
        rows = {
            "По штату": (sa, None),
            "По списку": (x.listed, None),
            "В строю": (x.present, None),
            "Отсутствуют": (x.absent, None),
        }
    else:  # записка 6: «всл, гп ппс, итс без А»
        g = six or {}
        cols = ("a", "b", "c")
        out = {
            "По штату": {"a": sa, "b": sb, "c": sc},
            "По списку": {k: g[k].listed for k in cols},
            "В строю": {k: g[k].present for k in cols},
            "Отсутствуют": {k: g[k].absent for k in cols},
        }
        for r in out.values():
            r["total"] = sum(x or 0 for x in (r["a"], r["b"], r["c"]))
        return out
    out = {}
    for name, (a, b) in rows.items():
        out[name] = {"a": a, "b": b, "total": (a or 0) + (b or 0)}
    return out


def form_counts(v: Variant, counts: dict[Variant, Counts], six_total: Counts | None = None) -> Counts:
    """Чьи счётчики причин печатаются под таблицей записки.

    Ошибка книги (исправлено): в записке «ппс» «Болен» берётся из счётчика всл (NT26), а не ппс (NT38).
    Записка 6 — по её колонкам (six_total = count_group(people, six_member)), а не по счётчику «без адъюнктов»
    книги, где есть и начальники лабораторий.
    """
    if v is Variant.ALL_NO_ADJ and six_total is not None:
        return six_total
    return counts[v]
