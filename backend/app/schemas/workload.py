# -*- coding: utf-8 -*-
from typing import List, Optional
from pydantic import BaseModel, ConfigDict


class EventTypeDistribution(BaseModel):
    """Распределение часов по типам занятий (лекции, практики, лабы) для диаграмм."""
    event_type_id: int
    event_type_name: str
    total_pairs: int
    total_hours: int
    percentage: float = 0.0

    model_config = ConfigDict(from_attributes=True)


class CourseWorkload(BaseModel):
    """Нагрузка в разрезе конкретной дисциплины."""
    course_id: int
    course_alias: Optional[str] = None
    course_title: str
    total_pairs: int
    total_hours: int

    model_config = ConfigDict(from_attributes=True)


class TeacherWorkloadSummary(BaseModel):
    """Суммарная нагрузка конкретного преподавателя."""
    teacher_id: int
    full_name: str
    lastname: str
    total_pairs: int
    total_hours: int

    model_config = ConfigDict(from_attributes=True)


class TeacherWorkloadDetail(BaseModel):
    """Детализация нагрузки преподавателя (по типам занятий и дисциплинам)."""
    teacher_id: int
    full_name: str
    total_pairs: int
    total_hours: int
    by_event_types: List[EventTypeDistribution]
    by_courses: List[CourseWorkload]

    model_config = ConfigDict(from_attributes=True)


class FacultyWorkloadSummary(BaseModel):
    """Суммарная нагрузка по факультетам."""
    faculty_id: Optional[int] = None
    faculty_name: str
    total_pairs: int
    total_hours: int

    model_config = ConfigDict(from_attributes=True)