"""Сводные сведения по штату (лист «Сводная»): строки штатного расписания, их расчётные колонки и итоги.

Отчёт строится по упорядоченному списку строк трёх разделов:
  MIL — военнослужащие ППС (строки 5–33 книги, итог — строка 34),
  CIV — гражданский персонал ППС (37–95, итог — 96; общий итог ППС — 97),
  AUX — учебные лаборатории и кабинеты (98–148; входят только в сквозные нумерации).
Строка — либо штатная должность (есть «шт.кат.»: звание или «ГП»), либо второй/третий человек на той же
должности при совмещении (шт.кат. пусто), либо заголовок (название должности/подразделения, ставки нет).
"""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import dataclass, field
from enum import Enum

from . import excel

VACANT = "вакантная"
JUNIOR_OFFICERS = ("к-н", "ст.л-т", "л-т")  # не входят в «комплект ГП» (колонка G)
DOCTOR = ("дтн", "двн", "дэн")
CANDIDATE = ("ктн", "квн", "кэн")
# колонки-признаки, суммируемые в итогах (ставка человека, если признак есть)
FLAG_COLS = ("AA", "AB", "AC", "AD", "AE", "AJ", "AK", "AL")


class Section(Enum):
    MIL = "военнослужащие ППС"
    CIV = "гражданский персонал ППС"
    AUX = "лаборатории и кабинеты"


@dataclass
class Row:
    section: Section
    category: str | None  # B: звание (сокр.) для военнослужащих, «ГП» для гражданских; пусто — не штатная строка
    name: object  # C: ФИО, «Вакантная», заголовок или 0 (ссылка на пустую клетку «Структуры»)
    rate: object = None  # D: ставка (шт. ед.)
    place: str | None = None  # E: основное / совмещение
    code: str | None = None  # J: должность (НК, ЗНК, П, Д, СПК, ПК)
    birth: dt.date | None = None  # N
    ped: list[tuple[dt.date | None, dt.date | None]] = field(default_factory=list)  # P–S: завершённые периоды
    ped_current: dt.date | None = None  # T: начало текущего периода (по дату отчёта)
    degree: str | None = None  # V: учёная степень (КТН, ДТН …)
    ns_old: str | None = None  # W: шифр научной специальности (старый)
    flags: dict[str, object] = field(default_factory=dict)  # AA…AL: П(ДН), П(КН), Д, ДБУС, СНС, ВБД, ГН, ГПЗ
    typed: dict[str, object] = field(default_factory=dict)  # значения, введённые в книге вместо формулы (A, F, G, I)
    count_degree: bool = True  # учитывать учёную степень в итогах (нет — например, человек переведён на другую кафедру)


def _gt0(v) -> bool:
    """Excel «v > 0»: любой текст больше любого числа; пусто — 0."""
    if isinstance(v, str):
        return True
    return isinstance(v, int | float) and not isinstance(v, bool) and v > 0


def _num(v) -> float:
    return float(v) if isinstance(v, int | float) and not isinstance(v, bool) else 0.0


def _vacant(v) -> bool:
    return isinstance(v, str) and v.strip().lower() == VACANT


def _blank(v) -> bool:
    return v is None or v == ""


def is_header(r: Row) -> bool:
    """Заголовок (название должности/подразделения): нет ни ставки, ни шт. категории — в книге у таких строк нет формул."""
    return _blank(r.rate) and _blank(r.category)


def is_person(r: Row) -> bool:
    """M: IF(AND(C>0, C<>"вакантная", C<>""), C, "")."""
    return not is_header(r) and _gt0(r.name) and not _vacant(r.name) and not _blank(r.name)


def age(birth: dt.date | None, as_of: dt.date, precision: float = 1) -> float | None:
    """O: IF(N<>"", FLOOR((TODAY()-N)/365, 1), "").

    Ошибка книги (исправлено): в строке 5 точность 0.1 года вместо целых лет.
    """
    if birth is None:
        return None
    return excel.floor((as_of - birth).days / 365, precision)


