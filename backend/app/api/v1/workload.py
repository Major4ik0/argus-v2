# -*- coding: utf-8 -*-
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
import asyncpg

from ...core.database import get_db_connection
from ...schemas.workload import (
    WorkloadKPISummary,
    TeacherWorkloadCard,
    TeacherWorkloadDetailResponse,
    EventTypeDistribution,
)
from ...repositories.workload import WorkloadRepository

router = APIRouter()


@router.get(
    "/kpi",
    response_model=WorkloadKPISummary,
    summary="Сводные KPI-показатели нагрузки кафедры",
    description="Возвращает 4 верхних показателя: общие часы, задействованных преподавателей, всего занятий и среднюю нагрузку.",
)
async def get_workload_kpi(
    sh_var_id: Optional[int] = Query(None, description="ID варианта расписания"),
    cathedra_id: Optional[int] = Query(None, description="ID кафедры"),
    pmk_id: Optional[int] = Query(None, description="ID ПМК (1 или 2)"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = WorkloadRepository(conn)
    return await repo.get_workload_kpi(
        sh_var_id=sh_var_id,
        cathedra_id=cathedra_id,
        pmk_id=pmk_id,
    )


@router.get(
    "/teachers",
    response_model=List[TeacherWorkloadCard],
    summary="Список преподавателей с часами по видам занятий",
    description="Возвращает преподавателей с детальной разбивкой (лекции, практики, лабы, экзамены, курсовые, всего, процент нагрузки).",
)
async def get_teachers_workload(
    sh_var_id: Optional[int] = Query(None, description="ID варианта расписания"),
    cathedra_id: Optional[int] = Query(None, description="ID кафедры"),
    pmk_id: Optional[int] = Query(None, description="ID ПМК (1 или 2)"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = WorkloadRepository(conn)
    return await repo.get_teachers_workload_cards(
        sh_var_id=sh_var_id,
        cathedra_id=cathedra_id,
        pmk_id=pmk_id,
    )


@router.get(
    "/teachers/{teacher_id}/detail",
    response_model=TeacherWorkloadDetailResponse,
    summary="Детализация нагрузки преподавателя для модального окна",
    description="Возвращает подробный список всех дисциплин, групп и академических часов конкретного педагога.",
)
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
            detail=f"Преподаватель с ID {teacher_id} не найден в штате",
        )
    return detail


# Сохраняем обратную совместимость для старого вызова /teachers/{teacher_id}
@router.get(
    "/teachers/{teacher_id}",
    response_model=TeacherWorkloadDetailResponse,
    summary="Детализация нагрузки преподавателя (обратная совместимость)",
    include_in_schema=False,
)
async def get_teacher_workload_detail_compat(
    teacher_id: int,
    sh_var_id: Optional[int] = Query(None),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = WorkloadRepository(conn)
    detail = await repo.get_teacher_detailed_workload(teacher_id=teacher_id, sh_var_id=sh_var_id)
    if not detail:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Преподаватель с ID {teacher_id} не найден в штате",
        )
    return detail


@router.get(
    "/types-distribution",
    response_model=List[EventTypeDistribution],
    summary="Распределение часов по видам занятий для графиков",
    description="Возвращает процентное соотношение лекций, практик, лабораторных, экзаменов и курсовых.",
)
async def get_types_distribution(
    sh_var_id: Optional[int] = Query(None, description="ID варианта расписания"),
    cathedra_id: Optional[int] = Query(None, description="ID кафедры"),
    pmk_id: Optional[int] = Query(None, description="ID ПМК (1 или 2)"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = WorkloadRepository(conn)
    return await repo.get_types_distribution(
        sh_var_id=sh_var_id,
        cathedra_id=cathedra_id,
        pmk_id=pmk_id,
    )
