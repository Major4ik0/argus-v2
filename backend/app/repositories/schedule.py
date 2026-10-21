# -*- coding: utf-8 -*-
import json
from typing import List, Dict, Any, Optional
from datetime import date, timedelta
import calendar
import asyncpg


class ScheduleRepository:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    def _parse_row(self, row: asyncpg.Record) -> Dict[str, Any]:
        """Преобразует строку Record в словарь и декодирует агрегированный JSON."""
        data = dict(row)
        for field in ("teachers", "rooms"):
            if isinstance(data.get(field), str):
                try:
                    data[field] = json.loads(data[field])
                except Exception:
                    data[field] = []
            elif data.get(field) is None:
                data[field] = []
        data["teacher_mid"] = list(data.get("teacher_mid") or [])
        data["room_ids"] = list(data.get("room_ids") or [])
        return data

    async def get_study_year_id_by_date(self, target_date: date) -> Optional[int]:
        """Определяет ID учебного года (school_year, например 34 для 2025-2026, 35 для 2026-2027) по дате."""
        year = target_date.year
        month = target_date.month
        # Учебный год начинается 1 сентября
        start_year = year if month >= 9 else year - 1

        sql = """
            SELECT school_year 
            FROM public.studyyears 
            WHERE name = $1 OR number = $2 OR school_year = $3
            ORDER BY school_year DESC 
            LIMIT 1;
        """
        row = await self.conn.fetchrow(sql, str(start_year), str(start_year)[-2:], start_year)
        if row and row["school_year"]:
            return row["school_year"]

        fallback_row = await self.conn.fetchrow(
            "SELECT school_year FROM public.studyyears ORDER BY school_year DESC LIMIT 1;"
        )
        return fallback_row["school_year"] if fallback_row else 35

    async def get_default_variant(self, s_year_id: Optional[int] = None) -> Optional[int]:
        """Получает существующий вариант расписания по умолчанию из базы."""
        if s_year_id:
            row = await self.conn.fetchrow(
                "SELECT sh_var_id FROM public.nnz_schedule_variants WHERE s_year_id = $1 ORDER BY sh_var_id LIMIT 1;",
                s_year_id
            )
            if row and row["sh_var_id"]:
                return row["sh_var_id"]

        row = await self.conn.fetchrow(
            "SELECT sh_var_id FROM public.nnz_schedule_variants ORDER BY sh_var_id DESC LIMIT 1;"
        )
        return row["sh_var_id"] if row else None

    async def get_sh_var_id_by_date(self, target_date: date, s_year_id: Optional[int] = None) -> Optional[int]:
        """
        Определяет вариант расписания (sh_var_id) для конкретной недели:
        1. По точному совпадению даты понедельника в названии (например, '13.10.2025').
        2. По вычисленному диапазону недели через CTE с широким охватом шаблонов.
        3. По номеру учебной недели (например, '7 неделя').
        4. Если не найден — автоматически создаёт вариант расписания на эту неделю, чтобы занятия не терялись.
        5. Fallback на существующий вариант из базы данных.
        """
        target_monday = target_date - timedelta(days=target_date.isoweekday() - 1)
        target_sunday = target_monday + timedelta(days=6)
        monday_str = target_monday.strftime("%d.%m.%Y")

        acad_start_year = target_date.year if target_date.month >= 9 else target_date.year - 1
        acad_start_date = date(acad_start_year, 9, 1)
        study_week = max(1, ((target_date - acad_start_date).days // 7) + 1)

        # 1. Быстрый и надёжный поиск по строке даты понедельника
        sql_direct = """
            SELECT sh_var_id 
            FROM public.nnz_schedule_variants 
            WHERE ($1::integer IS NULL OR s_year_id = $1)
              AND sh_var_name LIKE $2
            ORDER BY sh_var_id DESC 
            LIMIT 1;
        """
        row = await self.conn.fetchrow(sql_direct, s_year_id, f"%{monday_str}%")
        if row and row["sh_var_id"]:
            return row["sh_var_id"]

        # 2. Поиск по вычисленной дате внутри недели через CTE
        sql_date = """
        WITH schedule_variants AS (
            SELECT 
                nsv.sh_var_id, 
                nsv.sh_var_name, 
                nsv.s_year_id,
                CASE 
                    -- Любой вариант с датой в скобках (DD.MM.YYYY
                    WHEN nsv.sh_var_name ~ '\\(\\d{2}\\.\\d{2}\\.\\d{4}' THEN
                        TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                    -- Формат: "Вариант расписания 5 неделя"
                    WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        ($1::date + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week')::date
                    -- Формат: "Неделя 5"
                    WHEN nsv.sh_var_name ~* 'неделя\\s+(\\d+)' THEN
                        ($1::date + (CAST(substring(nsv.sh_var_name from 'неделя\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week')::date
                    ELSE NULL
                END AS week_start_date
            FROM public.nnz_schedule_variants nsv
            WHERE nsv.sh_var_name IS NOT NULL
              AND ($2::int IS NULL OR nsv.s_year_id = $2)
        )
        SELECT sh_var_id 
        FROM schedule_variants
        WHERE week_start_date IS NOT NULL
          AND $3::date BETWEEN week_start_date AND (week_start_date + INTERVAL '6 days')::date
        ORDER BY sh_var_id DESC
        LIMIT 1;
        """
        row = await self.conn.fetchrow(sql_date, acad_start_date, s_year_id, target_date)
        if row and row["sh_var_id"]:
            return row["sh_var_id"]

        # 3. Поиск по номеру учебной недели
        week_sql = """
            SELECT sh_var_id 
            FROM public.nnz_schedule_variants 
            WHERE ($1::integer IS NULL OR s_year_id = $1)
              AND (sh_var_name ILIKE $2 OR sh_var_name ILIKE $3)
            ORDER BY sh_var_id DESC
            LIMIT 1;
        """
        week_row = await self.conn.fetchrow(
            week_sql,
            s_year_id,
            f"%{study_week} недел%",
            f"%неделя {study_week}%"
        )
        if week_row and week_row["sh_var_id"]:
            return week_row["sh_var_id"]

        # 4. Если вариант не найден, автоматически создаем вариант для этой недели
        if s_year_id:
            new_var_name = f"Неделя {study_week} ({target_monday.strftime('%d.%m.%Y')} - {target_sunday.strftime('%d.%m.%Y')})"
            try:
                new_var_id = await self.conn.fetchval(
                    "INSERT INTO public.nnz_schedule_variants (sh_var_name, s_year_id) VALUES ($1, $2) RETURNING sh_var_id;",
                    new_var_name, s_year_id
                )
                if new_var_id:
                    return new_var_id
            except Exception:
                pass

        # 5. Fallback на дефолтный вариант из базы данных
        return await self.get_default_variant(s_year_id)

    async def get_period_lid(self, s_year_id: Optional[int], pair_number: int) -> int:
        """Определяет lid периода по номеру пары (1-4, 0-3) или возвращает periods.lid."""
        if pair_number in (0, 1, 2, 3, 4):
            pair_num = pair_number if pair_number in (1, 2, 3, 4) else (pair_number + 1)
            pattern = f"{pair_num}-я пара%"

            if s_year_id:
                row = await self.conn.fetchrow(
                    "SELECT lid FROM public.periods WHERE s_year_id = $1 AND short_time LIKE $2 LIMIT 1;",
                    s_year_id, pattern
                )
                if row and row["lid"]:
                    return row["lid"]

                row = await self.conn.fetchrow(
                    "SELECT lid FROM public.periods WHERE s_year_id = $1 ORDER BY starttime ASC, lid ASC OFFSET $2 LIMIT 1;",
                    s_year_id, pair_num - 1
                )
                if row and row["lid"]:
                    return row["lid"]

            row = await self.conn.fetchrow(
                "SELECT lid FROM public.periods WHERE short_time LIKE $1 ORDER BY s_year_id DESC LIMIT 1;",
                pattern
            )
            if row and row["lid"]:
                return row["lid"]

        row = await self.conn.fetchrow("SELECT lid FROM public.periods WHERE lid = $1 LIMIT 1;", pair_number)
        if row and row["lid"]:
            return row["lid"]

        def_lid = await self.conn.fetchval("SELECT lid FROM public.periods ORDER BY lid ASC LIMIT 1;")
        return def_lid or 3

    async def check_conflict(
        self,
        sh_var_id: int,
        period: int,
        day_of_week: int,
        teacher_id: int,
        exclude_sheid: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Проверка коллизий: занят ли преподаватель в указанный слот.
        Использует оператор PostgreSQL teacher_mid @> ARRAY[$4]::integer[].
        """
        sql = """
            SELECT 
                ns.sheid,
                ns.day_of_week,
                ns.period,
                crs.alias AS course_alias,
                crs.title AS course_title,
                g.name AS group_name,
                r.short_name AS room_name,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS teacher_name
            FROM public.nnz_schedule ns
            JOIN public.people p ON p.mid = $4
            LEFT JOIN public.courses crs ON crs.cid = ns.cid
            LEFT JOIN public.groupname g ON g.gid = ns.gid
            LEFT JOIN public.rooms r ON r.rid = ns.rid[1]
            WHERE ns.sh_var_id = $1
              AND ns.period = $2
              AND ns.day_of_week = $3
              AND ns.teacher_mid @> ARRAY[$4]::integer[]
              AND ($5::integer IS NULL OR ns.sheid != $5)
            LIMIT 1;
        """
        row = await self.conn.fetchrow(sql, sh_var_id, period, day_of_week, teacher_id, exclude_sheid)
        return dict(row) if row else None

    async def get_schedule(
        self,
        teacher_id: Optional[int] = None,
        group_id: Optional[int] = None,
        day_of_week: Optional[int] = None,
        sh_var_id: Optional[int] = None,
        cathedra_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Получение расписания с фильтрацией."""
        conditions = []
        params = []

        if teacher_id is not None:
            params.append(teacher_id)
            conditions.append(f"${len(params)} = ANY(nnz_s.teacher_mid)")

        if group_id is not None:
            params.append(group_id)
            conditions.append(f"nnz_s.gid = ${len(params)}")

        if day_of_week is not None:
            params.append(day_of_week)
            conditions.append(f"nnz_s.day_of_week = ${len(params)}")

        if sh_var_id is not None:
            params.append(sh_var_id)
            conditions.append(f"nnz_s.sh_var_id = ${len(params)}")

        if cathedra_id is not None:
            params.append(cathedra_id)
            conditions.append(f"nnz_s.idcathedra = ${len(params)}")

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        sql = f"""
            SELECT 
                nnz_s.sheid,
                nnz_s.day_of_week,
                nnz_s.period AS period_id,
                pr.name AS period_name,
                nnz_s.gid AS group_id,
                g.name AS group_name,
                g.idfaculty AS faculty_id,
                f."shortName" AS faculty_short_name,
                nnz_s.cid AS course_id,
                crs.alias AS course_alias,
                crs.title AS course_title,
                nnz_s.pair_type_id AS event_type_id,
                e.alias AS event_type_alias,
                nnz_s.sh_var_id,
                nsv.sh_var_name,
                nnz_s.idcathedra,
                nnz_s.teacher_mid,
                nnz_s.rid AS room_ids,
                (
                    SELECT COALESCE(json_agg(json_build_object(
                        'id', p.mid,
                        'full_name', TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)),
                        'lastname', p.lastname
                    )), '[]'::json)
                    FROM people p
                    WHERE p.mid = ANY(nnz_s.teacher_mid)
                ) AS teachers,
                (
                    SELECT COALESCE(json_agg(json_build_object(
                        'id', r.rid,
                        'name', r.short_name
                    )), '[]'::json)
                    FROM rooms r
                    WHERE r.rid = ANY(nnz_s.rid)
                ) AS rooms
            FROM public.nnz_schedule AS nnz_s
            LEFT JOIN courses AS crs ON crs.cid = nnz_s.cid
            LEFT JOIN eventtools AS e ON nnz_s.pair_type_id = e.typeid
            LEFT JOIN groupname AS g ON nnz_s.gid = g.gid
            LEFT JOIN fuculty AS f ON f.idfaculty = g.idfaculty
            LEFT JOIN periods AS pr ON nnz_s.period = pr.lid 
            LEFT JOIN nnz_schedule_variants AS nsv ON nsv.sh_var_id = nnz_s.sh_var_id
            {where_clause}
            ORDER BY nnz_s.day_of_week, nnz_s.period, nnz_s.sheid;
        """

        rows = await self.conn.fetch(sql, *params)
        return [self._parse_row(r) for r in rows]

    async def get_by_id(self, sheid: int) -> Optional[Dict[str, Any]]:
        """Получить одну пару по её ID."""
        sql = """
            SELECT 
                nnz_s.sheid,
                nnz_s.day_of_week,
                nnz_s.period AS period_id,
                pr.name AS period_name,
                nnz_s.gid AS group_id,
                g.name AS group_name,
                g.idfaculty AS faculty_id,
                f."shortName" AS faculty_short_name,
                nnz_s.cid AS course_id,
                crs.alias AS course_alias,
                crs.title AS course_title,
                nnz_s.pair_type_id AS event_type_id,
                e.alias AS event_type_alias,
                nnz_s.sh_var_id,
                nsv.sh_var_name,
                nnz_s.idcathedra,
                nnz_s.teacher_mid,
                nnz_s.rid AS room_ids,
                (
                    SELECT COALESCE(json_agg(json_build_object(
                        'id', p.mid,
                        'full_name', TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)),
                        'lastname', p.lastname
                    )), '[]'::json)
                    FROM people p
                    WHERE p.mid = ANY(nnz_s.teacher_mid)
                ) AS teachers,
                (
                    SELECT COALESCE(json_agg(json_build_object(
                        'id', r.rid,
                        'name', r.short_name
                    )), '[]'::json)
                    FROM rooms r
                    WHERE r.rid = ANY(nnz_s.rid)
                ) AS rooms
            FROM public.nnz_schedule AS nnz_s
            LEFT JOIN courses AS crs ON crs.cid = nnz_s.cid
            LEFT JOIN eventtools AS e ON nnz_s.pair_type_id = e.typeid
            LEFT JOIN groupname AS g ON nnz_s.gid = g.gid
            LEFT JOIN fuculty AS f ON f.idfaculty = g.idfaculty
            LEFT JOIN periods AS pr ON nnz_s.period = pr.lid 
            LEFT JOIN nnz_schedule_variants AS nsv ON nsv.sh_var_id = nnz_s.sh_var_id
            WHERE nnz_s.sheid = $1;
        """
        row = await self.conn.fetchrow(sql, sheid)
        return self._parse_row(row) if row else None

    async def create(self, data: Dict[str, Any]) -> int:
        """Создание новой пары в таблице nnz_schedule."""
        sh_var_id = data.get("sh_var_id")
        if not sh_var_id:
            sh_var_id = await self.get_default_variant()

        period = data["period"]
        if period <= 4:
            period = await self.get_period_lid(None, period)

        sql = """
            INSERT INTO public.nnz_schedule (
                day_of_week, period, gid, cid, pair_type_id,
                teacher_mid, rid, sh_var_id, idcathedra
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING sheid;
        """
        sheid = await self.conn.fetchval(
            sql,
            data["day_of_week"],
            period,
            data["gid"],
            data["cid"],
            data["pair_type_id"],
            data["teacher_mid"],
            data.get("rid", []),
            sh_var_id,
            data.get("idcathedra")
        )
        return sheid

    async def update(self, sheid: int, data: Dict[str, Any]) -> bool:
        """Частичное или полное обновление записи расписания."""
        set_clauses = []
        params = []

        field_mapping = {
            "day_of_week": "day_of_week",
            "period": "period",
            "gid": "gid",
            "cid": "cid",
            "pair_type_id": "pair_type_id",
            "teacher_mid": "teacher_mid",
            "rid": "rid",
            "sh_var_id": "sh_var_id",
            "idcathedra": "idcathedra",
            "lesson_num": "lesson_num",
        }

        if "period" in data and data["period"] is not None and data["period"] <= 4:
            data["period"] = await self.get_period_lid(None, data["period"])

        for key, col in field_mapping.items():
            if key in data and data[key] is not None:
                params.append(data[key])
                set_clauses.append(f"{col} = ${len(params)}")

        if not set_clauses:
            return False

        params.append(sheid)
        sql = f"""
            UPDATE public.nnz_schedule
            SET {', '.join(set_clauses)}
            WHERE sheid = ${len(params)};
        """
        result = await self.conn.execute(sql, *params)
        return result == "UPDATE 1"

    async def move_slot(self, sheid: int, day_of_week: int, period: int) -> bool:
        """Перемещение пары в новый слот (день/пара)."""
        if period <= 4:
            period = await self.get_period_lid(None, period)
        sql = """
            UPDATE public.nnz_schedule
            SET day_of_week = $1, period = $2
            WHERE sheid = $3;
        """
        result = await self.conn.execute(sql, day_of_week, period, sheid)
        return result == "UPDATE 1"

    async def delete(self, sheid: int) -> bool:
        """Удаление пары."""
        sql = "DELETE FROM public.nnz_schedule WHERE sheid = $1;"
        result = await self.conn.execute(sql, sheid)
        return result == "DELETE 1"

    async def swap_lesson(
        self,
        sheid: int,
        target_teacher_id: int,
        target_date: date,
        target_period: int,
        source_teacher_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Оперативная замена занятия:
        1. Получение исходных данных пары.
        2. Вычисление дня недели (1..7), варианта расписания sh_var_id и period.
        3. Проверка коллизий: не занят ли целевой преподаватель.
        4. Замена преподавателя и кафедры.
        5. Обновление nnz_schedule.
        """
        # 1. Исходная пара
        pair_row = await self.conn.fetchrow(
            """
            SELECT sheid, cid, gid, rid, teacher_mid, sh_var_id, period, day_of_week, idcathedra
            FROM public.nnz_schedule 
            WHERE sheid = $1;
            """,
            sheid
        )
        if not pair_row:
            raise ValueError(f"Занятие #{sheid} не найдено в базе данных")

        orig_sh_var_id = pair_row["sh_var_id"]
        orig_teacher_mids = list(pair_row["teacher_mid"] or [])

        # 2. Вычисление дня недели (1 = Пн .. 7 = Вс)
        target_day_of_week = target_date.isoweekday()

        # 3. Вычисление учебного года и варианта расписания
        study_year_id = await self.get_study_year_id_by_date(target_date)
        target_sh_var_id = await self.get_sh_var_id_by_date(target_date, study_year_id)
        if not target_sh_var_id:
            target_sh_var_id = orig_sh_var_id

        # 4. Вычисление ID периода
        target_period_lid = await self.get_period_lid(study_year_id, target_period)

        # 5. Проверка коллизии замещающего преподавателя
        conflict = await self.check_conflict(
            sh_var_id=target_sh_var_id,
            period=target_period_lid,
            day_of_week=target_day_of_week,
            teacher_id=target_teacher_id,
            exclude_sheid=sheid
        )
        if conflict:
            c_desc = f"{conflict.get('course_alias') or conflict.get('course_title') or 'Занятие'} ({conflict.get('group_name')})"
            raise ValueError(
                f"Преподаватель '{conflict.get('teacher_name')}' уже занят в этот слот: {c_desc}"
            )

        # 6. Определение кафедры целевого преподавателя
        cath_sql = """
            SELECT cid AS cath_id
            FROM public.cathedra_personnel 
            WHERE mid = $1 
            LIMIT 1;
        """
        new_cathedra_id = await self.conn.fetchval(cath_sql, target_teacher_id)
        if new_cathedra_id is None:
            new_cathedra_id = pair_row["idcathedra"]

        # 7. Формирование нового массива преподавателей
        if source_teacher_id and source_teacher_id in orig_teacher_mids:
            new_teacher_mids = [
                target_teacher_id if m == source_teacher_id else m
                for m in orig_teacher_mids
            ]
        else:
            new_teacher_mids = [target_teacher_id]

        # 8. Атомарное обновление nnz_schedule
        update_sql = """
            UPDATE public.nnz_schedule
            SET teacher_mid = $1::integer[],
                idcathedra = $2,
                sh_var_id = $3,
                period = $4,
                day_of_week = $5
            WHERE sheid = $6;
        """
        await self.conn.execute(
            update_sql,
            new_teacher_mids,
            new_cathedra_id,
            target_sh_var_id,
            target_period_lid,
            target_day_of_week,
            sheid
        )

        # Получаем обновленные данные
        updated_item = await self.get_by_id(sheid)
        return {
            "success": True,
            "sheid": sheid,
            "target_teacher_id": target_teacher_id,
            "target_date": target_date.isoformat(),
            "target_period": target_period_lid,
            "day_of_week": target_day_of_week,
            "sh_var_id": target_sh_var_id,
            "item": updated_item,
        }

    async def get_monthly_schedule(
        self,
        year: int | str,
        month: int | List[int] | None = None,
        teacher_ids: Optional[List[int]] = None
    ) -> List[Dict[str, Any]]:
        """
        Получение расписания за месяц.
        Поддерживает вызов как с отдельными аргументами (year, month_int, teacher_ids),
        так и со строкой месяца (month_str, teacher_ids).
        """
        if isinstance(year, str) and "-" in year:
            y, m = map(int, year.split("-"))
            t_ids = month if isinstance(month, list) else (teacher_ids or [])
        else:
            y = int(year)
            m = int(month)  # type: ignore
            t_ids = teacher_ids or []

        if not t_ids:
            return []

        last_day_num = calendar.monthrange(y, m)[1]
        first_date = date(y, m, 1)
        last_date = date(y, m, last_day_num)

        # 1. Проверяем наличие учебного года в базе
        study_year_id = await self.get_study_year_id_by_date(first_date)
        if not study_year_id:
            return []

        # Дата 1 сентября текущего учебного года
        acad_start_year = y if m >= 9 else y - 1
        acad_start_date = date(acad_start_year, 9, 1)

        # 2. Полный запрос расписания
        sql = """
        WITH schedule_variants AS (
            SELECT 
                nsv.sh_var_id, 
                nsv.sh_var_name, 
                nsv.s_year_id,
                CASE 
                    -- Любой формат с датой в скобках (DD.MM.YYYY
                    WHEN nsv.sh_var_name ~ '\\(\\d{2}\\.\\d{2}\\.\\d{4}' THEN
                        TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                    -- Формат 2: "Вариант расписания 5 неделя"
                    WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        ($1::date + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week')::date
                    -- Формат 3: "Неделя 5"
                    WHEN nsv.sh_var_name ~* 'неделя\\s+(\\d+)' THEN
                        ($1::date + (CAST(substring(nsv.sh_var_name from 'неделя\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week')::date
                    ELSE NULL
                END AS week_start_date
            FROM public.nnz_schedule_variants nsv
            WHERE nsv.sh_var_name IS NOT NULL AND nsv.s_year_id = $2
        ),
        filtered_variants AS (
            SELECT sv.* FROM schedule_variants sv
            WHERE sv.week_start_date IS NOT NULL
            AND (
                (EXTRACT(YEAR FROM sv.week_start_date)::integer = $3 AND EXTRACT(MONTH FROM sv.week_start_date)::integer = $4)
                OR (EXTRACT(YEAR FROM sv.week_start_date + INTERVAL '6 days')::integer = $5 AND EXTRACT(MONTH FROM sv.week_start_date + INTERVAL '6 days')::integer = $6)
            )
        ),
        schedule_with_teachers AS (
            SELECT 
                nnz_s.sheid,
                array_agg(DISTINCT p.lastname || ' ' || p.firstname || ' ' || COALESCE(p.patronymic, '')) AS all_teachers,
                array_agg(DISTINCT p.mid) AS all_teacher_mids
            FROM filtered_variants fv
            JOIN public.nnz_schedule nnz_s ON nnz_s.sh_var_id = fv.sh_var_id
            JOIN public.people p ON p.mid = ANY(nnz_s.teacher_mid)
            GROUP BY nnz_s.sheid
        ),
        schedule_with_rooms AS (
            SELECT 
                nnz_s.sheid,
                array_agg(DISTINCT COALESCE(r.short_name, 'Ауд. не указана')) AS all_rooms,
                array_agg(DISTINCT r.rid) AS all_rids
            FROM filtered_variants fv
            JOIN public.nnz_schedule nnz_s ON nnz_s.sh_var_id = fv.sh_var_id
            LEFT JOIN public.rooms r ON r.rid = ANY(nnz_s.rid)
            GROUP BY nnz_s.sheid
        ),
        schedule_with_groups AS (
            SELECT 
                nnz_s.sheid,
                array_agg(DISTINCT g.name) AS all_groups,
                array_agg(DISTINCT g.gid) AS all_gids
            FROM filtered_variants fv
            JOIN public.nnz_schedule nnz_s ON nnz_s.sh_var_id = fv.sh_var_id
            JOIN public.groupname g ON g.gid = nnz_s.gid
            GROUP BY nnz_s.sheid
        )
        SELECT 
            COALESCE(p_main.lastname || ' ' || p_main.firstname || ' ' || COALESCE(p_main.patronymic, ''), 'Преподаватель не указан') AS teacher_name,
            TO_CHAR(fv.week_start_date + (nnz_s.day_of_week - 1) * INTERVAL '1 day', 'YYYY-MM-DD') AS event_date,
            pr.name AS period_name,
            CASE 
                WHEN pr.name ILIKE '%1-2%' OR pr.short_time ILIKE '%1%' THEN 1
                WHEN pr.name ILIKE '%3-4%' OR pr.short_time ILIKE '%2%' THEN 2
                WHEN pr.name ILIKE '%5-6%' OR pr.short_time ILIKE '%3%' THEN 3
                WHEN pr.name ILIKE '%7-8%' OR pr.short_time ILIKE '%4%' THEN 4
                ELSE 1
            END AS pair_number,
            CASE 
                WHEN pr.name ILIKE '%1-2%' OR pr.short_time ILIKE '%1%' THEN 0
                WHEN pr.name ILIKE '%3-4%' OR pr.short_time ILIKE '%2%' THEN 1
                WHEN pr.name ILIKE '%5-6%' OR pr.short_time ILIKE '%3%' THEN 2
                WHEN pr.name ILIKE '%7-8%' OR pr.short_time ILIKE '%4%' THEN 3
                ELSE 0
            END AS pair_index,
            crs.alias AS course_alias,
            crs.title AS course_title,
            COALESCE(r_main.short_name, 'Ауд. не указана') AS room_name,
            e.alias AS event_type,
            g_main.name AS group_name,
            g_main.idfaculty AS faculty_id,
            nnz_s.sheid AS schedule_id,
            nnz_s.sheid,
            nnz_s.day_of_week,
            nnz_s.period AS period_id,
            pr.lid AS period_lid,
            COALESCE(p_main.mid, nnz_s.teacher_mid[1]) AS teacher_mid,
            COALESCE(p_main.mid, nnz_s.teacher_mid[1]) AS teacher_id,
            g_main.gid,
            crs.cid,
            r_main.rid,
            nnz_s.idcathedra,
            nnz_s.lesson_num,
            nnz_s.pair_type_id,
            fv.sh_var_id,
            fv.sh_var_name,
            COALESCE(swt.all_teachers, ARRAY[]::text[]) AS all_teachers,
            COALESCE(swt.all_teacher_mids, nnz_s.teacher_mid) AS all_teacher_mids,
            COALESCE(swr.all_rooms, ARRAY[]::text[]) AS all_rooms,
            COALESCE(swr.all_rids, nnz_s.rid) AS all_rids,
            COALESCE(swg.all_groups, ARRAY[]::text[]) AS all_groups,
            COALESCE(swg.all_gids, ARRAY[nnz_s.gid]::integer[]) AS all_gids
        FROM filtered_variants fv
        JOIN public.nnz_schedule nnz_s ON nnz_s.sh_var_id = fv.sh_var_id
        LEFT JOIN public.people p_main ON p_main.mid = nnz_s.teacher_mid[1]
        JOIN public.courses crs ON crs.cid = nnz_s.cid
        LEFT JOIN public.rooms r_main ON r_main.rid = nnz_s.rid[1]
        JOIN public.eventtools e ON nnz_s.pair_type_id = e.typeid
        JOIN public.groupname g_main ON nnz_s.gid = g_main.gid
        JOIN public.periods pr ON nnz_s.period = pr.lid
        LEFT JOIN schedule_with_teachers swt ON swt.sheid = nnz_s.sheid
        LEFT JOIN schedule_with_rooms swr ON swr.sheid = nnz_s.sheid
        LEFT JOIN schedule_with_groups swg ON swg.sheid = nnz_s.sheid
        WHERE (p_main.mid = ANY($7::integer[]) OR nnz_s.teacher_mid && $7::integer[])
          AND (fv.week_start_date + (nnz_s.day_of_week - 1) * INTERVAL '1 day')::date BETWEEN $8 AND $9
        ORDER BY event_date, period_id;
        """

        rows = await self.conn.fetch(
            sql,
            acad_start_date,  # $1
            study_year_id,    # $2
            y, m,             # $3, $4
            y, m,             # $5, $6
            t_ids,            # $7
            first_date,       # $8
            last_date         # $9
        )

        result = []
        for r in rows:
            d = dict(r)
            p_num = d.get("pair_number") or 1
            p_idx = d.get("pair_index") if d.get("pair_index") is not None else 0
            d["pair_number"] = p_num
            d["period_number"] = p_num
            d["pair_index"] = p_idx
            # Для совместимости с отображением по часам 1..4 в сетке
            d["period_id"] = p_num
            # Сохраняем исходный реальный ID периода
            d["period_lid"] = d.get("period_lid")
            # Название предмета для отображения
            d["subject_name"] = d.get("course_alias") or d.get("course_title") or ""
            d["course_name"] = d["subject_name"]
            # Аудитория для отображения
            d["classroom"] = d.get("room_name") or "--"
            result.append(d)

        return result