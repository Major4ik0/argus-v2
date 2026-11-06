# -*- coding: utf-8 -*-
import json
import logging
import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime, date
import asyncpg
from fastapi import APIRouter, HTTPException, Depends, status, Query
from pydantic import BaseModel, Field

from ...core.database import get_db_connection

logger = logging.getLogger("argus.db_manager")

router = APIRouter()

# Белый список таблиц, доступных для визуального управления через админ-панель
WHITELISTED_TABLES: Dict[str, Dict[str, Any]] = {
    "people": {
        "display_name": "Преподаватели и сотрудники",
        "primary_key": "mid",
        "default_sort": "mid",
    },
    "groupname": {
        "display_name": "Учебные группы",
        "primary_key": "gid",
        "default_sort": "name",
    },
    "courses": {
        "display_name": "Учебные дисциплины",
        "primary_key": "cid",
        "default_sort": "title",
    },
    "eventtools": {
        "display_name": "Типы занятий",
        "primary_key": "typeid",
        "default_sort": "typeid",
    },
    "cathedra_personnel": {
        "display_name": "Состав кафедры и ПМК",
        "primary_key": "cpid",
        "default_sort": "cpid",
    },
    "nnz_schedule": {
        "display_name": "Занятия в расписании",
        "primary_key": "sheid",
        "default_sort": "sheid",
    },
    "nnz_schedule_variants": {
        "display_name": "Варианты расписания (недели)",
        "primary_key": "sh_var_id",
        "default_sort": "sh_var_id",
    },
}


class BatchDeletePayload(BaseModel):
    ids: List[int] = Field(..., description="Список идентификаторов (PK) для группового удаления")


async def get_table_columns_meta(conn: asyncpg.Connection, table_name: str) -> List[Dict[str, Any]]:
    """Получение метаданных о колонках таблицы: имя, тип, nullable, primary key."""
    sql_cols = """
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $1
        ORDER BY ordinal_position;
    """
    cols = await conn.fetch(sql_cols, table_name)

    sql_pks = """
        SELECT kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        WHERE tc.constraint_type = 'PRIMARY KEY'
          AND tc.table_schema = 'public'
          AND tc.table_name = $1;
    """
    pks = await conn.fetch(sql_pks, table_name)
    pk_set = {p["column_name"] for p in pks}

    meta = []
    for c in cols:
        c_name = c["column_name"]
        raw_type = c["data_type"].lower()
        simple_type = "string"
        if "int" in raw_type or raw_type == "bigint":
            simple_type = "integer"
        elif "bool" in raw_type:
            simple_type = "boolean"
        elif "float" in raw_type or "double" in raw_type or "numeric" in raw_type:
            simple_type = "float"
        elif "array" in raw_type:
            simple_type = "array"
        elif "timestamp" in raw_type or "date" in raw_type:
            simple_type = "date"

        meta.append({
            "name": c_name,
            "raw_type": raw_type,
            "type": simple_type,
            "nullable": c["is_nullable"] == "YES",
            "is_pk": c_name in pk_set,
            "default": c["column_default"],
        })
    return meta


def cast_field_value(val: Any, col_type: str, nullable: bool) -> Any:
    """Приведение переданного из JSON значения к валидному типу PostgreSQL."""
    if val is None or val == "":
        return None if nullable else val

    if col_type == "integer":
        try:
            return int(val)
        except (ValueError, TypeError):
            return None if nullable else 0
    elif col_type == "float":
        try:
            return float(val)
        except (ValueError, TypeError):
            return None if nullable else 0.0
    elif col_type == "boolean":
        if isinstance(val, bool):
            return val
        return str(val).strip().lower() in ("true", "1", "yes")
    elif col_type == "array":
        if isinstance(val, list):
            # Конвертируем элементы списка в целые числа, если это числовой массив
            res = []
            for elem in val:
                try:
                    res.append(int(elem))
                except (ValueError, TypeError):
                    res.append(elem)
            return res
        elif isinstance(val, str):
            # Парсинг строки вида "1,2,3" или "{1,2,3}"
            cleaned = val.replace("{", "").replace("}", "").strip()
            if not cleaned:
                return []
            parts = [p.strip() for p in cleaned.split(",") if p.strip()]
            res = []
            for p in parts:
                try:
                    res.append(int(p))
                except (ValueError, TypeError):
                    res.append(p)
            return res
        return val

    return str(val)


@router.get("/tables", summary="Список доступных таблиц для администрирования")
async def list_available_tables(conn: asyncpg.Connection = Depends(get_db_connection)):
    """Возвращает список таблиц из белого списка с их названиями и количеством записей."""
    result = []
    for tbl_name, info in WHITELISTED_TABLES.items():
        try:
            count = await conn.fetchval(f"SELECT count(*) FROM public.{tbl_name};")
        except Exception:
            count = 0

        result.append({
            "table_name": tbl_name,
            "display_name": info["display_name"],
            "primary_key": info["primary_key"],
            "count": count or 0,
        })
    return result


