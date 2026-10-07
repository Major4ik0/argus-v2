from typing import List, Optional
from pydantic import BaseModel, ConfigDict


class CatalogItem(BaseModel):
    """Базовый элемент справочника (ID + Название)."""
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class CourseItem(BaseModel):
    """Дисциплина из таблицы courses."""
    id: int
    alias: Optional[str] = None
    title: str

    model_config = ConfigDict(from_attributes=True)


class TeacherItem(BaseModel):
    """Преподаватель из таблицы people."""
    id: int
    lastname: str
    firstname: Optional[str] = None
    patronymic: Optional[str] = None
    full_name: str

    model_config = ConfigDict(from_attributes=True)


class GroupItem(BaseModel):
    """Учебная группа из таблицы groupname."""
    id: int
    name: str
    faculty_id: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


class AllReferencesResponse(BaseModel):
    """Единый DTO со всеми справочниками для первичной инициализации фронтенда."""
    disciplines: List[CourseItem]
    classrooms: List[CatalogItem]
    lesson_types: List[CatalogItem]
    groups: List[GroupItem]
    teachers: List[TeacherItem]
    pmk: List[CatalogItem]


class PeriodItem(BaseModel):
    id: int
    name: Optional[str] = None
    short_name: Optional[str] = None
    time_range: str
    pair_number: int
    start_minutes: Optional[int] = None
    stop_minutes: Optional[int] = None
    index: int

    model_config = ConfigDict(from_attributes=True)


class PeriodsForYearResponse(BaseModel):
    study_year: int
    s_year_id: int
    periods: List[PeriodItem]


class PeriodForDateItem(BaseModel):
    index: int
    pair_id: int
    name: Optional[str] = None
    short_name: Optional[str] = None
    time_range: str
    display_text: str


class PeriodsForDateResponse(BaseModel):
    date: str
    periods: List[PeriodForDateItem]


class StudyYearResponse(BaseModel):
    success: bool
    study_year: str
    study_year_id: Optional[int] = None
    study_year_start: str