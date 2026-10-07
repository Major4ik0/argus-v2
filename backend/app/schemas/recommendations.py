# -*- coding: utf-8 -*-
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict


class RecommendedTeacher(BaseModel):
    """Кандидат на замену с рассчитанными метриками пригодности."""
    teacher_id: int
    full_name: str
    lastname: str
    is_free: bool = Field(..., description="Свободен ли преподаватель в этот период")
    is_same_cathedra: bool = Field(..., description="Работает ли на той же кафедре/ПМК")
    jaccard_score: float = Field(..., description="Коэффициент сходства профиля дисциплин (0.0 - 1.0)")
    teaches_target_course: bool = Field(..., description="Ведет ли уже эту конкретную дисциплину")
    shared_courses: List[str] = Field(default=[], description="Список общих преподаваемых дисциплин")

    model_config = ConfigDict(from_attributes=True)


class ReplacementQuerySchema(BaseModel):
    """Параметры для поиска кандидатов на замену по произвольному слоту."""
    day_of_week: int = Field(..., ge=1, le=7, description="День недели")
    period: int = Field(..., description="Номер пары / период")
    course_id: int = Field(..., description="ID дисциплины")
    current_teacher_id: Optional[int] = Field(None, description="ID отсутствующего преподавателя")
    sh_var_id: Optional[int] = Field(1, description="ID варианта расписания")


class ApplyReplacementSchema(BaseModel):
    """Применение выбранной замены в расписании."""
    sheid: int = Field(..., description="ID пары в расписании")
    old_teacher_id: int = Field(..., description="ID заменяемого преподавателя")
    new_teacher_id: int = Field(..., description="ID нового преподавателя")


class SlotCandidateQuery(BaseModel):
    date: str = Field(..., description="Дата в формате YYYY-MM-DD")
    pair_index: int = Field(0, description="Индекс пары (0 - 1-я пара, 1 - 2-я пара и т.д.)")
    group_id: Optional[int] = Field(None, description="ID учебной группы")
    course_id: Optional[int] = Field(None, description="ID дисциплины")
    course_alias: Optional[str] = Field(None, description="Краткое название дисциплины")
    cathedra_id: Optional[int] = Field(None, description="ID кафедры")


class BusyTeacherItem(BaseModel):
    id: int
    name: str
    lesson_type: Optional[str] = None
    course: Optional[str] = None
    group: Optional[str] = None
    schedule_id: int


class CandidateTeacherItem(BaseModel):
    id: int
    name: str
    degree: Optional[str] = None
    pmk: Optional[int] = None
    experience: Optional[dict] = None


class SlotCandidatesResponse(BaseModel):
    success: bool
    slot_info: dict
    busy_teachers: List[BusyTeacherItem]
    free_teachers: dict


class CourseTeachersQuery(BaseModel):
    course_id: Optional[int] = None
    course_alias: Optional[str] = ""
    group_id: Optional[int] = None
    date: Optional[str] = None
    pair_index: int = 0
    type_id: Optional[int] = None


class CourseTeacherRecommendation(BaseModel):
    mid: int
    full_name: str
    lastname: str
    firstname: Optional[str] = None
    patronymic: Optional[str] = None
    degree_short: Optional[str] = None
    degree_id: Optional[int] = None
    id_pmk: Optional[int] = None
    total_count: int
    same_group_count: int
    same_type_count: int
    confidence: float
    last_lesson_date: Optional[str] = None
    match_score: float


class CourseTeachersResponse(BaseModel):
    success: bool
    recommendations: List[CourseTeacherRecommendation]
    total_count: int
    criteria: dict