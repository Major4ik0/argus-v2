# -*- coding: utf-8 -*-
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
import asyncpg

from ...core.database import get_db_connection
from ...schemas.recommendations import (
    RecommendedTeacher,
    ReplacementQuerySchema,
    ApplyReplacementSchema,
    SlotCandidateQuery,
    SlotCandidatesResponse,
    CourseTeachersQuery,
    CourseTeachersResponse,
)
from ...repositories.recommendations import RecommendationsRepository
from ...repositories.schedule import ScheduleRepository

router = APIRouter()


@router.get("/by-pair/{sheid}", response_model=List[RecommendedTeacher], summary="Найти замены для конкретной пары")
async def recommend_for_pair(
    sheid: int,
    teacher_id: Optional[int] = Query(None, description="Кого именно из преподавателей пары требуется заменить"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    schedule_repo = ScheduleRepository(conn)
    pair = await schedule_repo.get_by_id(sheid)
    if not pair:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Занятие #{sheid} не найдено"
        )

    # Если преподаватель не передан явно, берем первого из массива пары
    target_teacher = teacher_id or (pair["teacher_mid"][0] if pair["teacher_mid"] else None)

    rec_repo = RecommendationsRepository(conn)
    return await rec_repo.find_replacements(
        day_of_week=pair["day_of_week"],
        period=pair["period_id"],
        course_id=pair["course_id"],
        current_teacher_id=target_teacher,
        sh_var_id=pair.get("sh_var_id", 1),
    )


@router.post("/search", response_model=List[RecommendedTeacher], summary="Поиск замен по произвольным параметрам")
async def search_replacements(
    payload: ReplacementQuerySchema,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    rec_repo = RecommendationsRepository(conn)
    return await rec_repo.find_replacements(
        day_of_week=payload.day_of_week,
        period=payload.period,
        course_id=payload.course_id,
        current_teacher_id=payload.current_teacher_id,
        sh_var_id=payload.sh_var_id or 1,
    )


@router.post("/apply", summary="Применить замену в расписании")
async def apply_replacement(
    payload: ApplyReplacementSchema,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    rec_repo = RecommendationsRepository(conn)
    success = await rec_repo.apply_replacement(
        sheid=payload.sheid,
        old_teacher_id=payload.old_teacher_id,
        new_teacher_id=payload.new_teacher_id,
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Не удалось применить замену: пара не найдена либо преподаватель не был назначен на это занятие"
        )
    return {"status": "ok", "message": f"Замена в занятии #{payload.sheid} успешно применена"}

@router.post("/candidates-for-slot", response_model=SlotCandidatesResponse, summary="Кандидаты на слот (занятые/свободные на дату и пару)")
async def get_candidates_for_slot(
    payload: SlotCandidateQuery,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    rec_repo = RecommendationsRepository(conn)
    return await rec_repo.get_candidates_for_slot(
        date_str=payload.date,
        pair_index=payload.pair_index,
        group_id=payload.group_id,
        course_id=payload.course_id,
        course_alias=payload.course_alias,
        cathedra_id=payload.cathedra_id,
    )


@router.post("/teachers-for-course", response_model=CourseTeachersResponse, summary="Преподаватели по опыту ведения курса")
async def find_teachers_for_course(
    payload: CourseTeachersQuery,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    rec_repo = RecommendationsRepository(conn)
    result = await rec_repo.find_teachers_for_course(
        course_id=payload.course_id,
        course_alias=payload.course_alias,
        group_id=payload.group_id,
        type_id=payload.type_id,
    )
    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Дисциплина не найдена либо не указана"
        )
    return result