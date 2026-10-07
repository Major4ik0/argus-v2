# -*- coding: utf-8 -*-
from typing import List, Dict, Any, Optional
import asyncpg


class WorkloadRepository:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    async def get_teachers_workload(
        self,
        faculty_id: Optional[int] = None,
        cathedra_id: Optional[int] = None,
        sh_var_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Сводная нагрузка по всем преподавателям."""
        conditions = []
        params = []

        if faculty_id is not None:
            params.append(faculty_id)
            conditions.append(f"g.idfaculty = ${len(params)}")

        if cathedra_id is not None:
            params.append(cathedra_id)
            conditions.append(f"s.idcathedra = ${len(params)}")

        if sh_var_id is not None:
            params.append(sh_var_id)
            conditions.append(f"s.sh_var_id = ${len(params)}")

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        sql = f"""
            SELECT 
                p.mid AS teacher_id,
                p.lastname,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                COUNT(s.sheid)::int AS total_pairs,
                (COUNT(s.sheid) * 2)::int AS total_hours
            FROM public.nnz_schedule s
            CROSS JOIN UNNEST(s.teacher_mid) AS t(mid)
            JOIN public.people p ON p.mid = t.mid
            LEFT JOIN public.groupname g ON g.gid = s.gid
            {where_clause}
            GROUP BY p.mid, p.lastname, p.firstname, p.patronymic
            ORDER BY total_hours DESC, p.lastname;
        """
        rows = await self.conn.fetch(sql, *params)
        return [dict(r) for r in rows]

    async def get_teacher_detailed_workload(
        self,
        teacher_id: int,
        sh_var_id: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Детализация нагрузки одного преподавателя с разбивкой по типам пар и предметам."""
        var_filter = "AND s.sh_var_id = $2" if sh_var_id else ""
        params = [teacher_id]
        if sh_var_id:
            params.append(sh_var_id)

        # 1. Получаем ФИО преподавателя и общие часы
        teacher_sql = f"""
            SELECT 
                p.mid AS teacher_id,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                COUNT(s.sheid)::int AS total_pairs,
                (COUNT(s.sheid) * 2)::int AS total_hours
            FROM public.people p
            LEFT JOIN public.nnz_schedule s ON $1 = ANY(s.teacher_mid) {var_filter}
            WHERE p.mid = $1
            GROUP BY p.mid, p.lastname, p.firstname, p.patronymic;
        """
        teacher_row = await self.conn.fetchrow(teacher_sql, *params)
        if not teacher_row:
            return None

        data = dict(teacher_row)
        total_pairs = data["total_pairs"]

        # 2. Разбивка по типам занятий
        event_sql = f"""
            SELECT 
                e.typeid AS event_type_id,
                COALESCE(e.alias, 'Не указано') AS event_type_name,
                COUNT(s.sheid)::int AS total_pairs,
                (COUNT(s.sheid) * 2)::int AS total_hours
            FROM public.nnz_schedule s
            JOIN public.eventtools e ON e.typeid = s.pair_type_id
            WHERE $1 = ANY(s.teacher_mid) {var_filter}
            GROUP BY e.typeid, e.alias
            ORDER BY total_hours DESC;
        """
        event_rows = await self.conn.fetch(event_sql, *params)
        events_list = []
        for r in event_rows:
            item = dict(r)
            item["percentage"] = round((item["total_pairs"] / total_pairs * 100), 1) if total_pairs > 0 else 0.0
            events_list.append(item)
        data["by_event_types"] = events_list

        # 3. Разбивка по дисциплинам
        course_sql = f"""
            SELECT 
                c.cid AS course_id,
                c.alias AS course_alias,
                c.title AS course_title,
                COUNT(s.sheid)::int AS total_pairs,
                (COUNT(s.sheid) * 2)::int AS total_hours
            FROM public.nnz_schedule s
            JOIN public.courses c ON c.cid = s.cid
            WHERE $1 = ANY(s.teacher_mid) {var_filter}
            GROUP BY c.cid, c.alias, c.title
            ORDER BY total_hours DESC;
        """
        course_rows = await self.conn.fetch(course_sql, *params)
        data["by_courses"] = [dict(r) for r in course_rows]

        return data

    async def get_event_type_distribution(
        self,
        sh_var_id: Optional[int] = None,
        faculty_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Общее распределение часов по типам занятий для круговой диаграммы."""
        conditions = []
        params = []

        if sh_var_id is not None:
            params.append(sh_var_id)
            conditions.append(f"s.sh_var_id = ${len(params)}")

        if faculty_id is not None:
            params.append(faculty_id)
            conditions.append(f"g.idfaculty = ${len(params)}")

        where_clause = f"WHERE {' AND '.join(conditions)}" if conditions else ""

        sql = f"""
            SELECT 
                e.typeid AS event_type_id,
                COALESCE(e.alias, 'Не указано') AS event_type_name,
                COUNT(s.sheid)::int AS total_pairs,
                (COUNT(s.sheid) * 2)::int AS total_hours
            FROM public.nnz_schedule s
            JOIN public.eventtools e ON e.typeid = s.pair_type_id
            LEFT JOIN public.groupname g ON g.gid = s.gid
            {where_clause}
            GROUP BY e.typeid, e.alias
            ORDER BY total_hours DESC;
        """
        rows = await self.conn.fetch(sql, *params)
        raw_items = [dict(r) for r in rows]
        overall_pairs = sum(item["total_pairs"] for item in raw_items)

        for item in raw_items:
            item["percentage"] = round((item["total_pairs"] / overall_pairs * 100), 1) if overall_pairs > 0 else 0.0

        return raw_items

    async def get_faculties_workload(self, sh_var_id: Optional[int] = None) -> List[Dict[str, Any]]:
        """Распределение учебных часов по факультетам."""
        param_clause = "WHERE s.sh_var_id = $1" if sh_var_id else ""
        params = [sh_var_id] if sh_var_id else []

        sql = f"""
            SELECT 
                f.idfaculty AS faculty_id,
                COALESCE(f."shortName", 'Общие потоки') AS faculty_name,
                COUNT(s.sheid)::int AS total_pairs,
                (COUNT(s.sheid) * 2)::int AS total_hours
            FROM public.nnz_schedule s
            LEFT JOIN public.groupname g ON g.gid = s.gid
            LEFT JOIN public.fuculty f ON f.idfaculty = g.idfaculty
            {param_clause}
            GROUP BY f.idfaculty, f."shortName"
            ORDER BY total_hours DESC;
        """
        rows = await self.conn.fetch(sql, *params)
        return [dict(r) for r in rows]