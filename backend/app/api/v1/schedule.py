# -*- coding: utf-8 -*-
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
import asyncpg
from pydantic import BaseModel

from ...core.database import get_db_connection
from ...schemas.schedule import (
    ScheduleItemResponse,
    ScheduleCreateSchema,
    ScheduleUpdateSchema,
    ScheduleMoveSchema,
)
from ...repositories.schedule import ScheduleRepository

router = APIRouter()


# 1. Месячный календарь (статический маршрут)
@router.get("/calendar", summary="Календарная сетка расписания за месяц для выбранных преподавателей")
async def get_calendar_schedule(
    month: str = Query(..., description="Месяц в формате YYYY-MM (например, 2026-10)"),
    teachers: str = Query(..., description="ID преподавателей через запятую (например, 1,2,5)"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    try:
        year_str, month_str = month.split("-")
        year, month_int = int(year_str), int(month_str)
        teacher_ids = [int(t.strip()) for t in teachers.split(",") if t.strip()]
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Некорректный формат параметров. Ожидается month=YYYY-MM и teachers=1,2,3"
        )

    if not teacher_ids:
        return []

    repo = ScheduleRepository(conn)
    return await repo.get_monthly_schedule(year, month_int, teacher_ids)


# 2. Общая сетка
@router.get("/", response_model=List[ScheduleItemResponse], summary="Получить сетку расписания")
async def get_schedule(
    teacher_id: Optional[int] = Query(None, description="Фильтр по преподавателю (mid)"),
    group_id: Optional[int] = Query(None, description="Фильтр по учебной группе (gid)"),
    day_of_week: Optional[int] = Query(None, ge=1, le=7, description="День недели (1-7)"),
    sh_var_id: Optional[int] = Query(None, description="ID варианта расписания"),
    cathedra_id: Optional[int] = Query(None, description="ID кафедры"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = ScheduleRepository(conn)
    return await repo.get_schedule(
        teacher_id=teacher_id,
        group_id=group_id,
        day_of_week=day_of_week,
        sh_var_id=sh_var_id,
        cathedra_id=cathedra_id,
    )


# 3. Маршрут получения пары по ID (вынесен в /item/{sheid})
@router.get("/item/{sheid}", response_model=ScheduleItemResponse, summary="Получить пару по ID")
async def get_schedule_item(
    sheid: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = ScheduleRepository(conn)
    item = await repo.get_by_id(sheid)
    if not item:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Запись расписания #{sheid} не найдена"
        )
    return item


@router.post("/", response_model=ScheduleItemResponse, status_code=status.HTTP_201_CREATED, summary="Создать новую пару")
async def create_schedule_item(
    payload: ScheduleCreateSchema,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = ScheduleRepository(conn)
    new_id = await repo.create(payload.model_dump())
    item = await repo.get_by_id(new_id)
    return item


@router.put("/item/{sheid}", response_model=ScheduleItemResponse, summary="Обновить пару")
async def update_schedule_item(
    sheid: int,
    payload: ScheduleUpdateSchema,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = ScheduleRepository(conn)
    success = await repo.update(sheid, payload.model_dump(exclude_unset=True))
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Запись расписания #{sheid} не найдена или не обновлена"
        )
    return await repo.get_by_id(sheid)


@router.patch("/item/{sheid}/move", response_model=ScheduleItemResponse, summary="Переместить пару (Drag-and-Drop)")
async def move_schedule_item(
    sheid: int,
    payload: ScheduleMoveSchema,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = ScheduleRepository(conn)
    success = await repo.move_slot(sheid, payload.day_of_week, payload.period)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Не удалось переместить запись #{sheid}"
        )
    return await repo.get_by_id(sheid)


@router.delete("/item/{sheid}", status_code=status.HTTP_204_NO_CONTENT, summary="Удалить пару")
async def delete_schedule_item(
    sheid: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = ScheduleRepository(conn)
    success = await repo.delete(sheid)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Запись расписания #{sheid} не найдена"
        )
    return None


class SwapScheduleRequest(BaseModel):
    from_teacher: str
    to_teacher: str
    date: str  # YYYY-MM-DD
    pair_index: int
    schedule_id: int


@router.post("/swap", summary="Замена преподавателя на занятии (с проверкой коллизий)")
async def swap_schedule(
    payload: SwapScheduleRequest,
    conn: asyncpg.Connection = Depends(get_db_connection)
):
    find_teacher_sql = """
        SELECT mid FROM public.people 
        WHERE TRIM(CONCAT_WS(' ', lastname, firstname, patronymic)) = $1
        LIMIT 1;
    """
    to_row = await conn.fetchrow(find_teacher_sql, payload.to_teacher)
    if not to_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Преподаватель '{payload.to_teacher}' не найден"
        )
    to_mid = to_row["mid"]

    pair_row = await conn.fetchrow(
        "SELECT sheid, sh_var_id, period, day_of_week FROM public.nnz_schedule WHERE sheid = $1;",
        payload.schedule_id
    )
    if not pair_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Занятие #{payload.schedule_id} не найдено"
        )

    conflict_sql = """
        SELECT sheid FROM public.nnz_schedule
        WHERE sh_var_id = $1 
          AND period = $2 
          AND day_of_week = $3 
          AND $4 = ANY(teacher_mid)
        LIMIT 1;
    """
    conflict = await conn.fetchval(
        conflict_sql,
        pair_row["sh_var_id"],
        pair_row["period"],
        pair_row["day_of_week"],
        to_mid
    )
    if conflict:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"У преподавателя '{payload.to_teacher}' уже есть занятие в этот слот!"
        )

    cathedra_sql = "SELECT idcathedra FROM public.cathedra_personnel WHERE mid = $1 LIMIT 1;"
    idcathedra = await conn.fetchval(cathedra_sql, to_mid)

    update_sql = """
        UPDATE public.nnz_schedule
        SET teacher_mid = ARRAY[$1]::integer[],
            idcathedra = COALESCE($2, idcathedra)
        WHERE sheid = $3;
    """
    await conn.execute(update_sql, to_mid, idcathedra, payload.schedule_id)

    return {
        "success": True,
        "message": f"Занятие #{payload.schedule_id} перенесено с '{payload.from_teacher}' на '{payload.to_teacher}'"
    }