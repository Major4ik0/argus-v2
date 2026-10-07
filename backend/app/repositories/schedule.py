import json
from typing import List, Dict, Any, Optional
import asyncpg


class ScheduleRepository:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    def _parse_row(self, row: asyncpg.Record) -> Dict[str, Any]:
        """Преобразует строку Record в словарь и декодирует агрегированный JSON."""
        data = dict(row)
        for field in ("teachers", "rooms"):
            if isinstance(data.get(field), str):
                data[field] = json.loads(data[field])
            elif data.get(field) is None:
                data[field] = []
        data["teacher_mid"] = list(data.get("teacher_mid") or [])
        data["room_ids"] = list(data.get("room_ids") or [])
        return data

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
            data["period"],
            data["gid"],
            data["cid"],
            data["pair_type_id"],
            data["teacher_mid"],
            data.get("rid", []),
            data.get("sh_var_id", 1),
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
        }

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

    async def get_monthly_schedule(
            self,
            year: int,
            month: int,
            teacher_ids: List[int],
    ) -> List[Dict[str, Any]]:
        """
        Календарная сетка занятий за месяц с расчетом точных дат и агрегацией массивов.
        """
        from ..core.calendar_utils import get_month_bounds, get_academic_year_info

        first_day, last_day = get_month_bounds(year, month)
        year_info = get_academic_year_info(first_day)

        # Определение ID учебного года из базы данных
        study_year_sql = """
            SELECT syid 
            FROM public.studyyears 
            WHERE school_year = $1 OR number = $2
            ORDER BY syid DESC 
            LIMIT 1;
        """
        sy_row = await self.conn.fetchrow(study_year_sql, year_info["start_year"], str(year_info["start_year"]))
        study_year_id = sy_row["syid"] if sy_row else None

        # Базовый SQL из старого schedule.py с адаптацией под asyncpg
        sql = """
        WITH schedule_variants AS (
            SELECT 
                nsv.sh_var_id, 
                nsv.sh_var_name, 
                nsv.s_year_id,
                CASE 
                    WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                    WHEN nsv.sh_var_name ~* 'расписания\\s+(\\d+)\\s+недел' THEN
                        $1::date + (CAST(substring(nsv.sh_var_name from 'расписания\\s+(\\d+)') AS INTEGER) - 1) * INTERVAL '1 week'
                    ELSE NULL
                END AS week_start_date
            FROM public.nnz_schedule_variants nsv
            WHERE nsv.sh_var_name IS NOT NULL 
              AND ($2::int IS NULL OR nsv.s_year_id = $2)
        ),
        filtered_variants AS (
            SELECT sv.* 
            FROM schedule_variants sv
            WHERE sv.week_start_date IS NOT NULL
              AND (
                  (EXTRACT(YEAR FROM sv.week_start_date) = $3 AND EXTRACT(MONTH FROM sv.week_start_date) = $4)
                  OR 
                  (EXTRACT(YEAR FROM sv.week_start_date + INTERVAL '6 days') = $3 AND EXTRACT(MONTH FROM sv.week_start_date + INTERVAL '6 days') = $4)
              )
        ),
        schedule_with_teachers AS (
            SELECT 
                nnz_s.sheid,
                array_agg(DISTINCT TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic))) AS all_teachers,
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
            TRIM(CONCAT_WS(' ', p_main.lastname, p_main.firstname, p_main.patronymic)) AS teacher_name,
            TO_CHAR(fv.week_start_date + (nnz_s.day_of_week - 1) * INTERVAL '1 day', 'YYYY-MM-DD') AS event_date,
            pr.name AS period_name, 
            crs.alias AS course_name,
            crs.title AS course_title,
            COALESCE(r_main.short_name, 'Ауд. не указана') AS room_name,
            e.alias AS event_type, 
            g_main.name AS group_name,
            nnz_s.sheid AS schedule_id, 
            fv.sh_var_name,
            nnz_s.day_of_week, 
            p_main.mid AS teacher_mid,
            g_main.gid, 
            crs.cid, 
            r_main.rid, 
            pr.lid AS period_lid, 
            nnz_s.idcathedra, 
            nnz_s.lesson_num, 
            COALESCE(swt.all_teachers, ARRAY[]::text[]) AS all_teachers,
            COALESCE(swt.all_teacher_mids, ARRAY[]::integer[]) AS all_teacher_mids,
            COALESCE(swr.all_rooms, ARRAY[]::text[]) AS all_rooms,
            COALESCE(swr.all_rids, ARRAY[]::integer[]) AS all_rids,
            COALESCE(swg.all_groups, ARRAY[]::text[]) AS all_groups,
            COALESCE(swg.all_gids, ARRAY[]::integer[]) AS all_gids
        FROM filtered_variants fv
        JOIN public.nnz_schedule nnz_s ON nnz_s.sh_var_id = fv.sh_var_id
        JOIN public.people p_main ON p_main.mid = nnz_s.teacher_mid[1]
        JOIN public.courses crs ON crs.cid = nnz_s.cid
        LEFT JOIN public.rooms r_main ON r_main.rid = nnz_s.rid[1]
        JOIN public.eventtools e ON nnz_s.pair_type_id = e.typeid
        JOIN public.groupname g_main ON nnz_s.gid = g_main.gid
        JOIN public.periods pr ON nnz_s.period = pr.lid
        LEFT JOIN schedule_with_teachers swt ON swt.sheid = nnz_s.sheid
        LEFT JOIN schedule_with_rooms swr ON swr.sheid = nnz_s.sheid
        LEFT JOIN schedule_with_groups swg ON swg.sheid = nnz_s.sheid
        WHERE p_main.mid = ANY($5::integer[])
          AND fv.week_start_date + (nnz_s.day_of_week - 1) * INTERVAL '1 day' BETWEEN $6::date AND $7::date
        ORDER BY event_date, pr.lid;
        """

        rows = await self.conn.fetch(
            sql,
            year_info["academic_year_start"],
            study_year_id,
            year,
            month,
            teacher_ids,
            first_day,
            last_day
        )
        return [dict(r) for r in rows]