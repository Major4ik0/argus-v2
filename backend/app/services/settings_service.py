# -*- coding: utf-8 -*-
import json
import logging
import asyncio
from typing import Dict, Any, Optional
import asyncpg
from pydantic import BaseModel, Field, ConfigDict

from ..core import database as db_module
from .camera import camera_service as face_recognition_service

logger = logging.getLogger("argus.settings")

DEFAULT_SETTINGS: Dict[str, Any] = {
    "carousel_interval": 6,
    "carousel_active": True,
    "start_day_mode": "monday",
    "font_scale_display": "normal",
    "font_scale_schedule": "normal",
    "camera_source": "0",
    "camera_similarity_threshold": 0.45,
    "camera_mirror": True,
    "ticker_text": "",
    "ticker_active": False,
    "night_mode_enabled": False,
    "night_mode_start": "21:00",
    "night_mode_end": "07:30",
    # Обратная совместимость и алиасы
    "recognition_threshold": 0.45,
    "similarity_threshold": 0.45,
    "camera_flip": True,
    "font_scale": "normal",
    "idle_timeout": 6,
    "person_timeout": 20,
    "is_active": True,
    "active": True,
}


class UnifiedConfigSchema(BaseModel):
    carousel_interval: int = Field(default=6, ge=3, le=60, description="Интервал автопрокрутки (3-60 сек)")
    carousel_active: bool = Field(default=True, description="Флаг активности автопрокрутки")
    start_day_mode: str = Field(default="monday", description="Режим отображения дней: monday или today")
    font_scale_display: str = Field(default="normal", description="Размер шрифта табло: compact, normal, large")
    font_scale_schedule: str = Field(default="normal", description="Размер шрифта расписания: compact, normal, large")
    camera_source: str = Field(default="0", description="Источник камеры (индекс 0, 1 или RTSP URL)")
    camera_similarity_threshold: float = Field(default=0.45, ge=0.20, le=0.90, description="Порог схожести ArcFace")
    camera_mirror: bool = Field(default=True, description="Зеркалирование видео (Flip)")
    ticker_text: str = Field(default="", description="Текст бегущей строки объявлений")
    ticker_active: bool = Field(default=False, description="Активность бегущей строки")
    night_mode_enabled: bool = Field(default=False, description="Ночной режим / энергосбережение")
    night_mode_start: str = Field(default="21:00", description="Время отключения экрана (HH:MM)")
    night_mode_end: str = Field(default="07:30", description="Время включения экрана (HH:MM)")

    # Алиасы для обратной совместимости
    recognition_threshold: Optional[float] = None
    similarity_threshold: Optional[float] = None
    camera_flip: Optional[bool] = None
    font_scale: Optional[str] = None
    idle_timeout: Optional[int] = None
    is_active: Optional[bool] = None

    model_config = ConfigDict(extra="ignore")


