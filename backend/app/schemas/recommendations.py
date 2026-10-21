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


class MathematicalRecommendationsQuery(BaseModel):
    pair_type_id: Optional[int] = None
    cathedra_id: Optional[int] = None
    exclude_teacher_id: Optional[int] = None
    group_id: Optional[int] = None
    course_id: Optional[int] = None
    course_alias: Optional[str] = None


class AIRecommendationsQuery(BaseModel):
    group_id: Optional[int] = None
    pair_type_id: Optional[int] = None
    period_id: Optional[int] = None
    day_of_week: Optional[int] = None
    date: Optional[str] = None
    cathedra_id: Optional[int] = None
    study_year_id: Optional[int] = None
    exclude_teacher_id: Optional[int] = None
    course_id: Optional[int] = None
    course_alias: Optional[str] = None


class UnifiedRecommendationItem(BaseModel):
    mid: int
    full_name: str
    lastname: str
    firstname: Optional[str] = None
    patronymic: Optional[str] = None
    degree_short: Optional[str] = None
    degree_id: Optional[int] = None
    id_pmk: Optional[int] = None
    pmk_name: Optional[str] = None
    total_count: int = 0
    same_group_count: int = 0
    same_type_count: int = 0
    confidence: float = 0.0
    math_score: Optional[float] = None
    ai_score: Optional[float] = None
    match_score: Optional[float] = None
    jaccard_score: Optional[float] = 0.0
    overlap_score: Optional[float] = 0.0
    shared_courses: List[str] = []
    day_load_pairs: int = 0
    is_free: bool = True
    reason: Optional[str] = None
    badge_type: Optional[str] = None
    badge_text: Optional[str] = None
    last_lesson_date: Optional[str] = None
    busy_info: Optional["PreferredTeacherConflict"] = None


class PreferredTeacherConflict(BaseModel):
    """Детализация конфликта занятости целевого преподавателя."""
    is_busy: bool = False
    sheid: Optional[int] = None
    course_alias: Optional[str] = None
    course_title: Optional[str] = None
    group_name: Optional[str] = None
    lesson_type: Optional[str] = None
    period_name: Optional[str] = None
    room_name: Optional[str] = None
    description: Optional[str] = None


class SmartTeacherRecommendation(BaseModel):
    """Рекомендация преподавателя по взвешенному гибридному методу Жаккара и CSP."""
    mid: int
    full_name: str
    lastname: str
    firstname: Optional[str] = None
    patronymic: Optional[str] = None
    degree_short: Optional[str] = None
    degree_id: Optional[int] = None
    id_pmk: Optional[int] = None
    pmk_name: Optional[str] = None
    cathedra_id: Optional[int] = None
    is_free: bool = True
    match_score: float = Field(..., description="Итоговый взвешенный процент соответствия (0..100)")
    jaccard_score: float = Field(default=0.0, description="Коэффициент сходства Жаккара (0.0..1.0)")
    overlap_score: float = Field(default=0.0, description="Коэффициент Шимкевича-Симпсона (0.0..1.0)")
    shared_courses: List[str] = Field(default=[], description="Список общих дисциплин")
    total_course_lessons: int = Field(default=0, description="Всего проведено занятий по дисциплине")
    same_group_lessons: int = Field(default=0, description="Проведено занятий с этой группой")
    same_type_lessons: int = Field(default=0, description="Проведено занятий данного типа")
    day_load_pairs: int = Field(default=0, description="Количество пар у преподавателя в этот день")
    badge_type: Optional[str] = None
    badge_text: Optional[str] = None
    reason: Optional[str] = None
    busy_info: Optional[PreferredTeacherConflict] = None

    model_config = ConfigDict(from_attributes=True)


class SmartRecommendationRequest(BaseModel):
    """Запрос на подбор преподавателей по гибридному алгоритму."""
    sh_var_id: Optional[int] = None
    date: Optional[str] = Field(None, description="Дата в формате YYYY-MM-DD")
    day_of_week: Optional[int] = Field(None, ge=1, le=7, description="День недели 1..7")
    pair_index: Optional[int] = Field(None, ge=0, le=3, description="Индекс пары 0..3")
    period_id: Optional[int] = Field(None, description="Период (1..4 или periods.lid)")
    course_id: Optional[int] = None
    course_alias: Optional[str] = None
    group_id: Optional[int] = None
    pair_type_id: Optional[int] = None
    preferred_teacher_id: Optional[int] = Field(None, description="Кого заменяем или кого пытаемся поставить")
    cathedra_id: Optional[int] = None


class SmartRecommendationResponse(BaseModel):
    """Ответ умного подбора преподавателей."""
    success: bool = True
    algorithm: str = "Hybrid Weighted Jaccard & CSP Scoring"
    preferred_teacher_conflict: Optional[PreferredTeacherConflict] = None
    recommendations: List[SmartTeacherRecommendation] = []
    total_count: int = 0
    criteria: dict = {}


class FreeSlotItem(BaseModel):
    """Свободный временной слот для пары."""
    day_of_week: int = Field(..., ge=1, le=6, description="День недели (1 - Пн .. 6 - Сб)")
    day_name: str
    day_short: str
    date_str: str
    period_lid: int
    pair_number: int = Field(..., ge=1, le=4, description="Номер пары (1..4)")
    time_str: Optional[str] = None
    convenience_score: int = Field(..., ge=0, le=100, description="Оценка удобства слота (0..100)")
    reasons: List[str] = Field(default=[], description="Факторы оценки удобства")
    badge: Optional[str] = None


class FreeSlotSuggestionRequest(BaseModel):
    """Запрос свободных окон для пары."""
    sh_var_id: Optional[int] = None
    date: Optional[str] = Field(None, description="Дата (YYYY-MM-DD) для определения недели")
    teacher_id: int = Field(..., description="ID преподавателя")
    group_id: int = Field(..., description="ID учебной группы")
    s_year_id: Optional[int] = None


class FreeSlotSuggestionResponse(BaseModel):
    """Ответ со списком свободных окон."""
    success: bool = True
    slots: List[FreeSlotItem] = []
    total_count: int = 0
    teacher_id: int
    group_id: int
    week_range: Optional[str] = None


class RecommendationsListResponse(BaseModel):
    success: bool
    recommendations: List[UnifiedRecommendationItem]
    total_count: int
    algorithm: Optional[str] = None
    criteria: Optional[dict] = None