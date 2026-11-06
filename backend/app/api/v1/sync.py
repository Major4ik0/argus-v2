# -*- coding: utf-8 -*-
import json
import logging
import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime
import asyncpg
from fastapi import APIRouter, HTTPException, Depends, status, Query
from pydantic import BaseModel, Field

from ...core.config import settings, write_source_db_config_file
from ...core.database import get_db_connection

logger = logging.getLogger("argus.sync")

router = APIRouter()


class SyncDbConfigPayload(BaseModel):
    host: str = Field(..., description="Хост сервера вторичной БД")
    port: int = Field(default=5432, description="Порт сервера")
    user: str = Field(..., description="Пользователь БД")
    password: Optional[str] = Field(None, description="Пароль пользователя")
    db_name: str = Field(..., description="Имя базы данных")
    enabled: bool = Field(default=True, description="Флаг активности источника")


class SyncExecutePayload(BaseModel):
    entity: str = Field(..., description="Сущность: teachers, groups, courses, schedule")
    selected_ids: List[int] = Field(..., description="Список ID выбранных записей для импорта")
    conflict_strategy: str = Field(default="skip", description="Стратегия коллизий: skip или overwrite")
    sh_var_id: Optional[int] = Field(None, description="ID недели для расписания")


async def connect_source_db(custom_config: Optional[SyncDbConfigPayload] = None) -> asyncpg.Connection:
    """Установка временного соединения со вторичной (источниковой) базой данных."""
    host = custom_config.host.strip() if custom_config else settings.SOURCE_DB_HOST
    port = int(custom_config.port if custom_config else settings.SOURCE_DB_PORT)
    user = custom_config.user.strip() if custom_config else settings.SOURCE_DB_USER
    
    password = settings.SOURCE_DB_PASSWORD
    if custom_config and custom_config.password is not None and custom_config.password != "••••••••":
        password = custom_config.password
        
    db_name = custom_config.db_name.strip() if custom_config else settings.SOURCE_DB_NAME

    try:
        conn = await asyncio.wait_for(
            asyncpg.connect(
                host=host,
                port=port,
                user=user,
                password=str(password),
                database=db_name,
                timeout=4.0,
            ),
            timeout=4.5,
        )
        return conn
    except asyncio.TimeoutError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Таймаут подключения к источнику данных (превышен лимит 4 сек)",
        )
    except Exception as e:
        err_msg = str(e).strip() or type(e).__name__
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Не удалось подключиться к источнику: {err_msg}",
        )


@router.get("/config", summary="Получить параметры подключения ко вторичной БД")
async def get_source_config():
    """Текущая конфигурация вторичной базы данных."""
    return {
        "enabled": settings.SOURCE_DB_ENABLED,
        "host": settings.SOURCE_DB_HOST,
        "port": settings.SOURCE_DB_PORT,
        "user": settings.SOURCE_DB_USER,
        "password": "••••••••" if settings.SOURCE_DB_PASSWORD else "",
        "db_name": settings.SOURCE_DB_NAME,
    }


@router.put("/config", summary="Сохранить параметры подключения ко вторичной БД")
async def update_source_config(payload: SyncDbConfigPayload):
    """Сохранение конфигурации вторичной БД в файл data/source_db_config.json."""
    actual_password = payload.password
    if not actual_password or actual_password == "••••••••":
        actual_password = settings.SOURCE_DB_PASSWORD

    data = {
        "host": payload.host.strip(),
        "port": int(payload.port),
        "user": payload.user.strip(),
        "password": str(actual_password),
        "db_name": payload.db_name.strip(),
        "enabled": bool(payload.enabled),
    }

    write_source_db_config_file(data)
    settings.apply_custom_source_db_config()

    return {
        "status": "ok",
        "message": "Параметры подключения к источнику успешно сохранены",
        "config": {
            "enabled": settings.SOURCE_DB_ENABLED,
            "host": settings.SOURCE_DB_HOST,
            "port": settings.SOURCE_DB_PORT,
            "user": settings.SOURCE_DB_USER,
            "db_name": settings.SOURCE_DB_NAME,
        },
    }


@router.post("/test-connection", summary="Проверка тестового соединения со вторичной БД")
async def test_source_connection(payload: SyncDbConfigPayload):
    """Тестирование доступности вторичной базы данных с переданными параметрами."""
    try:
        conn = await connect_source_db(payload)
        version = await conn.fetchval("SELECT version();")
        await conn.close()
        return {
            "status": "ok",
            "message": "Подключение к источнику успешно установлено",
            "postgres_version": version,
        }
    except HTTPException as he:
        return {
            "status": "error",
            "message": he.detail,
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Ошибка соединения: {str(e)}",
        }