@router.get("/tables/{table_name}", summary="Получение записей таблицы с пагинацией и поиском")
async def get_table_data(
    table_name: str,
    page: int = Query(1, ge=1, description="Номер страницы"),
    limit: int = Query(25, ge=5, le=200, description="Количество строк на странице"),
    search: Optional[str] = Query(None, description="Строка поиска"),
    sort_by: Optional[str] = Query(None, description="Колонка для сортировки"),
    sort_order: Optional[str] = Query("asc", description="Направление: asc или desc"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """
    Параметризованная выборка данных из указанной таблицы белого списка.
    Защита от SQL-инъекций: все имена колонок проверяются по information_schema.
    """
    if table_name not in WHITELISTED_TABLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Таблица '{table_name}' не входит в белый список разрешенных таблиц",
        )

    table_info = WHITELISTED_TABLES[table_name]
    columns_meta = await get_table_columns_meta(conn, table_name)
    col_names = {c["name"] for c in columns_meta}

    # Валидация параметров поиска и сортировки
    effective_search = search.strip() if isinstance(search, str) and search.strip() else None
    effective_sort_by = sort_by if isinstance(sort_by, str) and sort_by in col_names else table_info["default_sort"]
    effective_sort_order = "DESC" if str(sort_order).lower() == "desc" else "ASC"

    # Формирование фильтра поиска по текстовым полям
    where_clauses = []
    params = []
    p_idx = 1

    if effective_search:
        search_pattern = f"%{effective_search}%"
        search_subclauses = []
        for c in columns_meta:
            if c["type"] in ("string", "integer"):
                search_subclauses.append(f"CAST({c['name']} AS TEXT) ILIKE ${p_idx}")
        if search_subclauses:
            where_clauses.append(f"({' OR '.join(search_subclauses)})")
            params.append(search_pattern)
            p_idx += 1

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""

    # Подсчет общего числа строк
    count_sql = f"SELECT count(*) FROM public.{table_name} {where_sql};"
    total_count = await conn.fetchval(count_sql, *params) or 0

    # Выборка страницы
    offset = (page - 1) * limit
    select_sql = f"""
        SELECT * FROM public.{table_name}
        {where_sql}
        ORDER BY {effective_sort_by} {effective_sort_order}
        LIMIT ${p_idx} OFFSET ${p_idx + 1};
    """
    params.extend([limit, offset])
    rows = await conn.fetch(select_sql, *params)

    # Приведение типов для безопасного JSON ответа
    json_rows = []
    for r in rows:
        row_dict = {}
        for c in columns_meta:
            c_name = c["name"]
            val = r[c_name]
            if isinstance(val, datetime):
                row_dict[c_name] = val.strftime("%Y-%m-%d %H:%M:%S")
            else:
                row_dict[c_name] = val
        json_rows.append(row_dict)

    total_pages = (total_count + limit - 1) // limit if limit > 0 else 1

    return {
        "table_name": table_name,
        "display_name": table_info["display_name"],
        "primary_key": table_info["primary_key"],
        "columns": columns_meta,
        "rows": json_rows,
        "total": total_count,
        "page": page,
        "limit": limit,
        "total_pages": total_pages,
    }


@router.post("/tables/{table_name}", summary="Создание новой записи в таблице")
async def create_table_row(
    table_name: str,
    payload: Dict[str, Any],
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """
    Добавление новой записи в таблицу через параметризованный INSERT.
    Типы полей строго приводятся в соответствии со схемой таблицы.
    """
    if table_name not in WHITELISTED_TABLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Таблица '{table_name}' не входит в белый список",
        )

    columns_meta = await get_table_columns_meta(conn, table_name)
    col_by_name = {c["name"]: c for c in columns_meta}

    fields_to_insert = []
    values_to_insert = []
    placeholders = []
    p_idx = 1

    for k, v in payload.items():
        if k in col_by_name:
            col_meta = col_by_name[k]
            # Если поле PK и значение не передано или пустое, пропускаем для автоинкремента
            if col_meta["is_pk"] and (v is None or v == ""):
                continue

            cast_val = cast_field_value(v, col_meta["type"], col_meta["nullable"])
            fields_to_insert.append(k)
            values_to_insert.append(cast_val)
            placeholders.append(f"${p_idx}")
            p_idx += 1

    if not fields_to_insert:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Не передано ни одного валидного поля для вставки",
        )

    sql = f"""
        INSERT INTO public.{table_name} ({', '.join(fields_to_insert)})
        VALUES ({', '.join(placeholders)})
        RETURNING *;
    """

    try:
        new_row = await conn.fetchrow(sql, *values_to_insert)
        if not new_row:
            raise HTTPException(status_code=500, detail="Не удалось получить созданную запись")
        return dict(new_row)
    except asyncpg.UniqueViolationError as uve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Нарушение уникальности ключа: {str(uve).split('DETAIL:')[-1].strip()}",
        )
    except asyncpg.ForeignKeyViolationError as fve:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Нарушение внешнего ключа: указанный связанный ID не существует в базе данных",
        )
    except Exception as e:
        logger.error(f"[DB Manager] Ошибка вставки в {table_name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ошибка добавления записи: {str(e)}",
        )


