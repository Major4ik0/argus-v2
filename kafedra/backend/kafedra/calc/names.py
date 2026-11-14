"""ФИО: родительный падеж (порт VBA GenitiveCase) и формы инициалов (лист Database, колонки G, H, I, J).

Порт повторяет макрос книги буквально, включая его особенности:
  * сравнения без учёта регистра (Option Compare Text), регистр результата не меняется —
    StrConv(..., vbUnicode + vbProperCase) в макросе падает и пропускается (On Error Resume Next);
  * «Швец» → «ШвецА», «Кравец» (м.) → «КравЦА» — заглавные буквы зашиты в макросе;
  * пол определяется по окончанию третьего слова («...на»/«...ызы» — женский).
"""

from __future__ import annotations

_VOWELS = set("уеыаоэяиюё")


def _eq(a: str, b: str) -> bool:
    return a.lower() == b.lower()


def _right(s: str, n: int) -> str:
    return s[-n:] if n <= len(s) else s


def _mid(s: str, start: int, length: int) -> str:
    """VBA Mid(s, start, length), start с 1."""
    return s[start - 1 : start - 1 + max(length, 0)]


def _excel_trim(s: str) -> str:
    return " ".join(p for p in s.split(" ") if p)


def _decline_surname_part(part: str, male: bool, idx: int, last_idx: int) -> str:
    low = part.lower()
    n = len(part)
    res = ""
    if male:
        r1 = _right(part, 1).lower()
        if r1 in ("о", "и", "ы", "у", "э", "е", "ю", "і"):
            res = part
        elif r1 in ("й", "ь"):
            res = _mid(part, 1, n - 1) + "я"
        elif r1 == "я":
            res = _mid(part, 1, n - 1) + "и"
        elif r1 == "а":
            res = _mid(part, 1, n - 1) + "ы"
            if last_idx > 0 and idx == 0:
                res = part
        else:
            res = part + "а"

        r2 = _right(part, 2).lower()
        if r2 == "ец":
            res = _mid(part, 1, n - 2) + "ЦА"
            if n >= 3 and low[-3] in _VOWELS:  # Like "*[УЕЫАОЭЯИЮЁ]ЕЦ"
                res = _mid(part, 1, n - 1) + "ЦА"
            if n >= 4 and low[-3] not in _VOWELS and low[-4] not in _VOWELS:  # Like "*[!..][!..]ЕЦ"
                res = part + "А"
        elif r2 in ("зе", "их", "ых"):
            res = part
        elif r2 in ("ый", "ий", "ой"):
            res = _mid(part, 1, n - 2) + "ого"
        elif r2 == "ок":
            res = _mid(part, 1, n - 2) + "ка"
        elif r2 in ("га", "ка", "ха", "ча"):
            res = _mid(part, 1, n - 1) + "и"
            if _eq(_right(part, 3), "чий"):  # недостижимо (оканчивается на «а»), оставлено как в макросе
                res = _mid(part, 1, n - 2) + "его"
        elif r2 == "уй":
            res = _mid(part, 1, n - 2) + "уя"

        r3 = _right(part, 3).lower()
        if r3 in ("чий", "щий"):
            res = _mid(part, 1, n - 2) + "его"
        elif r3 == "тий":
            res = _mid(part, 1, n - 1) + "я"
        elif r3 == "рок":
            res = _mid(part, 1, n - 1) + "ка"
    else:
        r1 = _right(part, 1).lower()
        if r1 in set("оеэиыуюбвгджзклмнпрстфхцчшщьй"):
            res = part
        elif r1 == "а":
            res = _mid(part, 1, n - 1) + "ой"
        elif r1 == "я":
            res = _mid(part, 1, n - 1) + "ю"
        else:
            res = _mid(part, 1, n - 1) + "у"
        r2 = _right(part, 2).lower()
        if r2 == "ха":
            res = _mid(part, 1, n - 2) + "хи"
        elif r2 == "ла":
            res = _mid(part, 1, n - 2) + "лы"
        elif r2 == "ая":
            res = _mid(part, 1, n - 2) + "ой"

    # не склоняются фамилии на -а с предшествующей гласной
    if n >= 2 and low[-1] == "а" and low[-2] in _VOWELS:
        res = part
    return res


