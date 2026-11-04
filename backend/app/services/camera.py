# -*- coding: utf-8 -*-
import os
import sys
import time
import queue
import pickle
import logging
import platform
import threading
import asyncio
from collections import deque, Counter
from typing import List, Dict, Any, Optional, Tuple, Callable
import cv2
import numpy as np

logger = logging.getLogger("argus.camera")
logger.setLevel(logging.INFO)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS_DIR = os.path.join(BASE_DIR, "models")
YUNET_PATH = os.path.join(MODELS_DIR, "face_detection_yunet.onnx")
SFACE_PATH = os.path.join(MODELS_DIR, "face_recognition_sface.onnx")
PHOTOS_DIR = os.path.join(BASE_DIR, "uploads", "photos")
TEACHERS_DIR = os.path.join(BASE_DIR, "uploads", "teachers")
CACHE_FILE = os.path.join(TEACHERS_DIR, "face_cache_insightface.pkl")
os.makedirs(PHOTOS_DIR, exist_ok=True)
os.makedirs(TEACHERS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)


def is_valid_face_geometry(box, frame_w: int, frame_h: int) -> bool:
    """
    Геометрический фильтр пропорций лица (Aspect Ratio & Min Size).
    Исключает надписи на одежде, складки ткани и артефакты геометрии.
    Поддерживает координаты (x1, y1, x2, y2) и (x, y, w, h).
    """
    if box is None or len(box) < 4:
        return False

    b0, b1, b2, b3 = float(box[0]), float(box[1]), float(box[2]), float(box[3])
    if b2 > b0 and b3 > b1:
        x1, y1, x2, y2 = b0, b1, b2, b3
        w = x2 - x1
        h = y2 - y1
    else:
        x1, y1 = b0, b1
        w, h = b2, b3

    # 1. Минимальные и максимальные адекватные размеры лица в кадре
    if w < 50 or h < 50:
        return False
    if w > frame_w * 0.9 or h > frame_h * 0.9:
        return False

    # 2. Проверка соотношения сторон (высота / ширина)
    aspect_ratio = float(h) / float(w)
    if not (0.75 <= aspect_ratio <= 1.40):
        return False

    return True


class OpenCVFaceVision:
    """Детектор лиц YuNet и экстрактор признаков SFace через нативный OpenCV 5 DNN."""
    def __init__(self, yunet_path: str = YUNET_PATH, sface_path: str = SFACE_PATH):
        self.yunet_path = yunet_path
        self.sface_path = sface_path
        self.detector = None
        self.recognizer = None
        self._lock = threading.Lock()
        self._init_models()

    def _init_models(self):
        try:
            if os.path.exists(self.yunet_path) and hasattr(cv2, "FaceDetectorYN"):
                self.detector = cv2.FaceDetectorYN.create(
                    self.yunet_path, "", (320, 320), score_threshold=0.55, nms_threshold=0.3, top_k=5000
                )
                print(f"[YuNet] Детектор лиц успешно загружен: {self.yunet_path} (порог детекции: 0.55)")
            else:
                print(f"[YuNet] Веса детектора не найдены ({self.yunet_path}).")

            if os.path.exists(self.sface_path) and hasattr(cv2, "FaceRecognizerSF"):
                self.recognizer = cv2.FaceRecognizerSF.create(self.sface_path, "")
                print(f"[SFace] Модель распознавания лиц успешно загружена: {self.sface_path}")
            else:
                print(f"[SFace] Веса распознавания не найдены ({self.sface_path}).")
        except Exception as e:
            print(f"[OpenCV FaceVision] Ошибка загрузки моделей: {e}")

    def detect_and_align(self, img_bgr: np.ndarray) -> List[Tuple[Tuple[int, int, int, int], np.ndarray, float]]:
        """
        Обнаружение лиц и выравнивание через landmark crop.
        Возвращает: [(bbox, aligned_face, score), ...]
        """
        if img_bgr is None or img_bgr.size == 0 or self.detector is None or self.recognizer is None:
            return []

        h, w = img_bgr.shape[:2]
        with self._lock:
            try:
                self.detector.setInputSize((w, h))
                _, faces = self.detector.detect(img_bgr)
                if faces is None or len(faces) == 0:
                    return []

                results = []
                for face in faces:
                    score = float(face[-1])
                    if score < 0.55:
                        continue
                    bx = max(0, int(face[0]))
                    by = max(0, int(face[1]))
                    bw = max(10, int(face[2]))
                    bh = max(10, int(face[3]))

                    # Геометрический фильтр пропорций лица
                    if not is_valid_face_geometry((bx, by, bx + bw, by + bh), w, h):
                        continue

                    aligned = self.recognizer.alignCrop(img_bgr, face)
                    results.append(((bx, by, bw, bh), aligned, score))
                return results
            except Exception as e:
                logger.warning(f"Ошибка инференса OpenCV FaceVision: {e}")
                return []

    def extract_feature(self, aligned_face: np.ndarray) -> np.ndarray:
        """Извлечение 128-мерного L2-нормализованного вектора SFace."""
        if aligned_face is None or aligned_face.size == 0 or self.recognizer is None:
            return np.zeros(128, dtype=np.float32)
        with self._lock:
            try:
                feat = self.recognizer.feature(aligned_face)
                norm = np.linalg.norm(feat)
                if norm > 1e-6:
                    feat = feat / norm
                return feat.flatten().astype(np.float32)
            except Exception as e:
                logger.warning(f"Ошибка вычисления вектора SFace: {e}")
                return np.zeros(128, dtype=np.float32)


