"""Таблицы приложения. Соответствие листам книги — в docstring каждой модели.

Производные значения (возраст, выслуга, падежи, итоги) в БД не хранятся — их считает kafedra.calc
на дату запроса. Хранятся только вводимые данные.
"""

from __future__ import annotations

import datetime as dt
import enum
from decimal import Decimal
from typing import Any

from sqlalchemy import Date, DateTime, Enum, ForeignKey, Numeric, String, Text, UniqueConstraint, false, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, DepartmentMixin, IdMixin, TimestampMixin


def _enum(e: type[enum.Enum]) -> Enum:
    return Enum(e, native_enum=False, length=32, values_callable=lambda x: [m.value for m in x])


# --- кафедры и пользователи -------------------------------------------------------------------


class Department(IdMixin, TimestampMixin, Base):
    __tablename__ = "departments"

    name: Mapped[str] = mapped_column(Text)
    short_name: Mapped[str] = mapped_column(String(50), unique=True)
    settings: Mapped[dict[str, Any]] = mapped_column(default=dict)  # поправки «Ученые», числа записок и т.п.
    argus_cid: Mapped[int | None] = mapped_column()  # cathedras.idcathedra в АРГУСе


class Role(enum.Enum):
    USER = "user"  # просмотр
    DEPUTY = "deputy"  # ЗНК: редактирование своей кафедры
    ADMIN = "admin"  # учётные записи и все данные


class User(IdMixin, TimestampMixin, Base):
    __tablename__ = "users"

    login: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(Text, default="")
    role: Mapped[Role] = mapped_column(_enum(Role), default=Role.USER)
    department_id: Mapped[int | None] = mapped_column(ForeignKey("departments.id", ondelete="SET NULL"))
    # человек из личного состава, которому принадлежит учётка («Только я» в графиках)
    person_id: Mapped[int | None] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"))
    is_active: Mapped[bool] = mapped_column(default=True)


# --- справочники --------------------------------------------------------------------------------


class Rank(IdMixin, DepartmentMixin, Base):
    """Воинские звания: полное → сокращённое (Database!BA:BB)."""

    __tablename__ = "ranks"
    __table_args__ = (UniqueConstraint("department_id", "name"),)

    name: Mapped[str] = mapped_column(Text)
    short: Mapped[str] = mapped_column(Text)
    sort: Mapped[int] = mapped_column(default=0)


class ScienceSpecialty(IdMixin, DepartmentMixin, Base):
    """Научные специальности: шифр → полное название (Database!BD:BE), старый шифр → новый (Инф.!A:B)."""

    __tablename__ = "science_specialties"
    __table_args__ = (UniqueConstraint("department_id", "code"),)

    code: Mapped[str] = mapped_column(Text)
    title: Mapped[str] = mapped_column(Text, default="")
    old_code: Mapped[str | None] = mapped_column(Text)


class Cabinet(IdMixin, DepartmentMixin, Base):
    """Кабинет → рабочий телефон (Database!BG:BH)."""

    __tablename__ = "cabinets"
    __table_args__ = (UniqueConstraint("department_id", "number"),)

    number: Mapped[str] = mapped_column(Text)
    phone: Mapped[str] = mapped_column(Text, default="")


class Holiday(IdMixin, DepartmentMixin, Base):
    """Праздничные дни (Расчетный!P:Q) — выходные в табеле наряду с воскресеньями."""

    __tablename__ = "holidays"
    __table_args__ = (UniqueConstraint("department_id", "day"),)

    day: Mapped[dt.date] = mapped_column(Date)


class OrgUnit(IdMixin, DepartmentMixin, Base):
    """Подразделения академии для статистики нарядов (Стат!L: «1 каф» … «ООНРиПНПК»)."""

    __tablename__ = "org_units"
    __table_args__ = (UniqueConstraint("department_id", "name"),)

    name: Mapped[str] = mapped_column(Text)
    sort: Mapped[int] = mapped_column(default=0)


# --- личный состав --------------------------------------------------------------------------------


