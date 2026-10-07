# -*- coding: utf-8 -*-
import hashlib
from typing import List, Dict, Optional
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
import asyncpg

from ...core.database import get_db_connection

router = APIRouter()

# Статическая палитра из старого проекта
DEFAULT_PALETTE = [
    "#4E79A7", "#F28E2B", "#E15759", "#76B7B2", "#59A14F", "#EDC948",
    "#B07AA1", "#FF9DA7", "#9C755F", "#BAB0AC", "#2E91E5", "#E15F99"
]

FACULTY_COLORS = {
    37: "#F19CBB",
    41: "#F19CBB",
    42: "#396a42",
    40: "#E5BE01",
    39: "#42AAFF",
}




def hash_string_to_int(text: str) -> int:
    """Аналог hash_string из старого проекта для стабильного выбора цвета."""
    return int(hashlib.md5(text.encode('utf-8')).hexdigest(), 16)


class TeachersColorsRequest(BaseModel):
    teachers: List[str]
    palette_size: Optional[int] = 12


@router.get("/palette/{num_teachers}")
async def get_palette(num_teachers: int):
    palette = DEFAULT_PALETTE[:min(num_teachers, len(DEFAULT_PALETTE))]
    return {"palette": palette, "count": len(palette)}


@router.get("/teacher/{teacher_name}")
async def get_teacher_color(teacher_name: str):
    h = hash_string_to_int(teacher_name)
    color_index = h % len(DEFAULT_PALETTE)
    return {
        "teacher_name": teacher_name,
        "color": DEFAULT_PALETTE[color_index],
        "teacher_id": f"t-{h}",
        "color_index": color_index,
    }


@router.post("/teachers-colors")
async def get_teachers_colors(payload: TeachersColorsRequest):
    result = {}
    for teacher in payload.teachers:
        h = hash_string_to_int(teacher)
        color_index = h % len(DEFAULT_PALETTE)
        result[teacher] = {
            "color": DEFAULT_PALETTE[color_index],
            "teacher_id": f"t-{h}",
        }
    return result


async def init_faculty_colors_table(conn: asyncpg.Connection):
    """Автоматическое создание и первичное наполнение таблицы цветов факультетов."""
    await conn.execute("""
        CREATE TABLE IF NOT EXISTS public.faculty_colors (
            idfaculty INTEGER PRIMARY KEY,
            color VARCHAR(32) NOT NULL
        );
    """)

    # Проверяем, есть ли уже записи
    count = await conn.fetchval("SELECT COUNT(*) FROM public.faculty_colors;")
    if count == 0:
        for f_id, col in FACULTY_COLORS.items():
            await conn.execute(
                "INSERT INTO public.faculty_colors (idfaculty, color) VALUES ($1, $2) ON CONFLICT DO NOTHING;",
                f_id, col
            )

class FacultyColorItem(BaseModel):
    idfaculty: int
    name: str
    short_name: str
    color: str


class UpdateFacultyColorRequest(BaseModel):
    idfaculty: int = Field(..., description="ID факультета")
    color: str = Field(..., description="HEX код цвета (например, #F19CBB)")


@router.get("/faculties", response_model=List[FacultyColorItem], summary="Получить список всех факультетов с их цветами")
async def get_all_faculty_colors(conn: asyncpg.Connection = Depends(get_db_connection)):
    """
    Возвращает список всех факультетов из таблицы fuculty вместе с назначенными цветами.
    Если для факультета цвет еще не выбран — выдается дефолтный #6366F1.
    """
    await init_faculty_colors_table(conn)

    sql = """
        SELECT 
            f.idfaculty,
            COALESCE(f.faculty, 'Факультет ' || f.idfaculty::text) AS name,
            COALESCE(f."shortName", f.faculty, f.idfaculty::text) AS short_name,
            COALESCE(fc.color, '#6366F1') AS color
        FROM public.fuculty f
        LEFT JOIN public.faculty_colors fc ON f.idfaculty = fc.idfaculty
        ORDER BY f.idfaculty;
    """
    rows = await conn.fetch(sql)
    return [dict(r) for r in rows]


@router.put("/faculties/{idfaculty}", summary="Обновить или назначить цвет факультету")
async def update_faculty_color(
    idfaculty: int,
    payload: UpdateFacultyColorRequest,
    conn: asyncpg.Connection = Depends(get_db_connection)
):
    """Сохранение нового цвета факультета в БД."""
    await init_faculty_colors_table(conn)

    sql = """
        INSERT INTO public.faculty_colors (idfaculty, color)
        VALUES ($1, $2)
        ON CONFLICT (idfaculty) 
        DO UPDATE SET color = EXCLUDED.color;
    """
    await conn.execute(sql, idfaculty, payload.color)
    return {"success": True, "idfaculty": idfaculty, "color": payload.color}


@router.get("/getColorAtGroup/{group_name:path}", summary="Оригинальный эндпоинт цвета группы (динамический)")
async def get_color_at_group(
    group_name: str,
    conn: asyncpg.Connection = Depends(get_db_connection)
):
    await init_faculty_colors_table(conn)

    sql = """
        SELECT fc.color
        FROM public.groupname g
        LEFT JOIN public.faculty_colors fc ON g.idfaculty = fc.idfaculty
        WHERE g.name = $1
        LIMIT 1;
    """
    color = await conn.fetchval(sql, group_name)
    return color or "#6366F1"