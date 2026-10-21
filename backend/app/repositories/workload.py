# -*- coding: utf-8 -*-
import re
from typing import List, Dict, Any, Optional
import asyncpg


class WorkloadRepository:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    @staticmethod
    def _extract_initials(lastname: Optional[str], firstname: Optional[str], patronymic: Optional[str]) -> str:
        """Извлекает 2 буквы для аватара преподавателя."""
        l = (lastname or "").strip()
        f = (firstname or "").strip()
        p = (patronymic or "").strip()

        if f and p:
            return f"{f[0].upper()}{p[0].upper()}"
        if l and f:
            return f"{l[0].upper()}{f[0].upper()}"
        if l:
            return l[:2].upper()
        return "ПР"

    async def get_workload_kpi(
        self,
        sh_var_id: Optional[int] = None,
        cathedra_id: Optional[int] = None,
        pmk_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Возвращает 4 верхних KPI-показателя:
        1. Общая нагрузка (академических часов) = пары * 2
        2. Преподавателей (задействованных чел.)
        3. Всего занятий (пар)
        4. Средняя нагрузка на преподавателя (ч/чел)
        """
        sql = """
        WITH target_teachers AS (
            SELECT DISTINCT p.mid
            FROM public.people p
            JOIN public.cathedra_personnel cp ON p.mid = cp.mid
            WHERE cp.id_pmk IN (1, 2)
              AND ($1::int IS NULL OR cp.cid = $1)
              AND ($2::int IS NULL OR cp.id_pmk = $2)
        ),
        schedule_entries AS (
            SELECT 
                s.sheid,
                t.mid
            FROM public.nnz_schedule s
            CROSS JOIN UNNEST(s.teacher_mid) AS t(mid)
            JOIN target_teachers tt ON tt.mid = t.mid
            WHERE ($3::int IS NULL OR s.sh_var_id = $3)
        )
        SELECT 
            COALESCE(COUNT(DISTINCT sheid), 0)::int AS total_lessons,
            COALESCE(COUNT(DISTINCT mid), 0)::int AS active_teachers,
            COALESCE(COUNT(sheid) * 2, 0)::int AS total_hours
        FROM schedule_entries;
        """
        row = await self.conn.fetchrow(sql, cathedra_id, pmk_id, sh_var_id)
        total_lessons = row["total_lessons"] if row else 0
        total_hours = row["total_hours"] if row else 0
        active_teachers = row["active_teachers"] if row else 0

        # Если в расписании нет пар, считаем общее количество преподавателей в штате
        if active_teachers == 0:
            staff_count = await self.conn.fetchval(
                """
                SELECT COUNT(DISTINCT p.mid)::int
                FROM public.people p
                JOIN public.cathedra_personnel cp ON p.mid = cp.mid
                WHERE cp.id_pmk IN (1, 2)
                  AND ($1::int IS NULL OR cp.cid = $1)
                  AND ($2::int IS NULL OR cp.id_pmk = $2);
                """,
                cathedra_id,
                pmk_id,
            )
            teacher_count = staff_count or 0
        else:
            teacher_count = active_teachers

        avg_hours = round(total_hours / max(teacher_count, 1), 1)

        return {
            "total_hours": total_hours,
            "teacher_count": teacher_count,
            "total_lessons": total_lessons,
            "avg_hours": avg_hours,
        }

    async def get_teachers_workload_cards(
        self,
        sh_var_id: Optional[int] = None,
        cathedra_id: Optional[int] = None,
        pmk_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Список преподавателей кафедры с разбивкой нагрузки по 6 типам занятий
        для отображения карточек (3x2 показатели) и таблицы.
        """
        sql = """
        WITH teacher_base AS (
            SELECT DISTINCT
                p.mid,
                p.lastname,
                p.firstname,
                p.patronymic,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                c.cathedra AS cathedra_name,
                cp.id_pmk AS pmk_id,
                pm.name_pmk AS pmk_name,
                ad.name AS academic_degree
            FROM public.people p
            JOIN public.cathedra_personnel cp ON p.mid = cp.mid
            LEFT JOIN public.cathedras c ON cp.cid = c.idcathedra
            LEFT JOIN public.pmk pm ON cp.id_pmk = pm.id_pmk
            LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
            WHERE cp.id_pmk IN (1, 2)
              AND ($1::int IS NULL OR cp.cid = $1)
              AND ($2::int IS NULL OR cp.id_pmk = $2)
        ),
        teacher_schedule AS (
            SELECT 
                t.mid,
                s.sheid,
                s.pair_type_id,
                et.alias AS event_alias
            FROM public.nnz_schedule s
            CROSS JOIN UNNEST(s.teacher_mid) AS t(mid)
            LEFT JOIN public.eventtools et ON et.typeid = s.pair_type_id
            WHERE ($3::int IS NULL OR s.sh_var_id = $3)
        )
        SELECT 
            tb.mid AS teacher_id,
            tb.full_name,
            tb.lastname,
            tb.firstname,
            tb.patronymic,
            COALESCE(tb.cathedra_name, 'Кафедра АСУ') AS cathedra_name,
            tb.pmk_id,
            COALESCE(tb.pmk_name, 'ПМК ' || tb.pmk_id::text) AS pmk_name,
            tb.academic_degree,
            COUNT(ts.sheid)::int AS total_lessons,
            (COUNT(ts.sheid) * 2)::int AS total_hours,
            -- Лекции: alias = 'Л' или содержит 'лек' или pair_type_id = 1
            SUM(CASE 
                WHEN ts.event_alias = 'Л' OR ts.event_alias ILIKE '%лек%' OR ts.pair_type_id = 1 
                THEN 2 ELSE 0 
            END)::int AS lectures_hours,
            -- Практики: alias = 'П', 'ПЗ' или содержит 'пр'
            SUM(CASE 
                WHEN ts.event_alias IN ('П', 'ПЗ') OR ts.event_alias ILIKE '%пр%' OR ts.pair_type_id = 2 
                THEN 2 ELSE 0 
            END)::int AS practical_hours,
            -- Лабораторные: alias = 'ЛР', 'ЛБ' или содержит 'лаб'
            SUM(CASE 
                WHEN ts.event_alias IN ('ЛР', 'ЛБ') OR ts.event_alias ILIKE '%лаб%' 
                THEN 2 ELSE 0 
            END)::int AS lab_hours,
            -- Экзамены и зачеты: alias = 'Э', 'З' или содержит 'экз'/'зач'
            SUM(CASE 
                WHEN ts.event_alias IN ('Э', 'З') OR ts.event_alias ILIKE '%экз%' OR ts.event_alias ILIKE '%зач%' 
                THEN 2 ELSE 0 
            END)::int AS exams_hours,
            -- Курсовые работы: alias = 'КР', 'КуР' или содержит 'курс'
            SUM(CASE 
                WHEN ts.event_alias IN ('КуР', 'КР') OR ts.event_alias ILIKE '%курс%' 
                THEN 2 ELSE 0 
            END)::int AS course_work_hours
        FROM teacher_base tb
        LEFT JOIN teacher_schedule ts ON tb.mid = ts.mid
        GROUP BY 
            tb.mid, tb.full_name, tb.lastname, tb.firstname, tb.patronymic,
            tb.cathedra_name, tb.pmk_id, tb.pmk_name, tb.academic_degree
        ORDER BY total_hours DESC, tb.lastname;
        """
        rows = await self.conn.fetch(sql, cathedra_id, pmk_id, sh_var_id)
        items = []

        max_hours = max([r["total_hours"] for r in rows], default=1) or 1

        for r in rows:
            d = dict(r)
            lectures = d.get("lectures_hours") or 0
            practical = d.get("practical_hours") or 0
            labs = d.get("lab_hours") or 0
            exams = d.get("exams_hours") or 0
            course_work = d.get("course_work_hours") or 0
            total = d.get("total_hours") or 0
            categorized_sum = lectures + practical + labs + exams + course_work
            other = max(0, total - categorized_sum)

            initials = self._extract_initials(d.get("lastname"), d.get("firstname"), d.get("patronymic"))
            percentage = round((total / max_hours) * 100, 1)

            items.append({
                "teacher_id": d["teacher_id"],
                "full_name": d["full_name"],
                "lastname": d.get("lastname") or "",
                "initials": initials,
                "cathedra_name": d.get("cathedra_name"),
                "pmk_id": d.get("pmk_id"),
                "pmk_name": d.get("pmk_name"),
                "academic_degree": d.get("academic_degree"),
                "lectures_hours": lectures,
                "practical_hours": practical,
                "lab_hours": labs,
                "exams_hours": exams,
                "course_work_hours": course_work,
                "other_hours": other,
                "total_hours": total,
                "total_lessons": d.get("total_lessons") or 0,
                "load_percentage": percentage,
            })

        return items

    async def get_teacher_detailed_workload(
        self,
        teacher_id: int,
        sh_var_id: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Детализация нагрузки одного преподавателя по предметам, группам и типам пар."""
        # 1. Информация о преподавателе
        teacher_sql = """
        SELECT 
            p.mid AS teacher_id,
            TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
            c.cathedra AS cathedra_name,
            pm.name_pmk AS pmk_name,
            ad.name AS academic_degree
        FROM public.people p
        LEFT JOIN public.cathedra_personnel cp ON p.mid = cp.mid
        LEFT JOIN public.cathedras c ON cp.cid = c.idcathedra
        LEFT JOIN public.pmk pm ON cp.id_pmk = pm.id_pmk
        LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
        WHERE p.mid = $1
        LIMIT 1;
        """
        teacher_row = await self.conn.fetchrow(teacher_sql, teacher_id)
        if not teacher_row:
            return None

        t_data = dict(teacher_row)

        # 2. Детализация занятий по предметам и группам
        lessons_sql = """
        SELECT 
            c.cid AS course_id,
            COALESCE(c.alias, c.title, 'Дисциплина') AS course_alias,
            c.title AS course_title,
            COALESCE(g.name, 'Без группы') AS group_name,
            COALESCE(f."shortName", f.faculty, 'Общие') AS faculty_name,
            COALESCE(et.alias, 'Пара') AS lesson_type,
            COUNT(s.sheid)::int AS lessons_count,
            (COUNT(s.sheid) * 2)::int AS hours_count
        FROM public.nnz_schedule s
        CROSS JOIN UNNEST(s.teacher_mid) AS t(mid)
        JOIN public.courses c ON c.cid = s.cid
        LEFT JOIN public.eventtools et ON et.typeid = s.pair_type_id
        LEFT JOIN public.groupname g ON g.gid = s.gid
        LEFT JOIN public.fuculty f ON f.idfaculty = g.idfaculty
        WHERE t.mid = $1
          AND ($2::int IS NULL OR s.sh_var_id = $2)
        GROUP BY c.cid, c.alias, c.title, g.name, f."shortName", f.faculty, et.alias
        ORDER BY hours_count DESC, course_alias;
        """
        lesson_rows = await self.conn.fetch(lessons_sql, teacher_id, sh_var_id)
        lessons_list = [dict(r) for r in lesson_rows]

        total_hours = sum(r["hours_count"] for r in lessons_list)
        total_lessons = sum(r["lessons_count"] for r in lessons_list)

        # Подсчет типов
        lectures = 0
        practical = 0
        labs = 0
        exams = 0
        course_work = 0
        for l in lessons_list:
            lt = (l.get("lesson_type") or "").upper()
            h = l.get("hours_count") or 0
            if lt == "Л" or "ЛЕК" in lt:
                lectures += h
            elif lt in ("П", "ПЗ") or "ПР" in lt:
                practical += h
            elif lt in ("ЛР", "ЛБ") or "ЛАБ" in lt:
                labs += h
            elif lt in ("Э", "З") or "ЭКЗ" in lt or "ЗАЧ" in lt:
                exams += h
            elif lt in ("КР", "КУР") or "КУРС" in lt:
                course_work += h

        other = max(0, total_hours - (lectures + practical + labs + exams + course_work))

        return {
            "teacher_id": t_data["teacher_id"],
            "full_name": t_data["full_name"],
            "pmk_name": t_data.get("pmk_name") or "ПМК",
            "cathedra_name": t_data.get("cathedra_name") or "Кафедра АСУ",
            "academic_degree": t_data.get("academic_degree"),
            "total_hours": total_hours,
            "total_lessons": total_lessons,
            "lectures_hours": lectures,
            "practical_hours": practical,
            "lab_hours": labs,
            "exams_hours": exams,
            "course_work_hours": course_work,
            "other_hours": other,
            "lessons": lessons_list,
        }

    async def get_types_distribution(
        self,
        sh_var_id: Optional[int] = None,
        cathedra_id: Optional[int] = None,
        pmk_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Общее распределение часов по 5 ключевым типам занятий для круговой диаграммы."""
        sql = """
        WITH target_teachers AS (
            SELECT p.mid
            FROM public.people p
            JOIN public.cathedra_personnel cp ON p.mid = cp.mid
            WHERE cp.id_pmk IN (1, 2)
              AND ($1::int IS NULL OR cp.cid = $1)
              AND ($2::int IS NULL OR cp.id_pmk = $2)
        )
        SELECT 
            COALESCE(et.alias, 'Прочее') AS raw_alias,
            COUNT(s.sheid)::int AS pairs_count,
            (COUNT(s.sheid) * 2)::int AS hours
        FROM public.nnz_schedule s
        CROSS JOIN UNNEST(s.teacher_mid) AS t(mid)
        JOIN target_teachers tt ON tt.mid = t.mid
        LEFT JOIN public.eventtools et ON et.typeid = s.pair_type_id
        WHERE ($3::int IS NULL OR s.sh_var_id = $3)
        GROUP BY et.alias;
        """
        rows = await self.conn.fetch(sql, cathedra_id, pmk_id, sh_var_id)

        buckets = {
            "Лекции": {"hours": 0, "color": "#3b82f6"},
            "Практики": {"hours": 0, "color": "#10b981"},
            "Лабораторные": {"hours": 0, "color": "#f59e0b"},
            "Экзамены и зачеты": {"hours": 0, "color": "#ef4444"},
            "Курсовые работы": {"hours": 0, "color": "#8b5cf6"},
            "Прочее": {"hours": 0, "color": "#06b6d4"},
        }

        for r in rows:
            alias = (r["raw_alias"] or "").upper()
            h = r["hours"]
            if alias == "Л" or "ЛЕК" in alias:
                buckets["Лекции"]["hours"] += h
            elif alias in ("П", "ПЗ") or "ПР" in alias:
                buckets["Практики"]["hours"] += h
            elif alias in ("ЛР", "ЛБ") or "ЛАБ" in alias:
                buckets["Лабораторные"]["hours"] += h
            elif alias in ("Э", "З") or "ЭКЗ" in alias or "ЗАЧ" in alias:
                buckets["Экзамены и зачеты"]["hours"] += h
            elif alias in ("КР", "КУР") or "КУРС" in alias:
                buckets["Курсовые работы"]["hours"] += h
            else:
                buckets["Прочее"]["hours"] += h

        total = sum(b["hours"] for b in buckets.values())
        result = []
        for name, data in buckets.items():
            if data["hours"] > 0 or total == 0:
                pct = round((data["hours"] / total * 100), 1) if total > 0 else 0.0
                result.append({
                    "event_type_name": name,
                    "hours": data["hours"],
                    "percentage": pct,
                    "color": data["color"],
                })

        return result