class Person(IdMixin, DepartmentMixin, TimestampMixin, Base):
    """Справочник личного состава (лист Database). Производные колонки (G–J, O, R, S, U, AA, AI, AM, AN, AY)
    считаются в kafedra.calc."""

    __tablename__ = "persons"
    __table_args__ = (UniqueConstraint("department_id", "argus_mid"),)

    kind: Mapped[str] = mapped_column(Text, default="")  # A: всл / ГП
    position_short: Mapped[str] = mapped_column(Text, default="")  # B
    position_full: Mapped[str] = mapped_column(Text, default="")  # C
    rank: Mapped[str] = mapped_column(Text, default="")  # D
    full_name: Mapped[str] = mapped_column(Text)  # F
    rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))  # K: ставок
    personal_number: Mapped[str] = mapped_column(Text, default="")  # L
    sex: Mapped[str] = mapped_column(Text, default="")  # M
    birth_date: Mapped[dt.date | None] = mapped_column(Date)  # N
    combat_veteran: Mapped[str] = mapped_column(Text, default="")  # P: вбд
    service_start: Mapped[dt.date | None] = mapped_column(Date)  # Q: в ВС с
    service_bonus_days: Mapped[int] = mapped_column(default=0)  # льготная выслуга (Расчетный, блоки «… выслуга»)
    extra_vacation_days: Mapped[int] = mapped_column(default=0)  # T
    pmk: Mapped[str] = mapped_column(Text, default="")  # V
    pps: Mapped[str] = mapped_column(Text, default="")  # W: «ппс»
    degree: Mapped[str] = mapped_column(Text, default="")  # X: ктн, дтн …
    defense_date: Mapped[str] = mapped_column(Text, default="")  # Y
    science_code: Mapped[str] = mapped_column(Text, default="")  # Z
    academic_title: Mapped[str] = mapped_column(Text, default="")  # AB
    contract_number: Mapped[str] = mapped_column(Text, default="")  # AC
    contract_date: Mapped[str] = mapped_column(Text, default="")  # AD
    contract_addendum: Mapped[str] = mapped_column(Text, default="")  # AE
    appointment_order: Mapped[str] = mapped_column(Text, default="")  # AF
    appointment_order_date: Mapped[str] = mapped_column(Text, default="")  # AG
    cabinet: Mapped[str] = mapped_column(Text, default="")  # AH
    phones: Mapped[list[str]] = mapped_column(JSONB, default=list)  # AJ–AL
    clearance_form: Mapped[str] = mapped_column(Text, default="")  # AP
    clearance: Mapped[str] = mapped_column(Text, default="")  # AQ
    class_rating: Mapped[str] = mapped_column(Text, default="")  # AU: классность
    class_order: Mapped[str] = mapped_column(Text, default="")  # AV
    class_start: Mapped[dt.date | None] = mapped_column(Date)  # AW
    class_term: Mapped[int | None] = mapped_column()  # AX: 6 — полгода, иначе годы
    extra: Mapped[dict[str, Any]] = mapped_column(default=dict)  # разовые колонки («УМО 2024», «8 марта 2025» …)
    sort: Mapped[int] = mapped_column(default=0)
    is_active: Mapped[bool] = mapped_column(default=True)
    # people.mid в АРГУСе: ФИО, звание и ПМК берутся оттуда (kafedra.integration.argus_sync)
    argus_mid: Mapped[int | None] = mapped_column()

    service_periods: Mapped[list[ServicePeriod]] = relationship(back_populates="person", cascade="all, delete-orphan")
    teaching_periods: Mapped[list[TeachingPeriod]] = relationship(back_populates="person", cascade="all, delete-orphan")


class ServicePeriod(IdMixin, Base):
    """Периоды службы для людей с перерывами (Расчетный, блоки «… выслуга»). Пусто — выслуга от Person.service_start."""

    __tablename__ = "service_periods"

    person_id: Mapped[int] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    start: Mapped[dt.date] = mapped_column(Date)
    end: Mapped[dt.date | None] = mapped_column(Date)  # пусто — по дату расчёта
    person: Mapped[Person] = relationship(back_populates="service_periods")


class TeachingPeriod(IdMixin, Base):
    """Педагогический стаж (Сводная!P:T): завершённые периоды и текущий (end пусто)."""

    __tablename__ = "teaching_periods"

    person_id: Mapped[int] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    start: Mapped[dt.date] = mapped_column(Date)
    end: Mapped[dt.date | None] = mapped_column(Date)
    person: Mapped[Person] = relationship(back_populates="teaching_periods")


