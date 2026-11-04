# -*- coding: utf-8 -*-
import os
import sys
import time
import queue
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
os.makedirs(PHOTOS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)


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
                    self.yunet_path, "", (320, 320), score_threshold=0.15, nms_threshold=0.3, top_k=5000
                )
                print(f"[YuNet] Детектор лиц успешно загружен: {self.yunet_path}")
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
                    if score < 0.15:
                        continue
                    bx = max(0, int(face[0]))
                    by = max(0, int(face[1]))
                    bw = max(10, int(face[2]))
                    bh = max(10, int(face[3]))
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

        self.known_teachers: List[Dict[str, Any]] = []
        self._teachers_lock = threading.Lock()
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

        # Автозапуск рабочих потоков видеозахвата
        self.start_threads()

    def start_threads(self):
        """Запуск фоновых потоков захвата и обработки видео."""
        if not self._running:
            self.start(camera_source=self.camera_source)

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
        print(f"[База биометрии] Загружено {len(loaded)} эталонов преподавателей.")

    def compute_embedding_from_image(self, img_bgr: np.ndarray) -> Tuple[bytes, Tuple[int, int, int, int]]:
        if img_bgr is None or img_bgr.size == 0:
            return np.zeros(128, dtype=np.float32).tobytes(), (0, 0, 100, 100)

        h, w = img_bgr.shape[:2]
        results = self.vision.detect_and_align(img_bgr)
        if results:
            results.sort(key=lambda item: item[2], reverse=True)
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
        photo_filename = f"teacher_{teacher_id}.jpg"
        photo_path = os.path.join(PHOTOS_DIR, photo_filename)
        cv2.imwrite(photo_path, raw, [cv2.IMWRITE_JPEG_QUALITY, 95])
        with self._teachers_lock:
            found = False
            for item in self.known_teachers:
                if item["teacher_id"] == teacher_id:
                    item["vector"] = vec
                    item["photo_path"] = photo_filename
                    if full_name:
                        item["full_name"] = full_name
                    found = True
                    break
            if not found:
                self.known_teachers.append({
                    "teacher_id": teacher_id,
                    "full_name": full_name or f"Преподаватель #{teacher_id}",
                    "photo_path": photo_filename,
                    "vector": vec,
                })

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
                    return c
            except Exception as e:
                logger.warning(f"Ошибка при открытии камеры #{idx}: {e}")
            return None

        logger.info(f"Попытка открыть камеру #{source_idx}...")
        cap = try_open(source_idx)

        # Fallback на соседний индекс (0 <-> 1)
        if not cap:
            alt_idx = 1 if source_idx == 0 else 0
            logger.info(f"Камера #{source_idx} недоступна. Fallback на #{alt_idx}...")
            cap = try_open(alt_idx)
            if cap:
                self.video_source = str(alt_idx)
                self.camera_source = str(alt_idx)

        # Если не открылась, проверяем индекс 2
        if not cap:
            cap = try_open(2)
            if cap:
                self.video_source = "2"
                self.camera_source = "2"

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

        while self._running:
            frame = None
            if self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                if not ret or frame is None or frame.size == 0:
                    frame = None
                elif self.flip_horizontal:
                    frame = cv2.flip(frame, 1)
            else:
                if time.time() - reconnect_timer > 5.0:
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
                with self._teachers_lock:
                    candidates = list(self.known_teachers)

                best_sim = 0.0
                best_id = None
                best_name = None

                # Обрабатываем все обнаруженные лица в кадре
                for bbox, aligned_face, score in results:
                    face_emb = self.vision.extract_feature(aligned_face)
                    face_max_sim = 0.0
                    matched_id = None
                    matched_name = None

                    for teacher in candidates:
                        sim = float(np.dot(teacher["vector"].flatten(), face_emb.flatten()))
                        if sim > face_max_sim:
                            face_max_sim = sim
                            if sim >= self.recognition_threshold:
                                matched_id = teacher["teacher_id"]
                                matched_name = teacher["full_name"]

                    x, y, bw, bh = bbox
                    if matched_id:
                        color = (16, 185, 129)
                        label = f"{matched_name} ({face_max_sim:.2f})"
                    else:
                        color = (59, 130, 246)
                        label = f"Лицо ({face_max_sim:.2f})"

                    cv2.rectangle(annotated_frame, (x, y), (x + bw, y + bh), color, 2)
                    cv2.rectangle(annotated_frame, (x, max(0, y - 24)), (x + bw, y), color, -1)
                    cv2.putText(annotated_frame, label, (x + 4, max(14, y - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

                    if face_max_sim > best_sim:
                        best_sim = face_max_sim
                        if matched_id:
                            best_id = matched_id
                            best_name = matched_name

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
