"""Укомплектованность учёными (лист «Ученые»): подсчёты по справочнику личного состава."""

from __future__ import annotations

from dataclasses import dataclass, field

DOCTOR = ("дтн", "двн", "дэн")
CANDIDATE = ("ктн", "квн", "кэн")

# В книге в формулы C3, C5, C10 вписано «−2» без объяснения — ошибка книги, в приложении убрано (см. PROJECT.md).
BOOK_CORRECTION_CELLS = ("C3", "C5", "C10")


@dataclass(frozen=True)
class Member:
    has_fio: bool  # Database!F не пусто
    kind: str  # Database!A: «всл»/«ГП»
    rate: float | str | None  # Database!K: ставка
    pps: str  # Database!W: «ппс»
    degree: str  # Database!X: учёная степень (дтн, ктн, …)
    title: str  # Database!AB: учёное звание (профессор, доцент)


def _l(s) -> str:
    return str(s or "").strip().lower()


def _rate_is(rate, value: float) -> bool:
    """Критерий COUNTIFS "1" / "0,75": совпадает и число, и текст «1»/«0,75»."""
    if isinstance(rate, int | float):
        return abs(float(rate) - value) < 1e-9
    try:
        return abs(float(str(rate).replace(",", ".")) - value) < 1e-9
    except ValueError:
        return False


@dataclass
class Scientists:
    values: dict[str, float] = field(default_factory=dict)

    def __getitem__(self, k: str) -> float:
        return self.values[k]


def rating(share: float) -> str:
    """C21: ≥60% «отлично», ≥50% «хорошо», ≥40% «удовлетворительно», иначе «неудовлетворительно»."""
    if share >= 0.6:
        return "отлично"
    if share >= 0.5:
        return "хорошо"
    if share >= 0.4:
        return "удовлетворительно"
    return "неудовлетворительно"


def compute(members: list[Member]) -> dict[str, object]:
    """Все показатели листа «Ученые» (ключи — ячейки книги), без «−2» книги."""
    m = [x for x in members if x.has_fio]

    def n(pred) -> int:
        return sum(1 for x in m if pred(x))

    def kind(x, k):
        return _l(x.kind) == k

    def pps(x):
        return _l(x.pps) == "ппс"

    v: dict[str, object] = {}
    v["C3"] = n(lambda x: _rate_is(x.rate, 1) and kind(x, "всл"))
    v["C4"] = n(lambda x: (_rate_is(x.rate, 1) or _rate_is(x.rate, 0.75)) and kind(x, "гп"))
    v["C2"] = v["C3"] + v["C4"]
    v["C5"] = n(lambda x: _rate_is(x.rate, 1) and pps(x))
    v["C7"] = n(lambda x: pps(x) and _l(x.degree) in DOCTOR and kind(x, "всл"))
    v["C8"] = n(lambda x: pps(x) and _l(x.degree) in DOCTOR and kind(x, "гп"))
    v["C6"] = v["C7"] + v["C8"]
    v["C10"] = n(lambda x: pps(x) and _l(x.degree) in CANDIDATE and kind(x, "всл"))
    v["C11"] = n(lambda x: pps(x) and _l(x.degree) in CANDIDATE and kind(x, "гп"))
    v["C9"] = v["C10"] + v["C11"]
    v["C12"] = v["C6"] + v["C9"]
    v["C14"] = n(lambda x: pps(x) and _l(x.title) == "профессор" and kind(x, "всл"))
    v["C15"] = n(lambda x: pps(x) and _l(x.title) == "профессор" and kind(x, "гп"))
    v["C13"] = v["C14"] + v["C15"]
    v["C17"] = n(lambda x: pps(x) and _l(x.title) == "доцент" and kind(x, "всл"))
    v["C18"] = n(lambda x: pps(x) and _l(x.title) == "доцент" and kind(x, "гп"))
    v["C16"] = v["C17"] + v["C18"]
    v["C19"] = v["C13"] + v["C16"]
    v["C20"] = v["C12"] / v["C5"] if v["C5"] else 0.0
    v["C21"] = rating(v["C20"])
    return v
