# -*- coding: utf-8 -*-
from typing import List, Optional
from pydantic import BaseModel, Field


class ExcelRowError(BaseModel):
    row_index: int = Field(..., description="Номер строки в Excel-файле")
    reason: str = Field(..., description="Описание ошибки или ненайденной сущности")


class ExcelImportResult(BaseModel):
    success: bool = Field(default=True, description="Статус операции")
    message: str = Field(default="Импорт успешно завершен", description="Сообщение о результате")
    total_rows: int = Field(..., description="Всего обработано строк")
    imported_count: int = Field(..., description="Успешно добавлено пар")
    updated_count: int = Field(default=0, description="Обновлено существующих пар")
    skipped_count: int = Field(default=0, description="Пропущено строк")
    failed_count: int = Field(..., description="Ошибок при импорте")
    stats: Optional[dict] = Field(default=None, description="Сводная статистика: {inserted, updated, skipped}")
    errors: List[ExcelRowError] = Field(default=[], description="Список обнаруженных ошибок")
    created_ids: List[int] = Field(default=[], description="ID добавленных записей nnz_schedule")
    unmatched_teachers: List[str] = Field(default=[], description="Имена преподавателей, не найденных в базе")
    unmatched_courses: List[str] = Field(default=[], description="Коды дисциплин, не найденных в базе")
    unmatched_groups: List[str] = Field(default=[], description="Названия групп, не найденных в базе")
