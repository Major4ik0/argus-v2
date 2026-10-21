# -*- coding: utf-8 -*-
from typing import List, Optional, Any
from pydantic import BaseModel, Field, ConfigDict


class TeacherShort(BaseModel):
    id: int
    full_name: str
    lastname: str


class RoomShort(BaseModel):
    id: int
    name: str


class ScheduleItemResponse(BaseModel):
    """Модель пары для отображения в сетке расписания."""
    sheid: int
    day_of_week: int
    period_id: int
    period_name: Optional[str] = None
    group_id: int
    group_name: Optional[str] = None
    faculty_id: Optional[int] = None
    faculty_short_name: Optional[str] = None
    course_id: int
    course_alias: Optional[str] = None
    course_title: Optional[str] = None
    event_type_id: int
    event_type_alias: Optional[str] = None
    sh_var_id: Optional[int] = None
    sh_var_name: Optional[str] = None
    idcathedra: Optional[int] = None
    teacher_mid: List[int] = []
    teachers: List[TeacherShort] = []
    room_ids: List[int] = []
    rooms: List[RoomShort] = []

    model_config = ConfigDict(from_attributes=True)


class ScheduleCreateSchema(BaseModel):
    """Данные для создания новой пары."""
    day_of_week: int = Field(..., ge=1, le=7, description="День недели (1-7)")
    period: int = Field(..., description="Номер пары / ID периода")
    gid: int = Field(..., description="ID группы")
    cid: int = Field(..., description="ID дисциплины")
    pair_type_id: int = Field(..., description="ID типа занятия (лекция, практика и т.д.)")
    teacher_mid: List[int] = Field(..., min_length=1, description="Массив ID преподавателей")
    rid: Optional[List[int]] = Field(default=[], description="Массив ID аудиторий")
    sh_var_id: Optional[int] = Field(default=None, description="ID варианта расписания")
    idcathedra: Optional[int] = Field(default=None, description="ID кафедры")


class ScheduleUpdateSchema(BaseModel):
    """Данные для полного обновления существующей пары."""
    day_of_week: Optional[int] = Field(None, ge=1, le=7)
    period: Optional[int] = None
    gid: Optional[int] = None
    cid: Optional[int] = None
    pair_type_id: Optional[int] = None
    teacher_mid: Optional[List[int]] = None
    rid: Optional[List[int]] = None
    sh_var_id: Optional[int] = None
    idcathedra: Optional[int] = None


class ScheduleMoveSchema(BaseModel):
    """Быстрое перемещение пары (Drag-and-Drop)."""
    day_of_week: int = Field(..., ge=1, le=7)
    period: int = Field(..., description="Новый ID периода / номер пары")


class SwapScheduleRequest(BaseModel):
    """Запрос на оперативную замену занятия / преподавателя."""
    schedule_id: int = Field(..., description="ID занятия в расписании (sheid)")
    target_teacher_id: Optional[int] = Field(None, description="ID замещающего преподавателя (mid)")
    target_date: str = Field(..., description="Целевая дата (YYYY-MM-DD)")
    target_period: int = Field(..., description="Целевая пара (1-4 или ID периода lid)")
    source_teacher_id: Optional[int] = Field(None, description="ID заменяемого преподавателя")
    from_teacher: Optional[str] = Field(None, description="ФИО исходного преподавателя (для совместимости)")
    to_teacher: Optional[str] = Field(None, description="ФИО целевого преподавателя (для совместимости)")
    pair_index: Optional[int] = Field(None, description="Индекс пары (для совместимости)")


class ConflictCheckResponse(BaseModel):
    """Ответ проверки коллизий в расписании."""
    has_conflict: bool
    conflict_lesson: Optional[dict] = None
    message: str