class Award(IdMixin, Base):
    """Ведомственные награды (Сводная!AN:AO)."""

    __tablename__ = "awards"

    person_id: Mapped[int] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(Text)
    awarded_on: Mapped[dt.date | None] = mapped_column(Date)


# --- табель, отпуска, дежурства ------------------------------------------------------------------


class TimesheetEntry(IdMixin, Base):
    """Код дня табеля (лист «Расход», H5:NH102). Нет записи — день берётся из графика отпусков."""

    __tablename__ = "timesheet_entries"
    __table_args__ = (UniqueConstraint("person_id", "day"),)

    person_id: Mapped[int] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    day: Mapped[dt.date] = mapped_column(Date, index=True)
    code: Mapped[str] = mapped_column(Text)


class VacationPlan(IdMixin, Base):
    """График отпусков человека на год (лист «Отпуска»): части (в книге 4) + сутки на дорогу к одной части."""

    __tablename__ = "vacation_plans"
    __table_args__ = (UniqueConstraint("person_id", "year"),)

    person_id: Mapped[int] = mapped_column(ForeignKey("persons.id", ondelete="CASCADE"), index=True)
    year: Mapped[int]
    road_part: Mapped[int | None]  # V
    road_days: Mapped[int | None]  # W
    parts: Mapped[list[VacationPart]] = relationship(
        back_populates="plan", cascade="all, delete-orphan", order_by="VacationPart.part_no"
    )


class VacationPart(IdMixin, Base):
    __tablename__ = "vacation_parts"
    __table_args__ = (UniqueConstraint("plan_id", "part_no"),)

    plan_id: Mapped[int] = mapped_column(ForeignKey("vacation_plans.id", ondelete="CASCADE"), index=True)
    part_no: Mapped[int]  # 1…4 как в книге, больше — если кафедра добавила части (settings.vacation_parts)
    start: Mapped[dt.date | None] = mapped_column(Date)
    days: Mapped[int | None]
    plan: Mapped[VacationPlan] = relationship(back_populates="parts")


class DutyKind(enum.Enum):
    DEPARTMENT = "department"  # дежурный по кафедре (Дежурства!E)
    DETAIL = "detail"  # наряд (Дежурства!H/J/L с типом I/K/M)


class DutyEntry(IdMixin, DepartmentMixin, Base):
    """График дежурств и нарядов (лист «Дежурства»)."""

    __tablename__ = "duty_entries"
    __table_args__ = (UniqueConstraint("department_id", "day", "kind", "slot"),)

    day: Mapped[dt.date] = mapped_column(Date, index=True)
    kind: Mapped[DutyKind] = mapped_column(_enum(DutyKind))
    slot: Mapped[int] = mapped_column(default=1)  # наряды: 1…3 как в книге, больше — settings.duty_detail_slots
    person_id: Mapped[int | None] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"))
    name_text: Mapped[str] = mapped_column(Text, default="")  # если человека нет в справочнике
    detail_type: Mapped[str] = mapped_column(Text, default="")


class UnitDutyEntry(IdMixin, DepartmentMixin, Base):
    """Наряды подразделений академии по дням (лист «Стат», D:I)."""

    __tablename__ = "unit_duty_entries"
    __table_args__ = (UniqueConstraint("department_id", "day", "duty_type"),)

    day: Mapped[dt.date] = mapped_column(Date, index=True)
    duty_type: Mapped[str] = mapped_column(Text)  # ДА, ПДА, НДС, ДПГ, П79, СтПУ
    unit_id: Mapped[int | None] = mapped_column(ForeignKey("org_units.id", ondelete="SET NULL"))
    unit_text: Mapped[str] = mapped_column(Text, default="")  # исходное значение, если не из списка


# --- штатное расписание ----------------------------------------------------------------------------


class UnitKind(enum.Enum):
    LEADERSHIP = "leadership"  # НК, ЗНК
    PPS_MIL = "pps_mil"  # ППС военнослужащие
    PPS_CIV = "pps_civ"  # ППС гражданский персонал
    AUX = "aux"  # учебные лаборатории и кабинеты


