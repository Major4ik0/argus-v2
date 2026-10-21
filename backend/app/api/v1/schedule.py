# -*- coding: utf-8 -*-
import re
from typing import List, Optional
from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query, status
import asyncpg
from pydantic import BaseModel, Field

from ...core.database import get_db_connection
from ...schemas.schedule import (
    ScheduleItemResponse,
    ScheduleCreateSchema,
    ScheduleUpdateSchema,
    ScheduleMoveSchema,
    SwapScheduleRequest,
    ConflictCheckResponse,
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
        # Безопасный парсинг: пропускаем нецифровые и пустые токены
        teacher_ids = []
        for t in teachers.split(","):
            t_clean = t.strip()
            if t_clean.isdigit():
                teacher_ids.append(int(t_clean))
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Некорректный формат параметров. Ожидается month=YYYY-MM и teachers=1,2,3"
        )

    if not teacher_ids:
        return []

    repo = ScheduleRepository(conn)
    try:
        return await repo.get_monthly_schedule(year, month_int, teacher_ids)
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка формирования календаря: {e}"
        )


# 2. Общая сетка с фильтрами
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


# 3. Маршрут получения пары по ID
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


# 4. Проверка коллизий в расписании в реальном времени
@router.get("/check-conflict", response_model=ConflictCheckResponse, summary="Проверить занятость преподавателя в слоте")
async def check_teacher_conflict(
    teacher_id: int = Query(..., description="ID преподавателя (mid)"),
    date_str: str = Query(..., alias="date", description="Дата (YYYY-MM-DD)"),
    period: int = Query(..., description="Номер пары (1-4) или period lid"),
    exclude_sheid: Optional[int] = Query(None, description="Исключить ID текущей пары"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    try:
        target_date = date.fromisoformat(date_str)
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный формат даты, ожидается YYYY-MM-DD")

    repo = ScheduleRepository(conn)
    study_year_id = await repo.get_study_year_id_by_date(target_date)
    sh_var_id = await repo.get_sh_var_id_by_date(target_date, study_year_id)
    if not sh_var_id:
        sh_var_id = await repo.get_default_variant(study_year_id)

    period_lid = await repo.get_period_lid(study_year_id, period)
    day_of_week = target_date.isoweekday()

    conflict = await repo.check_conflict(
        sh_var_id=sh_var_id,
        period=period_lid,
        day_of_week=day_of_week,
        teacher_id=teacher_id,
        exclude_sheid=exclude_sheid,
    )

    if conflict:
        c_title = conflict.get("course_alias") or conflict.get("course_title") or "Занятие"
        g_name = conflict.get("group_name") or ""
        r_name = conflict.get("room_name") or ""
        room_str = f", ауд. {r_name}" if r_name else ""
        return ConflictCheckResponse(
            has_conflict=True,
            conflict_lesson=conflict,
            message=f"Преподаватель уже занят: '{c_title}' ({g_name}{room_str}) в этот слот"
        )

    return ConflictCheckResponse(
        has_conflict=False,
        conflict_lesson=None,
        message="Слот свободен для назначения"
    )


# 5. Оперативная замена занятия (Swap Mode)
@router.post("/swap", summary="Оперативная замена занятия (с проверкой коллизий и обновлением слота)")
async def swap_schedule(
    payload: SwapScheduleRequest,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = ScheduleRepository(conn)
    target_mid = payload.target_teacher_id

    # Поддержка текстового имени преподавателя для совместимости
    if target_mid is None and payload.to_teacher:
        find_sql = """
            SELECT mid FROM public.people 
            WHERE TRIM(CONCAT_WS(' ', lastname, firstname, patronymic)) = $1
               OR lastname = $1
            LIMIT 1;
        """
        row = await conn.fetchrow(find_sql, payload.to_teacher.strip())
        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Преподаватель '{payload.to_teacher}' не найден"
            )
        target_mid = row["mid"]

    if target_mid is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Не указан ID замещающего преподавателя (target_teacher_id)"
        )

    try:
        target_date_obj = date.fromisoformat(payload.target_date)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неверный формат целевой даты, ожидается YYYY-MM-DD"
        )

    try:
        result = await repo.swap_lesson(
            sheid=payload.schedule_id,
            target_teacher_id=target_mid,
            target_date=target_date_obj,
            target_period=payload.target_period,
            source_teacher_id=payload.source_teacher_id,
        )
        return result
    except ValueError as e:
        msg = str(e)
        if "уже занят" in msg:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=msg)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=msg)


