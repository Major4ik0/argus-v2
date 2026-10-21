# -*- coding: utf-8 -*-
import math
import re
from datetime import datetime, timedelta, date as dt_date
from typing import List, Dict, Any, Set, Optional, Tuple
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
                COALESCE(cp.cid, 0) AS cathedra_id
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

            # Расчет коэффициента Жаккара: |A ∩ B| / |A ∪ B| и коэффициента Шимкевича-Симпсона
            if current_courses and cand_courses:
                intersection = current_courses.intersection(cand_courses)
                union = current_courses.union(cand_courses)
                jaccard = round(len(intersection) / len(union), 3) if union else 0.0
                min_len = min(len(current_courses), len(cand_courses))
                overlap = round(len(intersection) / min_len, 3) if min_len > 0 else 0.0
                shared_titles = [courses_titles[cid] for cid in intersection if cid in courses_titles]
            else:
                jaccard = 1.0 if teaches_target else 0.0
                overlap = 1.0 if teaches_target else 0.0
                shared_titles = [courses_titles[course_id]] if teaches_target and course_id in courses_titles else []

            # Итоговый скор для сортировки (свободен > ведет предмет > Жаккар & Overlap > кафедра)
            sort_weight = (
                (10.0 if is_free else 0.0) +
                (5.0 if teaches_target else 0.0) +
                (jaccard * 3.0) +
                (overlap * 2.0) +
                (1.0 if is_same_cathedra else 0.0)
            )

            candidates.append({
                "teacher_id": t_id,
                "full_name": t["full_name"],
                "lastname": t["lastname"],
                "is_free": is_free,
                "is_same_cathedra": is_same_cathedra,
                "jaccard_score": jaccard,
                "overlap_score": overlap,
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
            "SELECT school_year FROM public.studyyears WHERE name = $1 OR number = $2 OR school_year = $3 LIMIT 1;",
            str(year_info["start_year"]), str(year_info["start_year"])[-2:], year_info["start_year"]
        )
        if not sy_row:
            sy_row = await self.conn.fetchrow("SELECT school_year FROM public.studyyears ORDER BY school_year DESC LIMIT 1;")
        s_year_id = sy_row["school_year"] if sy_row else 35

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

    async def get_mathematical_recommendations(
        self,
        course_id: Optional[int] = None,
        course_alias: Optional[str] = None,
        group_id: Optional[int] = None,
        pair_type_id: Optional[int] = None,
        cathedra_id: Optional[int] = None,
        exclude_teacher_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Математический подбор преподавателей:
        Взвешенный скоринг на основе опыта по курсу (35%), работы с группой (45%),
        соответствия типа занятия (10%) и принадлежности к кафедре/ПМК (10%).
        """
        course_ids = []
        if course_id:
            course_ids.append(course_id)
        if course_alias:
            rows = await self.conn.fetch("SELECT cid FROM public.courses WHERE LOWER(TRIM(alias)) = LOWER(TRIM($1));", course_alias)
            course_ids.extend([r["cid"] for r in rows])

        # Все преподаватели кафедры или всех кафедр
        cath_filter = "AND cp.cid = $1" if cathedra_id else ""
        cath_params = [cathedra_id] if cathedra_id else []

        teachers_sql = f"""
        SELECT DISTINCT
            p.mid,
            p.lastname,
            p.firstname,
            p.patronymic,
            TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
            ad.shortname AS degree_short,
            ad.agid AS degree_id,
            cp.id_pmk,
            cp.cid AS teacher_cathedra_id
        FROM public.people p
        JOIN public.cathedra_personnel cp ON p.mid = cp.mid
        LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
        WHERE cp.id_pmk IN (1, 2) {cath_filter}
        ORDER BY p.lastname;
        """
        all_teachers = await self.conn.fetch(teachers_sql, *cath_params)

        # Статистика по расписанию для дисциплины
        stats_map: Dict[int, Dict[str, Any]] = {}
        if course_ids:
            stats_sql = """
            SELECT 
                p.mid,
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
            LEFT JOIN public.nnz_schedule_variants nsv ON ns.sh_var_id = nsv.sh_var_id
            WHERE ns.cid = ANY($3::int[])
            GROUP BY p.mid;
            """
            stats_rows = await self.conn.fetch(stats_sql, group_id or -1, pair_type_id or -1, course_ids)
            for r in stats_rows:
                stats_map[r["mid"]] = dict(r)

        max_total = max((s["total_count"] for s in stats_map.values()), default=1) or 1
        max_group = max((s["same_group_count"] for s in stats_map.values()), default=1) or 1
        max_type = max((s["same_type_count"] for s in stats_map.values()), default=1) or 1

        recommendations = []
        for t in all_teachers:
            mid = t["mid"]
            if exclude_teacher_id and mid == exclude_teacher_id:
                continue

            stat = stats_map.get(mid, {})
            total_cnt = stat.get("total_count", 0)
            same_group_cnt = stat.get("same_group_count", 0)
            same_type_cnt = stat.get("same_type_count", 0)
            last_date = stat.get("last_lesson_date")
            last_date_str = last_date.strftime("%Y-%m-%d") if last_date else None

            is_same_cathedra = bool(cathedra_id and t["teacher_cathedra_id"] == cathedra_id)

            # Научно обоснованный математический скоринг с логарифмическим насыщением опыта:
            # 1. Опыт ведения конкретной дисциплины (насыщение к 25 занятиям): 35%
            total_part = (min(1.0, math.log(total_cnt + 1) / math.log(25.0)) * 35.0) if total_cnt > 0 else 0.0

            # 2. Опыт работы именно с этой группой/потоком (насыщение к 4 занятиям): 40%
            group_part = (min(1.0, same_group_cnt / 4.0) * 40.0) if same_group_cnt > 0 else 0.0

            # 3. Опыт конкретного вида занятия (лекция, практика, лаб - насыщение к 6 зан.): 15%
            type_part = (min(1.0, same_type_cnt / 6.0) * 15.0) if same_type_cnt > 0 else 0.0

            # 4. Профильная кафедра / ПМК: 10%
            cathedra_part = 10.0 if is_same_cathedra else 2.0

            raw_score = group_part + total_part + type_part + cathedra_part

            # Если преподаватель еще не вел дисциплину, но состоит на кафедре
            if total_cnt == 0:
                raw_score = 15.0 if is_same_cathedra else 5.0

            score = min(round(raw_score, 1), 100.0)

            # Определение бейджа
            if same_group_cnt > 0:
                badge_type = "experience"
                badge_text = f"✓ С группой ({same_group_cnt})"
            elif total_cnt > 0:
                badge_type = "rank-high"
                badge_text = f"📚 Дисциплина ({total_cnt})"
            else:
                badge_type = "new"
                badge_text = "🆕 Новый"

            recommendations.append({
                "mid": mid,
                "full_name": t["full_name"],
                "lastname": t["lastname"],
                "firstname": t["firstname"],
                "patronymic": t["patronymic"],
                "degree_short": t["degree_short"],
                "degree_id": t["degree_id"],
                "id_pmk": t["id_pmk"],
                "total_count": total_cnt,
                "same_group_count": same_group_cnt,
                "same_type_count": same_type_cnt,
                "confidence": score,
                "math_score": score,
                "badge_type": badge_type,
                "badge_text": badge_text,
                "last_lesson_date": last_date_str,
                "is_free": True,
            })

        recommendations.sort(key=lambda x: (x["math_score"] or 0, x["same_group_count"], x["total_count"]), reverse=True)

        return {
            "success": True,
            "recommendations": recommendations,
            "total_count": len(recommendations),
            "algorithm": "mathematical_saturated",
            "criteria": {
                "course_ids": course_ids,
                "group_id": group_id,
                "pair_type_id": pair_type_id,
                "cathedra_id": cathedra_id,
            },
        }

    async def get_ai_recommendations(
        self,
        group_id: Optional[int] = None,
        pair_type_id: Optional[int] = None,
        period_id: Optional[int] = None,
        day_of_week: Optional[int] = None,
        date_str: Optional[str] = None,
        cathedra_id: Optional[int] = None,
        study_year_id: Optional[int] = None,
        exclude_teacher_id: Optional[int] = None,
        course_id: Optional[int] = None,
        course_alias: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        ИИ-эвристический подбор преподавателей:
        Анализирует текущую занятость в слоте, историю дисциплины, опыт работы с группой,
        ученую степень и формирует текстовое объяснение рекомендации.
        """
        # Сначала получаем математические метрики
        math_result = await self.get_mathematical_recommendations(
            course_id=course_id,
            course_alias=course_alias,
            group_id=group_id,
            pair_type_id=pair_type_id,
            cathedra_id=cathedra_id,
            exclude_teacher_id=exclude_teacher_id,
        )
        candidates = math_result.get("recommendations", [])

        # Определение дня недели и недели расписания по дате, если передана
        if date_str:
            try:
                date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
                if not day_of_week:
                    day_of_week = date_obj.isoweekday()

                if not study_year_id:
                    sh_var_row = await self.conn.fetchrow("""
                        WITH schedule_variants AS (
                            SELECT 
                                sh_var_id,
                                CASE 
                                    WHEN sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                                        TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                                    ELSE NULL
                                END as week_start_date
                            FROM public.nnz_schedule_variants 
                            WHERE sh_var_name IS NOT NULL
                        )
                        SELECT sh_var_id FROM schedule_variants
                        WHERE week_start_date IS NOT NULL
                          AND $1::date BETWEEN week_start_date AND week_start_date + INTERVAL '6 days'
                        LIMIT 1;
                    """, date_obj)
                    if sh_var_row and sh_var_row["sh_var_id"]:
                        study_year_id = sh_var_row["sh_var_id"]
            except Exception:
                pass

        # Находим все периоды (lid), соответствующие номеру пары
        period_lids: List[int] = []
        if period_id:
            period_lids.append(period_id)
            pair_num = period_id if period_id in (1, 2, 3, 4) else None
            if pair_num:
                lid_rows = await self.conn.fetch(
                    "SELECT lid FROM public.periods WHERE short_time LIKE $1;",
                    f"{pair_num}-я пара%"
                )
                period_lids.extend([r["lid"] for r in lid_rows])

        # Проверяем занятость кандидатов в слот (day_of_week, period_lids)
        busy_ids: Set[int] = set()
        if day_of_week and period_lids:
            var_filter = "AND sh_var_id = $3" if study_year_id else ""
            var_params = [day_of_week, list(set(period_lids))]
            if study_year_id:
                var_params.append(study_year_id)

            busy_rows = await self.conn.fetch(f"""
                SELECT DISTINCT UNNEST(teacher_mid) AS teacher_id
                FROM public.nnz_schedule
                WHERE day_of_week = $1 AND period = ANY($2::int[]) {var_filter};
            """, *var_params)
            busy_ids = {r["teacher_id"] for r in busy_rows if r["teacher_id"] is not None}

        for c in candidates:
            mid = c["mid"]
            is_free = mid not in busy_ids
            c["is_free"] = is_free

            # Базовый математический скор (0..100)
            base_score = c.get("math_score", 50.0)

            # Бонус за академическую степень для лекций (доктора/кандидаты наук, профессора, доценты)
            deg_bonus = 0.0
            if (pair_type_id in (1, 2) or not pair_type_id) and (c.get("degree_id") and c["degree_id"] >= 3):
                deg_bonus = 8.0

            if is_free:
                ai_score = min(100.0, round(base_score * 0.85 + 15.0 + deg_bonus, 1))
            else:
                ai_score = max(5.0, round(base_score * 0.40 - 15.0, 1))

            c["ai_score"] = ai_score
            c["confidence"] = ai_score

            # Формирование подробного интеллектуального текстового обоснования (reason)
            reasons = []
            if is_free:
                reasons.append("✓ Свободен в данный период")
            else:
                reasons.append("⚠ Внимание: ведет другое занятие в этот слот")

            if c["same_group_count"] > 0:
                reasons.append(f"Провел {c['same_group_count']} зан. с этой группой")
            elif c["total_count"] > 0:
                reasons.append(f"Опыт по дисциплине: {c['total_count']} зан.")
            else:
                reasons.append("Профильный преподаватель кафедры")

            if c.get("degree_short"):
                reasons.append(f"степень: {c['degree_short']}")

            c["reason"] = ". ".join(reasons) + "."

        # Сортируем: сначала свободные преподаватели с наибольшим ai_score
        candidates.sort(key=lambda x: (1 if x["is_free"] else 0, x["ai_score"] or 0), reverse=True)

        return {
            "success": True,
            "recommendations": candidates,
            "total_count": len(candidates),
            "algorithm": "ai_contextual_heuristic",
            "criteria": {
                "group_id": group_id,
                "pair_type_id": pair_type_id,
                "period_id": period_id,
                "day_of_week": day_of_week,
                "date": date_str,
                "cathedra_id": cathedra_id,
            },
        }

    async def recommend_teachers_smart(
        self,
        course_id: Optional[int] = None,
        course_alias: Optional[str] = None,
        group_id: Optional[int] = None,
        pair_type_id: Optional[int] = None,
        date_str: Optional[str] = None,
        day_of_week: Optional[int] = None,
        pair_index: Optional[int] = None,
        period_id: Optional[int] = None,
        preferred_teacher_id: Optional[int] = None,
        cathedra_id: Optional[int] = None,
        sh_var_id: Optional[int] = None,
        limit: int = 15,
    ) -> Dict[str, Any]:
        """
        Умный подбор преподавателей по гибридному алгоритму:
        Взвешенный Жаккар (35% курс, 25% группа, 15% сходство Жаккара & Шимкевича-Симпсона,
        10% вид занятия, 10% баланс дневной нагрузки, 5% ПМК и ученая степень).
        Автоматически проверяет занятость целевого преподавателя в слоте и возвращает preferred_teacher_conflict.
        """
        from ..core.calendar_utils import get_academic_year_info

        # 1. Определение даты и дня недели
        date_obj: Optional[dt_date] = None
        if date_str:
            try:
                date_obj = datetime.strptime(date_str, "%Y-%m-%d").date()
                if not day_of_week:
                    day_of_week = date_obj.isoweekday()
            except Exception:
                pass

        # 2. Определение варианта расписания (sh_var_id) и учебного года (s_year_id)
        s_year_id = None
        if date_obj and not sh_var_id:
            sh_row = await self.conn.fetchrow("""
                WITH schedule_variants AS (
                    SELECT 
                        sh_var_id,
                        s_year_id,
                        CASE 
                            WHEN sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                                TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                            ELSE NULL
                        END as week_start_date
                    FROM public.nnz_schedule_variants 
                    WHERE sh_var_name IS NOT NULL
                )
                SELECT sh_var_id, s_year_id FROM schedule_variants
                WHERE week_start_date IS NOT NULL
                  AND $1::date BETWEEN week_start_date AND week_start_date + INTERVAL '6 days'
                LIMIT 1;
            """, date_obj)
            if sh_row:
                sh_var_id = sh_row["sh_var_id"]
                s_year_id = sh_row["s_year_id"]

        if not sh_var_id:
            latest_var = await self.conn.fetchrow(
                "SELECT sh_var_id, s_year_id FROM public.nnz_schedule_variants ORDER BY sh_var_id DESC LIMIT 1;"
            )
            if latest_var:
                sh_var_id = latest_var["sh_var_id"]
                s_year_id = latest_var["s_year_id"]
            else:
                sh_var_id = 1

        if not s_year_id:
            if date_obj:
                year_info = get_academic_year_info(date_obj)
                sy_row = await self.conn.fetchrow(
                    "SELECT school_year FROM public.studyyears WHERE name = $1 OR number = $2 OR school_year = $3 LIMIT 1;",
                    str(year_info["start_year"]), str(year_info["start_year"])[-2:], year_info["start_year"]
                )
                s_year_id = sy_row["school_year"] if sy_row else 35
            else:
                s_year_id = 35

        # 3. Определение lids периодов для проверки занятости
        period_lids: List[int] = []
        if period_id is not None:
            if period_id in (1, 2, 3, 4):
                pair_num = period_id
                l_row = await self.conn.fetchrow(
                    "SELECT lid FROM public.periods WHERE s_year_id = $1 ORDER BY starttime ASC, lid ASC OFFSET $2 LIMIT 1;",
                    s_year_id, pair_num - 1
                )
                if l_row:
                    period_lids.append(l_row["lid"])
                lid_rows = await self.conn.fetch(
                    "SELECT lid FROM public.periods WHERE short_time LIKE $1;",
                    f"{pair_num}-я пара%"
                )
                period_lids.extend([r["lid"] for r in lid_rows])
            else:
                period_lids.append(period_id)
        elif pair_index is not None and pair_index >= 0:
            pair_num = pair_index + 1
            l_row = await self.conn.fetchrow(
                "SELECT lid FROM public.periods WHERE s_year_id = $1 ORDER BY starttime ASC, lid ASC OFFSET $2 LIMIT 1;",
                s_year_id, pair_index
            )
            if l_row:
                period_lids.append(l_row["lid"])
            lid_rows = await self.conn.fetch(
                "SELECT lid FROM public.periods WHERE short_time LIKE $1;",
                f"{pair_num}-я пара%"
            )
            period_lids.extend([r["lid"] for r in lid_rows])
        period_lids = list(set(period_lids))

        # 4. Определение дисциплины
        course_ids: List[int] = []
        if course_id:
            course_ids.append(course_id)
        if course_alias:
            c_rows = await self.conn.fetch(
                "SELECT cid FROM public.courses WHERE LOWER(TRIM(alias)) = LOWER(TRIM($1)) OR LOWER(TRIM(title)) = LOWER(TRIM($1));",
                course_alias
            )
            for cr in c_rows:
                if cr["cid"] not in course_ids:
                    course_ids.append(cr["cid"])

        # 5. Определение кафедры группы, если не задана явно
        if not cathedra_id and group_id:
            g_row = await self.conn.fetchrow("SELECT idcathedra FROM public.groupname WHERE gid = $1;", group_id)
            if g_row and g_row["idcathedra"]:
                cathedra_id = g_row["idcathedra"]

        # 6. Справочник названий дисциплин
        courses_sql = "SELECT cid, alias, title FROM public.courses;"
        courses_rows = await self.conn.fetch(courses_sql)
        courses_titles: Dict[int, str] = {
            r["cid"]: (r["alias"] or r["title"] or f"Дисциплина #{r['cid']}")
            for r in courses_rows
        }

        # 7. Проверка конфликта предпочтительного преподавателя (preferred_teacher_id)
        preferred_conflict = None
        if preferred_teacher_id and day_of_week and period_lids:
            busy_check_sql = """
                SELECT 
                    ns.sheid,
                    c.alias AS course_alias,
                    c.title AS course_title,
                    gn.name AS group_name,
                    et.alias AS lesson_type,
                    pr.short_time AS period_name,
                    rm.short_name AS room_name
                FROM public.nnz_schedule ns
                LEFT JOIN public.courses c ON ns.cid = c.cid
                LEFT JOIN public.groupname gn ON ns.gid = gn.gid
                LEFT JOIN public.eventtools et ON ns.pair_type_id = et.typeid
                LEFT JOIN public.periods pr ON ns.period = pr.lid
                LEFT JOIN public.rooms rm ON rm.rid = ns.rid[1]
                WHERE ns.sh_var_id = $1
                  AND ns.day_of_week = $2
                  AND ns.period = ANY($3::int[])
                  AND $4 = ANY(ns.teacher_mid)
                LIMIT 1;
            """
            conf_row = await self.conn.fetchrow(busy_check_sql, sh_var_id, day_of_week, period_lids, preferred_teacher_id)
            if conf_row:
                c_name = conf_row["course_alias"] or conf_row["course_title"] or "Занятие"
                g_name = conf_row["group_name"] or "группа"
                r_name = conf_row["room_name"] or "-"
                l_type = conf_row["lesson_type"] or "пара"
                preferred_conflict = {
                    "is_busy": True,
                    "sheid": conf_row["sheid"],
                    "course_alias": conf_row["course_alias"],
                    "course_title": conf_row["course_title"],
                    "group_name": conf_row["group_name"],
                    "lesson_type": conf_row["lesson_type"],
                    "period_name": conf_row["period_name"],
                    "room_name": conf_row["room_name"],
                    "description": f"Занят: {c_name} ({l_type}) у гр. {g_name} в ауд. {r_name}",
                }
            else:
                preferred_conflict = {"is_busy": False}

        # 8. Занятость всех преподавателей в слоте
        busy_teachers_map: Dict[int, Dict[str, Any]] = {}
        if day_of_week and period_lids:
            slot_busy_sql = """
                SELECT 
                    p.mid AS teacher_id,
                    ns.sheid,
                    c.alias AS course_alias,
                    c.title AS course_title,
                    gn.name AS group_name,
                    et.alias AS lesson_type,
                    pr.short_time AS period_name,
                    rm.short_name AS room_name
                FROM public.nnz_schedule ns
                JOIN public.people p ON p.mid = ANY(ns.teacher_mid)
                LEFT JOIN public.courses c ON ns.cid = c.cid
                LEFT JOIN public.groupname gn ON ns.gid = gn.gid
                LEFT JOIN public.eventtools et ON ns.pair_type_id = et.typeid
                LEFT JOIN public.periods pr ON ns.period = pr.lid
                LEFT JOIN public.rooms rm ON rm.rid = ns.rid[1]
                WHERE ns.sh_var_id = $1
                  AND ns.day_of_week = $2
                  AND ns.period = ANY($3::int[]);
            """
            slot_busy_rows = await self.conn.fetch(slot_busy_sql, sh_var_id, day_of_week, period_lids)
            for r in slot_busy_rows:
                t_id = r["teacher_id"]
                if t_id not in busy_teachers_map:
                    c_name = r["course_alias"] or r["course_title"] or "Занятие"
                    g_name = r["group_name"] or "группа"
                    r_name = r["room_name"] or "-"
                    l_type = r["lesson_type"] or "пара"
                    busy_teachers_map[t_id] = {
                        "is_busy": True,
                        "sheid": r["sheid"],
                        "course_alias": r["course_alias"],
                        "course_title": r["course_title"],
                        "group_name": r["group_name"],
                        "lesson_type": r["lesson_type"],
                        "period_name": r["period_name"],
                        "room_name": r["room_name"],
                        "description": f"Занят: {c_name} ({l_type}) у гр. {g_name} в ауд. {r_name}",
                    }

        # 9. Дневная нагрузка преподавателей в этот день
        day_load_map: Dict[int, int] = {}
        if day_of_week:
            load_sql = """
                SELECT UNNEST(teacher_mid) AS teacher_id, COUNT(*)::int AS cnt
                FROM public.nnz_schedule
                WHERE sh_var_id = $1 AND day_of_week = $2
                GROUP BY teacher_id;
            """
            load_rows = await self.conn.fetch(load_sql, sh_var_id, day_of_week)
            for lr in load_rows:
                if lr["teacher_id"] is not None:
                    day_load_map[lr["teacher_id"]] = lr["cnt"]

        # 10. Карта всех дисциплин преподавателей
        teacher_courses = await self.get_teacher_courses_map()

        # 11. История преподавания целевой дисциплины
        course_stats_map: Dict[int, Dict[str, int]] = {}
        if course_ids:
            c_stats_sql = """
                SELECT 
                    p.mid,
                    COUNT(*)::int AS total_course_lessons,
                    COUNT(CASE WHEN ns.gid = $1 THEN 1 END)::int AS same_group_lessons,
                    COUNT(CASE WHEN ns.pair_type_id = $2 THEN 1 END)::int AS same_type_lessons
                FROM public.nnz_schedule ns
                JOIN public.people p ON p.mid = ANY(ns.teacher_mid)
                WHERE ns.cid = ANY($3::int[])
                GROUP BY p.mid;
            """
            c_stats_rows = await self.conn.fetch(c_stats_sql, group_id or -1, pair_type_id or -1, course_ids)
            for csr in c_stats_rows:
                course_stats_map[csr["mid"]] = {
                    "total_course_lessons": csr["total_course_lessons"],
                    "same_group_lessons": csr["same_group_lessons"],
                    "same_type_lessons": csr["same_type_lessons"],
                }

        # 12. Список всех преподавателей кафедры
        teachers_sql = """
            SELECT DISTINCT
                p.mid,
                p.lastname,
                p.firstname,
                p.patronymic,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                ad.shortname AS degree_short,
                ad.agid AS degree_id,
                cp.id_pmk,
                cp.cid AS cathedra_id,
                pm.name_pmk AS pmk_name
            FROM public.people p
            JOIN public.cathedra_personnel cp ON p.mid = cp.mid
            LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
            LEFT JOIN public.pmk pm ON cp.id_pmk = pm.id_pmk
            WHERE cp.id_pmk IN (1, 2)
            ORDER BY p.lastname;
        """
        all_teachers = await self.conn.fetch(teachers_sql)

        # 13. Расчет гибридного скора для каждого преподавателя
        target_courses_set = set(course_ids)
        preferred_courses = teacher_courses.get(preferred_teacher_id, set()) if preferred_teacher_id else set()

        recommendations = []
        for t in all_teachers:
            mid = t["mid"]
            cand_courses = teacher_courses.get(mid, set())

            # 1. Опыт ведения дисциплины (35%)
            stat = course_stats_map.get(mid, {})
            total_course_lessons = stat.get("total_course_lessons", 0)
            same_group_lessons = stat.get("same_group_lessons", 0)
            same_type_lessons = stat.get("same_type_lessons", 0)

            s_course = (min(1.0, math.log(total_course_lessons + 1) / math.log(30.0)) * 35.0) if total_course_lessons > 0 else 0.0

            # 2. Опыт работы с группой (25%)
            s_group = (min(1.0, math.log(same_group_lessons + 1) / math.log(10.0)) * 25.0) if same_group_lessons > 0 else 0.0

            # 3. Сходство Жаккара & Шимкевича-Симпсона (15%)
            if preferred_teacher_id and preferred_courses and mid != preferred_teacher_id:
                intersection = preferred_courses.intersection(cand_courses)
                union = preferred_courses.union(cand_courses)
                jaccard = round(len(intersection) / len(union), 3) if union else 0.0
                min_len = min(len(preferred_courses), len(cand_courses))
                overlap = round(len(intersection) / min_len, 3) if min_len > 0 else 0.0
                shared_titles = [courses_titles[cid] for cid in intersection if cid in courses_titles]
            else:
                intersection = target_courses_set.intersection(cand_courses)
                if intersection:
                    jaccard = round(len(intersection) / max(1, len(cand_courses)), 3)
                    overlap = 1.0
                    shared_titles = [courses_titles[cid] for cid in intersection if cid in courses_titles]
                else:
                    jaccard = 0.0
                    overlap = 0.0
                    shared_titles = []

            s_sim = round((0.6 * jaccard + 0.4 * overlap) * 15.0, 2)

            # 4. Опыт типа занятия (10%)
            s_type = (min(1.0, math.log(same_type_lessons + 1) / math.log(15.0)) * 10.0) if same_type_lessons > 0 else 0.0

            # 5. Дневной баланс нагрузки (10%)
            day_pairs = day_load_map.get(mid, 0)
            if day_pairs in (1, 2):
                s_load = 10.0
                load_desc = f"{day_pairs} пар(ы)"
            elif day_pairs == 0:
                s_load = 6.0
                load_desc = "0 пар (нужен приезд)"
            else:
                s_load = 2.0
                load_desc = f"{day_pairs} пар (высокая загрузка)"

            # 6. ПМК и ученая степень (5%)
            s_pmk_deg = 2.5
            deg_id = t["degree_id"] or 0
            is_lecture_or_exam = pair_type_id in (1, 2)
            if is_lecture_or_exam and deg_id >= 3:
                s_pmk_deg += 2.5
            elif deg_id >= 3:
                s_pmk_deg += 1.5

            raw_score = s_course + s_group + s_sim + s_type + s_load + s_pmk_deg
            if total_course_lessons == 0 and (cathedra_id and t["cathedra_id"] == cathedra_id):
                raw_score = max(raw_score, 18.0)

            # Статус доступности в слоте
            is_free = mid not in busy_teachers_map
            busy_info = busy_teachers_map.get(mid)

            if is_free:
                match_score = round(min(100.0, raw_score), 1)
            else:
                match_score = round(max(5.0, raw_score * 0.35), 1)

            # Причины рекомендации
            reasons = []
            if is_free:
                reasons.append("✓ Свободен в данный период")
            else:
                reasons.append(f"⚠ Внимание: {busy_info.get('description', 'занят') if busy_info else 'занят'}")

            if same_group_lessons > 0:
                reasons.append(f"Провел {same_group_lessons} зан. с этой группой")
            if total_course_lessons > 0:
                reasons.append(f"Опыт курса: {total_course_lessons} зан.")
            if jaccard > 0:
                reasons.append(f"Сходство Жаккара: J={jaccard:.2f}")
            if t["degree_short"]:
                reasons.append(f"степень: {t['degree_short']}")
            reasons.append(f"нагрузка дня: {load_desc}")

            reason_text = ". ".join(reasons) + "."

            # Бейдж кандидата
            if not is_free:
                badge_type = "conflict"
                badge_text = "Занят в слоте"
            elif same_group_lessons >= 2:
                badge_type = "experience"
                badge_text = f"Группа ({same_group_lessons})"
            elif match_score >= 70:
                badge_type = "rank-high"
                badge_text = f"Топ-выбор ({int(match_score)}%)"
            elif total_course_lessons > 0:
                badge_type = "rank-high"
                badge_text = f"Дисциплина ({total_course_lessons})"
            else:
                badge_type = "success"
                badge_text = "Свободен"

            recommendations.append({
                "mid": mid,
                "full_name": t["full_name"],
                "lastname": t["lastname"],
                "firstname": t["firstname"],
                "patronymic": t["patronymic"],
                "degree_short": t["degree_short"],
                "degree_id": t["degree_id"],
                "id_pmk": t["id_pmk"],
                "pmk_name": t["pmk_name"],
                "cathedra_id": t["cathedra_id"],
                "is_free": is_free,
                "match_score": match_score,
                "jaccard_score": jaccard,
                "overlap_score": overlap,
                "shared_courses": shared_titles,
                "total_course_lessons": total_course_lessons,
                "same_group_lessons": same_group_lessons,
                "same_type_lessons": same_type_lessons,
                "day_load_pairs": day_pairs,
                "badge_type": badge_type,
                "badge_text": badge_text,
                "reason": reason_text,
                "busy_info": busy_info,
            })

        recommendations.sort(key=lambda x: (1 if x["is_free"] else 0, x["match_score"], x["total_course_lessons"]), reverse=True)
        recommendations = recommendations[:limit]

        return {
            "success": True,
            "algorithm": "Hybrid Weighted Jaccard & CSP Scoring",
            "preferred_teacher_conflict": preferred_conflict,
            "recommendations": recommendations,
            "total_count": len(recommendations),
            "criteria": {
                "course_id": course_id,
                "course_alias": course_alias,
                "group_id": group_id,
                "pair_type_id": pair_type_id,
                "date": date_str,
                "day_of_week": day_of_week,
                "period_id": period_id,
                "pair_index": pair_index,
                "preferred_teacher_id": preferred_teacher_id,
                "cathedra_id": cathedra_id,
                "sh_var_id": sh_var_id,
            },
        }

    async def suggest_free_slots_for_pair(
        self,
        teacher_id: int,
        group_id: int,
        date_str: Optional[str] = None,
        sh_var_id: Optional[int] = None,
        s_year_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Поиск свободных окон для пары преподаватель + группа на неделе (Пн-Сб, 1..4 пары)
        с расчетом оценки удобства (convenience_score) по эвристикам CSP (компактизация, окна, дневная нагрузка).
        """
        from ..core.calendar_utils import format_period_time, extract_pair_number, get_academic_year_info

        # 1. Определение опорного понедельника недели
        ref_date: Optional[dt_date] = None
        if date_str:
            try:
                ref_date = datetime.strptime(date_str, "%Y-%m-%d").date()
                monday = ref_date - timedelta(days=ref_date.isoweekday() - 1)
            except Exception:
                monday = dt_date.today() - timedelta(days=dt_date.today().isoweekday() - 1)
        else:
            monday = dt_date.today() - timedelta(days=dt_date.today().isoweekday() - 1)

        # 2. Определение sh_var_id и s_year_id
        if not sh_var_id:
            sh_row = await self.conn.fetchrow("""
                WITH schedule_variants AS (
                    SELECT 
                        sh_var_id,
                        s_year_id,
                        sh_var_name,
                        CASE 
                            WHEN sh_var_name ~ '^Неделя\\s+\\d+\\s+\\(' THEN
                                TO_DATE(TRIM(SPLIT_PART(SPLIT_PART(sh_var_name, '(', 2), '-', 1)), 'DD.MM.YYYY')
                            ELSE NULL
                        END as week_start_date
                    FROM public.nnz_schedule_variants 
                    WHERE sh_var_name IS NOT NULL
                )
                SELECT sh_var_id, s_year_id, week_start_date FROM schedule_variants
                WHERE week_start_date IS NOT NULL
                  AND $1::date BETWEEN week_start_date AND week_start_date + INTERVAL '6 days'
                LIMIT 1;
            """, monday)
            if sh_row:
                sh_var_id = sh_row["sh_var_id"]
                s_year_id = sh_row["s_year_id"]
                if sh_row["week_start_date"] and not date_str:
                    monday = sh_row["week_start_date"]

        if not sh_var_id:
            latest_var = await self.conn.fetchrow(
                "SELECT sh_var_id, s_year_id, sh_var_name FROM public.nnz_schedule_variants ORDER BY sh_var_id DESC LIMIT 1;"
            )
            if latest_var:
                sh_var_id = latest_var["sh_var_id"]
                s_year_id = latest_var["s_year_id"]
                m = re.search(r'(\d{2}\.\d{2}\.\d{4})', latest_var.get("sh_var_name") or "")
                if m and not date_str:
                    try:
                        monday = datetime.strptime(m.group(1), "%d.%m.%Y").date()
                    except Exception:
                        pass
            else:
                sh_var_id = 1

        if not s_year_id:
            year_info = get_academic_year_info(monday)
            sy_row = await self.conn.fetchrow(
                "SELECT school_year FROM public.studyyears WHERE name = $1 OR number = $2 OR school_year = $3 LIMIT 1;",
                str(year_info["start_year"]), str(year_info["start_year"])[-2:], year_info["start_year"]
            )
            s_year_id = sy_row["school_year"] if sy_row else 35

        saturday = monday + timedelta(days=5)
        week_range = f"{monday.strftime('%d.%m.%Y')} - {saturday.strftime('%d.%m.%Y')}"

        # 3. Периоды (пары 1..4) для этого учебного года
        periods_sql = """
            SELECT lid, name, short_time, starttime, stoptime 
            FROM public.periods 
            WHERE s_year_id = $1 
            ORDER BY starttime ASC, lid ASC 
            LIMIT 4;
        """
        period_rows = await self.conn.fetch(periods_sql, s_year_id)
        if not period_rows or len(period_rows) < 4:
            fallback_sql = "SELECT lid, name, short_time, starttime, stoptime FROM public.periods ORDER BY starttime ASC, lid ASC LIMIT 4;"
            period_rows = await self.conn.fetch(fallback_sql)

        periods_list = []
        for idx, pr in enumerate(period_rows):
            p_num = extract_pair_number(pr["short_time"]) or (idx + 1)
            time_range = format_period_time(pr["starttime"], pr["stoptime"])
            periods_list.append({
                "lid": pr["lid"],
                "pair_number": p_num,
                "time_range": time_range,
                "short_name": pr["short_time"],
            })

        lid_to_pnum = {p["lid"]: p["pair_number"] for p in periods_list}

        # 4. Выборка всех занятий преподавателя и группы за эту неделю
        sched_sql = """
            SELECT 
                sheid,
                day_of_week,
                period,
                teacher_mid,
                gid
            FROM public.nnz_schedule
            WHERE sh_var_id = $1
              AND day_of_week BETWEEN 1 AND 6
              AND ($2 = ANY(teacher_mid) OR gid = $3);
        """
        sched_rows = await self.conn.fetch(sched_sql, sh_var_id, teacher_id, group_id)

        teacher_busy_slots: Set[Tuple[int, int]] = set()
        group_busy_slots: Set[Tuple[int, int]] = set()
        teacher_day_pairs: Dict[int, Set[int]] = {}
        group_day_pairs: Dict[int, Set[int]] = {}

        for r in sched_rows:
            dow = r["day_of_week"]
            p_lid = r["period"]
            p_num = lid_to_pnum.get(p_lid)

            if r["teacher_mid"] and teacher_id in r["teacher_mid"]:
                teacher_busy_slots.add((dow, p_lid))
                if p_num:
                    teacher_day_pairs.setdefault(dow, set()).add(p_num)

            if r["gid"] == group_id:
                group_busy_slots.add((dow, p_lid))
                if p_num:
                    group_day_pairs.setdefault(dow, set()).add(p_num)

        # 5. Перебор всех слотов: 6 дней x 4 пары
        day_names = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]
        day_shorts = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб"]

        available_slots = []
        for dow in range(1, 7):
            day_date = monday + timedelta(days=dow - 1)
            day_name = day_names[dow - 1]
            day_short = day_shorts[dow - 1]

            for p_info in periods_list:
                lid = p_info["lid"]
                p_num = p_info["pair_number"]

                # Проверка: свободны ли преподаватель и группа
                if (dow, lid) in teacher_busy_slots or (dow, lid) in group_busy_slots:
                    continue

                # Оба свободны: считаем скоринг удобства
                score = 50
                reasons = []

                # Номер пары
                if p_num in (2, 3):
                    score += 15
                    reasons.append("Удобное дневное время (2-3 пара)")
                elif p_num == 1:
                    score += 10
                    reasons.append("Утренняя пара (1-я)")
                else:
                    score += 5
                    reasons.append("Вечерняя пара (4-я)")

                # Расписание группы (CSP без окон)
                g_pairs = group_day_pairs.get(dow, set())
                if g_pairs:
                    if (p_num - 1 in g_pairs) and (p_num + 1 in g_pairs):
                        score += 25
                        reasons.append("Идеально: закрывает «окно» между парами группы")
                    elif (p_num - 1 in g_pairs) or (p_num + 1 in g_pairs):
                        score += 20
                        reasons.append("Компактно: идет подряд с занятиями группы")
                    else:
                        score -= 10
                        reasons.append("Создает «окно» в расписании группы")

                    if len(g_pairs) >= 3:
                        score -= 15
                        reasons.append("У группы уже 3+ пары в этот день")
                else:
                    score -= 5
                    reasons.append("Единственная пара у группы в этот день")

                # Расписание преподавателя (компактизация)
                t_pairs = teacher_day_pairs.get(dow, set())
                if t_pairs:
                    if (p_num - 1 in t_pairs) and (p_num + 1 in t_pairs):
                        score += 20
                        reasons.append("Закрывает «окно» преподавателя")
                    elif (p_num - 1 in t_pairs) or (p_num + 1 in t_pairs):
                        score += 15
                        reasons.append("Идет подряд с другой парой преподавателя")
                    if len(t_pairs) >= 3:
                        score -= 15
                        reasons.append("У преподавателя высокая нагрузка (3+ пары)")
                else:
                    score -= 5
                    reasons.append("У преподавателя нет других пар в этот день")

                final_score = max(10, min(98, score))

                if final_score >= 80:
                    badge = "Идеальный слот"
                elif final_score >= 65:
                    badge = "Удобный слот"
                else:
                    badge = "Допустимый слот"

                available_slots.append({
                    "day_of_week": dow,
                    "day_name": day_name,
                    "day_short": day_short,
                    "date_str": day_date.strftime("%Y-%m-%d"),
                    "period_lid": lid,
                    "pair_number": p_num,
                    "time_str": p_info.get("time_range") or p_info.get("short_name"),
                    "convenience_score": final_score,
                    "reasons": reasons,
                    "badge": badge,
                })

        # Сортировка: наивысший convenience_score, затем день недели, затем номер пары
        available_slots.sort(key=lambda s: (-s["convenience_score"], s["day_of_week"], s["pair_number"]))

        return {
            "success": True,
            "slots": available_slots,
            "total_count": len(available_slots),
            "teacher_id": teacher_id,
            "group_id": group_id,
            "week_range": week_range,
        }
