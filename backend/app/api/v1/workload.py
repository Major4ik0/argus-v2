# -*- coding: utf-8 -*-
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
import asyncpg

from ...core.database import get_db_connection
from ...schemas.workload import (
    TeacherWorkloadSummary,
    TeacherWorkloadDetail,
    EventTypeDistribution,
    FacultyWorkloadSummary,
)
from ...repositories.workload import WorkloadRepository

router = APIRouter()


@router.get("/teachers", response_model=List[TeacherWorkloadSummary], summary="Нагрузка по преподавателям")
async def get_teachers_workload(
    faculty_id: Optional[int] = Query(None, description="Фильтр по ID факультета"),
    cathedra_id: Optional[int] = Query(None, description="Фильтр по ID кафедры"),
    sh_var_id: Optional[int] = Query(None, description="ID варианта расписания"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = WorkloadRepository(conn)
    return await repo.get_teachers_workload(
        faculty_id=faculty_id,
        cathedra_id=cathedra_id,
        sh_var_id=sh_var_id,
    )


@router.get("/teachers/{teacher_id}", response_model=TeacherWorkloadDetail, summary="Детализация нагрузки преподавателя")
async def get_teacher_workload_detail(
    teacher_id: int,
    sh_var_id: Optional[int] = Query(None, description="ID варианта расписания"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = WorkloadRepository(conn)
    detail = await repo.get_teacher_detailed_workload(teacher_id=teacher_id, sh_var_id=sh_var_id)
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Преподаватель с ID {teacher_id} не найден",
        )
    return detail


@router.get("/types-distribution", response_model=List[EventTypeDistribution], summary="Распределение по типам занятий")
async def get_event_types_distribution(
    faculty_id: Optional[int] = Query(None, description="Фильтр по факультету"),
    sh_var_id: Optional[int] = Query(None, description="ID варианта расписания"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = WorkloadRepository(conn)
    return await repo.get_event_type_distribution(
        sh_var_id=sh_var_id,
        faculty_id=faculty_id,
    )


@router.get("/faculties", response_model=List[FacultyWorkloadSummary], summary="Распределение нагрузки по факультетам")
async def get_faculties_workload(
    sh_var_id: Optional[int] = Query(None, description="ID варианта расписания"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = WorkloadRepository(conn)
    return await repo.get_faculties_workload(sh_var_id=sh_var_id)