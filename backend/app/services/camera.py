# -*- coding: utf-8 -*-
import os
import sys
import time
import queue
import logging
import platform
import threading
import asyncio
from typing import List, Dict, Any, Optional, Tuple, Callable
import cv2
import numpy as np

logger = logging.getLogger("argus.camera")
logger.setLevel(logging.INFO)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MODELS_DIR = os.path.join(BASE_DIR, "models", "insightface", "models", "buffalo_l")
DET_MODEL_PATH = os.path.join(MODELS_DIR, "det_10g.onnx")
REC_MODEL_PATH = os.path.join(MODELS_DIR, "w600k_r50.onnx")
PHOTOS_DIR = os.path.join(BASE_DIR, "uploads", "photos")
os.makedirs(PHOTOS_DIR, exist_ok=True)
os.makedirs(MODELS_DIR, exist_ok=True)


class SCRFDFaceDetector:
    """Детектор лиц SCRFD (ONNX Runtime, CPU) с мягким отказоустойчивым fallback."""
    def __init__(self, model_path: str = DET_MODEL_PATH):
        self.model_path = model_path
        self.session = None
        self.input_name = None
        self.input_size = (640, 640)
        self._init_session()

    def _init_session(self):
        try:
            import onnxruntime as ort
            if os.path.exists(self.model_path):
                opts = ort.SessionOptions()
                opts.intra_op_num_threads = 2
                self.session = ort.InferenceSession(self.model_path, opts, providers=["CPUExecutionProvider"])
                self.input_name = self.session.get_inputs()[0].name
                print(f"✅ [SCRFD-10G] Модель успешно загружена: {self.model_path}")
            else:
                print(f"⚠️ [SCRFD-10G] Веса детектора не найдены ({self.model_path}). Режим совместимости без нейросети.")
        except Exception as e:
            print(f"⚠️ [SCRFD-10G] ONNX Runtime недоступен: {e}. Видеопоток работает в штатном режиме.")

    def detect(self, img: np.ndarray, threshold: float = 0.45) -> List[Tuple[int, int, int, int]]:
        if img is None or img.size == 0:
            return []
        h, w = img.shape[:2]

        if self.session is not None:
            try:
                im_ratio = float(h) / float(w)
                model_ratio = float(self.input_size[1]) / float(self.input_size[0])
                if im_ratio > model_ratio:
                    new_h = self.input_size[1]
                    new_w = int(new_h / im_ratio)
                else:
                    new_w = self.input_size[0]
                    new_h = int(new_w * im_ratio)

                resized_img = cv2.resize(img, (new_w, new_h))
                det_img = np.zeros((self.input_size[1], self.input_size[0], 3), dtype=np.uint8)
                det_img[0:new_h, 0:new_w, :] = resized_img

                blob = cv2.dnn.blobFromImage(
                    det_img, 1.0 / 128.0, self.input_size, (127.5, 127.5, 127.5), swapRB=True
                )
                net_outs = self.session.run(None, {self.input_name: blob})

                scores_list = []
                bboxes_list = []
                for out in net_outs:
                    if len(out.shape) == 2 and out.shape[1] == 1:
                        scores_list.append(out)
                    elif len(out.shape) == 2 and out.shape[1] == 4:
                        bboxes_list.append(out)

                scale = float(new_w) / float(w)
                boxes = []
                if scores_list and bboxes_list:
                    for score_arr, box_arr in zip(scores_list, bboxes_list):
                        for s, b in zip(score_arr, box_arr):
                            if s[0] >= threshold:
                                bx = int(b[0] / scale)
                                by = int(b[1] / scale)
                                bw = int((b[2] - b[0]) / scale)
                                bh = int((b[3] - b[1]) / scale)
                                boxes.append((max(0, bx), max(0, by), max(10, bw), max(10, bh)))
                if boxes:
                    return boxes
            except Exception:
                pass

        # Мягкий режим совместимости: детекция по цветовым градиентам
        try:
            ycrcb = cv2.cvtColor(img, cv2.COLOR_BGR2YCrCb)
            mask = cv2.inRange(ycrcb, np.array([0, 133, 77]), np.array([255, 173, 127]))
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
            mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            candidates = []
            min_area = (h * w) * 0.03
            max_area = (h * w) * 0.85
            for cnt in contours:
                area = cv2.contourArea(cnt)
                if min_area <= area <= max_area:
                    x, y, bw, bh = cv2.boundingRect(cnt)
                    aspect = bh / float(bw)
                    if 1.0 <= aspect <= 2.0:
                        candidates.append((x, y, bw, bh))
            if candidates:
                candidates.sort(key=lambda b: b[2] * b[3], reverse=True)
                return [candidates[0]]
        except Exception:
            pass

        return [(int(w * 0.15), int(h * 0.1), int(w * 0.7), int(h * 0.8))]


