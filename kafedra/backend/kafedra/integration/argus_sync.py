"""Сверка личного состава с АРГУСом: АРГУС — главный источник ФИО, воинского звания и ПМК.

Таблицы АРГУСа (``people``, ``cathedra_personnel``, ``military_rank``, ``pmk``, ``cathedras``) читаем той же
учёткой из схемы ``settings.argus_schema``; в них ничего не пишем. Кафедра связывается с ``cathedras.idcathedra``
(``departments.argus_cid``), человек — с ``people.mid`` (``persons.argus_mid``): первый раз — по ФИО
(без учёта регистра, «ё» и лишних пробелов) или вручную, дальше — по ``mid``. У связанного человека ФИО, звание
и ПМК меняются только сверкой, в карточке они только для чтения.

Звания АРГУСа переводятся в наш справочник ``ranks`` без учёта регистра, пробелов, дефисов и известных опечаток
(«лейтенент»); «без звания» — наше «ГП». Пустое звание или ПМК в АРГУСе — «нет сведений», наше значение не меняем.
Звание, которого нет в справочнике, не применяется и показывается отдельно.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from fastapi import HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..db import models as m
from ..settings import settings

FIELDS = ("full_name", "rank", "pmk")
TITLES = {"full_name": "ФИО", "rank": "Звание", "pmk": "ПМК"}
GP = "ГП"


@dataclass
class ArgusPerson:
    mid: int
    full_name: str
    rank_title: str
    pmk_name: str


def _schema() -> str:
    s = settings.argus_schema
    if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", s):
        raise ValueError(f"Недопустимое имя схемы АРГУСа: {s!r}")
    return f'"{s}"'


def norm_name(s: str | None) -> str:
    return " ".join((s or "").replace("ё", "е").replace("Ё", "Е").lower().split())


def rank_key(s: str | None) -> str:
    key = re.sub(r"[^а-яa-z]", "", (s or "").lower().replace("ё", "е"))
    return key.replace("лейтенент", "лейтенант")  # опечатка справочника АРГУСа


def map_rank(title: str | None, our_ranks: list[str]) -> str | None:
    """Звание АРГУСа → наше; None — нет сведений или нет такого в справочнике."""
    key = rank_key(title)
    if not key:
        return None
    if key == "беззвания":
        return GP
    return next((r for r in our_ranks if rank_key(r) == key), None)


def map_pmk(name: str | None) -> str | None:
    """«ПМК 2» → «2» (у нас ПМК хранится номером); пусто — нет сведений."""
    name = (name or "").strip()
    if not name:
        return None
    digits = re.findall(r"\d+", name)
    return digits[0] if len(digits) == 1 else name


def available(db: Session) -> bool:
    try:
        return db.execute(text("SELECT to_regclass(:t)"), {"t": f"{_schema()}.people"}).scalar() is not None
    except ValueError:
        return False


def cathedras(db: Session) -> list[dict]:
    s = _schema()
    rows = db.execute(text(
        f"SELECT c.idcathedra, coalesce(c.shortname, ''), coalesce(c.cathedra, ''), "
        f"(SELECT count(DISTINCT cp.mid) FROM {s}.cathedra_personnel cp WHERE cp.cid = c.idcathedra) "
        f"FROM {s}.cathedras c ORDER BY c.idcathedra")).all()  # fmt: skip
    return [{"id": r[0], "short": r[1].strip(), "name": r[2].strip(), "people": r[3]} for r in rows]


def _number(s: str) -> str | None:
    x = re.match(r"\s*(\d+)", s or "")
    return x.group(1) if x else None


def guess_cathedra(dept: m.Department, cats: list[dict]) -> int | None:
    """Кафедра АРГУСа с тем же номером («12 кафедра» ↔ «12 КАФ»), если такая одна (с людьми — в приоритете)."""
    num = _number(dept.name) or _number(dept.short_name)
    same = [c for c in cats if num and _number(c["short"]) == num]
    with_people = [c for c in same if c["people"]]
    pick = with_people if len(with_people) == 1 else same
    return pick[0]["id"] if len(pick) == 1 else None


def argus_people(db: Session, cid: int) -> dict[int, ArgusPerson]:
    s = _schema()
    rows = db.execute(text(
        f"SELECT p.mid, p.lastname, p.firstname, p.patronymic, mr.title, pm.name_pmk "
        f"FROM {s}.cathedra_personnel cp JOIN {s}.people p ON p.mid = cp.mid "
        f"LEFT JOIN {s}.military_rank mr ON mr.id_mil_rank = cp.military_rank "
        f"LEFT JOIN {s}.pmk pm ON pm.id_pmk = cp.id_pmk "
        f"WHERE cp.cid = :cid ORDER BY cp.cpid"), {"cid": cid}).all()  # fmt: skip
    out: dict[int, ArgusPerson] = {}
    for mid, last, first, patr, rank, pmk in rows:
        if mid not in out:  # несколько должностей у одного человека — берём первую строку
            name = " ".join(" ".join(x or "" for x in (last, first, patr)).split())
            out[mid] = ArgusPerson(mid, name, (rank or "").strip(), (pmk or "").strip())
    return dict(sorted(out.items(), key=lambda kv: norm_name(kv[1].full_name)))


def wanted(a: ArgusPerson, our_ranks: list[str]) -> dict[str, str]:
    """Значения из АРГУСа, которые можно применить (без «нет сведений» и неизвестных званий)."""
    vals = {"full_name": a.full_name, "rank": map_rank(a.rank_title, our_ranks), "pmk": map_pmk(a.pmk_name)}
    return {k: v for k, v in vals.items() if v}


def changes(p: m.Person, a: ArgusPerson, our_ranks: list[str]) -> list[dict]:
    out = []
    for f, v in wanted(a, our_ranks).items():
        ours = getattr(p, f) or ""
        same = norm_name(ours) == norm_name(v) if f == "full_name" else ours.strip() == v
        if not same:
            out.append({"field": f, "title": TITLES[f], "ours": ours, "argus": v})
    return out


def _ranks(db: Session, dept_id: int) -> list[str]:
    return list(db.scalars(select(m.Rank.name).where(m.Rank.department_id == dept_id).order_by(m.Rank.sort)))


def _persons(db: Session, dept_id: int) -> list[m.Person]:
    q = (select(m.Person).where(m.Person.department_id == dept_id, m.Person.is_active)
         .order_by(m.Person.sort, m.Person.id))  # fmt: skip
    return list(db.scalars(q))


def _row(status_: str, p: m.Person | None, a: ArgusPerson | None, ranks: list[str]) -> dict:
    return {
        "status": status_,
        "person_id": p.id if p else None,
        "person_name": p.full_name if p else "",
        "person_rank": p.rank if p else "",
        "mid": a.mid if a else (p.argus_mid if p else None),
        "argus_name": a.full_name if a else "",
        "argus_rank": a.rank_title if a else "",
        "argus_pmk": a.pmk_name if a else "",
        "changes": changes(p, a, ranks) if p and a else [],
    }


def preview(db: Session, dept: m.Department, cathedra_id: int | None = None) -> dict:
    """Что изменит сверка: связанные (linked), найденные по ФИО (match), без пары у нас (ours_only) и в АРГУСе
    (argus_only), связанные с человеком, которого больше нет на этой кафедре АРГУСа (lost)."""
    if not available(db):
        return {"available": False, "cathedras": [], "cathedra_id": None, "rows": [], "unknown_ranks": []}
    cats = cathedras(db)
    cid = cathedra_id or dept.argus_cid or guess_cathedra(dept, cats)
    people = argus_people(db, cid) if cid else {}
    ranks = _ranks(db, dept.id)
    persons = _persons(db, dept.id)
    rows, used = [], set()
    for p in persons:
        if p.argus_mid is not None:
            a = people.get(p.argus_mid)
            rows.append(_row("linked" if a else "lost", p, a, ranks))
            used.add(p.argus_mid)
    by_name: dict[str, list[ArgusPerson]] = {}
    for a in people.values():
        if a.mid not in used:
            by_name.setdefault(norm_name(a.full_name), []).append(a)
    free = [p for p in persons if p.argus_mid is None]
    ours_count: dict[str, int] = {}
    for p in free:
        ours_count[norm_name(p.full_name)] = ours_count.get(norm_name(p.full_name), 0) + 1
    for p in free:
        key = norm_name(p.full_name)
        cands = by_name.get(key, [])
        if len(cands) == 1 and ours_count[key] == 1:
            rows.append(_row("match", p, cands[0], ranks))
            used.add(cands[0].mid)
        else:
            rows.append(_row("ours_only", p, None, ranks))
    rows += [_row("argus_only", None, a, ranks) for a in people.values() if a.mid not in used]
    unknown = sorted({a.rank_title for a in people.values() if rank_key(a.rank_title) and
                      map_rank(a.rank_title, ranks) is None})  # fmt: skip
    return {"available": True, "cathedras": cats, "cathedra_id": cid, "linked_cathedra_id": dept.argus_cid,
            "rows": rows, "unknown_ranks": unknown}


class LinkIn(BaseModel):
    person_id: int
    mid: int
    fields: list[str] = list(FIELDS)  # что взять из АРГУСа сейчас


class ApplyIn(BaseModel):
    cathedra_id: int
    links: list[LinkIn] = []
    unlink: list[int] = []  # person_id


def _bad(msg: str) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, msg)


def apply(db: Session, dept: m.Department, data: ApplyIn) -> dict:
    """Связать людей с АРГУСом и взять из него выбранные поля. Значения берутся из АРГУСа заново, не из запроса."""
    if not available(db):
        raise HTTPException(status.HTTP_409_CONFLICT, "Таблиц АРГУСа в базе нет — сверка недоступна")
    if data.cathedra_id not in {c["id"] for c in cathedras(db)}:
        raise _bad("Нет такой кафедры в АРГУСе")
    people = argus_people(db, data.cathedra_id)
    ranks = _ranks(db, dept.id)
    persons = {p.id: p for p in db.scalars(select(m.Person).where(m.Person.department_id == dept.id))}

    mids = [x.mid for x in data.links]
    if len(set(mids)) != len(mids) or len({x.person_id for x in data.links}) != len(data.links):
        raise _bad("Один человек АРГУСа или наш человек указан дважды")
    for pid in [*data.unlink, *(x.person_id for x in data.links)]:
        if pid not in persons:
            raise _bad("Нет такого человека на кафедре")
    for x in data.links:
        if x.mid not in people:
            raise _bad(f"В АРГУСе на этой кафедре нет человека с номером {x.mid}")
        holder = next((p for p in persons.values() if p.argus_mid == x.mid), None)
        if holder and holder.id != x.person_id and holder.id not in data.unlink:
            raise _bad(f"Человек АРГУСа уже связан: {holder.full_name}")

    dept.argus_cid = data.cathedra_id
    touched = {*data.unlink, *(x.person_id for x in data.links)}
    for pid in touched:  # сначала снимаем связи — иначе обмен парами нарушит уникальность
        persons[pid].argus_mid = None
    db.flush()
    updated = 0
    for x in data.links:
        p, a = persons[x.person_id], people[x.mid]
        p.argus_mid = x.mid
        vals = wanted(a, ranks)
        diff = {c["field"] for c in changes(p, a, ranks)}
        for f in set(x.fields) & diff:
            setattr(p, f, vals[f])
            if f == "rank":
                p.kind = GP if vals[f] == GP else ("всл" if p.kind == GP else p.kind)
            updated += 1
    db.commit()
    return {"linked": len(data.links), "unlinked": len(data.unlink), "updated_fields": updated}
