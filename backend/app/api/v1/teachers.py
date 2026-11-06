# -*- coding: utf-8 -*-
import os
import time
import uuid
from typing import List, Optional
import cv2
import numpy as np
import asyncpg
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, status
from pydantic import BaseModel

from ...core.database import get_db_connection, pool as db_pool
from ...services.camera import camera_service

router = APIRouter()

# Директория для сохранения фотографий преподавателей
BASE_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../.."))
UPLOAD_DIR = os.path.join(BASE_BACKEND_DIR, "uploads")
TEACHERS_UPLOADS_DIR = os.path.join(UPLOAD_DIR, "teachers")
os.makedirs(TEACHERS_UPLOADS_DIR, exist_ok=True)


class TeacherPhotoItem(BaseModel):
    id: int
    url: str
    is_primary: bool
    created_at: str


class PhotoActionResponse(BaseModel):
    success: bool
    message: str


def format_photo_url(file_path: str) -> str:
    """Формирование гарантированно проксируемого URL через /api/v1/uploads."""
    if not file_path:
        return ""
    if file_path.startswith("http://") or file_path.startswith("https://"):
        return file_path
    if file_path.startswith("/api/v1/uploads/"):
        return file_path
    if file_path.startswith("api/v1/uploads/"):
        return f"/{file_path}"
    if file_path.startswith("/uploads/"):
        return f"/api/v1{file_path}"
    if file_path.startswith("uploads/"):
        return f"/api/v1/{file_path}"
    if file_path.startswith("teachers/"):
        return f"/api/v1/uploads/{file_path}"
    return f"/api/v1/uploads/teachers/{file_path}"