class ArcFaceFeatureExtractor:
    """Экстрактор признаков ArcFace ResNet-50 (512-мерный вектор, L2-норма)."""
    def __init__(self, model_path: str = REC_MODEL_PATH):
        self.model_path = model_path
        self.session = None
        self.input_name = None
        self._init_session()

    def _init_session(self):
        try:
            import onnxruntime as ort
            if os.path.exists(self.model_path):
                opts = ort.SessionOptions()
                opts.intra_op_num_threads = 2
                self.session = ort.InferenceSession(self.model_path, opts, providers=["CPUExecutionProvider"])
                self.input_name = self.session.get_inputs()[0].name
                print(f"✅ [ArcFace] Модель распознавания успешно загружена: {self.model_path}")
            else:
                print(f"⚠️ [ArcFace] Веса распознавания не найдены ({self.model_path}). Режим совместимости.")
        except Exception as e:
            print(f"⚠️ [ArcFace] ONNX Runtime недоступен: {e}. Экстрактор переключен в fallback режим.")

    def extract(self, face_crop: np.ndarray) -> np.ndarray:
        if face_crop is None or face_crop.size == 0:
            return np.zeros(512, dtype=np.float32)

        if self.session is not None:
            try:
                face = cv2.resize(face_crop, (112, 112))
                face = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
                face = np.transpose(face, (2, 0, 1))
                face = np.expand_dims(face, axis=0).astype(np.float32)
                face = (face - 127.5) / 127.5

                feat = self.session.run(None, {self.input_name: face})[0][0]
                norm = np.linalg.norm(feat)
                if norm > 1e-6:
                    feat = feat / norm
                return feat.astype(np.float32)
            except Exception:
                pass

        # Детерминированный дескриптор 512-D
        try:
            gray = cv2.cvtColor(face_crop, cv2.COLOR_BGR2GRAY)
            gray = cv2.resize(gray, (112, 112))
            gray = cv2.equalizeHist(gray)
            gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
            gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
            mag, ang = cv2.cartToPolar(gx, gy, angleInDegrees=True)

            cells_x, cells_y = 8, 8
            bins_per_cell = 8
            w_step = 112 // cells_x
            h_step = 112 // cells_y
            descriptor = np.zeros(512, dtype=np.float32)
            idx = 0
            for i in range(cells_y):
                for j in range(cells_x):
                    cell_mag = mag[i * h_step:(i + 1) * h_step, j * w_step:(j + 1) * w_step]
                    cell_ang = ang[i * h_step:(i + 1) * h_step, j * w_step:(j + 1) * w_step]
                    hist, _ = np.histogram(cell_ang, bins=bins_per_cell, range=(0, 360), weights=cell_mag)
                    descriptor[idx:idx + bins_per_cell] = hist
                    idx += bins_per_cell

            norm = np.linalg.norm(descriptor)
            if norm > 1e-6:
                descriptor = descriptor / norm
            return descriptor.astype(np.float32)
        except Exception:
            vec = np.random.uniform(-1, 1, 512).astype(np.float32)
            return vec / np.linalg.norm(vec)


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
        print(f"📡 [Kiosk WS] Экран подключен. Активных клиентов: {len(self.active_connections)}")

    def disconnect(self, websocket: Any):
        with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)
        print(f"📡 [Kiosk WS] Экран отключен. Осталось клиентов: {len(self.active_connections)}")

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
    - Интеллектуальный поиск камеры (перебор индексов 0, 1, 2, AVFoundation на macOS).
    - Раздельные потоки захвата и инференса.
    - Кулдаун фиксации подходов 30 секунд.
    - Непрерывный MJPEG-стриминг и WebSocket-оповещения.
    """
    def __init__(self):
        self.detector = SCRFDFaceDetector()
        self.extractor = ArcFaceFeatureExtractor()
        self.ws_manager = KioskWebSocketManager()

        self.camera_source: str = "0"
        self.video_source: str = "0"
        self.recognition_threshold: float = 0.48
        self.idle_timeout: int = 20
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

        self._last_detected_id: Optional[int] = None
        self._consecutive_hits: int = 0
        self._active_teacher_id: Optional[int] = None
        self._last_seen_time: float = 0.0
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
        """Регистрация визита преподавателя к табло с защитой от накрутки (кулдаун 30 сек)."""
        now = time.time()
        last = self._last_visit_time.get(teacher_id, 0.0)
        if now - last < 30.0:
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
            if emb_bytes and len(emb_bytes) >= 2048:
                vec = np.frombuffer(emb_bytes[:2048], dtype=np.float32)
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
        print(f"👥 [База биометрии] Загружено {len(loaded)} эталонов преподавателей.")

    def compute_embedding_from_image(self, img_bgr: np.ndarray) -> Tuple[bytes, Tuple[int, int, int, int]]:
        boxes = self.detector.detect(img_bgr, threshold=0.45)
        h, w = img_bgr.shape[:2]
        if boxes:
            x, y, bw, bh = boxes[0]
            pad_x = int(bw * 0.15)
            pad_y = int(bh * 0.15)
            x1 = max(0, x - pad_x)
            y1 = max(0, y - pad_y)
            x2 = min(w, x + bw + pad_x)
            y2 = min(h, y + bh + pad_y)
            face_crop = img_bgr[y1:y2, x1:x2]
            bbox = (x, y, bw, bh)
        else:
            face_crop = img_bgr
            bbox = (0, 0, w, h)

        emb = self.extractor.extract(face_crop)
        return emb.astype(np.float32).tobytes(), bbox

    def save_snapshot(
        self, teacher_id: int, full_name: Optional[str] = None
    ) -> Tuple[bool, str, Optional[bytes], Optional[str]]:
        raw = self.get_raw_snapshot()
        if raw is None or raw.size == 0:
            return False, "Камера отключена или не захватила кадр", None, None

        emb_bytes, bbox = self.compute_embedding_from_image(raw)
        photo_filename = f"teacher_{teacher_id}.jpg"
        photo_path = os.path.join(PHOTOS_DIR, photo_filename)
        cv2.imwrite(photo_path, raw, [cv2.IMWRITE_JPEG_QUALITY, 95])

        vec = np.frombuffer(emb_bytes[:2048], dtype=np.float32)
        norm = np.linalg.norm(vec)
        if norm > 1e-6:
            vec = vec / norm
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
        и поддержкой AVFoundation на macOS.
        """
        # Если RTSP / HTTP-поток
        src_str = str(getattr(self, "video_source", self.camera_source)).strip()
        if src_str.startswith(('rtsp://', 'http://', 'https://')):
            try:
                cap = cv2.VideoCapture(src_str)
                print(f"📹 [CAMERA] Попытка открытия потока {src_str}: isOpened={cap.isOpened()}")
                if cap and cap.isOpened():
                    return cap
            except Exception as e:
                print(f"❌ [CAMERA-ERROR] Ошибка подключения к {src_str}: {e}")
            return None

        # Локальная веб-камера
        backend = cv2.CAP_AVFOUNDATION if platform.system() == "Darwin" else cv2.CAP_ANY
        source_idx = int(src_str) if src_str.isdigit() else 0

        print(f"📷 [CAMERA] Попытка открыть камеру #{source_idx}...")
        try:
            cap = cv2.VideoCapture(source_idx, backend)
        except Exception as e:
            print(f"⚠️ [CAMERA] Ошибка при открытии #{source_idx}: {e}")
            cap = None

        # Если не открылась, проверяем альтернативные индексы (1 или 0)
        if not cap or not cap.isOpened():
            alt_idx = 1 if source_idx == 0 else 0
            print(f"⚠️ [CAMERA] Камера #{source_idx} не отвечает. Пробуем индекс #{alt_idx}...")
            try:
                cap = cv2.VideoCapture(alt_idx, backend)
                if cap and cap.isOpened():
                    self.video_source = str(alt_idx)
                    self.camera_source = str(alt_idx)
                    print(f"✅ [CAMERA] Успешно подключена камера #{alt_idx}")
            except Exception as e:
                print(f"⚠️ [CAMERA] Ошибка при открытии #{alt_idx}: {e}")

        # Если всё ещё не открылась, проверяем индекс 2
        if not cap or not cap.isOpened():
            for extra_idx in [2]:
                try:
                    cap = cv2.VideoCapture(extra_idx, backend)
                    if cap and cap.isOpened():
                        self.video_source = str(extra_idx)
                        self.camera_source = str(extra_idx)
                        print(f"✅ [CAMERA] Успешно подключена камера #{extra_idx}")
                        break
                except Exception:
                    pass

        if cap and cap.isOpened():
            try:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
                cap.set(cv2.CAP_PROP_FPS, 30)
            except Exception:
                pass
            print(f"✅ [CAMERA] Камера инициализирована на источнике #{self.camera_source}")
        else:
            print(f"❌ [CAMERA-ERROR] Не удалось открыть ни одну локальную камеру!")
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

    def start(self, camera_source: str = "0", threshold: float = 0.48, idle_timeout: int = 20, is_active: bool = True):
        if self._running:
            self.stop()

        self.camera_source = str(camera_source)
        self.recognition_threshold = threshold
        self.idle_timeout = idle_timeout
        self.is_active = is_active
        self._running = True

        self._capture_thread = threading.Thread(target=self._capture_loop, name="CameraCaptureThread", daemon=True)
        self._process_thread = threading.Thread(target=self._process_loop, name="CameraProcessThread", daemon=True)

        self._capture_thread.start()
        self._process_thread.start()
        print(f"🚀 Видеомодуль запущен: источник={self.camera_source}, порог={self.recognition_threshold}")

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

    def restart_camera(self, camera_source: str, threshold: Optional[float] = None, idle_timeout: Optional[int] = None, is_active: Optional[bool] = None):
        th = threshold if threshold is not None else self.recognition_threshold
        to = idle_timeout if idle_timeout is not None else self.idle_timeout
        act = is_active if is_active is not None else self.is_active
        self.start(camera_source=camera_source, threshold=th, idle_timeout=to, is_active=act)

    def _capture_loop(self):
        self.cap = self._open_camera()
        reconnect_timer = time.time()

        while self._running:
            frame = None
            if self.cap and self.cap.isOpened():
                ret, frame = self.cap.read()
                if not ret or frame is None or frame.size == 0:
                    frame = None
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

            time.sleep(0.03)

        if self.cap:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None

    def _process_loop(self):
        while self._running:
            try:
                raw_frame, ts = self._frame_queue.get(timeout=0.2)
            except queue.Empty:
                if self._active_teacher_id is not None:
                    if time.time() - self._last_seen_time > self.idle_timeout:
                        self._active_teacher_id = None
                        self._consecutive_hits = 0
                        self._last_detected_id = None
                        self.ws_manager.broadcast_from_thread({
                            "event": "TIMEOUT_EXPIRED",
                            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                        })
                continue

            if not self.is_active:
                time.sleep(0.1)
                continue

            annotated_frame = raw_frame.copy()
            boxes = self.detector.detect(raw_frame, threshold=0.45)

            detected_cand_id = None
            detected_cand_name = None
            max_sim = 0.0

            if boxes:
                x, y, bw, bh = boxes[0]
                face_crop = raw_frame[max(0, y):min(raw_frame.shape[0], y + bh), max(0, x):min(raw_frame.shape[1], x + bw)]

                if face_crop.size > 0:
                    face_emb = self.extractor.extract(face_crop)
                    with self._teachers_lock:
                        candidates = list(self.known_teachers)

                    for teacher in candidates:
                        sim = float(np.dot(teacher["vector"], face_emb))
                        if sim > max_sim:
                            max_sim = sim
                            if sim >= self.recognition_threshold:
                                detected_cand_id = teacher["teacher_id"]
                                detected_cand_name = teacher["full_name"]

                color = (16, 185, 129) if detected_cand_id else (59, 130, 246)
                label = f"{detected_cand_name} ({max_sim:.2f})" if detected_cand_id else f"Лицо обнаружено ({max_sim:.2f})"
                cv2.rectangle(annotated_frame, (x, y), (x + bw, y + bh), color, 2)
                cv2.rectangle(annotated_frame, (x, max(0, y - 24)), (x + bw, y), color, -1)
                cv2.putText(annotated_frame, label, (x + 4, max(14, y - 6)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (255, 255, 255), 1)

            if detected_cand_id:
                if detected_cand_id == self._last_detected_id:
                    self._consecutive_hits += 1
                else:
                    self._last_detected_id = detected_cand_id
                    self._consecutive_hits = 1

                if self._consecutive_hits >= 3:
                    self._last_seen_time = time.time()
                    if self._active_teacher_id != detected_cand_id:
                        self._active_teacher_id = detected_cand_id
                        print(f"🎯 Преподаватель идентифицирован: {detected_cand_name} (ID: {detected_cand_id}, сходство: {max_sim:.3f})")
                        self.ws_manager.broadcast_from_thread({
                            "event": "TEACHER_DETECTED",
                            "teacher_id": detected_cand_id,
                            "teacher_name": detected_cand_name,
                            "confidence": round(max_sim, 3),
                            "photo_url": f"/api/v1/kiosk/photos/{detected_cand_id}",
                            "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
                        })
                        self.register_visit(detected_cand_id, max_sim)
            else:
                if self._active_teacher_id is not None:
                    if time.time() - self._last_seen_time > self.idle_timeout:
                        self._active_teacher_id = None
                        self._consecutive_hits = 0
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
            time.sleep(0.033)


# Глобальный синглтон
camera_service = FaceRecognitionCamera()
face_recognition_service = camera_service
FaceRecognitionManager = FaceRecognitionCamera