class StaffUnit(IdMixin, DepartmentMixin, Base):
    """Подразделение кафедры в штатном расписании (листы «Структура кафедры», «Сводная»)."""

    __tablename__ = "staff_units"

    kind: Mapped[UnitKind] = mapped_column(_enum(UnitKind))
    title: Mapped[str] = mapped_column(Text)
    people_manual: Mapped[Decimal | None] = mapped_column(Numeric(6, 2))  # «по списку (реально чел.)» — ручной ввод
    sort: Mapped[int] = mapped_column(default=0)
    positions: Mapped[list[StaffPosition]] = relationship(
        back_populates="unit", cascade="all, delete-orphan", order_by="StaffPosition.sort"
    )


class StaffPosition(IdMixin, Base):
    """Штатная должность (или заголовок группы должностей, если is_header)."""

    __tablename__ = "staff_positions"

    unit_id: Mapped[int] = mapped_column(ForeignKey("staff_units.id", ondelete="CASCADE"), index=True)
    is_header: Mapped[bool] = mapped_column(default=False)  # «ПРОФЕССОР», «ДОЦЕНТ» …
    # сверх штата («внештата» на листе «Структура кафедры»): показывается в штате, в итоги и «Сводную» не входит
    out_of_staff: Mapped[bool] = mapped_column(default=False, server_default=false())
    title: Mapped[str] = mapped_column(Text, default="")
    code: Mapped[str] = mapped_column(Text, default="")  # НК, ЗНК, П, Д, СПК, ПК (Сводная!J)
    category: Mapped[str] = mapped_column(Text, default="")  # звание (сокр.) или «ГП» (Сводная!B)
    staff_number: Mapped[str] = mapped_column(Text, default="")  # штатный номер
    vus: Mapped[str] = mapped_column(Text, default="")
    secrecy: Mapped[str] = mapped_column(Text, default="")
    rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    sort: Mapped[int] = mapped_column(default=0)
    unit: Mapped[StaffUnit] = relationship(back_populates="positions")
    assignments: Mapped[list[PositionAssignment]] = relationship(
        back_populates="position", cascade="all, delete-orphan", order_by="PositionAssignment.sort"
    )


class PositionAssignment(IdMixin, Base):
    """Кто занимает должность: человек (на ставку, основное место или совмещение) или «Вакантная»."""

    __tablename__ = "position_assignments"

    position_id: Mapped[int] = mapped_column(ForeignKey("staff_positions.id", ondelete="CASCADE"), index=True)
    person_id: Mapped[int | None] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"))
    name_text: Mapped[str] = mapped_column(Text, default="")  # «Вакантная» или ФИО не из справочника
    rate: Mapped[Decimal | None] = mapped_column(Numeric(4, 2))
    employment: Mapped[str] = mapped_column(Text, default="")  # основное / внутр.совмещ. …
    contract_until: Mapped[str] = mapped_column(Text, default="")
    count_degree: Mapped[bool] = mapped_column(default=True)  # учитывать степень в итогах «Сводной»
    flags: Mapped[dict[str, Any]] = mapped_column(
        default=dict
    )  # Сводная AA…AL (П(ДН), П(КН), Д, ДБУС, СНС, ВБД, ГН, ГПЗ)
    sort: Mapped[int] = mapped_column(default=0)
    position: Mapped[StaffPosition] = relationship(back_populates="assignments")


class PlanYear(IdMixin, DepartmentMixin, Base):
    """План сохранения научного потенциала («Прил. 1»): прирост по годам."""

    __tablename__ = "plan_years"
    __table_args__ = (UniqueConstraint("department_id", "year"),)

    year: Mapped[int]
    appointed: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)  # «назначатся»
    defended: Mapped[Decimal] = mapped_column(Numeric(6, 2), default=0)  # «защитятся»
    pps_rates_text: Mapped[str] = mapped_column(Text, default="")


# --- прочие журналы ----------------------------------------------------------------------------------


