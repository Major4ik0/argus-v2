# -*- coding: utf-8 -*-
import os
import io
import time
import base64
import cv2
import numpy as np
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File, Form, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse, FileResponse, Response
import asyncpg

from ...core.database import get_db_connection, pool
from ...schemas.kiosk import (
    KioskSettingsSchema,
    TeacherBiometricStatusItem,
    BiometricsUploadResponse,
    KioskStatsSummary,
    TeacherWeeklyScheduleResponse,
    CarouselScheduleResponse,
    CameraSnapshotResponse,
)
from ...repositories.kiosk import KioskRepository
from ...services.camera import camera_service as face_recognition_service, PHOTOS_DIR

router = APIRouter()


@router.get("/video_feed", summary="MJPEG видеопоток с камеры")
def video_feed():
    """Синхронный стриминг живого видеопотока с камеры (не блокирует event loop)."""
    return StreamingResponse(
        face_recognition_service.generate_mjpeg_stream(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@router.get("/video-feed", include_in_schema=False)
def get_video_feed_alias():
    return video_feed()


@router.post("/camera/snapshot", response_model=CameraSnapshotResponse, summary="Захват текущего кадра с камеры")
async def take_camera_snapshot():
    """Захватывает чистый кадр (raw_frame) с камеры без рамок в формате Base64 JPEG."""
    jpeg_bytes = face_recognition_service.get_raw_snapshot_jpeg()
    if not jpeg_bytes:
        return CameraSnapshotResponse(
            success=False,
            message="Камера недоступна или не сформировала кадр",
        )
    b64_str = base64.b64encode(jpeg_bytes).decode("utf-8")
    return CameraSnapshotResponse(
        success=True,
        image_base64=f"data:image/jpeg;base64,{b64_str}",
        message="Снимок успешно захвачен",
    )


@router.post("/camera/snapshot/{teacher_id}", response_model=BiometricsUploadResponse, summary="Сделать снимок с камеры и привязать к преподавателю")
async def take_snapshot_for_teacher(
    teacher_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Захватывает чистый кадр с камеры, вычисляет 512-D вектор ArcFace и сохраняет профиль преподавателя."""
    repo = KioskRepository(conn)
    t_name = await conn.fetchval(
        "SELECT TRIM(CONCAT_WS(' ', lastname, firstname, patronymic)) FROM public.people WHERE mid = $1;",
        teacher_id,
    ) or f"Преподаватель #{teacher_id}"

    success, msg, emb_bytes, photo_fn = face_recognition_service.save_snapshot(teacher_id, full_name=t_name)
    if not success or not emb_bytes or not photo_fn:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=msg or "Не удалось сформировать снимок с камеры",
        )

    await repo.save_biometrics(teacher_id, photo_fn, emb_bytes)
    return BiometricsUploadResponse(
        success=True,
        message=f"Снимок с камеры успешно привязан к преподавателю #{teacher_id}",
        teacher_id=teacher_id,
        photo_url=f"/api/v1/kiosk/photos/{teacher_id}",
        embedding_size=512,
    )


@router.post("/biometrics/upload/{teacher_id}", response_model=BiometricsUploadResponse, summary="Загрузить фото преподавателя из файла")
async def upload_teacher_biometrics_file(
    teacher_id: int,
    file: UploadFile = File(...),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Алиас для загрузки фотографии с диска."""
    return await upload_teacher_biometrics(teacher_id=teacher_id, file=file, use_camera_snapshot=False, conn=conn)


@router.post("/biometrics/{teacher_id}", response_model=BiometricsUploadResponse, summary="Сохранить фото и рассчитать биометрию")
async def upload_teacher_biometrics(
    teacher_id: int,
    file: Optional[UploadFile] = File(None),
    use_camera_snapshot: bool = Form(False),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """
    Привязка биометрического профиля к преподавателю:
    - Загрузка изображения из файла (JPEG/PNG)
    - Либо моментальный снимок с камеры терминала
    - Расчет 512-мерного эмбеддинга ArcFace и сохранение в teacher_biometrics.
    """
    img_bgr = None

    if use_camera_snapshot:
        raw_frame = face_recognition_service.get_raw_snapshot()
        if raw_frame is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Не удалось получить снимок с камеры (камера отключена)",
            )
        img_bgr = raw_frame
    elif file is not None:
        file_bytes = await file.read()
        nparr = np.frombuffer(file_bytes, np.uint8)
        img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img_bgr is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Не удалось декодировать файл изображения",
            )
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Необходимо прикрепить файл или включить флаг снимка с камеры",
        )

    # Вычисляем 128-D L2-нормализованный эмбеддинг SFace
    embedding_bytes, bbox = face_recognition_service.compute_embedding_from_image(img_bgr)
    vec = np.frombuffer(embedding_bytes[:512], dtype=np.float32)
    if np.linalg.norm(vec) < 1e-6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Лицо не обнаружено на изображении. Пожалуйста, выберите четкую портретную фотографию",
        )

    # Сохраняем фото на диск
    photo_filename = f"teacher_{teacher_id}.jpg"
    photo_path = os.path.join(PHOTOS_DIR, photo_filename)
    cv2.imwrite(photo_path, img_bgr, [cv2.IMWRITE_JPEG_QUALITY, 95])

    # Сохраняем в базу данных
    repo = KioskRepository(conn)
    await repo.save_biometrics(teacher_id, photo_filename, embedding_bytes)

    # Обновляем кэш эмбеддингов в памяти сервиса
    all_embs = await repo.get_all_embeddings()
    face_recognition_service.reload_embeddings(all_embs)

    return BiometricsUploadResponse(
        success=True,
        message=f"Биометрический профиль преподавателя #{teacher_id} успешно сохранен",
        teacher_id=teacher_id,
        photo_url=f"/api/v1/kiosk/photos/{teacher_id}",
        embedding_size=512,
    )


