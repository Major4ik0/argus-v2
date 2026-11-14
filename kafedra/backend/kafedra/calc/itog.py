"""Итоговые показатели укомплектованности (лист «ИТОГ») и план сохранения научного потенциала («Прил. 1»)."""

from __future__ import annotations

from . import excel
from .svodnaya import Computed, Row, Section, _blank, _num


def _is_officer(r: Row) -> bool:
    return not _blank(r.category) and str(r.category).strip().lower() != "гп"


def _is_civil(r: Row) -> bool:
    return str(r.category or "").strip().lower() == "гп"


def itog(rows: list[Row], comp: Computed) -> dict[str, object]:
    """Ячейки листа «ИТОГ».

    Строка 4 — весь личный состав, строка 8 — только ППС; колонки: итого / оф. / ГП для «по штату», «по списку»,
    «некомплект», «% укомплектованности». «Офицеры» — должности с воинским званием в любом подразделении
    (в книге — Сводная!A33+2 и SUM(D4:D33; D98; D114) с привязкой к конкретным строкам лабораторий).

    Ошибка книги (исправлено): «ППС по списку» (D8, F8) в книге берёт диапазоны до строки 94 и теряет последнюю
    строку раздела (0,5 ставки).
    """
    t = comp.totals
    cells = [comp.cells[str(i)] for i in range(len(rows))]
    pps = [(r, c) for r, c in zip(rows, cells, strict=True) if r.section in (Section.MIL, Section.CIV)]

    def numbered(sel) -> int:
        return sum(1 for r, c in sel if isinstance(c.get("A"), int | float))

    def fmax(sel, col) -> float:
        return max((c[col] for _, c in sel if isinstance(c.get(col), int | float)), default=0)

    all_rows = list(zip(rows, cells, strict=True))
    v: dict[str, object] = {}
    v["A4"] = numbered(all_rows)
    v["B4"] = sum(1 for r, c in all_rows if _is_officer(r) and isinstance(c.get("A"), int | float))
    v["C4"] = sum(1 for r, _ in all_rows if _is_civil(r) and r.section is not Section.MIL)
    v["D4"] = t["F149"]
    v["E4"] = sum(_num(r.rate) for r, _ in all_rows if _is_officer(r))
    v["F4"] = t["G149"]
    mil = [(r, c) for r, c in pps if r.section is Section.MIL]
    civ = [(r, c) for r, c in pps if r.section is Section.CIV]
    v["A8"] = numbered(pps)
    v["B8"] = numbered(mil)
    v["C8"] = numbered(civ)
    v["D8"] = fmax(pps, "F")
    v["E8"] = fmax(mil, "F")
    v["F8"] = fmax(civ, "G")
    for row in ("4", "8"):
        a, b, c, d, e, f = (v[f"{x}{row}"] for x in "ABCDEF")
        v[f"G{row}"], v[f"H{row}"], v[f"I{row}"] = a - d, b - e, c - f
        v[f"J{row}"], v[f"K{row}"], v[f"L{row}"] = d * 100 / a, e * 100 / b, f * 100 / c
    v["N3"] = f"{excel.text(t['K106'])} / {excel.text(t['K108'])}"
    v["O3"] = f"{excel.text(t['K107'])} / {excel.text(t['K109'])}"
    v["P3"] = t["AJ97"]
    v["Q3"] = t["K106"] + t["K107"]
    v["R3"] = v["Q3"] / v["D8"]
    v["S3"] = (v["Q3"] + v["P3"]) / v["D8"]
    return v


def pril1(
    pps_staff: float, pps_list_people: float, comp: Computed, plan: list[tuple[float, float]]
) -> dict[str, object]:
    """«Прил. 1» строки 14–15: текущее состояние и план по годам.

    pps_staff, pps_list_people — «Структура кафедры» F54/F55 (ППС по штату, по списку реально чел.);
    plan — по годам (назначатся, защитятся): K25/L25, M25/N25, O25/P25.
    """
    v: dict[str, object] = {"A14": pps_staff, "B14": pps_list_people}
    c14 = comp.totals["K97"]
    v["C14"] = c14
    v["D14"] = comp.totals["K106"] + comp.totals["K107"]
    staff, sci = c14, v["D14"]
    for (appointed, defended), (cs, cd) in zip(plan, (("K", "L"), ("M", "N"), ("O", "P")), strict=False):
        staff += appointed or 0
        sci += defended or 0
        v[f"{cs}14"], v[f"{cd}14"] = staff, sci
        v[f"{cd}15"] = sci / c14
    v["D15"] = v["D14"] / c14
    return v