class KioskWebSocketManager:
    """Управление постоянными WebSocket-соединениями с экранами инфотабло."""
    def __init__(self):
        self.active_connections: List[Any] = []
        self._lock = threading.Lock()
        self.loop: Optional[asyncio.AbstractEventLoop] = None

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    async def connect(self, websocket: Any):
        await websocket.accept()
        with self._lock:
            self.active_connections.append(websocket)
        print(f"[Kiosk WS] Экран подключен. Активных клиентов: {len(self.active_connections)}")

    def disconnect(self, websocket: Any):
        with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
        print(f"[Kiosk WS] Экран отключен. Осталось клиентов: {len(self.active_connections)}")

    async def broadcast(self, message: dict):
        dead_conns = []
        with self._lock:
            conns = list(self.active_connections)

        for conn in conns:
            try:
                await conn.send_json(message)
            except Exception:
                dead_conns.append(conn)

        if dead_conns:
            with self._lock:
                for dc in dead_conns:
                    if dc in self.active_connections:
                        self.active_connections.remove(dc)

    def broadcast_from_thread(self, message: dict):
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(message), self.loop)


class FaceRecognitionCamera:
    """
    Основной модуль захвата видео и распознавания лиц для инфокиоска:
    - Высокоточный детектор YuNet и распознавание SFace (OpenCV DNN).
    - Интеллектуальный поиск камеры (перебор индексов 0, 1, 2, AVFoundation на macOS).
    - Раздельные потоки захвата и инференса.
    - Кулдаун фиксации подходов 15 секунд.
    - Непрерывный MJPEG-стриминг и WebSocket-оповещения.
    """
    def __init__(self):
        self.vision = OpenCVFaceVision()
        self.detector = self.vision
        self.extractor = self.vision
        self.ws_manager = KioskWebSocketManager()

        self.camera_source: str = "0"
        self.video_source: str = "0"
        self.recognition_threshold: float = 0.32  # Сбалансированный порог для уверенного распознавания SFace
        self.idle_timeout: int = 6  # Тайм-аут ухода преподавателя от камеры (секунд)
        self.is_active: bool = True

        self._running: bool = False
        self._capture_thread: Optional[threading.Thread] = None
        self._process_thread: Optional[threading.Thread] = None
        self._frame_queue: queue.Queue = queue.Queue(maxsize=1)
        self._frame_lock = threading.Lock()
        self.frame_lock = self._frame_lock

        self._raw_frame: Optional[np.ndarray] = None
        self._output_frame: Optional[np.ndarray] = None
        self.output_frame: Optional[np.ndarray] = None
        self.cap: Optional[cv2.VideoCapture] = None

        self.path_images = TEACHERS_DIR
        self.cache_file = CACHE_FILE
        os.makedirs(self.path_images, exist_ok=True)

        self.known_teachers: List[Dict[str, Any]] = []
        self.known_face_encodings: List[np.ndarray] = []
        self.known_face_names: List[str] = []
        self.known_teacher_ids: List[int] = []
        self._teachers_lock = threading.Lock()
        self.inference_lock = self._teachers_lock
        self.flip_horizontal: bool = True

        # Сглаживание предсказаний и кулдауны
        self._history: deque = deque(maxlen=5)
        self._last_detected_id: Optional[int] = None
        self._consecutive_hits: int = 0
        self._active_teacher_id: Optional[int] = None
        self._last_seen_time: float = 0.0
        self._last_ws_send_time: float = 0.0
        self._last_visit_time: Dict[int, float] = {}

        self.log_callback: Optional[Callable[[int, float], Any]] = None

        # Синхронная загрузка базы эталонов при старте (архитектура VisionAttend)
        self.load_known_faces()

        # Автозапуск рабочих потоков видеозахвата
        self.start_threads()

    def _extract_face_embedding(self, image_path: str) -> Optional[np.ndarray]:
        """Извлечение L2-нормализованного вектора лица из файла изображения."""
        if not os.path.exists(image_path):
            return None
        img = cv2.imread(image_path)
        if img is None or img.size == 0:
            return None
        results = self.vision.detect_and_align(img)
        if not results:
            return None
        # Сортировка по площади (w * h) - приоритет самого крупного лица
        results.sort(key=lambda item: item[0][2] * item[0][3], reverse=True)
        _, aligned, _ = results[0]
        feat = self.vision.extract_feature(aligned)
        norm = np.linalg.norm(feat)
        if norm > 1e-6:
            feat = feat / norm
            return feat.flatten().astype(np.float32)
        return None

    def _save_cache(self):
        """Сохранение векторов в бинарный pickle-кэш."""
        try:
            with open(self.cache_file, "wb") as f:
                pickle.dump({
                    "encodings": self.known_face_encodings,
                    "names": self.known_face_names,
                    "ids": self.known_teacher_ids
                }, f)
        except Exception as e:
            print(f"[InsightFace] Ошибка сохранения кэша: {e}")

    def load_known_faces(self):
        """Синхронная загрузка эталонов с диска / из кэша (архитектура VisionAttend)."""
        # 1. Попытка быстрой загрузки из pickle-кэша
        if os.path.exists(self.cache_file):
            try:
                with open(self.cache_file, "rb") as f:
                    cache_data = pickle.load(f)
                with self.inference_lock:
                    self.known_face_encodings = cache_data.get("encodings", [])
                    self.known_face_names = cache_data.get("names", [])
                    self.known_teacher_ids = cache_data.get("ids", [])
                    self.known_teachers = [
                        {"teacher_id": tid, "full_name": tname, "vector": enc}
                        for tid, tname, enc in zip(self.known_teacher_ids, self.known_face_names, self.known_face_encodings)
                    ]
                print(f"[InsightFace] Быстрая загрузка из кэша: {len(self.known_face_encodings)} преподавателей.")
                return
            except Exception as e:
                print(f"[InsightFace] Ошибка чтения кэша, пересборка: {e}")

        # 2. Если кэша нет — сканируем директорию uploads/teachers/
        if not os.path.exists(self.path_images):
            return

        new_encodings = []
        new_names = []
        new_ids = []

        for item in sorted(os.listdir(self.path_images)):
            item_path = os.path.join(self.path_images, item)
            if item.startswith('.') or item == os.path.basename(self.cache_file):
                continue

            teacher_id = None
            teacher_name = "Unknown"

            if os.path.isfile(item_path) and item.lower().endswith(('.jpg', '.jpeg', '.png')):
                base_name = os.path.splitext(item)[0]
                if "__" in base_name:
                    parts = base_name.split("__", 1)
                    teacher_id = int(parts[0]) if parts[0].isdigit() else None
                    teacher_name = parts[1]
                else:
                    teacher_name = base_name

                emb = self._extract_face_embedding(item_path)
                if emb is not None:
                    new_encodings.append(emb)
                    new_names.append(teacher_name)
                    new_ids.append(teacher_id)

        with self.inference_lock:
            self.known_face_encodings = new_encodings
            self.known_face_names = new_names
            self.known_teacher_ids = new_ids
            self.known_teachers = [
                {"teacher_id": tid, "full_name": tname, "vector": enc}
                for tid, tname, enc in zip(new_ids, new_names, new_encodings)
            ]

        # Сохраняем в кэш
        self._save_cache()
        print(f"[InsightFace] База загружена с диска: {len(new_encodings)} лиц.")

    def add_single_face(self, image_path: str, teacher_id: int, teacher_name: str) -> bool:
        """
        Извлекает эмбеддинг из переданного файла, добавляет в списки под self.inference_lock,
        вызывает self._save_cache(). Время работы — 0.1 секунды, видеопоток не прерывается.
        """
        emb = self._extract_face_embedding(image_path)
        if emb is None:
            return False

        with self.inference_lock:
            if teacher_id in self.known_teacher_ids:
                idx = self.known_teacher_ids.index(teacher_id)
                self.known_face_encodings[idx] = emb
                self.known_face_names[idx] = teacher_name
            else:
                self.known_face_encodings.append(emb)
                self.known_face_names.append(teacher_name)
                self.known_teacher_ids.append(teacher_id)

            self.known_teachers = [
                {"teacher_id": tid, "full_name": tname, "vector": enc}
                for tid, tname, enc in zip(self.known_teacher_ids, self.known_face_names, self.known_face_encodings)
            ]

        self._save_cache()
        print(f"[InsightFace] Добавлен профиль преподавателя #{teacher_id} ({teacher_name}). Всего: {len(self.known_face_encodings)}")
        return True

    def remove_face(self, teacher_id: int) -> bool:
        """
        Удаляет запись из списков по teacher_id, перезаписывает кэш
        и удаляет соответствующий файл фотографии из backend/uploads/teachers/.
        """
        with self.inference_lock:
            indices = [i for i, tid in enumerate(self.known_teacher_ids) if tid == teacher_id]
            for idx in reversed(indices):
                del self.known_face_encodings[idx]
                del self.known_face_names[idx]
                del self.known_teacher_ids[idx]

            self.known_teachers = [
                t for t in self.known_teachers if t.get("teacher_id") != teacher_id
            ]

        self._save_cache()

        # Удаление файлов с диска
        if os.path.exists(self.path_images):
            prefix = f"{teacher_id}__"
            for f in os.listdir(self.path_images):
                if f.startswith(prefix) or f == f"{teacher_id}.jpg" or f == f"{teacher_id}.png":
                    try:
                        os.remove(os.path.join(self.path_images, f))
                    except Exception:
                        pass

        for p_name in [f"teacher_{teacher_id}.jpg", f"teacher_{teacher_id}.png"]:
            old_p = os.path.join(PHOTOS_DIR, p_name)
            if os.path.exists(old_p):
                try:
                    os.remove(old_p)
                except Exception:
                    pass

        print(f"[InsightFace] Удален профиль преподавателя #{teacher_id}. Осталось: {len(self.known_face_encodings)}")
        return True

    def start_threads(self):
        """Запуск фоновых потоков захвата и обработки видео."""
        if not self._running:
            self.start(camera_source=self.camera_source)

    def stop_threads(self):
        """Остановка фоновых потоков захвата и обработки видео."""
        self.stop()

    async def load_biometrics_from_db(self, pool=None):
        """Загрузка сохраненных векторов лиц преподавателей из PostgreSQL в оперативную память камеры."""
        if pool is None:
            from app.core.database import pool as db_pool
            pool = db_pool
        if pool is None:
            print("[Биометрия] Пул соединений с БД недоступен для загрузки эталонов.")
            return

        query = """
            SELECT tb.teacher_id, tb.embedding, tb.photo_path,
                   TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name
            FROM public.teacher_biometrics tb
            JOIN public.people p ON tb.teacher_id = p.mid
            WHERE tb.embedding IS NOT NULL;
        """
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(query)
        except Exception as e:
            print(f"[Биометрия] Ошибка чтения биометрии из базы данных: {e}")
            return

        new_teachers = []
        new_encodings = []
        new_names = []
        new_ids = []

        for r in rows:
            raw_bytes = r["embedding"]
            vec = None
            if raw_bytes:
                if len(raw_bytes) == 512:
                    # 128 float32 чисел (нативный SFace)
                    vec = np.frombuffer(raw_bytes, dtype=np.float32).copy()
                elif len(raw_bytes) == 2048:
                    # 512 float32 чисел (ArcFace / InsightFace)
                    p_name = r.get("photo_path")
                    if p_name:
                        p_file = os.path.join(PHOTOS_DIR, p_name)
                        if os.path.exists(p_file):
                            p_img = cv2.imread(p_file)
                            if p_img is not None:
                                e_bytes, _ = self.compute_embedding_from_image(p_img)
                                vec = np.frombuffer(e_bytes, dtype=np.float32).copy()
                    if vec is None:
                        vec = np.frombuffer(raw_bytes[:512], dtype=np.float32).copy()
                elif len(raw_bytes) > 0:
                    vec = np.frombuffer(raw_bytes[:512], dtype=np.float32).copy()
            elif r.get("photo_path"):
                p_file = os.path.join(PHOTOS_DIR, r["photo_path"])
                if os.path.exists(p_file):
                    p_img = cv2.imread(p_file)
                    if p_img is not None:
                        e_bytes, _ = self.compute_embedding_from_image(p_img)
                        vec = np.frombuffer(e_bytes, dtype=np.float32).copy()

            if vec is not None:
                norm = np.linalg.norm(vec)
                if norm > 1e-6:
                    vec = vec / norm
                t_id = r["teacher_id"]
                t_name = r["full_name"] or f"Преподаватель #{t_id}"
                new_teachers.append({
                    "teacher_id": t_id,
                    "full_name": t_name,
                    "photo_path": r.get("photo_path"),
                    "vector": vec,
                })
                new_encodings.append(vec)
                new_names.append(t_name)
                new_ids.append(t_id)

        with self.inference_lock:
            self.known_teachers = new_teachers
            self.known_face_encodings = new_encodings
            self.known_face_names = new_names
            self.known_teacher_ids = new_ids
        self._save_cache()

        print(f"[Биометрия] Успешно загружено {len(new_teachers)} биометрических профилей преподавателей из БД.")

    def set_log_callback(self, cb: Callable[[int, float], Any]):
        self.log_callback = cb

    def register_visit(self, teacher_id: int, confidence: float) -> bool:
        """Регистрация визита преподавателя к табло с защитой от накрутки (кулдаун 15 сек)."""
        now = time.time()
        last = self._last_visit_time.get(teacher_id, 0.0)
        if now - last < 15.0:
            return False

        self._last_visit_time[teacher_id] = now
        if self.log_callback:
            try:
                self.log_callback(teacher_id, confidence)
                return True
            except Exception as e:
                logger.error(f"Ошибка логирования визита #{teacher_id}: {e}")
        return False

    def reload_embeddings(self, db_rows: List[Dict[str, Any]]):
        loaded = []
        for r in db_rows:
            emb_bytes = r.get("embedding")
            vec = None
            if emb_bytes:
                if len(emb_bytes) == 512:
                    # 128 float32 чисел (нативный SFace)
                    vec = np.frombuffer(emb_bytes, dtype=np.float32).copy()
                elif len(emb_bytes) >= 2048:
                    # Если сохранился старый 512-мерный вектор, пробуем пересчитать из файла фото
                    p_name = r.get("photo_path")
                    if p_name:
                        p_file = os.path.join(PHOTOS_DIR, p_name)
                        if os.path.exists(p_file):
                            p_img = cv2.imread(p_file)
                            if p_img is not None:
                                e_bytes, _ = self.compute_embedding_from_image(p_img)
                                vec = np.frombuffer(e_bytes, dtype=np.float32).copy()
                                print(f"[База биометрии] Пересчитан вектор SFace для преподавателя #{r['teacher_id']}")
                    if vec is None:
                        vec = np.frombuffer(emb_bytes[:512], dtype=np.float32).copy()
            elif r.get("photo_path"):
                p_file = os.path.join(PHOTOS_DIR, r["photo_path"])
                if os.path.exists(p_file):
                    p_img = cv2.imread(p_file)
                    if p_img is not None:
                        e_bytes, _ = self.compute_embedding_from_image(p_img)
                        vec = np.frombuffer(e_bytes, dtype=np.float32).copy()

            if vec is not None:
                norm = np.linalg.norm(vec)
                if norm > 1e-6:
                    vec = vec / norm
                loaded.append({
                    "teacher_id": r["teacher_id"],
                    "full_name": r.get("full_name") or f"Преподаватель #{r['teacher_id']}",
                    "photo_path": r.get("photo_path"),
                    "vector": vec,
                })
        with self._teachers_lock:
            self.known_teachers = loaded
            self.known_face_encodings = [t["vector"] for t in loaded]
            self.known_face_names = [t["full_name"] for t in loaded]
            self.known_teacher_ids = [t["teacher_id"] for t in loaded]
        print(f"[База биометрии] Загружено {len(loaded)} эталонов преподавателей.")

    def compute_embedding_from_image(self, img_bgr: np.ndarray) -> Tuple[bytes, Tuple[int, int, int, int]]:
        if img_bgr is None or img_bgr.size == 0:
            return np.zeros(128, dtype=np.float32).tobytes(), (0, 0, 100, 100)

        h, w = img_bgr.shape[:2]
        results = self.vision.detect_and_align(img_bgr)
        if results:
            # Сортировка по площади (w * h) - приоритет самого крупного лица
            results.sort(key=lambda item: item[0][2] * item[0][3], reverse=True)
            bbox, aligned, score = results[0]
            feat = self.vision.extract_feature(aligned)
            return feat.tobytes(), bbox

        return np.zeros(128, dtype=np.float32).tobytes(), (0, 0, w, h)

    def save_snapshot(
        self, teacher_id: int, full_name: Optional[str] = None
    ) -> Tuple[bool, str, Optional[bytes], Optional[str]]:
        raw = self.get_raw_snapshot()
        if raw is None or raw.size == 0:
            return False, "Камера отключена или не захватила кадр", None, None

        emb_bytes, bbox = self.compute_embedding_from_image(raw)
        vec = np.frombuffer(emb_bytes[:512], dtype=np.float32).copy()
        norm = np.linalg.norm(vec)
        if norm <= 1e-6:
            return False, "Лицо не обнаружено в кадре камеры. Пожалуйста, сядьте прямо перед камерой при хорошем освещении и повторите попытку.", None, None

        vec = vec / norm
        safe_name = (full_name or f"Преподаватель #{teacher_id}").replace("/", "_").replace("\\", "_")
        photo_filename = f"{teacher_id}__{safe_name}.jpg"
        photo_path = os.path.join(self.path_images, photo_filename)
        cv2.imwrite(photo_path, raw, [cv2.IMWRITE_JPEG_QUALITY, 95])

        legacy_path = os.path.join(PHOTOS_DIR, f"teacher_{teacher_id}.jpg")
        cv2.imwrite(legacy_path, raw, [cv2.IMWRITE_JPEG_QUALITY, 95])

        self.add_single_face(photo_path, teacher_id, full_name or f"Преподаватель #{teacher_id}")

        return True, f"Снимок преподавателя #{teacher_id} успешно сохранен", emb_bytes, photo_filename

    def _open_camera(self) -> Optional[cv2.VideoCapture]:
        """
        Открытие камеры с автопоиском доступного индекса (0, 1, 2)
        и поддержкой AVFoundation на macOS с установкой минимального буфера.
        """
        # Если RTSP / HTTP-поток
        src_str = str(getattr(self, "video_source", self.camera_source)).strip()
        if src_str.startswith(('rtsp://', 'http://', 'https://')):
            try:
                cap = cv2.VideoCapture(src_str)
                logger.info(f"Попытка открытия потока {src_str}: isOpened={cap.isOpened()}")
                if cap and cap.isOpened():
                    try:
                        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    except Exception:
                        pass
                    return cap
            except Exception as e:
                logger.error(f"Ошибка подключения к {src_str}: {e}")
            return None

        # Локальная веб-камера
        is_darwin = platform.system() == "Darwin"
        backend = cv2.CAP_AVFOUNDATION if is_darwin else cv2.CAP_ANY
        source_idx = int(src_str) if src_str.isdigit() else 0

        def try_open(idx: int) -> Optional[cv2.VideoCapture]:
            try:
                c = cv2.VideoCapture(idx, backend)
                if c and c.isOpened():
                    try:
                        c.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    except Exception:
                        pass
                    # Важно: проверяем реальное чтение кадра (на macOS пустые устройства могут быть isOpened=True)
                    ret, test_frame = c.read()
                    if ret and test_frame is not None and test_frame.size > 0:
                        return c
                    else:
                        logger.warning(f"Камера #{idx} открыта, но не отдает кадры (ret={ret})")
                        c.release()
            except Exception as e:
                logger.warning(f"Ошибка при открытии камеры #{idx}: {e}")
            return None

        logger.info(f"Попытка открыть камеру #{source_idx}...")
        cap = try_open(source_idx)

        # Fallback по другим доступным индексам [0, 1, 2]
        if not cap:
            candidates = [i for i in [0, 1, 2] if i != source_idx]
            for alt_idx in candidates:
                logger.info(f"Камера #{source_idx} не отдает кадры. Пробуем #{alt_idx}...")
                cap = try_open(alt_idx)
                if cap:
                    self.video_source = str(alt_idx)
                    self.camera_source = str(alt_idx)
                    logger.info(f"Успешно переключено на камеру #{alt_idx}")
                    break

        if cap and cap.isOpened():
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:
                pass
            try:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                cap.set(cv2.CAP_PROP_FPS, 30)
            except Exception:
                pass
            logger.info(f"Камера успешно инициализирована на источнике #{self.camera_source}")
        else:
            logger.error("Не удалось открыть ни одну локальную камеру!")
            cap = None
        return cap

    def get_jpeg_frame(self) -> Optional[bytes]:
        """
        Получение текущего кадра в формате JPEG для непрерывного MJPEG-стриминга.
        Если камера отключена или кадр ещё не сформирован, отдаёт темный кадр-заглушку
        с надписью «Камера отключена», предотвращая зависание HTTP-потока.
        """
        with self.frame_lock:
            frame = self.output_frame if self.output_frame is not None else self._output_frame
            if frame is None:
                frame = self._raw_frame

            if frame is None:
                # Генерируем темный кадр-заглушку с текстом
                placeholder = np.zeros((480, 640, 3), dtype=np.uint8)
                placeholder[:] = (15, 23, 42)
                for y in range(0, 480, 40):
                    cv2.line(placeholder, (0, y), (640, y), (30, 41, 59), 1)
                for x in range(0, 640, 40):
                    cv2.line(placeholder, (x, 0), (x, 480), (30, 41, 59), 1)

                cv2.putText(placeholder, "ARGUS KIOSK VISION", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (56, 189, 248), 2)
                msg = f"Камера #{self.camera_source}: Отключена"
                cv2.putText(placeholder, msg, (80, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 165, 255), 2)
                t_str = time.strftime("%H:%M:%S")
                cv2.putText(placeholder, f"STATUS: STANDBY | TIME: {t_str}", (20, 450), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (148, 163, 184), 1)
                ok, jpeg = cv2.imencode('.jpg', placeholder, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
                if ok:
                    return jpeg.tobytes()
                return None

            ok, jpeg = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            if not ok:
                return None
            return jpeg.tobytes()

    def _create_placeholder_frame(self, text: str = "Камера отключена") -> np.ndarray:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[:] = (15, 23, 42) # Slate-900
        for y in range(0, 480, 40):
            cv2.line(frame, (0, y), (640, y), (30, 41, 59), 1)
        for x in range(0, 640, 40):
            cv2.line(frame, (x, 0), (x, 480), (30, 41, 59), 1)

        cv2.putText(frame, "ARGUS KIOSK VISION", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (56, 189, 248), 2)
        cv2.putText(frame, text, (100, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (226, 232, 240), 2)
        t_str = time.strftime("%H:%M:%S")
        cv2.putText(frame, f"STATUS: STANDBY | TIME: {t_str}", (20, 450), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (148, 163, 184), 1)
        return frame

    def start(self, camera_source: str = "0", threshold: float = 0.32, idle_timeout: int = 6, is_active: bool = True, flip_horizontal: bool = True):
        if self._running:
            self.stop()

        self.camera_source = str(camera_source)
        self.recognition_threshold = threshold
        self.idle_timeout = idle_timeout
        self.is_active = is_active
        self.flip_horizontal = flip_horizontal
        self._running = True

        self._capture_thread = threading.Thread(target=self._capture_loop, name="CameraCaptureThread", daemon=True)
        self._process_thread = threading.Thread(target=self._process_loop, name="CameraProcessThread", daemon=True)

        self._capture_thread.start()
        self._process_thread.start()
        print(f"[Камера] Видеомодуль запущен: источник={self.camera_source}, порог={self.recognition_threshold}, зеркало={self.flip_horizontal}")

    def set_flip_horizontal(self, flip: bool):
        self.flip_horizontal = bool(flip)

    def stop(self):
        self._running = False
        if self._capture_thread and self._capture_thread.is_alive():
            self._capture_thread.join(timeout=1.5)
        if self._process_thread and self._process_thread.is_alive():
            self._process_thread.join(timeout=1.5)
        if self.cap:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None

    def restart_camera(self, camera_source: str, threshold: Optional[float] = None, idle_timeout: Optional[int] = None, is_active: Optional[bool] = None, flip_horizontal: Optional[bool] = None):
        th = threshold if threshold is not None else self.recognition_threshold
        to = idle_timeout if idle_timeout is not None else self.idle_timeout
        act = is_active if is_active is not None else self.is_active
        flip = flip_horizontal if flip_horizontal is not None else self.flip_horizontal
        self.start(camera_source=camera_source, threshold=th, idle_timeout=to, is_active=act, flip_horizontal=flip)

    def _capture_loop(self):
        self.cap = self._open_camera()
        reconnect_timer = time.time()
        failed_reads = 0

        while self._running:
            frame = None
            if self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                if not ret or frame is None or frame.size == 0:
                    frame = None
                    failed_reads += 1
                    if failed_reads >= 15:
                        logger.warning(f"Камера #{self.camera_source} перестала отдавать кадры ({failed_reads} ошибок подряд). Переинициализация...")
                        try:
                            self.cap.release()
                        except Exception:
                            pass
                        self.cap = None
                        failed_reads = 0
                else:
                    failed_reads = 0
                    if self.flip_horizontal:
                        frame = cv2.flip(frame, 1)
            else:
                if time.time() - reconnect_timer > 3.0:
                    reconnect_timer = time.time()
                    self.cap = self._open_camera()

            if frame is None:
                frame = self._create_placeholder_frame(f"Камера #{self.camera_source}: Отключена")
                time.sleep(0.04)

            raw_copy = frame.copy()
            with self._frame_lock:
                self._raw_frame = raw_copy
                if self._output_frame is None:
                    self._output_frame = raw_copy
                    self.output_frame = raw_copy

            if self.is_active:
                if self._frame_queue.full():
                    try:
                        self._frame_queue.get_nowait()
                    except queue.Empty:
                        pass
                try:
                    self._frame_queue.put_nowait((raw_copy, time.time()))
                except queue.Full:
                    pass

            time.sleep(0.02)

        if self.cap:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None

    def _process_loop(self):
        while self._running:
            try:
                raw_frame, ts = self._frame_queue.get(timeout=0.05)
            except queue.Empty:
                if self._active_teacher_id is not None:
                    if time.time() - self._last_seen_time > self.idle_timeout:
                        self._active_teacher_id = None
                        self._history.clear()
                        self._last_detected_id = None
                        self.ws_manager.broadcast_from_thread({
                            "event": "TIMEOUT_EXPIRED",
                            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                        })
                continue

            if not self.is_active:
                time.sleep(0.05)
                continue

            annotated_frame = raw_frame.copy()
            results = self.vision.detect_and_align(raw_frame)

            detected_cand_id = None
            detected_cand_name = None
            max_sim = 0.0

            if results:
                # 4. Подавление дубликатов (Приоритет главного пользователя):
                # Сортируем лица по площади (w * h) по убыванию (человек, стоящий ближе всего к терминалу)
                results.sort(key=lambda item: item[0][2] * item[0][3], reverse=True)

                with self.inference_lock:
                    known_encs = list(self.known_face_encodings)
                    known_nms = list(self.known_face_names)
                    known_ids = list(self.known_teacher_ids)

                best_sim = 0.0
                best_id = None
                best_name = None

                # Обрабатываем все обнаруженные лица в кадре
                for bbox, aligned_face, score in results:
                    face_emb = self.vision.extract_feature(aligned_face)
                    face_max_sim = 0.0
                    matched_id = None
                    matched_name = None

                    if len(known_encs) > 0:
                        sims = [float(np.dot(enc.flatten(), face_emb.flatten())) for enc in known_encs]
                        best_idx = int(np.argmax(sims))
                        max_val = sims[best_idx]
                        if max_val >= self.recognition_threshold:
                            face_max_sim = max_val
                            matched_id = known_ids[best_idx]
                            matched_name = known_nms[best_idx]
                        else:
                            face_max_sim = max_val

                    x, y, bw, bh = bbox

                    # 3. Фильтрация отрисовки и исключение отрицательных скоров:
                    if matched_id:
                        # Зеленая рамка (Преподаватель опознан): best_similarity >= similarity_threshold
                        color = (16, 185, 129)  # Зеленый BGR
                        label = f"{matched_name} ({face_max_sim:.2f})"
                        cv2.rectangle(annotated_frame, (x, y), (x + bw, y + bh), color, 2)
                        cv2.rectangle(annotated_frame, (x, max(0, y - 24)), (x + bw, y), color, -1)
                        cv2.putText(annotated_frame, label, (x + 4, max(14, y - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
                    elif score >= 0.60 and 0.15 <= face_max_sim < self.recognition_threshold:
                        # Оранжевая рамка (Неопознанный человек): det_score >= 0.60 и 0.15 <= best_sim < 0.45
                        color = (11, 158, 245)  # Оранжевый BGR (RGB: 245, 158, 11)
                        label = "Не опознан"
                        cv2.rectangle(annotated_frame, (x, y), (x + bw, y + bh), color, 2)
                        cv2.rectangle(annotated_frame, (x, max(0, y - 24)), (x + bw, y), color, -1)
                        cv2.putText(annotated_frame, label, (x + 4, max(14, y - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)
                    else:
                        # Полный игнор ложных срабатываний: сходство отрицательное или близко к нулю (< 0.15)
                        # Рамку НЕ ОТРИСОВЫВАТЬ ВООБЩЕ.
                        pass

                    # Приоритет первого (самого крупного) опознанного лица
                    if matched_id and best_id is None:
                        best_sim = face_max_sim
                        best_id = matched_id
                        best_name = matched_name
                    elif best_id is None and face_max_sim > best_sim:
                        best_sim = face_max_sim

                max_sim = best_sim
                detected_cand_id = best_id
                detected_cand_name = best_name

            # Добавляем в скользящее окно сглаживания deque(maxlen=5)
            self._history.append((detected_cand_id, detected_cand_name, max_sim))

            # Голосование большинства (Counter): 2 из 5 кадров для надежного и быстрого срабатывания
            valid_ids = [item[0] for item in self._history if item[0] is not None]
            confirmed_teacher_id = None
            confirmed_teacher_name = None
            confirmed_sim = 0.0

            if valid_ids:
                counts = Counter(valid_ids)
                top_id, count = counts.most_common(1)[0]
                if count >= 2:
                    confirmed_teacher_id = top_id
                    for item in reversed(self._history):
                        if item[0] == top_id:
                            confirmed_teacher_name = item[1]
                            confirmed_sim = item[2]
                            break

            now = time.time()
            if confirmed_teacher_id is not None:
                self._last_seen_time = now
                is_new = (self._active_teacher_id != confirmed_teacher_id)
                pulse_due = (now - self._last_ws_send_time >= 1.5)

                if is_new or pulse_due:
                    self._active_teacher_id = confirmed_teacher_id
                    self._last_ws_send_time = now
                    if is_new:
                        logger.info(f"Преподаватель идентифицирован: {confirmed_teacher_name} (ID: {confirmed_teacher_id}, сходство: {confirmed_sim:.3f})")
                        self.register_visit(confirmed_teacher_id, confirmed_sim)

                    # Непрерывный импульс присутствия: экран держит личное расписание, пока преподаватель у камеры
                    self.ws_manager.broadcast_from_thread({
                        "event": "TEACHER_DETECTED",
                        "teacher_id": confirmed_teacher_id,
                        "teacher_name": confirmed_teacher_name,
                        "confidence": round(confirmed_sim, 3),
                        "is_present": True,
                        "photo_url": f"/api/v1/kiosk/photos/{confirmed_teacher_id}",
                        "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                    })
            else:
                if self._active_teacher_id is not None:
                    if now - self._last_seen_time > self.idle_timeout:
                        logger.info(f"Преподаватель #{self._active_teacher_id} отошел от экрана. Возврат в общее расписание.")
                        self._active_teacher_id = None
                        self._history.clear()
                        self._last_detected_id = None
                        self.ws_manager.broadcast_from_thread({
                            "event": "TIMEOUT_EXPIRED",
                            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                        })

            with self._frame_lock:
                self._output_frame = annotated_frame
                self.output_frame = annotated_frame

    def get_raw_snapshot(self) -> Optional[np.ndarray]:
        with self._frame_lock:
            if self._raw_frame is not None:
                return self._raw_frame.copy()
        return None

    def get_raw_snapshot_jpeg(self) -> Optional[bytes]:
        frame = self.get_raw_snapshot()
        if frame is not None:
            ret, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 92])
            if ret:
                return buf.tobytes()
        return None

    def generate_mjpeg_stream(self):
        while True:
            frame_bytes = self.get_jpeg_frame()
            if frame_bytes:
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
                )
            time.sleep(0.04)


# Глобальный синглтон
camera_service = FaceRecognitionCamera()
face_recognition_service = camera_service
FaceRecognitionManager = FaceRecognitionCamera