@router.delete("/biometrics/{teacher_id}", summary="Удалить биометрию преподавателя")
async def delete_teacher_biometrics(
    teacher_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Удаляет фото и вектор биометрии преподавателя с диска, из базы и из памяти."""
    repo = KioskRepository(conn)
    photo_filename = await repo.get_biometric_photo_path(teacher_id)

    success = await repo.delete_biometrics(teacher_id)

    # 1. Физическое удаление файла с диска
    if photo_filename:
        full_path = os.path.join(PHOTOS_DIR, photo_filename)
        if os.path.exists(full_path):
            try:
                os.remove(full_path)
            except Exception:
                pass

    default_photo = os.path.join(PHOTOS_DIR, f"teacher_{teacher_id}.jpg")
    if os.path.exists(default_photo):
        try:
            os.remove(default_photo)
        except Exception:
            pass

    # 2. Удаление из памяти камеры
    with face_recognition_service._teachers_lock:
        face_recognition_service.known_teachers = [
            t for t in face_recognition_service.known_teachers if t["teacher_id"] != teacher_id
        ]

    # 3. Полная перезагрузка базы биометрии
    all_embs = await repo.get_all_embeddings()
    face_recognition_service.reload_embeddings(all_embs)

    return {"status": "ok", "message": f"Биометрия преподавателя #{teacher_id} полностью удалена", "deleted": success}


@router.get("/biometrics/status", response_model=List[TeacherBiometricStatusItem], summary="Статус биометрии всех преподавателей")
async def get_teachers_biometrics_status(
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Возвращает список преподавателей с отметкой о наличии фото и эмбеддинга."""
    repo = KioskRepository(conn)
    return await repo.get_teacher_biometrics_status()


@router.get("/teachers-biometrics", response_model=List[TeacherBiometricStatusItem], summary="Список преподавателей с биометрией и визитами", include_in_schema=False)
async def get_teachers_biometrics_alias(
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    return await get_teachers_biometrics_status(conn=conn)


@router.get("/photos/{teacher_id}", summary="Получить фото преподавателя")
async def get_teacher_photo(
    teacher_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Отдает сохраненную фотографию преподавателя либо SVG заглушку с отключением HTTP-кэширования."""
    repo = KioskRepository(conn)
    photo_filename = await repo.get_biometric_photo_path(teacher_id)

    no_cache_headers = {
        "Cache-Control": "no-cache, no-store, must-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
    }

    if photo_filename:
        photo_full_path = os.path.join(PHOTOS_DIR, photo_filename)
        if os.path.exists(photo_full_path):
            return FileResponse(photo_full_path, media_type="image/jpeg", headers=no_cache_headers)

    # SVG заглушка
    svg_data = """<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"></path>
        <circle cx="12" cy="7" r="4"></circle>
    </svg>"""
    return Response(content=svg_data, media_type="image/svg+xml", headers=no_cache_headers)


@router.get("/settings", response_model=KioskSettingsSchema, summary="Получить настройки терминала")
async def get_kiosk_settings(
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Текущие настройки камеры, порога распознавания и таймеров."""
    repo = KioskRepository(conn)
    return await repo.get_settings()


@router.put("/settings", response_model=KioskSettingsSchema, summary="Обновить настройки терминала")
async def update_kiosk_settings(
    payload: KioskSettingsSchema,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Обновление параметров камеры и табло с авто-перезапуском видеопотока при необходимости."""
    repo = KioskRepository(conn)
    old_settings = await repo.get_settings()
    updated = await repo.update_settings(payload.model_dump())

    # Если изменились параметры камеры или активности, перезапускаем сервис
    if (
        str(old_settings.get("camera_source")) != str(updated.get("camera_source"))
        or old_settings.get("is_active") != updated.get("is_active")
    ):
        face_recognition_service.restart_camera(
            camera_source=str(updated.get("camera_source", "0")),
            threshold=float(updated.get("recognition_threshold", 0.32)),
            idle_timeout=int(updated.get("idle_timeout", 6)),
            is_active=bool(updated.get("is_active", True)),
            flip_horizontal=bool(updated.get("camera_flip", False)),
        )
    else:
        face_recognition_service.recognition_threshold = float(updated.get("recognition_threshold", 0.32))
        face_recognition_service.idle_timeout = int(updated.get("idle_timeout", 6))
        face_recognition_service.is_active = bool(updated.get("is_active", True))
        face_recognition_service.set_flip_horizontal(bool(updated.get("camera_flip", False)))

    return updated


@router.get("/stats", response_model=KioskStatsSummary, summary="Сводная статистика работы табло")
async def get_kiosk_stats(
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Счетчики подходов за сегодня, неделю, топ преподавателей и журнал фиксаций."""
    repo = KioskRepository(conn)
    return await repo.get_stats()


@router.get("/teacher-schedule/{teacher_id}", response_model=TeacherWeeklyScheduleResponse, summary="Недельное расписание преподавателя")
async def get_teacher_kiosk_schedule(
    teacher_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Персональное расписание на текущую неделю для отображения на табло при подходе преподавателя."""
    repo = KioskRepository(conn)
    return await repo.get_teacher_weekly_schedule(teacher_id)


@router.get("/personal-schedule/{teacher_id}", response_model=TeacherWeeklyScheduleResponse, summary="Персональное расписание преподавателя", include_in_schema=False)
async def get_personal_schedule_alias(
    teacher_id: int,
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    return await get_teacher_kiosk_schedule(teacher_id=teacher_id, conn=conn)


@router.get("/carousel-schedule", response_model=CarouselScheduleResponse, summary="Расписание для карусели инфотабло")
async def get_carousel_kiosk_schedule(
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    """Агрегированное расписание кафедры для циклического показа в режиме ожидания."""
    repo = KioskRepository(conn)
    return await repo.get_carousel_schedule()


@router.websocket("/ws")
async def kiosk_websocket_endpoint(websocket: WebSocket):
    """
    WebSocket канал для информационного табло.
    Сервер мгновенно отправляет события при распознавании преподавателя:
    { "event": "TEACHER_DETECTED", "teacher_id": 38, "teacher_name": "Иванов И.И." }
    или при потере лица:
    { "event": "TIMEOUT_EXPIRED" }
    """
    await face_recognition_service.ws_manager.connect(websocket)
    try:
        await websocket.send_json({
            "event": "CONNECTED",
            "message": "Камера и видеоаналитика активны",
        })
        while True:
            # Поддерживаем соединение и принимаем пинги / команды от фронтенда
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        face_recognition_service.ws_manager.disconnect(websocket)
    except Exception:
        face_recognition_service.ws_manager.disconnect(websocket)