def ped_stage(r: Row, as_of: dt.date) -> float | None:
    """U: сумма FLOOR((по−с)/365; 0.1) по двум завершённым периодам + текущий период до даты отчёта; 0 → пусто."""
    total = 0.0
    for start, end in r.ped[:2]:
        if start and end:
            total += excel.floor((end - start).days / 365, 0.1)
    if r.ped_current:
        total += excel.floor((as_of - r.ped_current).days / 365, 0.1)
    return None if total == 0 else total


def degree_share(r: Row, k, kinds: tuple[str, ...]):
    """Y/Z: IF(OR(V="ДТН";V="ДВН";V="ДЭН"); K; "").

    В книге у переведённого на другую кафедру формула удалена (строка 33) — здесь это признак count_degree.
    """
    if not r.count_degree:
        return None
    return k if (r.degree or "").strip().lower() in kinds else None


@dataclass
class Computed:
    cells: dict[str, dict[str, object]]  # по строкам: {"A": …, "F": …}
    totals: dict[str, object]


def compute(rows: list[Row], as_of: dt.date, ns_map: dict[str, object]) -> Computed:
    """Расчётные колонки строк и итоги. rows — в порядке книги; ns_map — шифры НС (Инф.!A:B)."""
    cells: list[dict[str, object]] = []
    a_max = f_max = g_max = 0.0
    civ_i: list[float | None] = []  # колонка I по строкам раздела CIV
    for r in rows:
        c: dict[str, object] = {}
        c["A"] = r.typed.get("A", None)
        if "A" not in r.typed and not _blank(r.category):
            a_max += 1
            c["A"] = a_max
        elif isinstance(c["A"], int | float):
            a_max = max(a_max, c["A"])
        if r.section is Section.MIL:
            d = r.rate
            c["K"] = d if _gt0(d) and not isinstance(d, str) else None
            ok_f = not _blank(d) and _gt0(d) and not _vacant(r.name)
            c["F"] = r.typed.get("F", (f_max + 1) if ok_f else None)
        else:
            d = r.rate
            c["K"] = d if (_gt0(d) and not isinstance(d, str) and not _vacant(r.name)) else None
            ok_f = not _blank(r.name) and not _vacant(r.name) and _gt0(d) and not isinstance(d, str)
            c["F"] = r.typed.get("F", (f_max + _num(d)) if ok_f else None)
            ok_g = (r.category or "") not in JUNIOR_OFFICERS and ok_f
            c["G"] = r.typed.get("G", (g_max + _num(d)) if ok_g else None)
            if isinstance(c["G"], int | float):
                g_max = max(g_max, c["G"])
            if r.section is Section.CIV:
                # I40: IF(AND(C>0; C<>"вакантная"; C<>""); MAX(I$37:I38)+1; "") — максимум до ПОЗАПРОШЛОЙ строки,
                # поэтому второй человек на той же должности (следующая строка) получает тот же номер.
                if "I" in r.typed:
                    c["I"] = r.typed["I"]
                elif is_person(r):
                    window = [x for x in civ_i[:-1] if isinstance(x, int | float)]
                    c["I"] = max(window, default=0) + 1
                else:
                    c["I"] = None
                civ_i.append(c["I"])
        if isinstance(c["F"], int | float):
            f_max = max(f_max, c["F"])
        c["M"] = r.name if is_person(r) else None
        c["O"] = age(r.birth, as_of)
        c["U"] = ped_stage(r, as_of)
        if _blank(r.ns_old):
            c["X"] = None
        else:
            v = ns_map.get(r.ns_old, "")
            c["X"] = 0 if v is None else v
        k = c["K"]
        c["Y"] = degree_share(r, k, DOCTOR)
        c["Z"] = degree_share(r, k, CANDIDATE)
        for col in FLAG_COLS:
            c[col] = r.flags.get(col)
        c["AM"] = r.flags.get("AB") if not _blank(r.flags.get("AB")) else None
        cells.append(c)

    def section_totals(sec: Section) -> dict[str, float]:
        sel = [(r, c) for r, c in zip(rows, cells, strict=True) if r.section is sec]
        t: dict[str, float] = {}
        for col in ("K", "Y", "Z", *FLAG_COLS, "AM"):
            t[col] = sum(_num(c.get(col)) for _, c in sel)
        ages = [c["O"] for _, c in sel if isinstance(c["O"], int | float) and c["O"] > 0]
        t["O_sum"], t["O_n"] = sum(ages), len(ages)
        t["V"] = sum(1 for r, _ in sel if not _blank(r.degree))
        return t

    mil, civ = section_totals(Section.MIL), section_totals(Section.CIV)
    tot: dict[str, object] = {}
    for key, t in (("34", mil), ("96", civ)):
        for col in ("K", "Y", "Z", *FLAG_COLS, "AM"):
            tot[f"{col}{key}"] = t[col]
        tot[f"O{key}"] = t["O_sum"] / t["O_n"] if t["O_n"] else None
        tot[f"AF{key}"] = t["Y"] + t["Z"] + t["AD"]
        tot[f"AG{key}"] = t["Y"] + t["AB"]
        tot[f"AH{key}"] = (t["Y"] + t["Z"]) * 100 / t["K"]
        tot[f"AI{key}"] = (t["Y"] + t["AA"] + t["AB"]) * 100 / t["K"]
    tot["V34"] = mil["V"]
    for col in ("K", "Y", "Z", *FLAG_COLS, "AM"):
        tot[f"{col}97"] = mil[col] + civ[col]
    tot["O97"] = (mil["O_sum"] + civ["O_sum"]) / (mil["O_n"] + civ["O_n"])
    tot["AF97"] = tot["Y97"] + tot["Z97"] + tot["AD97"]
    tot["AG97"] = tot["Y97"] + tot["AB97"]
    tot["AH97"] = (tot["Y97"] + tot["Z97"]) / tot["K97"] * 100
    tot["AI97"] = (tot["Y97"] + tot["AA97"] + tot["AB97"]) * 100 / tot["K97"]

    # итоговый блок K104:L110
    listed = tot["K97"]
    tot["K104"] = max((c["A"] for c in cells if isinstance(c["A"], int | float)), default=0)
    tot["K105"] = listed
    tot["L104"] = listed * 100 / tot["K104"]
    tot["L105"] = (tot["Y97"] + tot["Z97"]) * 100 / listed
    tot["K106"] = tot["Y97"]
    tot["L106"] = tot["K106"] * 100 / listed
    up = math.ceil(listed)
    tot["K107"] = tot["Z97"]
    tot["K108"] = mil["AA"] + mil["AB"] + civ["AA"] + civ["AB"]
    tot["K109"] = tot["AC97"] + tot["AE97"] + tot["AD97"]
    tot["K110"] = tot["AJ97"]
    for r_ in ("107", "108", "109", "110"):
        tot[f"L{r_}"] = tot[f"K{r_}"] * 100 / up
    tot["F149"] = max((c["F"] for c in cells if isinstance(c.get("F"), int | float)), default=0)
    tot["G149"] = max((c["G"] for c in cells if isinstance(c.get("G"), int | float)), default=0)

    # DCOUNTA/DSUM: гражданский персонал на основных строках (B = «ГП») и совместители (B пусто)
    def dq(pred_b):
        sel = [
            r
            for r in rows
            if r.section is not Section.MIL  # диапазон БД в книге — A34:E148
            and pred_b(r.category)
            and not _blank(r.name)
            and not _vacant(r.name)
            and not (isinstance(r.name, str) and r.name.strip().lower().startswith("передан"))
            and _gt0(r.rate)
            and not isinstance(r.rate, str)
            and not _blank(r.place)
        ]
        return len(sel), sum(_num(r.rate) for r in sel)

    tot["C160"], tot["C161"] = dq(lambda b: (b or "").strip().lower() == "гп")  # DCOUNTA, DSUM
    tot["C162"], _ = dq(_blank)  # DCOUNTA
    tot["C163"] = tot["C162"]  # DCOUNT(штед) — число строк с числовой ставкой
    return Computed(cells={str(i): c for i, c in enumerate(cells)}, totals=tot)