@router.put("/tables/{table_name}/{record_id}", summary="Обновление существующей записи по первичному ключу")
async def update_table_row(
    table_name: str,
    record_id: int,
    payload: Dict[str, Any],
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Обновление строки по ее первичному ключу."""
    if table_name not in WHITELISTED_TABLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Таблица '{table_name}' не входит в белый список",
        )

    pk_col = WHITELISTED_TABLES[table_name]["primary_key"]
    columns_meta = await get_table_columns_meta(conn, table_name)
    col_by_name = {c["name"]: c for c in columns_meta}

    set_clauses = []
    params = []
    p_idx = 1

    for k, v in payload.items():
        if k in col_by_name and k != pk_col:
            col_meta = col_by_name[k]
            cast_val = cast_field_value(v, col_meta["type"], col_meta["nullable"])
            set_clauses.append(f"{k} = ${p_idx}")
            params.append(cast_val)
            p_idx += 1

    if not set_clauses:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Не передано ни одного поля для обновления",
        )

    params.append(record_id)
    sql = f"""
        UPDATE public.{table_name}
        SET {', '.join(set_clauses)}
        WHERE {pk_col} = ${p_idx}
        RETURNING *;
    """

    try:
        updated_row = await conn.fetchrow(sql, *params)
        if not updated_row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Запись с ключом {record_id} не найдена в таблице {table_name}",
            )
        return dict(updated_row)
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Ошибка внешнего ключа: указан несуществующий связанный идентификатор",
        )
    except Exception as e:
        logger.error(f"[DB Manager] Ошибка обновления в {table_name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ошибка обновления записи: {str(e)}",
        )


@router.delete("/tables/{table_name}/{record_id}", summary="Безопасное удаление записи по первичному ключу")
async def delete_table_row(
    table_name: str,
    record_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """
    Удаление записи по первичному ключу.
    При нарушении целостности внешнего ключа возвращает понятное русское сообщение.
    """
    if table_name not in WHITELISTED_TABLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Таблица '{table_name}' не входит в белый список",
        )

    pk_col = WHITELISTED_TABLES[table_name]["primary_key"]
    sql = f"DELETE FROM public.{table_name} WHERE {pk_col} = $1 RETURNING {pk_col};"

    try:
        deleted_pk = await conn.fetchval(sql, record_id)
        if deleted_pk is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Запись с ключом #{record_id} не найдена в таблице {table_name}",
            )
        return {
            "success": True,
            "message": f"Запись #{record_id} успешно удалена из таблицы '{WHITELISTED_TABLES[table_name]['display_name']}'",
        }
    except asyncpg.ForeignKeyViolationError as fve:
        err_text = str(fve)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Невозможно удалить запись #{record_id}, так как на нее ссылаются строки в связанных таблицах. "
                f"Сначала удалите или переназначьте связанные занятия или назначения."
            ),
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[DB Manager] Ошибка удаления из {table_name}: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ошибка удаления записи: {str(e)}",
        )


@router.post("/tables/{table_name}/batch-delete", summary="Групповое удаление записей по списку первичных ключей")
async def batch_delete_table_rows(
    table_name: str,
    payload: BatchDeletePayload,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Групповое удаление записей по списку ID внутри транзакции."""
    if table_name not in WHITELISTED_TABLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Таблица '{table_name}' не входит в белый список",
        )

    if not payload.ids:
        return {"success": True, "deleted_count": 0}

    pk_col = WHITELISTED_TABLES[table_name]["primary_key"]
    sql = f"DELETE FROM public.{table_name} WHERE {pk_col} = ANY($1::bigint[]);"

    try:
        async with conn.transaction():
            result = await conn.execute(sql, payload.ids)
            # result обычно имеет вид "DELETE 3"
            parts = result.split()
            count = int(parts[-1]) if len(parts) >= 2 else len(payload.ids)
            return {
                "success": True,
                "deleted_count": count,
                "message": f"Удалено записей: {count}",
            }
    except asyncpg.ForeignKeyViolationError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Невозможно удалить выбранные записи, так как на некоторые из них ссылаются связанные таблицы",
        )
    except Exception as e:
        logger.error(f"[DB Manager] Ошибка пакетного удаления: {e}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ошибка пакетного удаления: {str(e)}",
        )
