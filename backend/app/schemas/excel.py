# -*- coding: utf-8 -*-
from typing import List, Optional
from pydantic import BaseModel, Field


class ExcelRowError(BaseModel):
    row_index: int = Field(..., description="Номер строки в Excel-файле")
    reason: str = Field(..., description="Описание ошибки или ненайденной сущности")


class ExcelImportResult(BaseModel):
    total_rows: int = Field(..., description="Всего обработано строк")
    imported_count: int = Field(..., description="Успешно добавлено пар")
    failed_count: int = Field(..., description="Пропущено из-за ошибок")
    errors: List[ExcelRowError] = Field(default=[], description="Список обнаруженных ошибок")
    created_ids: List[int] = Field(default=[], description="ID добавленных записей nnz_schedule")