# 6. Эндпоинты событий (совместимость с фронтендом, строго на nnz_schedule)
class MoveEventRequest(BaseModel):
    event_id: int
    target_teacher_id: int
    target_date: str
    target_period_id: int


@router.post("/events/move", summary="Переместить пару (Drag-and-Drop или Вырезать->Вставить)")
async def move_event_compat(
    payload: MoveEventRequest,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = ScheduleRepository(conn)
    try:
        target_date_obj = date.fromisoformat(payload.target_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный формат даты, ожидается YYYY-MM-DD")

    try:
        result = await repo.swap_lesson(
            sheid=payload.event_id,
            target_teacher_id=payload.target_teacher_id,
            target_date=target_date_obj,
            target_period=payload.target_period_id,
        )
        return {"success": True, "message": "Пара успешно перемещена", "result": result}
    except ValueError as e:
        msg = str(e)
        if "уже занят" in msg:
            raise HTTPException(status_code=409, detail=msg)
        raise HTTPException(status_code=400, detail=msg)


@router.delete("/events/{event_id}", summary="Удалить пару (совместимость)")
async def delete_event_compat(
    event_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    repo = ScheduleRepository(conn)
    success = await repo.delete(event_id)
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Занятие #{event_id} не найдено"
        )
    return {"success": True, "message": f"Занятие #{event_id} удалено"}


class CreateEventRequest(BaseModel):
    teacher_id: Optional[int] = None
    teacher_mids: Optional[List[int]] = None
    teachers: Optional[List[str]] = None
    event_date: str          # YYYY-MM-DD
    period_id: int           # 1, 2, 3, 4
    subject_name: Optional[str] = ""
    group_name: Optional[str] = ""
    classroom: Optional[str] = ""
    faculty_id: Optional[int] = 1
    # Полноструктурированные поля для современного модального окна
    cid: Optional[int] = None
    pair_type_id: Optional[int] = None
    typeid: Optional[int] = None
    lesson_num: Optional[int] = None
    rooms: Optional[List[int]] = None
    room_ids: Optional[List[int]] = None
    rid: Optional[List[int]] = None
    groups: Optional[List[int]] = None
    gid: Optional[int] = None


async def get_period_lid(conn: asyncpg.Connection, s_year_id: Optional[int], pair_index: int) -> int:
    """
    pair_index: 0..3 (индекс пары) или 1..4 (номер пары), либо уже существующий lid из periods.
    Возвращает periods.lid.
    """
    # 1. Если передано число 0..4, это номер пары (1..4) или индекс (0..3)
    if pair_index in (0, 1, 2, 3, 4):
        pair_num = pair_index if pair_index in (1, 2, 3, 4) else (pair_index + 1)
        pattern = f"{pair_num}-я пара%"

        if s_year_id:
            # Поиск по учебному году и названию пары
            row = await conn.fetchrow(
                "SELECT lid FROM public.periods WHERE s_year_id = $1 AND short_time LIKE $2 LIMIT 1;",
                s_year_id, pattern
            )
            if row and row['lid']:
                return row['lid']

            # Fallback по порядку времени (starttime) в этом году
            row = await conn.fetchrow(
                "SELECT lid FROM public.periods WHERE s_year_id = $1 ORDER BY starttime ASC, lid ASC OFFSET $2 LIMIT 1;",
                s_year_id, pair_num - 1
            )
            if row and row['lid']:
                return row['lid']

        # Fallback по любому году
        row = await conn.fetchrow(
            "SELECT lid FROM public.periods WHERE short_time LIKE $1 ORDER BY s_year_id DESC LIMIT 1;",
            pattern
        )
        if row and row['lid']:
            return row['lid']

    # 2. Если pair_index не 0..4 или поиск по номеру пары не нашел lid, проверяем, существует ли такой lid напрямую
    row = await conn.fetchrow("SELECT lid FROM public.periods WHERE lid = $1 LIMIT 1;", pair_index)
    if row and row['lid']:
        return row['lid']

    # 3. Дефолтный lid из базы
    def_lid = await conn.fetchval("SELECT lid FROM public.periods ORDER BY lid ASC LIMIT 1;")
    return def_lid or 3


@router.post("/events", summary="Создать пару (совместимость с формой создания на nnz_schedule)")
async def create_event_compat(
    payload: CreateEventRequest,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    try:
        event_date_obj = date.fromisoformat(payload.event_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный формат даты YYYY-MM-DD")

    repo = ScheduleRepository(conn)
    day_of_week = event_date_obj.isoweekday()
    study_year_id = await repo.get_study_year_id_by_date(event_date_obj)
    if not study_year_id:
        study_year_id = await conn.fetchval(
            "SELECT school_year FROM public.studyyears ORDER BY school_year DESC LIMIT 1;"
        ) or 35

    sh_var_id = await repo.get_sh_var_id_by_date(event_date_obj, study_year_id)
    if not sh_var_id:
        sh_var_id = await repo.get_default_variant(study_year_id)

    period_lid = await get_period_lid(conn, study_year_id, payload.period_id)

    # 1. Определение преподавателей (teacher_mid массив)
    t_mids: List[int] = []
    if payload.teacher_mids and len(payload.teacher_mids) > 0:
        t_mids = [int(m) for m in payload.teacher_mids]
    elif payload.teacher_id:
        t_mids = [int(payload.teacher_id)]
    elif payload.teachers and len(payload.teachers) > 0:
        for t_name in payload.teachers:
            row = await conn.fetchrow(
                "SELECT mid FROM public.people WHERE TRIM(CONCAT_WS(' ', lastname, firstname, patronymic)) ILIKE $1 OR lastname ILIKE $1 LIMIT 1;",
                t_name.strip()
            )
            if row:
                t_mids.append(row["mid"])
    if not t_mids:
        t_mids = [payload.teacher_id or 1]
    primary_mid = t_mids[0]

    # 2. Определение типа и номера занятия
    pair_type_id = payload.pair_type_id or payload.typeid
    lesson_num = payload.lesson_num

    clean_subj = (payload.subject_name or "").strip()
    if not pair_type_id:
        type_match = re.search(r"\[(.*?)\]", clean_subj)
        if type_match:
            t_alias = type_match.group(1).strip()
            type_row = await conn.fetchrow(
                "SELECT typeid FROM public.eventtools WHERE alias ILIKE $1 OR typename ILIKE $1 LIMIT 1;",
                f"%{t_alias}%"
            )
            if type_row:
                pair_type_id = type_row["typeid"]
            clean_subj = clean_subj.replace(type_match.group(0), "").strip()

    if not pair_type_id:
        def_type = await conn.fetchval(
            "SELECT typeid FROM public.eventtools WHERE alias = 'ГЗ' OR alias = 'Л' ORDER BY typeid DESC LIMIT 1;"
        )
        pair_type_id = def_type or 76

    if lesson_num is None:
        num_match = re.search(r"(?:зан\.?\s*№?|№)\s*(\d+)", clean_subj, re.IGNORECASE)
        if num_match:
            try:
                lesson_num = int(num_match.group(1))
            except ValueError:
                pass
            clean_subj = re.sub(r"\(?зан\.?\s*№?\s*\d+\)?", "", clean_subj, flags=re.IGNORECASE).strip()

    # 3. Поиск или создание курса (cid)
    cid = payload.cid
    if not cid:
        if clean_subj:
            course_row = await conn.fetchrow(
                "SELECT cid FROM public.courses WHERE alias ILIKE $1 OR title ILIKE $1 LIMIT 1;",
                clean_subj
            )
            if course_row:
                cid = course_row["cid"]
            else:
                cid = await conn.fetchval(
                    "INSERT INTO public.courses (alias, title) VALUES ($1, $1) RETURNING cid;",
                    clean_subj
                )
        else:
            cid = await conn.fetchval("SELECT cid FROM public.courses ORDER BY cid LIMIT 1;") or 1

    # 4. Поиск или создание группы (gid)
    g_clean = (payload.group_name or "").strip()
    gid = None

    if g_clean and "-поток" in g_clean:
        group_row = await conn.fetchrow(
            "SELECT gid FROM public.groupname WHERE name ILIKE $1 LIMIT 1;",
            g_clean
        )
        if group_row:
            gid = group_row["gid"]
        else:
            fac_id = 37 if g_clean.startswith("1") else (41 if g_clean.startswith("2") else (payload.faculty_id or 1))
            gid = await conn.fetchval(
                "INSERT INTO public.groupname (name, idfaculty) VALUES ($1, $2) RETURNING gid;",
                g_clean, fac_id
            )

    if not gid:
        gid = payload.gid
        if not gid and payload.groups and len(payload.groups) > 0:
            gid = int(payload.groups[0])

    if not gid and g_clean:
        group_row = await conn.fetchrow(
            "SELECT gid FROM public.groupname WHERE name ILIKE $1 LIMIT 1;",
            g_clean
        )
        if group_row:
            gid = group_row["gid"]
        else:
            gid = await conn.fetchval(
                "INSERT INTO public.groupname (name, idfaculty) VALUES ($1, $2) RETURNING gid;",
                g_clean, payload.faculty_id or 1
            )
    if not gid:
        gid = await conn.fetchval("SELECT gid FROM public.groupname ORDER BY gid LIMIT 1;") or 1

    # 5. Поиск или создание аудиторий (rid)
    rid_list: List[int] = []
    raw_rooms = payload.rooms or payload.room_ids or payload.rid
    if raw_rooms and len(raw_rooms) > 0:
        rid_list = [int(r) for r in raw_rooms]
    elif payload.classroom and payload.classroom.strip() and payload.classroom.strip() != "--":
        r_clean = payload.classroom.strip()
        room_row = await conn.fetchrow(
            "SELECT rid FROM public.rooms WHERE short_name ILIKE $1 OR name ILIKE $1 LIMIT 1;",
            r_clean
        )
        if room_row:
            rid_list.append(room_row["rid"])
        else:
            new_rid = await conn.fetchval(
                "INSERT INTO public.rooms (short_name, name) VALUES ($1, $1) RETURNING rid;",
                r_clean
            )
            rid_list.append(new_rid)

    # 6. Кафедра преподавателя
    idcathedra = await conn.fetchval(
        "SELECT cid FROM public.cathedra_personnel WHERE mid = $1 LIMIT 1;",
        primary_mid
    )
    if not idcathedra:
        idcathedra = await conn.fetchval(
            "SELECT idcathedra FROM public.groupname WHERE gid = $1 LIMIT 1;",
            gid
        )
    if not idcathedra:
        idcathedra = await conn.fetchval(
            "SELECT cid FROM public.cathedra_personnel LIMIT 1;"
        ) or 151

    # 7. Вставка в nnz_schedule
    insert_sql = """
        INSERT INTO public.nnz_schedule (
            cid, rid, gid, teacher_mid, sh_var_id, period,
            day_of_week, pair_type_id, idcathedra, lesson_num
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING sheid;
    """
    new_sheid = await conn.fetchval(
        insert_sql,
        cid,
        rid_list,
        gid,
        t_mids,
        sh_var_id,
        period_lid,
        day_of_week,
        pair_type_id,
        idcathedra,
        lesson_num
    )

    return {"success": True, "schedule_id": new_sheid, "sheid": new_sheid}


@router.put("/events/{event_id}", summary="Обновить пару (совместимость с формой редактирования)")
async def update_event_compat(
    event_id: int,
    payload: CreateEventRequest,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    try:
        event_date_obj = date.fromisoformat(payload.event_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Неверный формат даты YYYY-MM-DD")

    repo = ScheduleRepository(conn)
    day_of_week = event_date_obj.isoweekday()
    study_year_id = await repo.get_study_year_id_by_date(event_date_obj)
    if not study_year_id:
        study_year_id = await conn.fetchval(
            "SELECT school_year FROM public.studyyears ORDER BY school_year DESC LIMIT 1;"
        ) or 35

    sh_var_id = await repo.get_sh_var_id_by_date(event_date_obj, study_year_id)
    if not sh_var_id:
        sh_var_id = await repo.get_default_variant(study_year_id)

    period_lid = await get_period_lid(conn, study_year_id, payload.period_id)

    # 1. Определение преподавателей (teacher_mid массив)
    t_mids: List[int] = []
    if payload.teacher_mids and len(payload.teacher_mids) > 0:
        t_mids = [int(m) for m in payload.teacher_mids]
    elif payload.teacher_id:
        t_mids = [int(payload.teacher_id)]
    elif payload.teachers and len(payload.teachers) > 0:
        for t_name in payload.teachers:
            row = await conn.fetchrow(
                "SELECT mid FROM public.people WHERE TRIM(CONCAT_WS(' ', lastname, firstname, patronymic)) ILIKE $1 OR lastname ILIKE $1 LIMIT 1;",
                t_name.strip()
            )
            if row:
                t_mids.append(row["mid"])
    if not t_mids:
        t_mids = [payload.teacher_id or 1]
    primary_mid = t_mids[0]

    # 2. Определение типа и номера занятия
    pair_type_id = payload.pair_type_id or payload.typeid
    lesson_num = payload.lesson_num

    clean_subj = (payload.subject_name or "").strip()
    if not pair_type_id:
        type_match = re.search(r"\[(.*?)\]", clean_subj)
        if type_match:
            t_alias = type_match.group(1).strip()
            type_row = await conn.fetchrow(
                "SELECT typeid FROM public.eventtools WHERE alias ILIKE $1 OR typename ILIKE $1 LIMIT 1;",
                f"%{t_alias}%"
            )
            if type_row:
                pair_type_id = type_row["typeid"]
            clean_subj = clean_subj.replace(type_match.group(0), "").strip()

    if not pair_type_id:
        def_type = await conn.fetchval(
            "SELECT typeid FROM public.eventtools WHERE alias = 'ГЗ' OR alias = 'Л' ORDER BY typeid DESC LIMIT 1;"
        )
        pair_type_id = def_type or 76

    if lesson_num is None:
        num_match = re.search(r"(?:зан\.?\s*№?|№)\s*(\d+)", clean_subj, re.IGNORECASE)
        if num_match:
            try:
                lesson_num = int(num_match.group(1))
            except ValueError:
                pass
            clean_subj = re.sub(r"\(?зан\.?\s*№?\s*\d+\)?", "", clean_subj, flags=re.IGNORECASE).strip()

    # 3. Поиск или создание курса (cid)
    cid = payload.cid
    if not cid:
        if clean_subj:
            course_row = await conn.fetchrow(
                "SELECT cid FROM public.courses WHERE alias ILIKE $1 OR title ILIKE $1 LIMIT 1;",
                clean_subj
            )
            if course_row:
                cid = course_row["cid"]
            else:
                cid = await conn.fetchval(
                    "INSERT INTO public.courses (alias, title) VALUES ($1, $1) RETURNING cid;",
                    clean_subj
                )
        else:
            cid = await conn.fetchval("SELECT cid FROM public.courses ORDER BY cid LIMIT 1;") or 1

    # 4. Поиск или создание группы (gid)
    g_clean = (payload.group_name or "").strip()
    gid = None

    if g_clean and "-поток" in g_clean:
        group_row = await conn.fetchrow(
            "SELECT gid FROM public.groupname WHERE name ILIKE $1 LIMIT 1;",
            g_clean
        )
        if group_row:
            gid = group_row["gid"]
        else:
            fac_id = 37 if g_clean.startswith("1") else (41 if g_clean.startswith("2") else (payload.faculty_id or 1))
            gid = await conn.fetchval(
                "INSERT INTO public.groupname (name, idfaculty) VALUES ($1, $2) RETURNING gid;",
                g_clean, fac_id
            )

    if not gid:
        gid = payload.gid
        if not gid and payload.groups and len(payload.groups) > 0:
            gid = int(payload.groups[0])

    if not gid and g_clean:
        group_row = await conn.fetchrow(
            "SELECT gid FROM public.groupname WHERE name ILIKE $1 LIMIT 1;",
            g_clean
        )
        if group_row:
            gid = group_row["gid"]
        else:
            gid = await conn.fetchval(
                "INSERT INTO public.groupname (name, idfaculty) VALUES ($1, $2) RETURNING gid;",
                g_clean, payload.faculty_id or 1
            )
    if not gid:
        gid = await conn.fetchval("SELECT gid FROM public.groupname ORDER BY gid LIMIT 1;") or 1

    # 5. Поиск или создание аудиторий (rid)
    rid_list: List[int] = []
    raw_rooms = payload.rooms or payload.room_ids or payload.rid
    if raw_rooms and len(raw_rooms) > 0:
        rid_list = [int(r) for r in raw_rooms]
    elif payload.classroom and payload.classroom.strip() and payload.classroom.strip() != "--":
        r_clean = payload.classroom.strip()
        room_row = await conn.fetchrow(
            "SELECT rid FROM public.rooms WHERE short_name ILIKE $1 OR name ILIKE $1 LIMIT 1;",
            r_clean
        )
        if room_row:
            rid_list.append(room_row["rid"])
        else:
            new_rid = await conn.fetchval(
                "INSERT INTO public.rooms (short_name, name) VALUES ($1, $1) RETURNING rid;",
                r_clean
            )
            rid_list.append(new_rid)

    # 6. Кафедра преподавателя
    idcathedra = await conn.fetchval(
        "SELECT cid FROM public.cathedra_personnel WHERE mid = $1 LIMIT 1;",
        primary_mid
    )
    if not idcathedra:
        idcathedra = await conn.fetchval(
            "SELECT idcathedra FROM public.groupname WHERE gid = $1 LIMIT 1;",
            gid
        )
    if not idcathedra:
        idcathedra = await conn.fetchval(
            "SELECT cid FROM public.cathedra_personnel LIMIT 1;"
        ) or 151

    # 7. Обновление в nnz_schedule
    update_sql = """
        UPDATE public.nnz_schedule
        SET cid = $1,
            rid = $2,
            gid = $3,
            teacher_mid = $4,
            sh_var_id = $5,
            period = $6,
            day_of_week = $7,
            pair_type_id = $8,
            idcathedra = COALESCE($9, idcathedra),
            lesson_num = $10
        WHERE sheid = $11;
    """
    res = await conn.execute(
        update_sql,
        cid,
        rid_list,
        gid,
        t_mids,
        sh_var_id,
        period_lid,
        day_of_week,
        pair_type_id,
        idcathedra,
        lesson_num,
        event_id
    )
    if res != "UPDATE 1":
        raise HTTPException(status_code=404, detail=f"Занятие #{event_id} не найдено")

    return {"success": True, "sheid": event_id}