class SettingsService:
    """
    Единый сервис конфигурации терминала и камеры.
    Работает с таблицей public.kiosk_settings (key TEXT PRIMARY KEY, value TEXT).
    Гарантирует отказоустойчивость: при недоступности PostgreSQL возвращает
    дефолтный словарь параметров без возбуждения исключений.
    """

    def __init__(self):
        self._cached_config: Dict[str, Any] = dict(DEFAULT_SETTINGS)

    async def get_config(self, conn: Optional[asyncpg.Connection] = None) -> Dict[str, Any]:
        """
        Чтение единой конфигурации из PostgreSQL.
        При недоступности БД возвращает актуальный кэш / дефолтные параметры.
        """
        settings = dict(self._cached_config)

        should_close = False
        active_conn = conn
        try:
            if active_conn is None:
                pool = db_module.pool
                if pool is None:
                    logger.warning("[SettingsService] Пул БД недоступен, возвращаем дефолтные настройки")
                    return settings
                active_conn = await pool.acquire()
                should_close = True

            rows = await active_conn.fetch("SELECT key, value FROM public.kiosk_settings;")
            for r in rows:
                k = r["key"]
                v = r["value"]
                if v is None:
                    continue

                if k in ("carousel_interval", "idle_timeout", "person_timeout"):
                    try:
                        settings[k] = int(v)
                    except (ValueError, TypeError):
                        pass
                elif k in ("camera_similarity_threshold", "recognition_threshold", "similarity_threshold"):
                    try:
                        settings[k] = float(v)
                    except (ValueError, TypeError):
                        pass
                elif k in ("carousel_active", "camera_mirror", "camera_flip", "ticker_active", "night_mode_enabled", "is_active", "active"):
                    settings[k] = str(v).strip().lower() in ("true", "1", "yes")
                elif k in ("start_day_mode", "font_scale_display", "font_scale_schedule", "font_scale", "camera_source", "ticker_text", "night_mode_start", "night_mode_end"):
                    settings[k] = str(v)

            # Синхронизация алиасов и канонических полей
            if "camera_similarity_threshold" not in settings or settings["camera_similarity_threshold"] is None:
                settings["camera_similarity_threshold"] = settings.get("recognition_threshold", 0.45)
            settings["recognition_threshold"] = settings["camera_similarity_threshold"]
            settings["similarity_threshold"] = settings["camera_similarity_threshold"]

            if "camera_mirror" not in settings or settings["camera_mirror"] is None:
                settings["camera_mirror"] = settings.get("camera_flip", True)
            settings["camera_flip"] = settings["camera_mirror"]

            if "carousel_interval" not in settings or settings["carousel_interval"] is None:
                settings["carousel_interval"] = settings.get("idle_timeout", 6)
            settings["idle_timeout"] = settings["carousel_interval"]

            if not settings.get("font_scale_display"):
                settings["font_scale_display"] = settings.get("font_scale", "normal")
            if not settings.get("font_scale_schedule"):
                settings["font_scale_schedule"] = settings.get("font_scale", "normal")
            settings["font_scale"] = settings["font_scale_display"]

            self._cached_config = dict(settings)
            return settings

        except Exception as e:
            logger.warning(f"[SettingsService] Ошибка чтения настроек из БД ({e}), возврат дефолтов")
            return settings
        finally:
            if should_close and active_conn is not None and db_module.pool is not None:
                try:
                    await db_module.pool.release(active_conn)
                except Exception:
                    pass

    async def update_config(self, new_settings: Dict[str, Any], conn: Optional[asyncpg.Connection] = None) -> Dict[str, Any]:
        """
        Сохранение настроек в PostgreSQL, обновление параметров камеры
        и рассылка события SETTINGS_UPDATED всем клиентам через WebSocket.
        """
        # Синхронизация взаимных алиасов
        if "camera_similarity_threshold" in new_settings and new_settings["camera_similarity_threshold"] is not None:
            new_settings["recognition_threshold"] = float(new_settings["camera_similarity_threshold"])
            new_settings["similarity_threshold"] = float(new_settings["camera_similarity_threshold"])
        elif "recognition_threshold" in new_settings and new_settings["recognition_threshold"] is not None:
            new_settings["camera_similarity_threshold"] = float(new_settings["recognition_threshold"])
            new_settings["similarity_threshold"] = float(new_settings["recognition_threshold"])

        if "camera_mirror" in new_settings and new_settings["camera_mirror"] is not None:
            new_settings["camera_flip"] = bool(new_settings["camera_mirror"])
        elif "camera_flip" in new_settings and new_settings["camera_flip"] is not None:
            new_settings["camera_mirror"] = bool(new_settings["camera_flip"])

        if "carousel_interval" in new_settings and new_settings["carousel_interval"] is not None:
            new_settings["idle_timeout"] = int(new_settings["carousel_interval"])
        elif "idle_timeout" in new_settings and new_settings["idle_timeout"] is not None:
            new_settings["carousel_interval"] = int(new_settings["idle_timeout"])

        old_settings = await self.get_config(conn=conn)

        # Сохранение в БД
        should_close = False
        active_conn = conn
        try:
            if active_conn is None:
                pool = db_module.pool
                if pool:
                    active_conn = await pool.acquire()
                    should_close = True

            if active_conn:
                for k, v in new_settings.items():
                    if v is not None:
                        val_str = str(v).lower() if isinstance(v, bool) else str(v)
                        sql = """
                            INSERT INTO public.kiosk_settings (key, value)
                            VALUES ($1, $2)
                            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
                        """
                        await active_conn.execute(sql, k, val_str)
        except Exception as e:
            logger.error(f"[SettingsService] Ошибка сохранения настроек в БД: {e}")
        finally:
            if should_close and active_conn is not None and db_module.pool is not None:
                try:
                    await db_module.pool.release(active_conn)
                except Exception:
                    pass

        # Обновляем локальный кэш
        for k, v in new_settings.items():
            if v is not None:
                self._cached_config[k] = v

        current_config = await self.get_config(conn=conn)

        # Реакция на изменение камеры / распознавания
        try:
            cam_source_changed = str(old_settings.get("camera_source")) != str(current_config.get("camera_source"))
            is_active_changed = old_settings.get("is_active") != current_config.get("is_active")

            if cam_source_changed or is_active_changed:
                face_recognition_service.restart_camera(
                    camera_source=str(current_config.get("camera_source", "0")),
                    threshold=float(current_config.get("camera_similarity_threshold", 0.45)),
                    idle_timeout=int(current_config.get("carousel_interval", 6)),
                    is_active=bool(current_config.get("is_active", True)),
                    flip_horizontal=bool(current_config.get("camera_mirror", True)),
                )
            else:
                face_recognition_service.recognition_threshold = float(current_config.get("camera_similarity_threshold", 0.45))
                face_recognition_service.idle_timeout = int(current_config.get("carousel_interval", 6))
                face_recognition_service.is_active = bool(current_config.get("is_active", True))
                face_recognition_service.set_flip_horizontal(bool(current_config.get("camera_mirror", True)))
        except Exception as cam_err:
            logger.error(f"[SettingsService] Ошибка обновления параметров камеры: {cam_err}")

        # Рассылка SETTINGS_UPDATED всем клиентам
        try:
            broadcast_payload = {
                "event": "SETTINGS_UPDATED",
                "settings": {
                    "carousel_interval": current_config.get("carousel_interval", 6),
                    "carousel_active": current_config.get("carousel_active", True),
                    "start_day_mode": current_config.get("start_day_mode", "monday"),
                    "font_scale_display": current_config.get("font_scale_display", "normal"),
                    "font_scale_schedule": current_config.get("font_scale_schedule", "normal"),
                    "camera_source": current_config.get("camera_source", "0"),
                    "camera_similarity_threshold": current_config.get("camera_similarity_threshold", 0.45),
                    "camera_mirror": current_config.get("camera_mirror", True),
                    "ticker_text": current_config.get("ticker_text", ""),
                    "ticker_active": current_config.get("ticker_active", False),
                    "night_mode_enabled": current_config.get("night_mode_enabled", False),
                    "night_mode_start": current_config.get("night_mode_start", "21:00"),
                    "night_mode_end": current_config.get("night_mode_end", "07:30"),
                    # Алиасы
                    "recognition_threshold": current_config.get("camera_similarity_threshold", 0.45),
                    "similarity_threshold": current_config.get("camera_similarity_threshold", 0.45),
                    "camera_flip": current_config.get("camera_mirror", True),
                    "font_scale": current_config.get("font_scale_display", "normal"),
                    "idle_timeout": current_config.get("carousel_interval", 6),
                    "is_active": current_config.get("is_active", True),
                }
            }
            await face_recognition_service.ws_manager.broadcast(broadcast_payload)
        except Exception as ws_err:
            logger.warning(f"[SettingsService] Ошибка рассылки WebSocket: {ws_err}")

        return current_config


settings_service = SettingsService()
