from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
import asyncpg
from datetime import datetime, date

from ...repositories.references import ReferenceRepository
from ...core.database import get_db_connection
from ...schemas.references import (
    AllReferencesResponse,
    CatalogItem,
    CourseItem,
    GroupItem,
    TeacherItem,
    PeriodItem,
    PeriodsForYearResponse,
    PeriodsForDateResponse,
    StudyYearResponse,
)
from ...core.calendar_utils import get_academic_year_info

router = APIRouter()


@router.get("/all", response_model=AllReferencesResponse, summary="Все справочники разом (для загрузки страницы)")
async def get_all_references(conn: asyncpg.Connection = Depends(get_db_connection)):
    repo = ReferenceRepository(conn)
    return await repo.get_all_references()


@router.get("/teachers", response_model=List[TeacherItem], summary="Список преподавателей")
async def get_teachers(conn: asyncpg.Connection = Depends(get_db_connection)):
    repo = ReferenceRepository(conn)
    return await repo.get_teachers()


@router.get("/courses", response_model=List[CourseItem], summary="Список дисциплин")
async def get_courses(conn: asyncpg.Connection = Depends(get_db_connection)):
    repo = ReferenceRepository(conn)
    return await repo.get_courses()


@router.get("/groups", response_model=List[GroupItem], summary="Список групп")
async def get_groups(conn: asyncpg.Connection = Depends(get_db_connection)):
    repo = ReferenceRepository(conn)
    return await repo.get_groups()


@router.get("/rooms", response_model=List[CatalogItem], summary="Список аудиторий")
async def get_rooms(conn: asyncpg.Connection = Depends(get_db_connection)):
    repo = ReferenceRepository(conn)
    return await repo.get_rooms()


@router.get("/pmk", response_model=List[CatalogItem], summary="Список ПМК")
async def get_pmk(conn: asyncpg.Connection = Depends(get_db_connection)):
    repo = ReferenceRepository(conn)
    return await repo.get_pmk()


@router.get("/periods/year", response_model=PeriodsForYearResponse,
            summary="Расписание пар для конкретного учебного года")
async def get_periods_for_year(
        year: int = Query(..., description="Год начала учебного года (например, 2025 или 2026)"),
        conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = ReferenceRepository(conn)
    sy_sql = "SELECT syid FROM public.studyyears WHERE school_year = $1 OR number = $2 LIMIT 1;"
    row = await conn.fetchrow(sy_sql, year, str(year))
    if not row:
        row = await conn.fetchrow("SELECT syid FROM public.studyyears ORDER BY syid DESC LIMIT 1;")

    if not row:
        raise HTTPException(status_code=404, detail="Учебный год не найден в базе")

    s_year_id = row["syid"]
    periods = await repo.get_periods_by_year_id(s_year_id)

    return {
        "study_year": year,
        "s_year_id": s_year_id,
        "periods": periods
    }


@router.get("/periods/date", response_model=PeriodsForDateResponse, summary="Расписание пар для конкретной даты")
async def get_periods_for_date(
        date_str: str = Query(..., alias="date", description="Дата в формате YYYY-MM-DD"),
        conn: asyncpg.Connection = Depends(get_db_connection),
):
    try:
        target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный формат даты, ожидается YYYY-MM-DD")

    repo = ReferenceRepository(conn)
    s_year_id = await repo.get_study_year_by_date(target_date)
    if not s_year_id:
        row = await conn.fetchrow("SELECT syid FROM public.studyyears ORDER BY syid DESC LIMIT 1;")
        s_year_id = row["syid"] if row else None

    if not s_year_id:
        raise HTTPException(status_code=404, detail="Не удалось определить учебный год для указанной даты")

    periods_raw = await repo.get_periods_by_year_id(s_year_id)
    periods_formatted = [
        {
            "index": p["index"],
            "pair_id": p["id"],
            "name": p["name"],
            "short_name": p["short_name"],
            "time_range": p["time_range"],
            "display_text": p["display_text"]
        }
        for p in periods_raw
    ]

    return {
        "date": date_str,
        "periods": periods_formatted
    }


@router.get("/study-year", response_model=StudyYearResponse, summary="Определение текущего учебного года по дате")
async def get_study_year(
        date_str: Optional[str] = Query(None, alias="date", description="Дата (YYYY-MM-DD), по умолчанию текущая"),
        conn: asyncpg.Connection = Depends(get_db_connection),
):
    if date_str:
        try:
            target_date = datetime.strptime(date_str, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Неверный формат даты, ожидается YYYY-MM-DD")
    else:
        target_date = date.today()

    year_info = get_academic_year_info(target_date)
    repo = ReferenceRepository(conn)
    s_year_id = await repo.get_study_year_by_date(target_date)

    return {
        "success": True,
        "study_year": year_info["study_year_full"],
        "study_year_id": s_year_id,
        "study_year_start": year_info["academic_year_start"].strftime("%Y-%m-%d")
    }