@router.get("/preview", summary="Сравнительный анализ (Diff) сущностей между источником и локальной БД")
async def preview_sync(
    entity: str = Query(..., description="Сущность: teachers, groups, courses, schedule"),
    sh_var_id: Optional[int] = Query(None, description="ID недели для расписания"),
    conn_local: asyncpg.Connection = Depends(get_db_connection),
):
    """
    Выполняет сопоставление записей источника и локальной базы.
    Статусы:
    - to_insert: новая запись, отсутствует в локальной базе.
    - conflict: запись существует, но реквизиты отличаются.
    - identical: запись уже полностью совпадает с локальной.
    """
    if entity not in ("teachers", "groups", "courses", "schedule"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Недопустимый тип сущности. Допустимы: teachers, groups, courses, schedule",
        )

    conn_source = await connect_source_db()
    items = []

    try:
        if entity == "teachers":
            # 1. Сравнение преподавателей
            src_rows = await conn_source.fetch("""
                SELECT 
                    p.mid, p.lastname, p.firstname, p.patronymic, p.degree,
                    cp.cpid, cp.cid AS cathedra_id, cp.id_pmk, cp.positionid
                FROM public.people p
                LEFT JOIN public.cathedra_personnel cp ON p.mid = cp.mid
                ORDER BY p.lastname, p.firstname, p.mid;
            """)

            loc_rows = await conn_local.fetch("""
                SELECT 
                    p.mid, p.lastname, p.firstname, p.patronymic, p.degree,
                    cp.cpid, cp.cid AS cathedra_id, cp.id_pmk, cp.positionid
                FROM public.people p
                LEFT JOIN public.cathedra_personnel cp ON p.mid = cp.mid;
            """)

            loc_by_mid = {r["mid"]: r for r in loc_rows}
            loc_by_name = {
                f"{str(r['lastname']).strip()} {str(r['firstname']).strip()} {str(r['patronymic']).strip()}".lower(): r
                for r in loc_rows
            }

            for s in src_rows:
                s_dict = dict(s)
                s_id = s_dict["mid"]
                full_name = f"{s_dict.get('lastname') or ''} {s_dict.get('firstname') or ''} {s_dict.get('patronymic') or ''}".strip()
                norm_name = full_name.lower()

                matched = loc_by_mid.get(s_id) or loc_by_name.get(norm_name)

                if matched is None:
                    items.append({
                        "id": s_id,
                        "label": full_name or f"Преподаватель #{s_id}",
                        "status": "to_insert",
                        "source_data": s_dict,
                        "local_data": None,
                        "differences": ["Отсутствует в локальной базе"],
                    })
                else:
                    m_dict = dict(matched)
                    diffs = []
                    if (s_dict.get("degree") or 0) != (m_dict.get("degree") or 0):
                        diffs.append(f"Ученая степень: {m_dict.get('degree')} -> {s_dict.get('degree')}")
                    if str(s_dict.get("lastname") or "") != str(m_dict.get("lastname") or ""):
                        diffs.append(f"Фамилия: {m_dict.get('lastname')} -> {s_dict.get('lastname')}")
                    if (s_dict.get("cathedra_id") or 0) != (m_dict.get("cathedra_id") or 0):
                        diffs.append(f"Кафедра: {m_dict.get('cathedra_id')} -> {s_dict.get('cathedra_id')}")

                    if diffs:
                        items.append({
                            "id": s_id,
                            "label": full_name or f"Преподаватель #{s_id}",
                            "status": "conflict",
                            "source_data": s_dict,
                            "local_data": m_dict,
                            "differences": diffs,
                        })
                    else:
                        items.append({
                            "id": s_id,
                            "label": full_name or f"Преподаватель #{s_id}",
                            "status": "identical",
                            "source_data": s_dict,
                            "local_data": m_dict,
                            "differences": [],
                        })

        elif entity == "groups":
            # 2. Сравнение учебных групп
            src_rows = await conn_source.fetch("SELECT gid, name, idcathedra, idfaculty FROM public.groupname ORDER BY name;")
            loc_rows = await conn_local.fetch("SELECT gid, name, idcathedra, idfaculty FROM public.groupname;")

            loc_by_name = {str(r["name"]).strip().lower(): r for r in loc_rows if r["name"]}
            loc_by_gid = {r["gid"]: r for r in loc_rows}

            for s in src_rows:
                s_dict = dict(s)
                s_id = s_dict["gid"]
                name_key = str(s_dict.get("name") or "").strip().lower()

                matched = loc_by_gid.get(s_id) or loc_by_name.get(name_key)

                if matched is None:
                    items.append({
                        "id": s_id,
                        "label": s_dict.get("name") or f"Группа #{s_id}",
                        "status": "to_insert",
                        "source_data": s_dict,
                        "local_data": None,
                        "differences": ["Новая учебная группа"],
                    })
                else:
                    m_dict = dict(matched)
                    diffs = []
                    if (s_dict.get("idcathedra") or 0) != (m_dict.get("idcathedra") or 0):
                        diffs.append(f"Кафедра: {m_dict.get('idcathedra')} -> {s_dict.get('idcathedra')}")
                    if (s_dict.get("idfaculty") or 0) != (m_dict.get("idfaculty") or 0):
                        diffs.append(f"Факультет: {m_dict.get('idfaculty')} -> {s_dict.get('idfaculty')}")

                    if diffs:
                        items.append({
                            "id": s_id,
                            "label": s_dict.get("name") or f"Группа #{s_id}",
                            "status": "conflict",
                            "source_data": s_dict,
                            "local_data": m_dict,
                            "differences": diffs,
                        })
                    else:
                        items.append({
                            "id": s_id,
                            "label": s_dict.get("name") or f"Группа #{s_id}",
                            "status": "identical",
                            "source_data": s_dict,
                            "local_data": m_dict,
                            "differences": [],
                        })

        elif entity == "courses":
            # 3. Сравнение дисциплин
            src_rows = await conn_source.fetch("SELECT cid, title, alias, meta_course FROM public.courses ORDER BY title;")
            loc_rows = await conn_local.fetch("SELECT cid, title, alias, meta_course FROM public.courses;")

            loc_by_title = {str(r["title"]).strip().lower(): r for r in loc_rows if r["title"]}
            loc_by_cid = {r["cid"]: r for r in loc_rows}

            for s in src_rows:
                s_dict = dict(s)
                s_id = s_dict["cid"]
                t_key = str(s_dict.get("title") or "").strip().lower()

                matched = loc_by_cid.get(s_id) or loc_by_title.get(t_key)

                if matched is None:
                    items.append({
                        "id": s_id,
                        "label": s_dict.get("title") or f"Предмет #{s_id}",
                        "status": "to_insert",
                        "source_data": s_dict,
                        "local_data": None,
                        "differences": ["Новая дисциплина"],
                    })
                else:
                    m_dict = dict(matched)
                    diffs = []
                    if str(s_dict.get("alias") or "") != str(m_dict.get("alias") or ""):
                        diffs.append(f"Алиас: {m_dict.get('alias')} -> {s_dict.get('alias')}")
                    if diffs:
                        items.append({
                            "id": s_id,
                            "label": s_dict.get("title") or f"Предмет #{s_id}",
                            "status": "conflict",
                            "source_data": s_dict,
                            "local_data": m_dict,
                            "differences": diffs,
                        })
                    else:
                        items.append({
                            "id": s_id,
                            "label": s_dict.get("title") or f"Предмет #{s_id}",
                            "status": "identical",
                            "source_data": s_dict,
                            "local_data": m_dict,
                            "differences": [],
                        })

        elif entity == "schedule":
            # 4. Сравнение расписания
            var_filter = ""
            args = []
            if sh_var_id is not None:
                var_filter = "WHERE sh_var_id = $1"
                args.append(sh_var_id)

            src_rows = await conn_source.fetch(f"""
                SELECT sheid, cid, rid, gid, teacher_mid, sh_var_id, period, day_of_week, pair_type_id, idcathedra, lesson_num
                FROM public.nnz_schedule
                {var_filter}
                ORDER BY sh_var_id, day_of_week, period, sheid
                LIMIT 300;
            """, *args)

            loc_rows = await conn_local.fetch(f"""
                SELECT sheid, cid, rid, gid, teacher_mid, sh_var_id, period, day_of_week, pair_type_id, idcathedra, lesson_num
                FROM public.nnz_schedule
                {var_filter};
            """, *args)

            loc_by_sheid = {r["sheid"]: r for r in loc_rows}
            loc_by_slot = {
                (r["sh_var_id"], r["day_of_week"], r["period"], r["gid"]): r
                for r in loc_rows
            }

            for s in src_rows:
                s_dict = dict(s)
                s_id = s_dict["sheid"]
                slot_key = (s_dict["sh_var_id"], s_dict["day_of_week"], s_dict["period"], s_dict["gid"])

                matched = loc_by_sheid.get(s_id) or loc_by_slot.get(slot_key)
                label = f"Занятие #{s_id}: день {s_dict.get('day_of_week')}, пара {s_dict.get('period')}, группа #{s_dict.get('gid')}"

                if matched is None:
                    items.append({
                        "id": s_id,
                        "label": label,
                        "status": "to_insert",
                        "source_data": s_dict,
                        "local_data": None,
                        "differences": ["Новое занятие в расписании"],
                    })
                else:
                    m_dict = dict(matched)
                    diffs = []
                    if s_dict.get("cid") != m_dict.get("cid"):
                        diffs.append(f"Предмет: {m_dict.get('cid')} -> {s_dict.get('cid')}")
                    if s_dict.get("teacher_mid") != m_dict.get("teacher_mid"):
                        diffs.append("Преподаватели отличаются")
                    if s_dict.get("rid") != m_dict.get("rid"):
                        diffs.append("Аудитории отличаются")

                    if diffs:
                        items.append({
                            "id": s_id,
                            "label": label,
                            "status": "conflict",
                            "source_data": s_dict,
                            "local_data": m_dict,
                            "differences": diffs,
                        })
                    else:
                        items.append({
                            "id": s_id,
                            "label": label,
                            "status": "identical",
                            "source_data": s_dict,
                            "local_data": m_dict,
                            "differences": [],
                        })

    finally:
        await conn_source.close()

    summary = {
        "to_insert": sum(1 for i in items if i["status"] == "to_insert"),
        "conflict": sum(1 for i in items if i["status"] == "conflict"),
        "identical": sum(1 for i in items if i["status"] == "identical"),
        "total": len(items),
    }

    return {
        "entity": entity,
        "items": items,
        "summary": summary,
    }


