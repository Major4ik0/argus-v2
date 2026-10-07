from datetime import date
from typing import List, Dict, Any, Optional
import asyncpg


class ReferenceRepository:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    async def get_courses(self) -> List[Dict[str, Any]]:
        sql = "SELECT cid AS id, alias, title FROM courses ORDER BY alias, title;"
        rows = await self.conn.fetch(sql)
        return [dict(r) for r in rows]

    async def get_rooms(self) -> List[Dict[str, Any]]:
        sql = "SELECT rid AS id, short_name AS name FROM rooms ORDER BY short_name;"
        rows = await self.conn.fetch(sql)
        return [dict(r) for r in rows]

    async def get_event_types(self) -> List[Dict[str, Any]]:
        sql = "SELECT typeid AS id, alias AS name FROM eventtools ORDER BY alias;"
        rows = await self.conn.fetch(sql)
        return [dict(r) for r in rows]

    async def get_groups(self) -> List[Dict[str, Any]]:
        sql = "SELECT gid AS id, name, idfaculty AS faculty_id FROM groupname ORDER BY name;"
        rows = await self.conn.fetch(sql)
        return [dict(r) for r in rows]

    async def get_teachers(self) -> List[Dict[str, Any]]:
        """Получение преподавателей кафедры (строго ПМК 1 и 2)."""
        sql = """
            SELECT DISTINCT
                p.mid AS id, 
                p.lastname, 
                p.firstname, 
                p.patronymic,
                TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name,
                cp.id_pmk AS category
            FROM public.people AS p
            JOIN public.cathedra_personnel AS cp ON p.mid = cp.mid
            WHERE cp.id_pmk IN (1, 2)
            ORDER BY full_name;
        """
        rows = await self.conn.fetch(sql)
        return [dict(r) for r in rows]

    async def get_pmk(self) -> List[Dict[str, Any]]:
        sql = "SELECT id_pmk AS id, name_pmk as name FROM pmk ORDER BY name;"
        rows = await self.conn.fetch(sql)
        return [dict(r) for r in rows]

    async def get_all_references(self) -> Dict[str, Any]:
        """Получение всех справочников в одном месте без лишних round-trip запросов."""
        return {
            "disciplines": await self.get_courses(),
            "classrooms": await self.get_rooms(),
            "lesson_types": await self.get_event_types(),
            "groups": await self.get_groups(),
            "teachers": await self.get_teachers(),
            "pmk": await self.get_pmk(),
        }

    async def get_study_year_by_date(self, target_date: date) -> Optional[int]:
        """Определяет ID учебного года (syid) по дате."""
        from ..core.calendar_utils import get_academic_year_info
        year_info = get_academic_year_info(target_date)

        sql = """
            SELECT syid 
            FROM public.studyyears 
            WHERE school_year = $1 OR number = $2 OR name ILIKE $3
            ORDER BY syid DESC 
            LIMIT 1;
        """
        row = await self.conn.fetchrow(
            sql,
            year_info["start_year"],
            str(year_info["start_year"]),
            f"%{year_info['start_year']}%"
        )
        return row["syid"] if row else None

    async def get_periods_by_year_id(self, s_year_id: int) -> List[Dict[str, Any]]:
        """Получает список периодов (пар) для ID учебного года."""
        from ..core.calendar_utils import format_period_time, extract_pair_number

        sql = """
            SELECT lid, name, short_time, starttime, stoptime 
            FROM public.periods 
            WHERE s_year_id = $1 
            ORDER BY starttime ASC, lid ASC;
        """
        rows = await self.conn.fetch(sql, s_year_id)
        if not rows:
            # Fallback на дефолтные периоды, если для года нет записей
            fallback_sql = "SELECT lid, name, short_time, starttime, stoptime FROM public.periods ORDER BY starttime ASC, lid ASC LIMIT 6;"
            rows = await self.conn.fetch(fallback_sql)

        periods = []
        for i, r in enumerate(rows):
            time_range = format_period_time(r["starttime"], r["stoptime"])
            pair_num = extract_pair_number(r["short_time"]) or (i + 1)
            periods.append({
                "id": r["lid"],
                "name": r["name"],
                "short_name": r["short_time"],
                "time_range": time_range,
                "pair_number": pair_num,
                "start_minutes": r["starttime"],
                "stop_minutes": r["stoptime"],
                "index": i,
                "display_text": f"{r['short_time']} ({time_range})" if r["short_time"] else time_range
            })
        return periods