class Task(IdMixin, DepartmentMixin, TimestampMixin, Base):
    """Журнал задач (лист «Задачи»)."""

    __tablename__ = "tasks"

    source: Mapped[str] = mapped_column(Text, default="")  # тип: чат, письмо …
    received_on: Mapped[dt.date | None] = mapped_column(Date)
    incoming_number: Mapped[str] = mapped_column(Text, default="")
    content: Mapped[str] = mapped_column(Text, default="")
    issued_by: Mapped[str] = mapped_column(Text, default="")
    due: Mapped[str] = mapped_column(Text, default="")  # бывает «11.12.2024 13.40»
    assigned_to: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(Text, default="")
    outgoing_number: Mapped[str] = mapped_column(Text, default="")


class Veteran(IdMixin, DepartmentMixin, TimestampMixin, Base):
    """Ветераны кафедры (лист «Ветераны»)."""

    __tablename__ = "veterans"

    rank: Mapped[str] = mapped_column(Text, default="")
    full_name: Mapped[str] = mapped_column(Text)
    birth_date: Mapped[dt.date | None] = mapped_column(Date)
    phone_mobile: Mapped[str] = mapped_column(Text, default="")
    phone_city: Mapped[str] = mapped_column(Text, default="")
    address: Mapped[str] = mapped_column(Text, default="")
    workplace: Mapped[str] = mapped_column(Text, default="")
    last_position: Mapped[str] = mapped_column(Text, default="")
    position_start: Mapped[dt.date | None] = mapped_column(Date)
    position_end: Mapped[dt.date | None] = mapped_column(Date)
    academy_start: Mapped[dt.date | None] = mapped_column(Date)
    army_start: Mapped[dt.date | None] = mapped_column(Date)


class AssignmentSection(enum.Enum):
    WORKLOAD = "workload"  # выполняемая нагрузка → ответственные
    DAILY_DUTY = "daily_duty"  # суточный наряд → кто заступает
    SHIFT = "shift"  # дежурства → периоды


class AssignmentList(IdMixin, DepartmentMixin, Base):
    """Лист «Обязанности»: группа (нагрузка, роль суточного наряда, место дежурства) и её участники."""

    __tablename__ = "assignment_lists"

    section: Mapped[AssignmentSection] = mapped_column(_enum(AssignmentSection))
    title: Mapped[str] = mapped_column(Text, default="")
    duty_type: Mapped[str] = mapped_column(Text, default="", server_default="")  # суточный наряд: вид в графике (ДА, П79…)
    sort: Mapped[int] = mapped_column(default=0)
    members: Mapped[list[AssignmentMember]] = relationship(
        back_populates="list", cascade="all, delete-orphan", order_by="AssignmentMember.sort"
    )


class AssignmentMember(IdMixin, Base):
    __tablename__ = "assignment_members"

    list_id: Mapped[int] = mapped_column(ForeignKey("assignment_lists.id", ondelete="CASCADE"), index=True)
    person_id: Mapped[int | None] = mapped_column(ForeignKey("persons.id", ondelete="SET NULL"))
    rank_text: Mapped[str] = mapped_column(Text, default="")
    name_text: Mapped[str] = mapped_column(Text, default="")
    period1_start: Mapped[dt.date | None] = mapped_column(Date)  # O/P
    period1_days: Mapped[int | None]
    period2_start: Mapped[dt.date | None] = mapped_column(Date)  # R/S
    period2_days: Mapped[int | None]
    sort: Mapped[int] = mapped_column(default=0)
    list: Mapped[AssignmentList] = relationship(back_populates="members")


class UserSession(IdMixin, Base):
    """Сессия входа: в БД только SHA-256 токена (сам токен — в HttpOnly-cookie браузера)."""

    __tablename__ = "user_sessions"

    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    # вход через АРГУС: SHA-256 токена АРГУСа, по которому открыта сессия (null — вход по паролю)
    argus_token_hash: Mapped[str | None] = mapped_column(String(64))
    user: Mapped[User] = relationship()


class ArgusToken(Base):
    """Успешный вход в АРГУС (пароль проверил сервер АРГУСа в AD): SHA-256 его токена → доменный логин.

    Общая для всех кафедр, как и сессии: по логину находится учётка, а у неё уже есть кафедра.
    """

    __tablename__ = "argus_tokens"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    login: Mapped[str] = mapped_column(String(64))  # нормализованный: без домена, строчными
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), index=True)