def resolve_local_photo_path(file_path: str) -> Optional[str]:
    """Поиск физического файла на диске в возможных директориях uploads."""
    if not file_path:
        return None
    basename = os.path.basename(file_path)
    candidates = [
        os.path.join(TEACHERS_UPLOADS_DIR, basename),
        os.path.join(UPLOAD_DIR, "teachers", basename),
        os.path.join(UPLOAD_DIR, "photos", basename),
        os.path.join(UPLOAD_DIR, file_path.lstrip("/")),
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    return None


@router.get("/{teacher_id}/photos", response_model=List[TeacherPhotoItem], summary="Список всех фотографий преподавателя")
async def get_teacher_photos(
    teacher_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Возвращает список всех фотографий преподавателя с отметкой об основной."""
    rows = await conn.fetch(
        """
        SELECT id, file_path, is_primary, created_at
        FROM public.teacher_photos
        WHERE teacher_id = $1
        ORDER BY is_primary DESC, created_at DESC;
        """,
        teacher_id,
    )

    items = []
    for r in rows:
        created_str = r["created_at"].isoformat() if r["created_at"] else ""
        items.append({
            "id": r["id"],
            "url": format_photo_url(r["file_path"]),
            "is_primary": bool(r["is_primary"]),
            "created_at": created_str,
        })
    return items


@router.post("/{teacher_id}/photos", response_model=TeacherPhotoItem, status_code=status.HTTP_201_CREATED, summary="Загрузить фотографию преподавателя")
async def upload_teacher_photo(
    teacher_id: int,
    file: UploadFile = File(...),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """
    Загрузка нового снимка преподавателя:
    1. Сохраняет оригинальные сырые байты файла напрямую на диск без искажений.
    2. Прогоняет через детектор InsightFace SCRFD и экстрактор ArcFace.
    3. При отсутствии лица удаляет файл и возвращает ошибку 400.
    4. Записывает 512-мерный вектор в public.teacher_photos.
    5. Если это первая фотография, выставляет is_primary = TRUE.
    6. Обновляет кэш биометрии в памяти без перезапуска сервера.
    """
    # Проверка существования преподавателя
    teacher_exists = await conn.fetchval(
        "SELECT mid FROM public.people WHERE mid = $1", teacher_id
    )
    if not teacher_exists:
        raise HTTPException(status_code=404, detail=f"Преподаватель #{teacher_id} не найден в базе данных")

    file_ext = os.path.splitext(file.filename or "")[1].lower() or ".jpg"
    if file_ext not in [".jpg", ".jpeg", ".png"]:
        file_ext = ".jpg"

    unique_filename = f"{teacher_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}{file_ext}"
    dest_path = os.path.join(TEACHERS_UPLOADS_DIR, unique_filename)

    # 1. Сохранение сырых оригинальных байтов файла напрямую на диск
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Файл пуст")

    with open(dest_path, "wb") as f:
        f.write(content)

    # 2. Декодирование для работы детектора InsightFace
    nparr = np.frombuffer(content, np.uint8)
    image_np = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if image_np is None or image_np.size == 0:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        raise HTTPException(status_code=400, detail="Не удалось декодировать изображение. Поддерживаются форматы JPEG и PNG.")

    # 3. Извлечение лица и вычисление 512-D вектора ArcFace
    emb_bytes, bbox = camera_service.compute_embedding_from_image(image_np)
    vec = np.frombuffer(emb_bytes, dtype=np.float32)
    norm = float(np.linalg.norm(vec))

    if norm <= 1e-6:
        if os.path.exists(dest_path):
            os.remove(dest_path)
        raise HTTPException(status_code=400, detail="Лицо на фотографии не обнаружено")

    # Проверка наличия уже существующих фото для определения primary
    existing_count = await conn.fetchval(
        "SELECT COUNT(*) FROM public.teacher_photos WHERE teacher_id = $1", teacher_id
    )
    is_primary = (existing_count == 0)

    # Сохранение записи в teacher_photos с гарантированным web URL
    web_url = f"/api/v1/uploads/teachers/{unique_filename}"
    row = await conn.fetchrow(
        """
        INSERT INTO public.teacher_photos (teacher_id, file_path, embedding, is_primary, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING id, created_at;
        """,
        teacher_id,
        web_url,
        emb_bytes,
        is_primary,
    )

    photo_id = row["id"]
    created_at_str = row["created_at"].isoformat() if row["created_at"] else ""

    # Синхронизация с teacher_biometrics для обратной совместимости
    if is_primary:
        await conn.execute(
            """
            INSERT INTO public.teacher_biometrics (teacher_id, photo_path, embedding, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (teacher_id) DO UPDATE SET
                photo_path = EXCLUDED.photo_path,
                embedding = EXCLUDED.embedding,
                updated_at = NOW();
            """,
            teacher_id,
            unique_filename,
            emb_bytes,
        )

    # Обновление рабочего кэша биометрии в памяти камеры без перезапуска сервера
    active_pool = db_pool
    if active_pool:
        await camera_service.load_biometrics_from_db(active_pool)

    return {
        "id": photo_id,
        "url": web_url,
        "is_primary": is_primary,
        "created_at": created_at_str,
    }


@router.post("/{teacher_id}/snapshot", response_model=TeacherPhotoItem, status_code=status.HTTP_201_CREATED, summary="Сделать снимок с камеры киоска и добавить в галерею")
@router.post("/{teacher_id}/photos/capture", response_model=TeacherPhotoItem, status_code=status.HTTP_201_CREATED, summary="Сделать снимок с камеры киоска и добавить в галерею (алиас)")
async def capture_snapshot_for_teacher(
    teacher_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Захватывает текущий кадр с камеры терминала, вычисляет ArcFace вектор и сохраняет фото."""
    teacher_exists = await conn.fetchval(
        "SELECT mid FROM public.people WHERE mid = $1", teacher_id
    )
    if not teacher_exists:
        raise HTTPException(status_code=404, detail=f"Преподаватель #{teacher_id} не найден в базе данных")

    raw = camera_service.get_raw_snapshot()
    if raw is None or not isinstance(raw, np.ndarray) or raw.size == 0:
        raise HTTPException(status_code=503, detail="Камера отключена или не захватила кадр")

    if raw.dtype != np.uint8:
        raw = raw.astype(np.uint8)
    if len(raw.shape) == 2:
        raw = cv2.cvtColor(raw, cv2.COLOR_GRAY2BGR)

    emb_bytes, bbox = camera_service.compute_embedding_from_image(raw)
    vec = np.frombuffer(emb_bytes, dtype=np.float32)
    norm = float(np.linalg.norm(vec))

    if norm <= 1e-6:
        raise HTTPException(status_code=400, detail="Лицо на фотографии не обнаружено")

    unique_filename = f"{teacher_id}_{int(time.time())}_{uuid.uuid4().hex[:6]}.jpg"
    dest_path = os.path.join(TEACHERS_UPLOADS_DIR, unique_filename)

    cv2.imwrite(dest_path, raw, [int(cv2.IMWRITE_JPEG_QUALITY), 95])

    existing_count = await conn.fetchval(
        "SELECT COUNT(*) FROM public.teacher_photos WHERE teacher_id = $1", teacher_id
    )
    is_primary = (existing_count == 0)

    web_url = f"/api/v1/uploads/teachers/{unique_filename}"
    row = await conn.fetchrow(
        """
        INSERT INTO public.teacher_photos (teacher_id, file_path, embedding, is_primary, created_at)
        VALUES ($1, $2, $3, $4, NOW())
        RETURNING id, created_at;
        """,
        teacher_id,
        web_url,
        emb_bytes,
        is_primary,
    )

    photo_id = row["id"]
    created_at_str = row["created_at"].isoformat() if row["created_at"] else ""

    if is_primary:
        await conn.execute(
            """
            INSERT INTO public.teacher_biometrics (teacher_id, photo_path, embedding, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (teacher_id) DO UPDATE SET
                photo_path = EXCLUDED.photo_path,
                embedding = EXCLUDED.embedding,
                updated_at = NOW();
            """,
            teacher_id,
            unique_filename,
            emb_bytes,
        )

    active_pool = db_pool
    if active_pool:
        await camera_service.load_biometrics_from_db(active_pool)

    return {
        "id": photo_id,
        "url": web_url,
        "is_primary": is_primary,
        "created_at": created_at_str,
    }


@router.put("/photos/{photo_id}/set-primary", response_model=PhotoActionResponse, summary="Назначить фотографию основной")
async def set_primary_photo(
    photo_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """
    Назначает выбранную фотографию основной:
    1. Сбрасывает is_primary = FALSE у всех остальных фото преподавателя.
    2. Выставляет is_primary = TRUE у выбранной фотографии.
    3. Синхронизирует профиль с teacher_biometrics.
    4. Обновляет кэш распознавания в сервисе камеры.
    """
    row = await conn.fetchrow(
        "SELECT id, teacher_id, file_path, embedding FROM public.teacher_photos WHERE id = $1", photo_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Фотография не найдена")

    teacher_id = row["teacher_id"]
    file_path = row["file_path"]
    emb_bytes = row["embedding"]

    async with conn.transaction():
        await conn.execute(
            "UPDATE public.teacher_photos SET is_primary = FALSE WHERE teacher_id = $1", teacher_id
        )
        await conn.execute(
            "UPDATE public.teacher_photos SET is_primary = TRUE WHERE id = $1", photo_id
        )
        filename = os.path.basename(file_path)
        await conn.execute(
            """
            INSERT INTO public.teacher_biometrics (teacher_id, photo_path, embedding, updated_at)
            VALUES ($1, $2, $3, NOW())
            ON CONFLICT (teacher_id) DO UPDATE SET
                photo_path = EXCLUDED.photo_path,
                embedding = EXCLUDED.embedding,
                updated_at = NOW();
            """,
            teacher_id,
            filename,
            emb_bytes,
        )

    active_pool = db_pool
    if active_pool:
        await camera_service.load_biometrics_from_db(active_pool)

    return PhotoActionResponse(success=True, message="Основная фотография успешно обновлена")


@router.delete("/photos/{photo_id}", response_model=PhotoActionResponse, summary="Удалить фотографию преподавателя")
async def delete_teacher_photo(
    photo_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """
    Удаляет фотографию с диска и из базы данных:
    1. Удаляет файл из директории uploads/teachers/.
    2. Удаляет запись из public.teacher_photos.
    3. Если удаляемое фото было основным, автоматически назначает основным любое оставшееся фото.
    4. Если фото не осталось, удаляет профиль из teacher_biometrics.
    5. Обновляет кэш распознавания в сервисе камеры.
    """
    row = await conn.fetchrow(
        "SELECT id, teacher_id, file_path, is_primary FROM public.teacher_photos WHERE id = $1", photo_id
    )
    if not row:
        raise HTTPException(status_code=404, detail="Фотография не найдена")

    teacher_id = row["teacher_id"]
    file_path = row["file_path"]
    was_primary = bool(row["is_primary"])

    # Физическое удаление файла с диска
    disk_path = resolve_local_photo_path(file_path)
    if disk_path and os.path.exists(disk_path):
        try:
            os.remove(disk_path)
        except Exception:
            pass

    async with conn.transaction():
        await conn.execute("DELETE FROM public.teacher_photos WHERE id = $1", photo_id)

        if was_primary:
            # Назначаем основным любое оставшееся фото
            next_row = await conn.fetchrow(
                """
                SELECT id, file_path, embedding
                FROM public.teacher_photos
                WHERE teacher_id = $1
                ORDER BY created_at DESC
                LIMIT 1;
                """,
                teacher_id,
            )
            if next_row:
                await conn.execute(
                    "UPDATE public.teacher_photos SET is_primary = TRUE WHERE id = $1", next_row["id"]
                )
                filename = os.path.basename(next_row["file_path"])
                await conn.execute(
                    """
                    INSERT INTO public.teacher_biometrics (teacher_id, photo_path, embedding, updated_at)
                    VALUES ($1, $2, $3, NOW())
                    ON CONFLICT (teacher_id) DO UPDATE SET
                        photo_path = EXCLUDED.photo_path,
                        embedding = EXCLUDED.embedding,
                        updated_at = NOW();
                    """,
                    teacher_id,
                    filename,
                    next_row["embedding"],
                )
            else:
                # Фотографий больше нет
                await conn.execute("DELETE FROM public.teacher_biometrics WHERE teacher_id = $1", teacher_id)

    active_pool = db_pool
    if active_pool:
        await camera_service.load_biometrics_from_db(active_pool)

    return PhotoActionResponse(success=True, message="Фотография успешно удалена")
