# -*- coding: utf-8 -*-
from typing import List, Dict, Any, Set, Optional
import asyncpg


class RecommendationsRepository:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    async def get_busy_teacher_ids(self, day_of_week: int, period: int, sh_var_id: int = 1) -> Set[int]:
        """Получить список ID всех преподавателей, уже занятых на этой паре."""
        sql = """
            SELECT DISTINCT UNNEST(teacher_mid) AS teacher_id
            FROM public.nnz_schedule
            WHERE day_of_week = $1 
              AND period = $2 
              AND sh_var_id = $3;
        """
        rows = await self.conn.fetch(sql, day_of_week, period, sh_var_id)
        return {r["teacher_id"] for r in rows if r["teacher_id"] is not None}

    async def get_teacher_courses_map(self) -> Dict[int, Set[int]]:
        """Карта: ID преподавателя -> Множество ID дисциплин, которые он ведет."""
        sql = """
            SELECT DISTINCT 
                UNNEST(s.teacher_mid) AS teacher_id,
                s.cid AS course_id
            FROM public.nnz_schedule s
            WHERE s.cid IS NOT NULL;
        """
        rows = await self.conn.fetch(sql)
        mapping: Dict[int, Set[int]] = {}
        for r in rows:
            t_id = r["teacher_id"]
            if t_id not in mapping:
                mapping[t_id] = set()
            mapping[t_id].add(r["course_id"])
        return mapping

    async def find_replacements(
        self,
        day_of_week: int,
        period: int,
        course_id: int,
        current_teacher_id: Optional[int] = None,
        sh_var_id: int = 1
    ) -> List[Dict[str, Any]]:
        """Подбор кандидатов на замену по коэффициенту Жаккара и статусу занятости."""
        # 1. Занятые преподаватели в этот временной слот
        busy_teachers = await self.get_busy_teacher_ids(day_of_week, period, sh_var_id)

        # 2. Список всех преподавателей с их кафедрой
        teachers_sql = """
            SELECT 
                p.mid AS teacher_id,
                p.lastname,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                COALESCE(cp.idcathedra, 0) AS cathedra_id
            FROM public.people p
            LEFT JOIN public.cathedra_personnel cp ON cp.mid = p.mid
            ORDER BY p.lastname;
        """
        all_teachers = await self.conn.fetch(teachers_sql)

        # 3. Карта дисциплин преподавателей
        teacher_courses = await self.get_teacher_courses_map()

        # Карта названий дисциплин
        courses_sql = "SELECT cid, alias, title FROM public.courses;"
        courses_rows = await self.conn.fetch(courses_sql)
        courses_titles = {
            r["cid"]: (r["alias"] or r["title"] or f"Дисциплина #{r['cid']}")
            for r in courses_rows
        }

        # Определяем кафедру и дисциплины текущего преподавателя
        current_teacher_cathedra = 0
        current_courses: Set[int] = set()
        if current_teacher_id:
            current_courses = teacher_courses.get(current_teacher_id, set())
            for t in all_teachers:
                if t["teacher_id"] == current_teacher_id:
                    current_teacher_cathedra = t["cathedra_id"]
                    break

        candidates = []

        for t in all_teachers:
            t_id = t["teacher_id"]
            if current_teacher_id and t_id == current_teacher_id:
                continue

            cand_courses = teacher_courses.get(t_id, set())
            teaches_target = course_id in cand_courses
            is_free = t_id not in busy_teachers
            is_same_cathedra = (
                current_teacher_cathedra > 0 and
                t["cathedra_id"] == current_teacher_cathedra
            )

            # Расчет коэффициента Жаккара: |A ∩ B| / |A ∪ B|
            if current_courses and cand_courses:
                intersection = current_courses.intersection(cand_courses)
                union = current_courses.union(cand_courses)
                jaccard = round(len(intersection) / len(union), 3) if union else 0.0
                shared_titles = [courses_titles[cid] for cid in intersection if cid in courses_titles]
            else:
                jaccard = 1.0 if teaches_target else 0.0
                shared_titles = [courses_titles[course_id]] if teaches_target and course_id in courses_titles else []

            # Итоговый скор для сортировки (свободен > ведет предмет > Жаккар > кафедра)
            sort_weight = (
                (10.0 if is_free else 0.0) +
                (5.0 if teaches_target else 0.0) +
                (jaccard * 3.0) +
                (1.0 if is_same_cathedra else 0.0)
            )

            candidates.append({
                "teacher_id": t_id,
                "full_name": t["full_name"],
                "lastname": t["lastname"],
                "is_free": is_free,
                "is_same_cathedra": is_same_cathedra,
                "jaccard_score": jaccard,
                "teaches_target_course": teaches_target,
                "shared_courses": shared_titles,
                "_sort_weight": sort_weight
            })

        # Сортируем: сначала свободные и наиболее подходящие
        candidates.sort(key=lambda x: x["_sort_weight"], reverse=True)

        for c in candidates:
            c.pop("_sort_weight", None)

        return candidates

    async def apply_replacement(self, sheid: int, old_teacher_id: int, new_teacher_id: int) -> bool:
        """Замена ID преподавателя в массиве teacher_mid конкретной пары."""
        sql = """
            UPDATE public.nnz_schedule
            SET teacher_mid = array_replace(teacher_mid, $1, $2)
            WHERE sheid = $3 AND $1 = ANY(teacher_mid);
        """
        result = await self.conn.execute(sql, old_teacher_id, new_teacher_id, sheid)
        return result == "UPDATE 1"

    async def get_candidates_for_slot(
            self,
            date_str: str,
            pair_index: int = 0,
            group_id: Optional[int] = None,
            course_id: Optional[int] = None,
            course_alias: Optional[str] = None,
            cathedra_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Поиск занятых и свободных преподавателей на конкретный слот."""
        from datetime import datetime
        from ..core.calendar_utils import get_academic_year_info

        date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
        day_of_week = date_obj.isoweekday()
        year_info = get_academic_year_info(date_obj)

        # 1. Определение учебного года
        sy_row = await self.conn.fetchrow(
            "SELECT syid FROM public.studyyears WHERE school_year = $1 OR number = $2 LIMIT 1;",
            year_info["start_year"], str(year_info["start_year"])
        )
        if not sy_row:
            sy_row = await self.conn.fetchrow("SELECT syid FROM public.studyyears ORDER BY syid DESC LIMIT 1;")
        s_year_id = sy_row["syid"] if sy_row else None

        # 2. Определение period_id по номеру (индексу) пары
        period_row = await self.conn.fetchrow(
            "SELECT lid FROM public.periods WHERE s_year_id = $1 ORDER BY starttime ASC, lid ASC OFFSET $2 LIMIT 1;",
            s_year_id, pair_index
        )
        period_id = period_row["lid"] if period_row else None

        # 3. Определение кафедры группы, если не передана
        if not cathedra_id and group_id:
            g_row = await self.conn.fetchrow("SELECT idcathedra FROM public.groupname WHERE gid = $1;", group_id)
            if g_row and g_row["idcathedra"]:
                cathedra_id = g_row["idcathedra"]

        # 4. Поиск sh_var_id недели для указанной даты
        sh_var_query = """
        WITH schedule_variants AS (
            SELECT 
                sh_var_id,
                CASE 
                    WHEN sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                    ELSE NULL
                END as week_start_date
            FROM public.nnz_schedule_variants 
            WHERE s_year_id = $1 AND sh_var_name IS NOT NULL
        )
        SELECT sh_var_id FROM schedule_variants
        WHERE week_start_date IS NOT NULL
          AND $2::date BETWEEN week_start_date AND week_start_date + INTERVAL '6 days'
        LIMIT 1;
        """
        sh_row = await self.conn.fetchrow(sh_var_query, s_year_id, date_obj)
        sh_var_id = sh_row["sh_var_id"] if sh_row else None

        # 5. Занятые преподаватели в этот временной слот
        busy_teachers = []
        if sh_var_id and period_id:
            busy_query = """
            SELECT DISTINCT
                p.mid AS id,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS name,
                et.alias AS lesson_type,
                cr.alias AS course,
                gn.name AS group,
                ns.sheid AS schedule_id
            FROM public.nnz_schedule ns
            JOIN public.people p ON p.mid = ANY(ns.teacher_mid)
            JOIN public.eventtools et ON ns.pair_type_id = et.typeid
            JOIN public.courses cr ON ns.cid = cr.cid
            JOIN public.groupname gn ON ns.gid = gn.gid
            WHERE ns.sh_var_id = $1
              AND ns.period = $2
              AND ns.day_of_week = $3;
            """
            busy_rows = await self.conn.fetch(busy_query, sh_var_id, period_id, day_of_week)
            busy_teachers = [dict(r) for r in busy_rows]

        # 6. Преподаватели с опытом ведения этой дисциплины
        course_ids = []
        if course_id:
            course_ids.append(course_id)
        if course_alias:
            alias_rows = await self.conn.fetch("SELECT cid FROM public.courses WHERE alias = $1;", course_alias)
            course_ids.extend([r["cid"] for r in alias_rows])

        experienced_teachers = []
        if course_ids:
            exp_sql = f"""
            SELECT DISTINCT
                p.mid AS id,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                ad.shortname AS degree_short,
                cp.id_pmk,
                COUNT(*)::int AS total_count,
                COUNT(CASE WHEN ns.gid = $1 THEN 1 END)::int AS same_group_count
            FROM public.nnz_schedule ns
            JOIN public.people p ON p.mid = ANY(ns.teacher_mid)
            LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
            JOIN public.cathedra_personnel cp ON p.mid = cp.mid
            WHERE ns.cid = ANY($2::int[])
            {'AND ns.idcathedra = $3' if cathedra_id else ''}
            GROUP BY p.mid, p.lastname, p.firstname, p.patronymic, ad.shortname, cp.id_pmk
            ORDER BY total_count DESC
            LIMIT 30;
            """
            params = [group_id or -1, course_ids]
            if cathedra_id:
                params.append(cathedra_id)
            exp_rows = await self.conn.fetch(exp_sql, *params)
            experienced_teachers = [dict(r) for r in exp_rows]

        # 7. Все преподаватели кафедры
        all_cathedra_teachers = []
        if cathedra_id:
            cath_sql = """
            SELECT DISTINCT
                p.mid AS id,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                ad.shortname AS degree_short,
                cp.id_pmk
            FROM public.cathedra_personnel cp
            JOIN public.people p ON p.mid = cp.mid
            LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
            WHERE cp.cid = $1 AND cp.id_pmk IN (1, 2)
            ORDER BY full_name;
            """
            cath_rows = await self.conn.fetch(cath_sql, cathedra_id)
            all_cathedra_teachers = [dict(r) for r in cath_rows]

        # 8. Разделение свободных на опытных и неопытных
        busy_ids = {t["id"] for t in busy_teachers}
        experienced_map = {t["id"]: t for t in experienced_teachers}

        free_experienced = []
        free_unexperienced = []

        for teacher in all_cathedra_teachers:
            t_id = teacher["id"]
            if t_id not in busy_ids:
                item = {
                    "id": t_id,
                    "name": teacher["full_name"],
                    "degree": teacher["degree_short"],
                    "pmk": teacher["id_pmk"],
                }
                if t_id in experienced_map:
                    exp = experienced_map[t_id]
                    item["experience"] = {
                        "total": exp["total_count"],
                        "same_group": exp["same_group_count"],
                    }
                    free_experienced.append(item)
                else:
                    free_unexperienced.append(item)

        return {
            "success": True,
            "slot_info": {
                "date": date_str,
                "day_of_week": day_of_week,
                "pair_index": pair_index,
                "period_id": period_id,
                "course_id": course_id,
                "group_id": group_id,
                "cathedra_id": cathedra_id,
            },
            "busy_teachers": busy_teachers,
            "free_teachers": {
                "experienced": free_experienced,
                "unexperienced": free_unexperienced,
                "total_free": len(free_experienced) + len(free_unexperienced),
            },
        }

    async def find_teachers_for_course(
            self,
            course_id: Optional[int] = None,
            course_alias: Optional[str] = "",
            group_id: Optional[int] = None,
            type_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Поиск преподавателей по истории ведения предмета."""
        course_ids = []
        if course_id:
            course_ids.append(course_id)
        if course_alias:
            alias_rows = await self.conn.fetch("SELECT cid FROM public.courses WHERE alias = $1;", course_alias)
            course_ids.extend([r["cid"] for r in alias_rows])

        if not course_ids:
            return {"success": False, "recommendations": [], "total_count": 0, "criteria": {}}

        query = """
        SELECT 
            p.mid,
            p.lastname,
            p.firstname,
            p.patronymic,
            TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
            ad.shortname AS degree_short,
            ad.agid AS degree_id,
            cp.id_pmk,
            COUNT(*)::int AS total_count,
            COUNT(CASE WHEN ns.gid = $1 THEN 1 END)::int AS same_group_count,
            COUNT(CASE WHEN ns.pair_type_id = $2 THEN 1 END)::int AS same_type_count,
            MAX(
                CASE 
                    WHEN nsv.sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                        TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(nsv.sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                        + (ns.day_of_week - 1) * INTERVAL '1 day'
                    ELSE NULL
                END
            ) AS last_lesson_date
        FROM public.nnz_schedule ns
        JOIN public.people p ON p.mid = ANY(ns.teacher_mid)
        LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
        JOIN public.cathedra_personnel cp ON p.mid = cp.mid
        LEFT JOIN public.nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
        WHERE ns.cid = ANY($3::int[])
          AND cp.id_pmk IN (1, 2)
        GROUP BY p.mid, p.lastname, p.firstname, p.patronymic, ad.shortname, ad.agid, cp.id_pmk
        ORDER BY same_group_count DESC, total_count DESC
        LIMIT 20;
        """
        rows = await self.conn.fetch(query, group_id or -1, type_id or -1, course_ids)

        teachers = [dict(r) for r in rows]
        max_total = max((t["total_count"] for t in teachers), default=1)
        max_group = max((t["same_group_count"] for t in teachers), default=1)

        recommendations = []
        for t in teachers:
            total = t["total_count"] or 0
            same_group = t["same_group_count"] or 0
            total_score = (total / max_total * 100) if max_total > 0 else 0
            group_score = (same_group / max_group * 100) if max_group > 0 else 0

            # 60% опыт с конкретной группой + 40% общий опыт
            confidence = round(group_score * 0.6 + total_score * 0.4, 1)

            last_date_str = t["last_lesson_date"].strftime("%Y-%m-%d") if t.get("last_lesson_date") else None

            recommendations.append({
                "mid": t["mid"],
                "full_name": t["full_name"],
                "lastname": t["lastname"],
                "firstname": t["firstname"],
                "patronymic": t["patronymic"],
                "degree_short": t["degree_short"],
                "degree_id": t["degree_id"],
                "id_pmk": t["id_pmk"],
                "total_count": total,
                "same_group_count": same_group,
                "same_type_count": t["same_type_count"],
                "confidence": confidence,
                "last_lesson_date": last_date_str,
                "match_score": confidence,
            })

        recommendations.sort(key=lambda x: x["confidence"], reverse=True)

        return {
            "success": True,
            "recommendations": recommendations,
            "total_count": len(recommendations),
            "criteria": {
                "course_ids": course_ids,
                "group_id": group_id,
                "type_id": type_id,
                "method": "experience_based",
            },
        }