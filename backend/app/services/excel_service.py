# -*- coding: utf-8 -*-
import io
import re
from typing import Dict, List, Tuple, Any, Optional
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
import asyncpg

from ..schemas.excel import ExcelImportResult, ExcelRowError


class ExcelService:
    def __init__(self, conn: asyncpg.Connection):
        self.conn = conn

    @staticmethod
    def _clean_str(val: Any) -> str:
        """Очистка строковых значений от лишних пробелов."""
        if val is None:
            return ""
        return str(val).strip()

    async def _build_lookup_caches(self) -> Dict[str, Dict[str, int]]:
        """Кэширование справочников базы данных для мгновенного поиска по тексту."""
        # 1. Группы: 'ИС-21' -> gid
        groups = await self.conn.fetch("SELECT gid, LOWER(TRIM(name)) AS key FROM groupname;")
        groups_map = {r["key"]: r["gid"] for r in groups}

        # 2. Дисциплины: 'Мат. анализ' / 'Математический анализ' -> cid
        courses = await self.conn.fetch("SELECT cid, LOWER(TRIM(alias)) AS alias, LOWER(TRIM(title)) AS title FROM courses;")
        courses_map = {}
        for r in courses:
            if r["alias"]:
                courses_map[r["alias"]] = r["cid"]
            if r["title"]:
                courses_map[r["title"]] = r["cid"]

        # 3. Типы занятий: 'лек' / 'лекция' -> typeid
        types = await self.conn.fetch("SELECT typeid, LOWER(TRIM(alias)) AS key FROM eventtools;")
        types_map = {r["key"]: r["typeid"] for r in types}

        # 4. Аудитории: '204' / '204а' -> rid
        rooms = await self.conn.fetch("SELECT rid, LOWER(TRIM(short_name)) AS key FROM rooms;")
        rooms_map = {r["key"]: r["rid"] for r in rooms}

        # 5. Преподаватели: поиск по фамилии и полному ФИО -> mid
        teachers = await self.conn.fetch("""
            SELECT mid, LOWER(TRIM(lastname)) AS lname,
                   LOWER(TRIM(CONCAT_WS(' ', lastname, firstname, patronymic))) AS full_name
            FROM people;
        """)
        teachers_map = {}
        for r in teachers:
            teachers_map[r["lname"]] = r["mid"]
            teachers_map[r["full_name"]] = r["mid"]

        return {
            "groups": groups_map,
            "courses": courses_map,
            "types": types_map,
            "rooms": rooms_map,
            "teachers": teachers_map,
        }

    async def import_schedule_from_excel(
        self,
        file_bytes: bytes,
        sh_var_id: int = 1,
        dry_run: bool = False
    ) -> ExcelImportResult:
        """
        Парсинг Excel и сохранение в nnz_schedule.
        Ожидаемый порядок колонок:
        1: День недели (1-7), 2: Номер пары (1-6), 3: Группа,
        4: Дисциплина, 5: Тип занятия, 6: Преподаватель (ФИО), 7: Аудитория
        """
        caches = await self._build_lookup_caches()
        workbook = openpyxl.load_workbook(filename=io.BytesIO(file_bytes), data_only=True)
        sheet = workbook.active

        errors: List[ExcelRowError] = []
        rows_to_insert: List[Dict[str, Any]] = []
        total_rows = 0

        # Чтение строк с автопропуском шапки
        for row_idx, row in enumerate(sheet.iter_rows(values_only=True), start=1):
            if row_idx == 1:
                continue

            # Пропуск пустых строк
            if not any(row):
                continue

            total_rows += 1

            raw_day = self._clean_str(row[0] if len(row) > 0 else "")
            raw_period = self._clean_str(row[1] if len(row) > 1 else "")
            raw_group = self._clean_str(row[2] if len(row) > 2 else "").lower()
            raw_course = self._clean_str(row[3] if len(row) > 3 else "").lower()
            raw_type = self._clean_str(row[4] if len(row) > 4 else "").lower()
            raw_teacher = self._clean_str(row[5] if len(row) > 5 else "").lower()
            raw_room = self._clean_str(row[6] if len(row) > 6 else "").lower()

            # 1. Валидация дня недели и пары
            try:
                day_of_week = int(raw_day)
                if not (1 <= day_of_week <= 7):
                    raise ValueError
            except ValueError:
                errors.append(ExcelRowError(row_index=row_idx, reason=f"Некорректный день недели: '{raw_day}' (ожидается 1-7)"))
                continue

            try:
                period = int(raw_period)
            except ValueError:
                errors.append(ExcelRowError(row_index=row_idx, reason=f"Некорректный номер пары: '{raw_period}'"))
                continue

            # 2. Сопоставление группы
            gid = caches["groups"].get(raw_group)
            if not gid:
                errors.append(ExcelRowError(row_index=row_idx, reason=f"Учебная группа '{raw_group}' не найдена в базе"))
                continue

            # 3. Сопоставление дисциплины
            cid = caches["courses"].get(raw_course)
            if not cid:
                errors.append(ExcelRowError(row_index=row_idx, reason=f"Дисциплина '{raw_course}' не найдена в базе"))
                continue

            # 4. Сопоставление типа занятия (по умолчанию Лекция = 1)
            pair_type_id = caches["types"].get(raw_type, 1)

            # 5. Сопоставление преподавателя
            # Попытка найти по фамилии (первое слово) или полному значению
            teacher_clean = re.sub(r'\s+', ' ', raw_teacher)
            teacher_mid = caches["teachers"].get(teacher_clean)
            if not teacher_mid:
                first_word = teacher_clean.split(' ')[0] if teacher_clean else ""
                teacher_mid = caches["teachers"].get(first_word)

            if not teacher_mid:
                errors.append(ExcelRowError(row_index=row_idx, reason=f"Преподаватель '{raw_teacher}' не найден в базе"))
                continue

            # 6. Сопоставление аудитории (опционально)
            rid_list = []
            if raw_room:
                rid = caches["rooms"].get(raw_room)
                if rid:
                    rid_list.append(rid)

            rows_to_insert.append({
                "day_of_week": day_of_week,
                "period": period,
                "gid": gid,
                "cid": cid,
                "pair_type_id": pair_type_id,
                "teacher_mid": [teacher_mid],
                "rid": rid_list,
                "sh_var_id": sh_var_id,
            })

        created_ids = []
        if not dry_run and rows_to_insert:
            # Пакетная вставка в рамках безопасной транзакции
            async with self.conn.transaction():
                sql = """
                    INSERT INTO public.nnz_schedule (
                        day_of_week, period, gid, cid, pair_type_id,
                        teacher_mid, rid, sh_var_id
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                    RETURNING sheid;
                """
                for item in rows_to_insert:
                    sheid = await self.conn.fetchval(
                        sql,
                        item["day_of_week"],
                        item["period"],
                        item["gid"],
                        item["cid"],
                        item["pair_type_id"],
                        item["teacher_mid"],
                        item["rid"],
                        item["sh_var_id"]
                    )
                    created_ids.append(sheid)

        return ExcelImportResult(
            total_rows=total_rows,
            imported_count=len(rows_to_insert),
            failed_count=len(errors),
            errors=errors,
            created_ids=created_ids
        )

    async def export_schedule_to_excel(
        self,
        group_id: Optional[int] = None,
        teacher_id: Optional[int] = None,
        sh_var_id: Optional[int] = 1,
    ) -> io.BytesIO:
        """Формирование красиво оформленного отчета расписания в Excel."""
        conditions = ["s.sh_var_id = $1"]
        params = [sh_var_id]

        if group_id:
            params.append(group_id)
            conditions.append(f"s.gid = ${len(params)}")

        if teacher_id:
            params.append(teacher_id)
            conditions.append(f"${len(params)} = ANY(s.teacher_mid)")

        sql = f"""
            SELECT 
                s.day_of_week,
                s.period,
                COALESCE(g.name, '-') AS group_name,
                COALESCE(c.alias, c.title, '-') AS course_name,
                COALESCE(e.alias, '-') AS event_type,
                (
                    SELECT TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic))
                    FROM people p WHERE p.mid = ANY(s.teacher_mid) LIMIT 1
                ) AS teacher_name,
                (
                    SELECT r.short_name 
                    FROM rooms r WHERE r.rid = ANY(s.rid) LIMIT 1
                ) AS room_name
            FROM public.nnz_schedule s
            LEFT JOIN groupname g ON g.gid = s.gid
            LEFT JOIN courses c ON c.cid = s.cid
            LEFT JOIN eventtools e ON e.typeid = s.pair_type_id
            WHERE {' AND '.join(conditions)}
            ORDER BY s.day_of_week, s.period;
        """
        rows = await self.conn.fetch(sql, *params)

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Расписание занятий"

        # Стили шапки
        header_fill = PatternFill(start_color="1E293B", end_color="1E293B", fill_type="solid")
        header_font = Font(name="Arial", size=11, bold=True, color="FFFFFF")
        regular_font = Font(name="Arial", size=10)
        center_align = Alignment(horizontal="center", vertical="center")
        thin_border = Border(
            left=Side(style="thin", color="CBD5E1"),
            right=Side(style="thin", color="CBD5E1"),
            top=Side(style="thin", color="CBD5E1"),
            bottom=Side(style="thin", color="CBD5E1")
        )

        headers = ["День недели", "Пара", "Группа", "Дисциплина", "Тип занятия", "Преподаватель", "Аудитория"]
        ws.append(headers)

        for col_num in range(1, len(headers) + 1):
            cell = ws.cell(row=1, column=col_num)
            cell.fill = header_fill
            cell.font = header_font
            cell.alignment = center_align

        day_names = {1: "ПН", 2: "ВТ", 3: "СР", 4: "ЧТ", 5: "ПТ", 6: "СБ", 7: "ВС"}

        for row_data in rows:
            day_str = day_names.get(row_data["day_of_week"], str(row_data["day_of_week"]))
            ws.append([
                day_str,
                row_data["period"],
                row_data["group_name"],
                row_data["course_name"],
                row_data["event_type"],
                row_data["teacher_name"] or "-",
                row_data["room_name"] or "-",
            ])

        # Применяем границы и центровку
        for row in ws.iter_rows(min_row=2, max_row=ws.max_row, min_col=1, max_col=7):
            for cell in row:
                cell.font = regular_font
                cell.border = thin_border
                if cell.column in (1, 2, 7):
                    cell.alignment = center_align

        # Автоширина колонок
        for col in ws.columns:
            max_len = max(len(str(cell.value or '')) for cell in col)
            col_letter = openpyxl.utils.get_column_letter(col[0].column)
            ws.column_dimensions[col_letter].width = max(max_len + 3, 12)

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return output