@router.post("/execute", summary="Выполнение селективной синхронизации выбранных записей")
async def execute_sync(
    payload: SyncExecutePayload,
    conn_local: asyncpg.Connection = Depends(get_db_connection),
):
    """
    Безопасный перенос выбранных сущностей из вторичной базы в локальную PostgreSQL.
    Выполняется внутри изолированной транзакции с защитой от перезаписи биометрии.
    """
    if not payload.selected_ids:
        return {
            "success": True,
            "inserted": 0,
            "updated": 0,
            "skipped": 0,
            "errors": 0,
            "message": "Нет записей для переноса",
        }

    conn_source = await connect_source_db()
    inserted_count = 0
    updated_count = 0
    skipped_count = 0
    errors_count = 0

    try:
        async with conn_local.transaction():
            if payload.entity == "teachers":
                # Перенос преподавателей
                src_rows = await conn_source.fetch("""
                    SELECT 
                        p.mid, p.lastname, p.firstname, p.patronymic, p.degree,
                        cp.cid AS cathedra_id, cp.positionid, cp.military_rank, cp.id_pmk, cp.chear_man
                    FROM public.people p
                    LEFT JOIN public.cathedra_personnel cp ON p.mid = cp.mid
                    WHERE p.mid = ANY($1::bigint[]);
                """, payload.selected_ids)

                for r in src_rows:
                    mid = r["mid"]
                    exists = await conn_local.fetchval("SELECT 1 FROM public.people WHERE mid = $1;", mid)

                    if exists:
                        if payload.conflict_strategy == "overwrite":
                            await conn_local.execute("""
                                UPDATE public.people
                                SET lastname = $2, firstname = $3, patronymic = $4, degree = $5
                                WHERE mid = $1;
                            """, mid, r["lastname"], r["firstname"], r["patronymic"], r["degree"])
                            updated_count += 1
                        else:
                            skipped_count += 1
                    else:
                        await conn_local.execute("""
                            INSERT INTO public.people (mid, lastname, firstname, patronymic, degree)
                            VALUES ($1, $2, $3, $4, $5)
                            ON CONFLICT (mid) DO NOTHING;
                        """, mid, r["lastname"], r["firstname"], r["patronymic"], r["degree"])
                        inserted_count += 1

                    # Состав кафедры (cathedra_personnel)
                    if r["cathedra_id"] is not None:
                        cp_exists = await conn_local.fetchval("SELECT 1 FROM public.cathedra_personnel WHERE mid = $1;", mid)
                        if not cp_exists:
                            await conn_local.execute("""
                                INSERT INTO public.cathedra_personnel (cid, positionid, mid, military_rank, id_pmk, chear_man)
                                VALUES ($1, $2, $3, $4, $5, $6);
                            """, r["cathedra_id"], r["positionid"], mid, r["military_rank"] or 0, r["id_pmk"], r["chear_man"])

            elif payload.entity == "groups":
                # Перенос групп
                src_rows = await conn_source.fetch("""
                    SELECT gid, name, idcathedra, idfaculty
                    FROM public.groupname
                    WHERE gid = ANY($1::bigint[]);
                """, payload.selected_ids)

                for r in src_rows:
                    gid = r["gid"]
                    exists = await conn_local.fetchval("SELECT 1 FROM public.groupname WHERE gid = $1;", gid)

                    if exists:
                        if payload.conflict_strategy == "overwrite":
                            await conn_local.execute("""
                                UPDATE public.groupname
                                SET name = $2, idcathedra = $3, idfaculty = $4
                                WHERE gid = $1;
                            """, gid, r["name"], r["idcathedra"], r["idfaculty"])
                            updated_count += 1
                        else:
                            skipped_count += 1
                    else:
                        await conn_local.execute("""
                            INSERT INTO public.groupname (gid, name, idcathedra, idfaculty)
                            VALUES ($1, $2, $3, $4)
                            ON CONFLICT (gid) DO NOTHING;
                        """, gid, r["name"], r["idcathedra"], r["idfaculty"])
                        inserted_count += 1

            elif payload.entity == "courses":
                # Перенос дисциплин
                src_rows = await conn_source.fetch("""
                    SELECT cid, title, alias, meta_course
                    FROM public.courses
                    WHERE cid = ANY($1::bigint[]);
                """, payload.selected_ids)

                for r in src_rows:
                    cid = r["cid"]
                    exists = await conn_local.fetchval("SELECT 1 FROM public.courses WHERE cid = $1;", cid)

                    if exists:
                        if payload.conflict_strategy == "overwrite":
                            await conn_local.execute("""
                                UPDATE public.courses
                                SET title = $2, alias = $3, meta_course = $4
                                WHERE cid = $1;
                            """, cid, r["title"], r["alias"], r["meta_course"])
                            updated_count += 1
                        else:
                            skipped_count += 1
                    else:
                        await conn_local.execute("""
                            INSERT INTO public.courses (cid, title, alias, meta_course)
                            VALUES ($1, $2, $3, $4)
                            ON CONFLICT (cid) DO NOTHING;
                        """, cid, r["title"], r["alias"], r["meta_course"])
                        inserted_count += 1

            elif payload.entity == "schedule":
                # Перенос расписания
                src_rows = await conn_source.fetch("""
                    SELECT sheid, cid, rid, gid, teacher_mid, sh_var_id, period, day_of_week, pair_type_id, idcathedra, lesson_num
                    FROM public.nnz_schedule
                    WHERE sheid = ANY($1::bigint[]);
                """, payload.selected_ids)

                for r in src_rows:
                    sheid = r["sheid"]
                    exists = await conn_local.fetchval("SELECT 1 FROM public.nnz_schedule WHERE sheid = $1;", sheid)

                    if exists:
                        if payload.conflict_strategy == "overwrite":
                            await conn_local.execute("""
                                UPDATE public.nnz_schedule
                                SET cid = $2, rid = $3, gid = $4, teacher_mid = $5, sh_var_id = $6,
                                    period = $7, day_of_week = $8, pair_type_id = $9, idcathedra = $10, lesson_num = $11
                                WHERE sheid = $1;
                            """, sheid, r["cid"], r["rid"], r["gid"], r["teacher_mid"], r["sh_var_id"],
                            r["period"], r["day_of_week"], r["pair_type_id"], r["idcathedra"], r["lesson_num"])
                            updated_count += 1
                        else:
                            skipped_count += 1
                    else:
                        await conn_local.execute("""
                            INSERT INTO public.nnz_schedule (
                                sheid, cid, rid, gid, teacher_mid, sh_var_id, period, day_of_week, pair_type_id, idcathedra, lesson_num
                            )
                            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
                            ON CONFLICT (sheid) DO NOTHING;
                        """, sheid, r["cid"], r["rid"], r["gid"], r["teacher_mid"], r["sh_var_id"],
                        r["period"], r["day_of_week"], r["pair_type_id"], r["idcathedra"], r["lesson_num"])
                        inserted_count += 1

    except Exception as e:
        logger.error(f"[Sync] Ошибка транзакции синхронизации: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Ошибка транзакции при синхронизации: {str(e)}",
        )
    finally:
        await conn_source.close()

    return {
        "success": True,
        "inserted": inserted_count,
        "updated": updated_count,
        "skipped": skipped_count,
        "errors": errors_count,
        "message": f"Синхронизация завершена. Добавлено: {inserted_count}, обновлено: {updated_count}, пропущено: {skipped_count}.",
    }
