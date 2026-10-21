# -*- coding: utf-8 -*-
from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field


class WorkloadKPISummary(BaseModel):
    """Сводные KPI-показатели нагрузки кафедры."""
    total_hours: int = Field(default=0, description="Суммарное количество академических часов")
    teacher_count: int = Field(default=0, description="Количество задействованных преподавателей (чел)")
    total_lessons: int = Field(default=0, description="Общее количество занятий / пар")
    avg_hours: float = Field(default=0.0, description="Средняя нагрузка на преподавателя (ч/чел)")

    model_config = ConfigDict(from_attributes=True)


class TeacherWorkloadCard(BaseModel):
    """Нагрузка конкретного преподавателя для карточки и таблицы."""
    teacher_id: int = Field(..., description="ID преподавателя (mid)")
    full_name: str = Field(..., description="Полное ФИО")
    lastname: str = Field(default="", description="Фамилия")
    initials: str = Field(default="", description="Инициалы для аватара")
    cathedra_name: Optional[str] = Field(default=None, description="Название кафедры")
    pmk_id: Optional[int] = Field(default=None, description="ID ПМК (1 или 2)")
    pmk_name: Optional[str] = Field(default=None, description="Название ПМК (например, 'ПМК 1')")
    academic_degree: Optional[str] = Field(default=None, description="Ученая степень/звание")

    # Разбивка по часам (1 пара = 2 академических часа)
    lectures_hours: int = Field(default=0, description="Лекции (акад. часы)")
    practical_hours: int = Field(default=0, description="Практики (акад. часы)")
    lab_hours: int = Field(default=0, description="Лабораторные (акад. часы)")
    exams_hours: int = Field(default=0, description="Экзамены/зачеты (акад. часы)")
    course_work_hours: int = Field(default=0, description="Курсовые работы (акад. часы)")
    other_hours: int = Field(default=0, description="Прочие занятия (акад. часы)")
    total_hours: int = Field(default=0, description="Суммарно академических часов")
    total_lessons: int = Field(default=0, description="Всего занятий/пар")

    load_percentage: float = Field(default=0.0, description="Процент нагрузки от максимума или нормы")

    model_config = ConfigDict(from_attributes=True)


class TeacherLessonDetailItem(BaseModel):
    """Строка детализации нагрузки по предмету, группе и типу занятия."""
    course_id: int
    course_alias: Optional[str] = None
    course_title: Optional[str] = None
    group_name: Optional[str] = None
    faculty_name: Optional[str] = None
    lesson_type: Optional[str] = None
    lessons_count: int = 0
    hours_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class TeacherWorkloadDetailResponse(BaseModel):
    """Детальная информация о нагрузке преподавателя для модального окна."""
    teacher_id: int
    full_name: str
    pmk_name: Optional[str] = None
    cathedra_name: Optional[str] = None
    academic_degree: Optional[str] = None
    total_hours: int = 0
    total_lessons: int = 0
    lectures_hours: int = 0
    practical_hours: int = 0
    lab_hours: int = 0
    exams_hours: int = 0
    course_work_hours: int = 0
    other_hours: int = 0
    lessons: List[TeacherLessonDetailItem] = []

    model_config = ConfigDict(from_attributes=True)


class EventTypeDistribution(BaseModel):
    """Распределение часов по типам занятий для графиков."""
    event_type_name: str
    hours: int
    percentage: float = 0.0
    color: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)
