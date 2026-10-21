# -*- coding: utf-8 -*-
from typing import List, Optional
from pydantic import BaseModel, Field, ConfigDict


class KioskSettingsSchema(BaseModel):
    """Настройки терминала и камеры."""
    camera_source: str = Field(default="0", description="Индекс USB камеры (0, 1) или RTSP-ссылка")
    recognition_threshold: float = Field(default=0.48, ge=0.2, le=0.99, description="Порог уверенности распознавания лиц (0.48 - 0.50)")
    similarity_threshold: Optional[float] = Field(default=0.48, ge=0.2, le=0.99, description="Алиас для порога сходства")
    carousel_interval: int = Field(default=12, ge=5, le=60, description="Интервал смены слайдов карусели в секундах")
    idle_timeout: int = Field(default=20, ge=5, le=120, description="Таймаут возврата в карусель при отсутствии лица (сек)")
    person_timeout: Optional[int] = Field(default=20, ge=5, le=120, description="Алиас для таймаута присутствия")
    is_active: bool = Field(default=True, description="Флаг активности видеоаналитики")
    active: Optional[bool] = Field(default=True, description="Алиас для флага активности")

    model_config = ConfigDict(from_attributes=True)


class TeacherBiometricStatusItem(BaseModel):
    """Информация о преподавателе и наличии его биометрического профиля."""
    teacher_id: int
    full_name: str
    lastname: str
    firstname: Optional[str] = None
    patronymic: Optional[str] = None
    cathedra_id: Optional[int] = None
    cathedra_name: Optional[str] = None
    degree_short: Optional[str] = None
    has_photo: bool = False
    photo_url: Optional[str] = None
    updated_at: Optional[str] = None
    visits_today: int = 0
    visits_week: int = 0
    visits_total: int = 0
    last_visit: Optional[str] = None


class BiometricsUploadResponse(BaseModel):
    """Результат загрузки и вычисления биометрии преподавателя."""
    success: bool
    message: str
    teacher_id: int
    photo_url: Optional[str] = None
    embedding_size: int = 512


class KioskTopTeacherItem(BaseModel):
    """Преподаватель в топе по количеству подходов к терминалу."""
    teacher_id: int
    full_name: str
    photo_url: Optional[str] = None
    cathedra_name: Optional[str] = None
    visit_count: int
    last_visit: Optional[str] = None


class KioskLogItem(BaseModel):
    """Запись в журнале фиксаций лиц."""
    id: int
    teacher_id: int
    teacher_name: str
    photo_url: Optional[str] = None
    confidence: float
    recognized_at: str


class KioskStatsSummary(BaseModel):
    """Сводная статистика работы умного табло."""
    total_today: int
    total_week: int
    total_all_time: int
    active_teachers_today: int
    biometrics_coverage_pct: float = 0.0
    most_active_teacher: Optional[str] = None
    top_teachers: List[KioskTopTeacherItem]
    recent_logs: List[KioskLogItem]


class TeacherWeeklyLessonItem(BaseModel):
    """Занятие в недельном расписании преподавателя."""
    sheid: int
    day_of_week: int = Field(..., ge=1, le=6, description="1 - Пн .. 6 - Сб")
    day_name: str
    date_str: Optional[str] = None
    pair_number: int = Field(..., ge=1, le=4, description="Номер пары 1..4")
    pair_name: Optional[str] = Field(default="1-2", description="Название пары: 1-2, 3-4, 5-6, 7-8")
    time_str: str
    course_title: str
    course_alias: str
    course_name: Optional[str] = None
    lesson_type: str
    event_type: Optional[str] = None
    event_type_alias: Optional[str] = None
    lesson_num: Optional[int] = None
    room_name: str
    all_rooms: Optional[List[str]] = None
    group_name: str
    all_groups: Optional[List[str]] = None
    teacher_name: Optional[str] = None
    faculty_name: Optional[str] = None
    faculty_short_name: Optional[str] = None
    faculty_color: Optional[str] = None


class TeacherWeeklyScheduleResponse(BaseModel):
    """Персональное расписание преподавателя на текущую неделю."""
    success: bool = True
    teacher_id: int
    teacher_name: str
    academic_degree: Optional[str] = None
    cathedra_name: Optional[str] = None
    photo_url: Optional[str] = None
    week_name: str
    lessons: List[TeacherWeeklyLessonItem] = []
    total_lessons: int = 0


class DepartmentFacultyLegendItem(BaseModel):
    """Элемент легенды факультетов из organaizer.ui."""
    name: str
    color: str


class TeacherDepartmentScheduleItem(BaseModel):
    """Преподаватель кафедры со всем его недельным расписанием для сводной таблицы."""
    teacher_id: int
    full_name: str
    rank: Optional[str] = None
    academic_degree: Optional[str] = None
    cathedra_name: Optional[str] = None
    photo_url: Optional[str] = None
    lessons: List[TeacherWeeklyLessonItem] = []


class CarouselSlideItem(BaseModel):
    """Слайд расписания для режима карусели."""
    cathedra_id: Optional[int] = None
    cathedra_name: str
    date_str: str
    day_name: str
    teacher_count: int = 0
    lessons: List[TeacherWeeklyLessonItem] = []


class CarouselScheduleResponse(BaseModel):
    """Агрегированное расписание для режима ожидания (карусели) по organaizer.ui."""
    success: bool = True
    week_name: str
    date_str: str
    cathedra_title: str = "Расписание занятий преподавателей кафедры"
    faculties: List[DepartmentFacultyLegendItem] = []
    department_teachers: List[TeacherDepartmentScheduleItem] = []
    slides: List[CarouselSlideItem] = []


class CameraSnapshotResponse(BaseModel):
    """Снимок с камеры терминала."""
    success: bool
    image_base64: Optional[str] = None
    message: Optional[str] = None