_NAME_EXCEPTIONS = {"павел": "Павла", "лев": "Льва", "пётр": "Петра", "любовь": "Любови"}
_NAME_UNCHANGED = {"али", "бали"}


def genitive_case(fio: str | None) -> str:
    """Родительный падеж ФИО — точный порт VBA GenitiveCase(sSurname)."""
    s = fio or ""
    s = s.replace(" - ", "-").replace(" -", "-").replace("- ", "-")
    arr = _excel_trim(s).split(" ") if _excel_trim(s) else []
    surname, name, patr = s, "", ""
    # sSurname = arr(0): sName = arr(1): sPatronymic = Replace(arr(2), ".", "") — ошибки пропускаются
    if len(arr) > 0:
        surname = arr[0]
    if len(arr) > 1:
        name = arr[1]
    if len(arr) > 2:
        patr = arr[2].replace(".", "")
    if not arr:
        surname = s

    male = not (_eq(_right(patr, 2), "на") or _eq(_right(patr, 3), "ызы"))
    out = ""
    if surname:
        parts = surname.split("-")
        parts = [_decline_surname_part(p, male, i, len(parts) - 1) for i, p in enumerate(parts)]
        out = "-".join(parts) + " "

    if name:
        low = name.lower()
        if low in _NAME_EXCEPTIONS:
            out += _NAME_EXCEPTIONS[low]
        elif low in _NAME_UNCHANGED:
            out += name
        elif male:
            r1 = name[-1].lower()
            if r1 in ("й", "ь"):
                out += name[:-1] + "я"
            elif r1 == "а":
                out += name[:-1] + "ы"
            elif r1 == "я":
                out += name[:-1] + "и"
            elif r1 == "о":
                out += name
            else:
                out += name + "а"
        else:
            r1 = name[-1].lower()
            if r1 == "а":
                out += name[:-1] + "ы"
            elif r1 == "я":
                out += name[:-1] + "и"
            else:
                out += name
        out += " "

    if patr:
        if (
            _eq(_right(patr, 3), "ұлы")
            or _eq(_right(patr, 4), "қызы")
            or _eq(_right(patr, 4), "оглы")
            or _eq(_right(patr, 4), "кызы")
        ):
            out += patr
        elif male:
            out += patr + "а"
        else:
            out += patr[:-1] + "ы"

    return out.replace("-", "- ").replace("- ", "-")


class ExcelError(Exception):
    """Значение-ошибка Excel (#VALUE!, #N/A …) — для повторения поведения формул в тестах."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _search_space(s: str, start: int = 1) -> int:
    i = s.find(" ", start - 1)
    if i < 0:
        raise ExcelError("#VALUE!")
    return i + 1


def short_name(fio: str | None) -> str:
    """«Фамилия И.О.» — Database!H:
    IFERROR(LEFT(F,SEARCH(" ",F)+1)&"."&MID(F,SEARCH(" ",F,SEARCH(" ",F)+1)+1,1)&".", LEFT(F,SEARCH(" ",F)+1)&".")

    Ошибка книги (исправлено): для ФИО без пробела Excel даёт #VALUE!; здесь — само ФИО.
    """
    f = fio or ""
    try:
        p1 = _search_space(f)
        p2 = _search_space(f, p1 + 1)
        return f[: p1 + 1] + "." + _mid(f, p2 + 1, 1) + "."
    except ExcelError:
        try:
            return f[: _search_space(f) + 1] + "."
        except ExcelError:
            return f


def initial_surname(fio: str | None) -> str:
    """«И.Фамилия » — Database!J: IFERROR(MID(F,FIND(" ",F)+1,1)&"."&LEFT(F,FIND(" ",F)),"").

    С пробелом в конце, как в книге."""
    f = fio or ""
    p = f.find(" ")
    if p < 0:
        return ""
    return f[p + 1 : p + 2] + "." + f[: p + 1]
