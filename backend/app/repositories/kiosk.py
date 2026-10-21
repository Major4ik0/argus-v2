# -*- coding: utf-8 -*-
import math
from datetime import datetime, timedelta, date as dt_date
from typing import List, Dict, Any, Optional, Tuple
import asyncpg

from ..core.calendar_utils import format_period_time, extract_pair_number, get_academic_year_info


def resolve_faculty(fac_str: Optional[str]) -> Tuple[str, str]:
    """Сопоставление названия факультета и канонического цвета по organaizer.ui."""
    if not fac_str:
        return "АСУ, РЭС", "#FFAAFF"
    s = fac_str.upper()
    if "АСУ" in s or "РЭС" in s:
        return "АСУ, РЭС", "#FFAAFF"
    if "ПИПК" in s or "ППК" in s:
        return "ПиПК", "#FFFF00"
    if "СФ" in s:
        return "СФ", "#AAFF00"
    if "ВВОТП" in s or "ВВ" in s:
        return "ВВОТП", "#95E7FF"
    return fac_str, "#FFAAFF"


class KioskRepository:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    async def get_settings(self) -> Dict[str, Any]:
        """Получить текущие настройки терминала и камеры."""
        sql = "SELECT key, value FROM public.kiosk_settings;"
        rows = await self.conn.fetch(sql)
        settings: Dict[str, Any] = {
            "camera_source": "0",
            "recognition_threshold": 0.48,
            "carousel_interval": 12,
            "idle_timeout": 20,
            "is_active": True,
        }
        for r in rows:
            k = r["key"]
            v = r["value"]
            if k == "camera_source":
                settings[k] = v
            elif k == "recognition_threshold":
                try:
                    settings[k] = float(v)
                except ValueError:
                    pass
            elif k in ("carousel_interval", "idle_timeout"):
                try:
                    settings[k] = int(v)
                except ValueError:
                    pass
            elif k == "is_active":
                settings[k] = v.lower() in ("true", "1", "yes")
        return settings

    async def update_settings(self, new_settings: Dict[str, Any]) -> Dict[str, Any]:
        """Обновить настройки терминала."""
        for k, v in new_settings.items():
            if v is not None:
                val_str = str(v).lower() if isinstance(v, bool) else str(v)
                sql = """
                    INSERT INTO public.kiosk_settings (key, value)
                    VALUES ($1, $2)
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
                """
                await self.conn.execute(sql, k, val_str)
        return await self.get_settings()

    async def save_biometrics(self, teacher_id: int, photo_path: str, embedding_bytes: bytes) -> bool:
        """Сохранить или обновить биометрический профиль преподавателя."""
        sql = """
            INSERT INTO public.teacher_biometrics (teacher_id, photo_path, embedding, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (teacher_id) DO UPDATE 
            SET photo_path = EXCLUDED.photo_path,
                embedding = EXCLUDED.embedding,
                updated_at = CURRENT_TIMESTAMP;
        """
        await self.conn.execute(sql, teacher_id, photo_path, embedding_bytes)
        return True

    async def delete_biometrics(self, teacher_id: int) -> bool:
        """Удалить биометрический профиль преподавателя."""
        sql = "DELETE FROM public.teacher_biometrics WHERE teacher_id = $1;"
        result = await self.conn.execute(sql, teacher_id)
        return "DELETE 1" in result

    async def get_all_embeddings(self) -> List[Dict[str, Any]]:
        """Получить все сохраненные эмбеддинги для сопоставления в памяти."""
        sql = """
            SELECT 
                tb.teacher_id,
                tb.embedding,
                tb.photo_path,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name
            FROM public.teacher_biometrics tb
            JOIN public.people p ON p.mid = tb.teacher_id;
        """
        rows = await self.conn.fetch(sql)
        return [dict(r) for r in rows]

    async def get_teacher_biometrics_status(self) -> List[Dict[str, Any]]:
        """Список всех преподавателей со статусом биометрии и количеством визитов."""
        sql = """
            WITH visits AS (
                SELECT 
                    teacher_id,
                    COUNT(*) FILTER (WHERE recognized_at >= CURRENT_DATE)::int AS visits_today,
                    COUNT(*) FILTER (WHERE recognized_at >= CURRENT_DATE - INTERVAL '7 days')::int AS visits_week,
                    COUNT(*)::int AS visits_total,
                    MAX(recognized_at) AS last_visit
                FROM public.kiosk_recognition_logs
                GROUP BY teacher_id
            )
            SELECT DISTINCT
                p.mid AS teacher_id,
                p.lastname,
                p.firstname,
                p.patronymic,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                ad.shortname AS degree_short,
                cp.cid AS cathedra_id,
                COALESCE(c.cathedra, pm.name_pmk, 'Кафедра') AS cathedra_name,
                (tb.embedding IS NOT NULL) AS has_photo,
                tb.photo_path,
                tb.updated_at,
                COALESCE(v.visits_today, 0)::int AS visits_today,
                COALESCE(v.visits_week, 0)::int AS visits_week,
                COALESCE(v.visits_total, 0)::int AS visits_total,
                v.last_visit
            FROM public.people p
            JOIN public.cathedra_personnel cp ON p.mid = cp.mid
            LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
            LEFT JOIN public.cathedras c ON cp.cid = c.idcathedra
            LEFT JOIN public.pmk pm ON cp.id_pmk = pm.id_pmk
            LEFT JOIN public.teacher_biometrics tb ON p.mid = tb.teacher_id
            LEFT JOIN visits v ON v.teacher_id = p.mid
            WHERE cp.id_pmk IN (1, 2)
            ORDER BY has_photo DESC, p.lastname, p.firstname;
        """
        rows = await self.conn.fetch(sql)
        items = []
        for r in rows:
            p_url = f"/api/v1/kiosk/photos/{r['teacher_id']}" if r["has_photo"] else None
            items.append({
                "teacher_id": r["teacher_id"],
                "full_name": r["full_name"],
                "lastname": r["lastname"],
                "firstname": r["firstname"],
                "patronymic": r["patronymic"],
                "cathedra_id": r["cathedra_id"],
                "cathedra_name": r["cathedra_name"],
                "degree_short": r["degree_short"],
                "has_photo": bool(r["has_photo"]),
                "photo_url": p_url,
                "updated_at": r["updated_at"].strftime("%Y-%m-%d %H:%M:%S") if r["updated_at"] else None,
                "visits_today": r["visits_today"],
                "visits_week": r["visits_week"],
                "visits_total": r["visits_total"],
                "last_visit": r["last_visit"].strftime("%d.%m.%Y %H:%M") if r["last_visit"] else None,
            })
        return items

    async def get_biometric_photo_path(self, teacher_id: int) -> Optional[str]:
        """Получить путь к файлу фотографии преподавателя."""
        sql = "SELECT photo_path FROM public.teacher_biometrics WHERE teacher_id = $1;"
        return await self.conn.fetchval(sql, teacher_id)

    async def log_recognition(self, teacher_id: int, confidence: float) -> int:
        """Записать событие распознавания преподавателя в лог."""
        sql = """
            INSERT INTO public.kiosk_recognition_logs (teacher_id, confidence, recognized_at)
            VALUES ($1, $2, CURRENT_TIMESTAMP)
            RETURNING id;
        """
        return await self.conn.fetchval(sql, teacher_id, confidence)

    async def get_stats(self) -> Dict[str, Any]:
        """Сводная аналитика работы табло и статистика подходов преподавателей."""
        # 1. Счетчики
        sql_counts = """
            SELECT 
                COUNT(*) FILTER (WHERE recognized_at >= CURRENT_DATE)::int AS today_count,
                COUNT(*) FILTER (WHERE recognized_at >= CURRENT_DATE - INTERVAL '7 days')::int AS week_count,
                COUNT(*)::int AS total_count,
                COUNT(DISTINCT teacher_id) FILTER (WHERE recognized_at >= CURRENT_DATE)::int AS active_today
            FROM public.kiosk_recognition_logs;
        """
        c_row = await self.conn.fetchrow(sql_counts)
        today_count = c_row["today_count"] if c_row else 0
        week_count = c_row["week_count"] if c_row else 0
        total_count = c_row["total_count"] if c_row else 0
        active_today = c_row["active_today"] if c_row else 0

        # 2. Топ преподавателей по подходам
        sql_top = """
            SELECT 
                krl.teacher_id,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                COALESCE(c.cathedra, pm.name_pmk, 'Кафедра') AS cathedra_name,
                COUNT(*)::int AS visit_count,
                MAX(krl.recognized_at) AS last_visit,
                (tb.embedding IS NOT NULL) AS has_photo
            FROM public.kiosk_recognition_logs krl
            JOIN public.people p ON p.mid = krl.teacher_id
            LEFT JOIN public.cathedra_personnel cp ON p.mid = cp.mid
            LEFT JOIN public.cathedras c ON cp.cid = c.idcathedra
            LEFT JOIN public.pmk pm ON cp.id_pmk = pm.id_pmk
            LEFT JOIN public.teacher_biometrics tb ON p.mid = tb.teacher_id
            GROUP BY krl.teacher_id, p.lastname, p.firstname, p.patronymic, c.cathedra, pm.name_pmk, tb.embedding
            ORDER BY visit_count DESC
            LIMIT 10;
        """
        top_rows = await self.conn.fetch(sql_top)
        top_teachers = [
            {
                "teacher_id": r["teacher_id"],
                "full_name": r["full_name"],
                "cathedra_name": r["cathedra_name"],
                "visit_count": r["visit_count"],
                "photo_url": f"/api/v1/kiosk/photos/{r['teacher_id']}" if r["has_photo"] else None,
                "last_visit": r["last_visit"].strftime("%d.%m.%Y %H:%M") if r["last_visit"] else None,
            }
            for r in top_rows
        ]

        # 3. Последние 50 записей в логе
        sql_recent = """
            SELECT 
                krl.id,
                krl.teacher_id,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS teacher_name,
                krl.confidence,
                krl.recognized_at,
                (tb.embedding IS NOT NULL) AS has_photo
            FROM public.kiosk_recognition_logs krl
            JOIN public.people p ON p.mid = krl.teacher_id
            LEFT JOIN public.teacher_biometrics tb ON p.mid = tb.teacher_id
            ORDER BY krl.recognized_at DESC
            LIMIT 50;
        """
        recent_rows = await self.conn.fetch(sql_recent)
        recent_logs = [
            {
                "id": r["id"],
                "teacher_id": r["teacher_id"],
                "teacher_name": r["teacher_name"],
                "photo_url": f"/api/v1/kiosk/photos/{r['teacher_id']}" if r["has_photo"] else None,
                "confidence": round(float(r["confidence"]), 3),
                "recognized_at": r["recognized_at"].strftime("%d.%m.%Y %H:%M:%S") if r["recognized_at"] else "",
            }
            for r in recent_rows
        ]

        # 4. Процент охвата кафедры биометрией
        cov_row = await self.conn.fetchrow("""
            SELECT 
                COUNT(DISTINCT p.mid)::int AS total_teachers,
                COUNT(DISTINCT tb.teacher_id)::int AS teachers_with_photo
            FROM public.people p
            JOIN public.cathedra_personnel cp ON p.mid = cp.mid
            LEFT JOIN public.teacher_biometrics tb ON p.mid = tb.teacher_id AND tb.embedding IS NOT NULL
            WHERE cp.id_pmk IN (1, 2);
        """)
        total_teachers = cov_row["total_teachers"] if cov_row and cov_row["total_teachers"] else 1
        teachers_with_photo = cov_row["teachers_with_photo"] if cov_row else 0
        coverage_pct = round((teachers_with_photo / max(1, total_teachers)) * 100, 1)

        most_active_teacher = top_teachers[0]["full_name"] if top_teachers else None

        return {
            "total_today": today_count,
            "total_week": week_count,
            "total_all_time": total_count,
            "active_teachers_today": active_today,
            "biometrics_coverage_pct": coverage_pct,
            "most_active_teacher": most_active_teacher,
            "top_teachers": top_teachers,
            "recent_logs": recent_logs,
        }

    async def _get_current_week_variant(self) -> Dict[str, Any]:
        """Определяет текущий вариант расписания (sh_var_id) и понедельник недели."""
        today = dt_date.today()
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
            SELECT sh_var_id, s_year_id, sh_var_name, week_start_date 
            FROM schedule_variants
            WHERE week_start_date IS NOT NULL
              AND $1::date BETWEEN week_start_date AND week_start_date + INTERVAL '6 days'
            LIMIT 1;
        """, today)

        if sh_row:
            monday = sh_row["week_start_date"] or (today - timedelta(days=today.isoweekday() - 1))
            return {
                "sh_var_id": sh_row["sh_var_id"],
                "s_year_id": sh_row["s_year_id"],
                "sh_var_name": sh_row["sh_var_name"],
                "monday": monday,
            }

        # Fallback на последний вариант
        latest_var = await self.conn.fetchrow(
            "SELECT sh_var_id, s_year_id, sh_var_name FROM public.nnz_schedule_variants ORDER BY sh_var_id DESC LIMIT 1;"
        )
        monday = today - timedelta(days=today.isoweekday() - 1)
        sh_var_id = latest_var["sh_var_id"] if latest_var else 1
        s_year_id = latest_var["s_year_id"] if latest_var else 35
        sh_var_name = latest_var["sh_var_name"] if latest_var else "Текущая неделя"
        return {
            "sh_var_id": sh_var_id,
            "s_year_id": s_year_id,
            "sh_var_name": sh_var_name,
            "monday": monday,
        }

    async def get_teacher_weekly_schedule(self, teacher_id: int) -> Dict[str, Any]:
        """Получить недельное расписание конкретного преподавателя (Пн-Сб, 1-4 пары)."""
        week_info = await self._get_current_week_variant()
        sh_var_id = week_info["sh_var_id"]
        s_year_id = week_info["s_year_id"]
        monday = week_info["monday"]

        # Получаем данные преподавателя
        t_row = await self.conn.fetchrow("""
            SELECT 
                p.mid AS teacher_id,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                ad.shortname AS degree_short,
                COALESCE(c.cathedra, pm.name_pmk, 'Кафедра') AS cathedra_name,
                (tb.embedding IS NOT NULL) AS has_photo
            FROM public.people p
            LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
            LEFT JOIN public.cathedra_personnel cp ON p.mid = cp.mid
            LEFT JOIN public.cathedras c ON cp.cid = c.idcathedra
            LEFT JOIN public.pmk pm ON cp.id_pmk = pm.id_pmk
            LEFT JOIN public.teacher_biometrics tb ON p.mid = tb.teacher_id
            WHERE p.mid = $1
            LIMIT 1;
        """, teacher_id)

        if not t_row:
            return {
                "success": False,
                "teacher_id": teacher_id,
                "teacher_name": f"Преподаватель #{teacher_id}",
                "week_name": week_info["sh_var_name"],
                "lessons": [],
                "total_lessons": 0,
            }

        # Получаем периоды года
        periods_sql = """
            SELECT lid, short_time, starttime, stoptime 
            FROM public.periods 
            WHERE s_year_id = $1 
            ORDER BY starttime ASC, lid ASC 
            LIMIT 4;
        """
        p_rows = await self.conn.fetch(periods_sql, s_year_id)
        if not p_rows:
            p_rows = await self.conn.fetch(
                "SELECT lid, short_time, starttime, stoptime FROM public.periods ORDER BY starttime ASC, lid ASC LIMIT 4;"
            )

        periods_map = {}
        for idx, pr in enumerate(p_rows):
            p_num = extract_pair_number(pr["short_time"]) or (idx + 1)
            time_range = format_period_time(pr["starttime"], pr["stoptime"])
            periods_map[pr["lid"]] = {
                "pair_number": p_num,
                "time_range": time_range or f"{p_num}-я пара",
            }

        # Получаем пары преподавателя
        sched_sql = """
            SELECT 
                ns.sheid,
                ns.day_of_week,
                ns.period,
                c.title AS course_title,
                c.alias AS course_alias,
                et.alias AS lesson_type,
                gn.name AS group_name,
                rm.short_name AS room_name,
                COALESCE(f."shortName", f.faculty, '') AS faculty_short
            FROM public.nnz_schedule ns
            LEFT JOIN public.courses c ON ns.cid = c.cid
            LEFT JOIN public.eventtools et ON ns.pair_type_id = et.typeid
            LEFT JOIN public.groupname gn ON ns.gid = gn.gid
            LEFT JOIN public.fuculty f ON gn.idfaculty = f.idfaculty
            LEFT JOIN public.rooms rm ON rm.rid = ns.rid[1]
            WHERE ns.sh_var_id = $1
              AND ns.day_of_week BETWEEN 1 AND 6
              AND $2 = ANY(ns.teacher_mid)
            ORDER BY ns.day_of_week ASC, ns.period ASC;
        """
        sched_rows = await self.conn.fetch(sched_sql, sh_var_id, teacher_id)

        day_names = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]

        lessons = []
        for r in sched_rows:
            dow = r["day_of_week"]
            p_meta = periods_map.get(r["period"], {"pair_number": 1, "time_range": "09:00 - 10:35"})
            day_date = monday + timedelta(days=dow - 1)
            fac_name, fac_color = resolve_faculty(r["faculty_short"])

            lessons.append({
                "sheid": r["sheid"],
                "day_of_week": dow,
                "day_name": day_names[dow - 1],
                "date_str": day_date.strftime("%d.%m.%Y"),
                "pair_number": p_meta["pair_number"],
                "pair_name": f"{p_meta['pair_number'] * 2 - 1}-{p_meta['pair_number'] * 2}",
                "time_str": p_meta["time_range"],
                "course_title": r["course_title"] or r["course_alias"] or "Занятие",
                "course_alias": r["course_alias"] or r["course_title"] or "Занятие",
                "course_name": r["course_alias"] or r["course_title"] or "Занятие",
                "lesson_type": r["lesson_type"] or "Пара",
                "event_type": r["lesson_type"] or "Пара",
                "event_type_alias": r["lesson_type"] or "Пара",
                "lesson_num": p_meta["pair_number"],
                "room_name": r["room_name"] or "--",
                "all_rooms": [r["room_name"]] if r["room_name"] else [],
                "group_name": r["group_name"] or "Группа",
                "all_groups": [r["group_name"]] if r["group_name"] else [],
                "teacher_name": t_row["full_name"],
                "faculty_name": fac_name,
                "faculty_short_name": fac_name,
                "faculty_color": fac_color,
            })

        return {
            "success": True,
            "teacher_id": teacher_id,
            "teacher_name": t_row["full_name"],
            "academic_degree": t_row["degree_short"],
            "cathedra_name": t_row["cathedra_name"],
            "photo_url": f"/api/v1/kiosk/photos/{teacher_id}" if t_row["has_photo"] else None,
            "week_name": week_info["sh_var_name"],
            "lessons": lessons,
            "total_lessons": len(lessons),
        }

    async def get_carousel_schedule(self) -> Dict[str, Any]:
        """Получить общее расписание для циклической карусели информационного табло."""
        week_info = await self._get_current_week_variant()
        sh_var_id = week_info["sh_var_id"]
        s_year_id = week_info["s_year_id"]
        monday = week_info["monday"]
        today = dt_date.today()
        current_dow = today.isoweekday()

        # Периоды года
        periods_sql = """
            SELECT lid, short_time, starttime, stoptime 
            FROM public.periods 
            WHERE s_year_id = $1 
            ORDER BY starttime ASC, lid ASC 
            LIMIT 4;
        """
        p_rows = await self.conn.fetch(periods_sql, s_year_id)
        if not p_rows:
            p_rows = await self.conn.fetch(
                "SELECT lid, short_time, starttime, stoptime FROM public.periods ORDER BY starttime ASC, lid ASC LIMIT 4;"
            )

        periods_map = {}
        for idx, pr in enumerate(p_rows):
            p_num = extract_pair_number(pr["short_time"]) or (idx + 1)
            time_range = format_period_time(pr["starttime"], pr["stoptime"])
            periods_map[pr["lid"]] = {
                "pair_number": p_num,
                "time_range": time_range or f"{p_num}-я пара",
            }

        day_names = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"]

        # Легенда факультетов по organaizer.ui
        faculties = [
            {"name": "АСУ, РЭС", "color": "#FFAAFF"},
            {"name": "ПиПК", "color": "#FFFF00"},
            {"name": "СФ", "color": "#AAFF00"},
            {"name": "ВВОТП", "color": "#95E7FF"},
        ]

        # 1. Список преподавателей кафедры (ПМК 1, 2)
        teachers_sql = """
            SELECT DISTINCT
                p.mid AS teacher_id,
                p.lastname,
                p.firstname,
                p.patronymic,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                ad.shortname AS degree_short,
                COALESCE(cath.cathedra, pm.name_pmk, 'Кафедра') AS cathedra_name,
                (tb.embedding IS NOT NULL) AS has_photo
            FROM public.people p
            JOIN public.cathedra_personnel cp ON p.mid = cp.mid
            LEFT JOIN public.academicdegree ad ON p.degree = ad.agid
            LEFT JOIN public.cathedras cath ON cp.cid = cath.idcathedra
            LEFT JOIN public.pmk pm ON cp.id_pmk = pm.id_pmk
            LEFT JOIN public.teacher_biometrics tb ON p.mid = tb.teacher_id
            WHERE cp.id_pmk IN (1, 2)
            ORDER BY p.lastname, p.firstname;
        """
        teacher_rows = await self.conn.fetch(teachers_sql)

        # 2. Все занятия на неделю (Пн-Сб)
        all_week_sched_sql = """
            SELECT 
                ns.sheid,
                ns.day_of_week,
                ns.period,
                ns.teacher_mid,
                c.title AS course_title,
                c.alias AS course_alias,
                et.alias AS lesson_type,
                gn.name AS group_name,
                rm.short_name AS room_name,
                COALESCE(f."shortName", f.faculty, '') AS faculty_short
            FROM public.nnz_schedule ns
            LEFT JOIN public.courses c ON ns.cid = c.cid
            LEFT JOIN public.eventtools et ON ns.pair_type_id = et.typeid
            LEFT JOIN public.groupname gn ON ns.gid = gn.gid
            LEFT JOIN public.fuculty f ON gn.idfaculty = f.idfaculty
            LEFT JOIN public.rooms rm ON rm.rid = ns.rid[1]
            WHERE ns.sh_var_id = $1
              AND ns.day_of_week BETWEEN 1 AND 6
            ORDER BY ns.day_of_week ASC, ns.period ASC;
        """
        all_sched_rows = await self.conn.fetch(all_week_sched_sql, sh_var_id)

        teacher_lessons_map: Dict[int, List[Dict[str, Any]]] = {}
        for r in all_sched_rows:
            dow = r["day_of_week"]
            if not (1 <= dow <= 6):
                continue
            day_date = monday + timedelta(days=dow - 1)
            p_meta = periods_map.get(r["period"], {"pair_number": 1, "time_range": "09:00 - 10:35"})
            fac_name, fac_color = resolve_faculty(r["faculty_short"])
            p_num = p_meta["pair_number"]
            pair_name = f"{p_num * 2 - 1}-{p_num * 2}"

            lesson_dict = {
                "sheid": r["sheid"],
                "day_of_week": dow,
                "day_name": day_names[dow - 1],
                "date_str": day_date.strftime("%d.%m.%Y"),
                "pair_number": p_num,
                "pair_name": pair_name,
                "time_str": p_meta["time_range"],
                "course_title": r["course_title"] or r["course_alias"] or "Занятие",
                "course_alias": r["course_alias"] or r["course_title"] or "Занятие",
                "course_name": r["course_alias"] or r["course_title"] or "Занятие",
                "lesson_type": r["lesson_type"] or "Пара",
                "event_type": r["lesson_type"] or "Пара",
                "event_type_alias": r["lesson_type"] or "Пара",
                "lesson_num": p_num,
                "room_name": r["room_name"] or "--",
                "all_rooms": [r["room_name"]] if r["room_name"] else [],
                "group_name": r["group_name"] or "Группа",
                "all_groups": [r["group_name"]] if r["group_name"] else [],
                "faculty_name": fac_name,
                "faculty_short_name": fac_name,
                "faculty_color": fac_color,
            }

            mids = r["teacher_mid"] or []
            for tmid in mids:
                if tmid not in teacher_lessons_map:
                    teacher_lessons_map[tmid] = []
                teacher_lessons_map[tmid].append(lesson_dict)

        department_teachers = []
        for tr in teacher_rows:
            tmid = tr["teacher_id"]
            lessons = teacher_lessons_map.get(tmid, [])
            p_url = f"/api/v1/kiosk/photos/{tmid}" if tr["has_photo"] else None
            department_teachers.append({
                "teacher_id": tmid,
                "full_name": tr["full_name"],
                "rank": tr["degree_short"],
                "academic_degree": tr["degree_short"],
                "cathedra_name": tr["cathedra_name"],
                "photo_url": p_url,
                "lessons": lessons,
            })

        # 3. Формируем слайды для совместимости
        target_days = [current_dow]
        if current_dow < 6:
            target_days.append(current_dow + 1)
        if current_dow < 5:
            target_days.append(current_dow + 2)
        if current_dow >= 6:
            target_days = [1, 2]

        grouped_slides: Dict[str, Dict[str, Any]] = {}
        for r in all_sched_rows:
            dow = r["day_of_week"]
            if dow not in target_days:
                continue
            cath_name = "Кафедра"
            key = f"{dow}_{cath_name}"
            day_date = monday + timedelta(days=dow - 1)
            p_meta = periods_map.get(r["period"], {"pair_number": 1, "time_range": "09:00 - 10:35"})
            fac_name, fac_color = resolve_faculty(r["faculty_short"])
            p_num = p_meta["pair_number"]

            if key not in grouped_slides:
                grouped_slides[key] = {
                    "cathedra_id": None,
                    "cathedra_name": cath_name,
                    "date_str": day_date.strftime("%d.%m.%Y"),
                    "day_name": day_names[dow - 1],
                    "teachers_set": set(),
                    "lessons": [],
                }

            grouped_slides[key]["lessons"].append({
                "sheid": r["sheid"],
                "day_of_week": dow,
                "day_name": day_names[dow - 1],
                "date_str": day_date.strftime("%d.%m.%Y"),
                "pair_number": p_num,
                "pair_name": f"{p_num * 2 - 1}-{p_num * 2}",
                "time_str": p_meta["time_range"],
                "course_title": r["course_title"] or r["course_alias"] or "Занятие",
                "course_alias": r["course_alias"] or r["course_title"] or "Занятие",
                "lesson_type": r["lesson_type"] or "Пара",
                "room_name": r["room_name"] or "--",
                "group_name": r["group_name"] or "Группа",
                "faculty_name": fac_name,
                "faculty_color": fac_color,
            })

        slides = []
        for g in grouped_slides.values():
            slides.append({
                "cathedra_id": g["cathedra_id"],
                "cathedra_name": g["cathedra_name"],
                "date_str": g["date_str"],
                "day_name": g["day_name"],
                "teacher_count": len(g["teachers_set"]),
                "lessons": g["lessons"][:12],
            })

        return {
            "success": True,
            "week_name": week_info["sh_var_name"],
            "date_str": today.strftime("%d.%m.%Y"),
            "cathedra_title": "Расписание занятий преподавателей кафедры",
            "faculties": faculties,
            "department_teachers": department_teachers,
            "slides": slides,
        }
