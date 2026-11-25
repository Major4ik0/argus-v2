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

# Ограничиваем пул потоков OpenCV и убираем лишний шум C++ предупреждений в логах
try:
    cv2.setNumThreads(2)
except Exception:
    pass
try:
    cv2.setLogLevel(2)
except Exception:
    pass

logger = logging.getLogger("argus.camera")
logger.setLevel(logging.INFO)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PHOTOS_DIR = os.path.join(BASE_DIR, "uploads", "photos")
TEACHERS_DIR = os.path.join(BASE_DIR, "uploads", "teachers")
CACHE_FILE = os.path.join(TEACHERS_DIR, "face_cache_insightface.pkl")
os.makedirs(PHOTOS_DIR, exist_ok=True)
os.makedirs(TEACHERS_DIR, exist_ok=True)


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


def _resolve_model_paths() -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Поиск путей к автономным моделям InsightFace Buffalo_l (det_10g.onnx / w600k_r50.onnx).
    Возвращает: (det_path, rec_path, models_dir) или (None, None, None).
    """
    search_dirs = [
        os.path.abspath("models/insightface/models/buffalo_l"),
        os.path.abspath("backend/models/insightface/models/buffalo_l"),
        "/app/models/insightface/models/buffalo_l",
        "/app/models/buffalo_l",
        "/app/models",
        os.path.join(BASE_DIR, "models", "insightface", "models", "buffalo_l"),
        os.path.join(BASE_DIR, "backend", "models", "insightface", "models", "buffalo_l"),
        os.path.abspath("./models/insightface/models/buffalo_l"),
        os.path.abspath("./models/buffalo_l"),
        os.path.abspath("./models"),
        os.path.expanduser("~/models/buffalo_l"),
        os.path.expanduser("~/.insightface/models/buffalo_l"),
    ]

    detector_names = ["det_10g.onnx", "det_500m.onnx"]
    recognizer_names = ["w600k_r50.onnx", "w600k_mbf.onnx"]

    for d in search_dirs:
        if not os.path.exists(d) or not os.path.isdir(d):
            continue

        try:
            files = os.listdir(d)
        except Exception:
            continue

        det_path = None
        rec_path = None

        # Точный поиск по приоритетным именам
        for det_name in detector_names:
            p = os.path.join(d, det_name)
            if os.path.exists(p):
                det_path = p
                break

        for rec_name in recognizer_names:
            p = os.path.join(d, rec_name)
            if os.path.exists(p):
                rec_path = p
                break

        # Нечеткий поиск, если файлы названы иначе
        if not det_path:
            for f in files:
                fl = f.lower()
                if fl.endswith(".onnx") and (fl.startswith("det_") or "det_10g" in fl or "det_500m" in fl):
                    det_path = os.path.join(d, f)
                    break

        if not rec_path:
            for f in files:
                fl = f.lower()
                if fl.endswith(".onnx") and any(k in fl for k in ("w600k", "r50", "mbf", "arcface", "glint")):
                    rec_path = os.path.join(d, f)
                    break

        if det_path and rec_path:
            return det_path, rec_path, d

    return None, None, None


class InsightFaceVision:
    """Детектор лиц SCRFD (det_10g.onnx) и экстрактор признаков ArcFace (w600k_r50.onnx) Buffalo_l (512-D)."""
    def __init__(self, det_path: str, rec_path: str, models_dir: str):
        self.det_path = det_path
        self.rec_path = rec_path
        self.models_dir = models_dir
        self.det_session = None
        self.rec_session = None
        self.det_input_name = None
        self.rec_input_name = None
        self._lock = threading.Lock()

        # Предварительный расчет опорных центров (anchors) для SCRFD (поддержка 320x320 и 640x640)
        self._anchors: Dict[Tuple[int, int], np.ndarray] = {}
        for dsz in (320, 640):
            for s in (8, 16, 32):
                gh, gw = dsz // s, dsz // s
                grid_y, grid_x = np.meshgrid(np.arange(gh), np.arange(gw), indexing="ij")
                centers = np.stack([grid_x.ravel() * s, grid_y.ravel() * s], axis=-1)
                self._anchors[(dsz, s)] = np.repeat(centers, 2, axis=0).astype(np.float32)

        self._init_models()

    def _init_models(self):
        import onnxruntime as ort
        opts = ort.SessionOptions()
        # Ограничение 1 потоком и отключение spin-wait гарантирует, что CPU сервера не упрется в 100%
        opts.intra_op_num_threads = 1
        opts.inter_op_num_threads = 1
        opts.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        opts.log_severity_level = 3
        try:
            opts.add_session_config_entry("session.intra_op.allow_spinning", "0")
            opts.add_session_config_entry("session.inter_op.allow_spinning", "0")
        except Exception:
            pass

        self.det_session = ort.InferenceSession(self.det_path, opts, providers=["CPUExecutionProvider"])
        self.det_input_name = self.det_session.get_inputs()[0].name

        self.rec_session = ort.InferenceSession(self.rec_path, opts, providers=["CPUExecutionProvider"])
        self.rec_input_name = self.rec_session.get_inputs()[0].name

        msg = f"[InsightFace] Модели детекции и распознавания успешно инициализированы из: {self.models_dir}"
        logger.info(msg)
        print(msg)

    def detect_and_align(
        self,
        img_bgr: np.ndarray,
        max_faces: Optional[int] = None,
        det_size: int = 640,
        skip_arcface: bool = False,
    ) -> List[Tuple[Tuple[int, int, int, int], np.ndarray, float]]:
        if img_bgr is None or img_bgr.size == 0 or self.det_session is None or self.rec_session is None:
            return []

        if det_size not in (320, 640):
            det_size = 640

        h, w = img_bgr.shape[:2]
        with self._lock:
            try:
                # Масштабирование кадра под целевой вход SCRFD (320x320 для стрима или 640x640 для фото)
                im_ratio = float(h) / float(w)
                if im_ratio > 1.0:
                    new_h = det_size
                    new_w = max(1, int(new_h / im_ratio))
                else:
                    new_w = det_size
                    new_h = max(1, int(new_w * im_ratio))

                resized_img = cv2.resize(img_bgr, (new_w, new_h))
                det_img = np.zeros((det_size, det_size, 3), dtype=np.uint8)
                det_img[0:new_h, 0:new_w, :] = resized_img

                blob = cv2.dnn.blobFromImage(
                    det_img, 1.0 / 128.0, (det_size, det_size), (127.5, 127.5, 127.5), swapRB=True
                )
                net_outs = self.det_session.run(None, {self.det_input_name: blob})

                scores_by_len = {}
                bboxes_by_len = {}
                for out in net_outs:
                    if len(out.shape) == 2:
                        length = out.shape[0]
                        dim = out.shape[1]
                        if dim == 1:
                            scores_by_len[length] = out
                        elif dim == 4:
                            bboxes_by_len[length] = out

                scale = float(new_w) / float(w)
                candidates_boxes = []
                candidates_scores = []

                for s in (8, 16, 32):
                    n_anchors = (det_size // s) ** 2 * 2
                    score_arr = scores_by_len.get(n_anchors)
                    bbox_arr = bboxes_by_len.get(n_anchors)
                    if score_arr is None or bbox_arr is None:
                        continue

                    anchors = self._anchors[(det_size, s)]
                    pos_mask = (score_arr[:, 0] >= 0.55)
                    if not np.any(pos_mask):
                        continue

                    valid_indices = np.nonzero(pos_mask)[0]
                    for idx in valid_indices:
                        sc = float(score_arr[idx, 0])
                        cx, cy = anchors[idx]
                        dist = bbox_arr[idx] * s
                        x1 = max(0, int((cx - dist[0]) / scale))
                        y1 = max(0, int((cy - dist[1]) / scale))
                        x2 = min(w, int((cx + dist[2]) / scale))
                        y2 = min(h, int((cy + dist[3]) / scale))
                        bw_box = x2 - x1
                        bh_box = y2 - y1

                        if bw_box >= 20 and bh_box >= 20 and is_valid_face_geometry((x1, y1, x2, y2), w, h):
                            candidates_boxes.append([x1, y1, bw_box, bh_box])
                            candidates_scores.append(sc)

                if not candidates_boxes:
                    return []

                # Подавление немаксимумов (NMS)
                nms_indices = cv2.dnn.NMSBoxes(candidates_boxes, candidates_scores, score_threshold=0.55, nms_threshold=0.4)
                if len(nms_indices) == 0:
                    return []

                sorted_indices = sorted(
                    nms_indices.flatten(),
                    key=lambda idx: candidates_boxes[idx][2] * candidates_boxes[idx][3],
                    reverse=True,
                )

                results = []
                for rank, i in enumerate(sorted_indices):
                    box = candidates_boxes[i]
                    sc = candidates_scores[i]
                    bx, by, bw_box, bh_box = box
                    if skip_arcface or (max_faces is not None and rank >= max_faces):
                        feat = np.zeros(512, dtype=np.float32)
                    else:
                        face_crop = img_bgr[by:by + bh_box, bx:bx + bw_box]
                        feat = self._extract_arcface(face_crop)
                    results.append(((bx, by, bw_box, bh_box), feat, sc))

                return results
            except Exception as e:
                logger.warning(f"Ошибка инференса SCRFD: {e}")
                return []

    def _extract_arcface(self, face_crop: np.ndarray) -> np.ndarray:
        """Извлечение 512-мерного L2-нормализованного вектора ArcFace (float32)."""
        if face_crop is None or face_crop.size == 0 or self.rec_session is None:
            return np.zeros(512, dtype=np.float32)
        try:
            face = cv2.resize(face_crop, (112, 112))
            face = cv2.cvtColor(face, cv2.COLOR_BGR2RGB)
            face = np.transpose(face, (2, 0, 1))
            face = np.expand_dims(face, axis=0).astype(np.float32)
            face = (face - 127.5) / 127.5
            feat = self.rec_session.run(None, {self.rec_input_name: face})[0][0]
            norm = np.linalg.norm(feat)
            if norm > 1e-6:
                feat = feat / norm
            else:
                feat = np.zeros(512, dtype=np.float32)
            return feat.astype(np.float32)
        except Exception:
            return np.zeros(512, dtype=np.float32)

    def extract_feature(self, aligned_or_feat: np.ndarray) -> np.ndarray:
        if aligned_or_feat is None:
            return np.zeros(512, dtype=np.float32)
        if isinstance(aligned_or_feat, np.ndarray) and aligned_or_feat.ndim == 1:
            norm = np.linalg.norm(aligned_or_feat)
            if norm > 1e-6:
                return (aligned_or_feat / norm).astype(np.float32)
            return aligned_or_feat.astype(np.float32)
        return self._extract_arcface(aligned_or_feat)


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
        with self._lock:
            has_clients = bool(self.active_connections)
        if not has_clients:
            return
        if self.loop and self.loop.is_running():
            asyncio.run_coroutine_threadsafe(self.broadcast(message), self.loop)


class FaceRecognitionCamera:
    """
    Основной модуль захвата видео и распознавания лиц для инфокиоска:
    - Автономный промышленный стек InsightFace Buffalo_l (SCRFD det_10g.onnx + ArcFace w600k_r50.onnx, 512-D).
    - Полная автономность (Air-Gapped): без обращений к внешним CDN и интернет-ресурсам.
    - Автоматический pass-through режим, если модели отсутствуют на сервере.
    - Раздельные потоки захвата и инференса.
    - Кулдаун фиксации подходов 15 секунд.
    - Непрерывный MJPEG-стриминг и WebSocket-оповещения.
    """
    def __init__(self):
        det_path, rec_path, models_dir = _resolve_model_paths()
        if det_path and rec_path and models_dir:
            try:
                self.vision = InsightFaceVision(det_path, rec_path, models_dir)
                self.detector = self.vision
                self.extractor = self.vision
                self.is_insightface = True
                self.detector_model_name = f"InsightFace SCRFD ({os.path.basename(det_path)})"
                self.recognizer_model_name = f"InsightFace ArcFace ({os.path.basename(rec_path)})"
                self.models_dir = models_dir
            except Exception as e:
                warn_msg = f"[InsightFace] ПРЕДУПРЕЖДЕНИЕ: Ошибка загрузки ONNX Runtime ({e}). Распознавание отключено, видеопоток работает в сквозном режиме."
                logger.warning(warn_msg)
                print(warn_msg)
                self.vision = None
                self.detector = None
                self.extractor = None
                self.is_insightface = False
                self.detector_model_name = "Отключено (ошибка ONNX)"
                self.recognizer_model_name = "Отключено (ошибка ONNX)"
                self.models_dir = None
        else:
            warn_msg = "[InsightFace] ПРЕДУПРЕЖДЕНИЕ: Модели buffalo_l (det_10g.onnx / w600k_r50.onnx) не найдены. Распознавание отключено, видеопоток работает в сквозном режиме."
            logger.warning(warn_msg)
            print(warn_msg)
            self.vision = None
            self.detector = None
            self.extractor = None
            self.is_insightface = False
            self.detector_model_name = "Отключено (buffalo_l не найден)"
            self.recognizer_model_name = "Отключено (buffalo_l не найден)"
            self.models_dir = None

        self.ws_manager = KioskWebSocketManager()

        self.camera_source: str = "0"
        self.video_source: str = "0"
        self.recognition_threshold: float = 0.48
        self.idle_timeout: int = 6  # Тайм-аут ухода преподавателя от камеры (секунд)
        self.is_active: bool = True

        self._running: bool = False
        self._lifecycle_lock = threading.Lock()
        self._session_stop: Optional[threading.Event] = None
        self.stop_event: threading.Event = threading.Event()
        self._capture_thread: Optional[threading.Thread] = None
        self._process_thread: Optional[threading.Thread] = None
        self.frame_queue: queue.Queue = queue.Queue(maxsize=1)
        self._frame_queue: queue.Queue = self.frame_queue
        self.frame_lock = threading.Lock()
        self._frame_lock = self.frame_lock

        # Счетчики последовательности кадров и детекций + кэш JPEG
        self._frame_seq: int = 0
        self._det_seq: int = 0
        self._jpeg_cache_lock = threading.Lock()
        self._cached_jpeg: Optional[bytes] = None
        self._cached_jpeg_key: Optional[Tuple[int, bool, int]] = None
        self._placeholder_jpeg: Optional[bytes] = None
        self._placeholder_ts: float = 0.0
        self._camera_connected: bool = False
        self._last_camera_error: Optional[str] = None

        # Замок и переменные для кэширования детекций (Double Buffering)
        self.results_lock = threading.Lock()
        self.cached_detections: List[Dict[str, Any]] = []
        self.last_detection_time: float = 0.0

        self.raw_frame: Optional[np.ndarray] = None
        self._raw_frame: Optional[np.ndarray] = None
        self.output_frame: Optional[np.ndarray] = None
        self._output_frame: Optional[np.ndarray] = None
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

        # Отслеживание и троттлинг событий FACE_RECOGNITION для WebSocket
        self._last_face_rec_payload: Optional[Dict[str, Any]] = None
        self._last_face_rec_time: float = 0.0
        self._last_face_seen_time: float = 0.0
        self._face_recognition_idle_broadcasted: bool = False

        self.log_callback: Optional[Callable[[int, float], Any]] = None

        # Синхронная загрузка базы эталонов при старте (потоки камеры запускаются в lifespan)
        self.load_known_faces()

    def _extract_face_embedding(self, image_path: str) -> Optional[np.ndarray]:
        """Извлечение 512-мерного L2-нормализованного вектора лица из файла изображения."""
        if self.vision is None or not os.path.exists(image_path):
            return None
        img = cv2.imread(image_path)
        if img is None or img.size == 0:
            return None
        results = self.vision.detect_and_align(img)
        if not results:
            return None
        # Сортировка по площади (w * h) - приоритет самого крупного лица
        results.sort(key=lambda item: item[0][2] * item[0][3], reverse=True)
        _, aligned_or_feat, _ = results[0]
        feat = self.vision.extract_feature(aligned_or_feat)
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
                    cached_encs = cache_data.get("encodings", [])
                    # Строгая проверка размерности вектора: только 512-D float32
                    if cached_encs and len(cached_encs) > 0 and len(cached_encs[0]) != 512:
                        print(f"[InsightFace] Несовпадение размерности векторов кэша ({len(cached_encs[0])} != 512). Требуется пересборка кэша.")
                        raise ValueError("Vector dimension mismatch")
                    self.known_face_encodings = cached_encs
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

        # 2. Если кэша нет или он невалиден — сканируем директорию uploads/teachers/
        if not os.path.exists(self.path_images) or self.vision is None:
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
                if emb is not None and len(emb) == 512:
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
        """Загрузка сохраненных 512-D векторов лиц преподавателей из PostgreSQL в оперативную память камеры."""
        if pool is None:
            try:
                from ..core import database as db_core
                pool = db_core.pool
            except Exception:
                try:
                    from app.core import database as db_core
                    pool = db_core.pool
                except Exception:
                    pass
        if pool is None:
            print("[Биометрия] Пул соединений с БД недоступен для загрузки эталонов.")
            return

        query_photos = """
            SELECT tp.id, tp.teacher_id, tp.file_path, tp.embedding, tp.is_primary,
                   TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name
            FROM public.teacher_photos tp
            JOIN public.people p ON tp.teacher_id = p.mid
            WHERE tp.embedding IS NOT NULL
            ORDER BY tp.teacher_id, tp.is_primary DESC, tp.created_at ASC;
        """
        try:
            async with pool.acquire() as conn:
                rows = await conn.fetch(query_photos)
                if not rows:
                    fallback_query = """
                        SELECT tb.teacher_id, tb.embedding, tb.photo_path AS file_path, TRUE AS is_primary,
                               TRIM(CONCAT_WS(' ', p.lastname, p.firstname, p.patronymic)) AS full_name
                        FROM public.teacher_biometrics tb
                        JOIN public.people p ON tb.teacher_id = p.mid
                        WHERE tb.embedding IS NOT NULL;
                    """
                    rows = await conn.fetch(fallback_query)
        except Exception as e:
            print(f"[Биометрия] Ошибка чтения биометрии из базы данных: {e}")
            return

        teachers_map: Dict[int, Dict[str, Any]] = {}

        for r in rows:
            t_id = r["teacher_id"]
            raw_bytes = r["embedding"]
            vec = None
            if raw_bytes and len(raw_bytes) == 2048:
                # 512 float32 чисел (2048 байт) — стандарт ArcFace
                vec = np.frombuffer(raw_bytes, dtype=np.float32).copy()
            elif r.get("file_path") and self.vision is not None:
                p_file = os.path.join(self.path_images, r["file_path"])
                if not os.path.exists(p_file):
                    p_file = os.path.join(PHOTOS_DIR, r["file_path"])
                if os.path.exists(p_file):
                    p_img = cv2.imread(p_file)
                    if p_img is not None:
                        e_bytes, _ = self.compute_embedding_from_image(p_img)
                        cand = np.frombuffer(e_bytes, dtype=np.float32).copy()
                        if len(cand) == 512 and np.linalg.norm(cand) > 1e-6:
                            vec = cand

            if vec is not None and len(vec) == 512:
                norm = np.linalg.norm(vec)
                if norm > 1e-6:
                    vec = vec / norm
                t_name = r["full_name"] or f"Преподаватель #{t_id}"
                if t_id not in teachers_map:
                    teachers_map[t_id] = {
                        "teacher_id": t_id,
                        "name": t_name,
                        "full_name": t_name,
                        "vectors": [],
                        "photo_path": r.get("file_path"),
                    }
                teachers_map[t_id]["vectors"].append(vec)
                if r.get("is_primary"):
                    teachers_map[t_id]["photo_path"] = r.get("file_path")

        teachers_dict = {}
        all_encodings = []
        all_names = []
        all_ids = []

        for t_id, t_info in teachers_map.items():
            if t_info["vectors"]:
                matrix = np.array(t_info["vectors"], dtype=np.float32)
                teachers_dict[t_id] = {
                    "teacher_id": t_id,
                    "name": t_info["name"],
                    "full_name": t_info["full_name"],
                    "embeddings": matrix,
                    "photo_path": t_info.get("photo_path"),
                }
                for v in t_info["vectors"]:
                    all_encodings.append(v)
                    all_names.append(t_info["name"])
                    all_ids.append(t_id)

        with self.inference_lock:
            self.known_teachers = teachers_dict
            self.known_face_encodings = all_encodings
            self.known_face_names = all_names
            self.known_teacher_ids = all_ids
        self._save_cache()
        print(f"[Биометрия] Успешно загружено {len(teachers_dict)} профилей преподавателей ({len(all_encodings)} эталонных фото) из БД.")

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
            if emb_bytes and len(emb_bytes) == 2048:
                vec = np.frombuffer(emb_bytes, dtype=np.float32).copy()
            elif r.get("photo_path") and self.vision is not None:
                p_file = os.path.join(PHOTOS_DIR, r["photo_path"])
                if os.path.exists(p_file):
                    p_img = cv2.imread(p_file)
                    if p_img is not None:
                        e_bytes, _ = self.compute_embedding_from_image(p_img)
                        cand = np.frombuffer(e_bytes, dtype=np.float32).copy()
                        if len(cand) == 512 and np.linalg.norm(cand) > 1e-6:
                            vec = cand

            if vec is not None and len(vec) == 512:
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
        self._save_cache()
        print(f"[База биометрии] Загружено {len(loaded)} эталонов преподавателей.")

    def compute_embedding_from_image(self, img_bgr: np.ndarray) -> Tuple[bytes, Tuple[int, int, int, int]]:
        if img_bgr is None or img_bgr.size == 0 or self.vision is None:
            return np.zeros(512, dtype=np.float32).tobytes(), (0, 0, 100, 100)

        h, w = img_bgr.shape[:2]
        results = self.vision.detect_and_align(img_bgr)
        if results:
            results.sort(key=lambda item: item[0][2] * item[0][3], reverse=True)
            bbox, aligned_or_feat, score = results[0]
            feat = self.vision.extract_feature(aligned_or_feat)
            norm = np.linalg.norm(feat)
            if norm > 1e-6:
                feat = feat / norm
            return feat.astype(np.float32).tobytes(), bbox

        return np.zeros(512, dtype=np.float32).tobytes(), (0, 0, w, h)

    def save_snapshot(
        self, teacher_id: int, full_name: Optional[str] = None
    ) -> Tuple[bool, str, Optional[bytes], Optional[str]]:
        raw = self.get_raw_snapshot()
        if raw is None or raw.size == 0:
            return False, "Камера отключена или не захватила кадр", None, None

        emb_bytes, bbox = self.compute_embedding_from_image(raw)
        vec = np.frombuffer(emb_bytes, dtype=np.float32).copy()
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

    def _open_capture_device(self, source) -> Optional[cv2.VideoCapture]:
        """Открытие камеры с учетом платформы и минимальным буфером."""
        if isinstance(source, str):
            source = source.strip()
            if source.isdigit():
                source = int(source)

        if isinstance(source, str) and source.startswith(('rtsp://', 'http://', 'https://')):
            try:
                # Используем TCP и таймаут 5с, чтобы мертвые RTSP потоки не вешали поток навсегда
                if "OPENCV_FFMPEG_CAPTURE_OPTIONS" not in os.environ:
                    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;tcp|stimeout;5000000"
                cap = cv2.VideoCapture(source, cv2.CAP_FFMPEG)
                if not cap or not cap.isOpened():
                    cap = cv2.VideoCapture(source)
                if cap and cap.isOpened():
                    try:
                        cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    except Exception:
                        pass
                    return cap
                if cap:
                    cap.release()
            except Exception as e:
                logger.warning(f"[Камера] Ошибка подключения к потоку {source}: {e}")
            return None

        sys_name = platform.system()
        backends: List[int] = [cv2.CAP_ANY]
        if isinstance(source, int):
            if sys_name == "Darwin":
                backends = [cv2.CAP_AVFOUNDATION]
            elif sys_name == "Linux":
                backends = [cv2.CAP_V4L2, cv2.CAP_ANY]

        cap = None
        for backend in backends:
            try:
                cand = cv2.VideoCapture(source, backend)
                if cand is not None and cand.isOpened():
                    cap = cand
                    break
                if cand is not None:
                    cand.release()
            except Exception as e:
                logger.warning(f"[Камера] Ошибка вызова VideoCapture({source}): {e}")

        if cap is not None:
            # Сброс буфера до 1 кадра: устраняет лаги, рассинхрон и задержку видео
            try:
                cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            except Exception:
                pass

            # На Linux для USB-камер пробуем MJPG для снижения нагрузки на USB-шину и CPU
            if sys_name == "Linux" and isinstance(source, int):
                try:
                    cap.set(cv2.CAP_PROP_FOURCC, cv2.VideoWriter_fourcc(*"MJPG"))
                except Exception:
                    pass

            # Задаем стабильное разрешение и частоту
            try:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 480)
                cap.set(cv2.CAP_PROP_FPS, 30)
            except Exception:
                pass

        return cap

    def _open_camera(self) -> Optional[cv2.VideoCapture]:
        return self._open_capture_device(self.camera_source)

    def get_jpeg_frame_with_meta(self) -> Tuple[Optional[bytes], Tuple[Any, ...], bool]:
        """
        Неблокирующее получение JPEG кадра с кэшированием сжатия.
        Даже при 10 открытых вкладках cv2.imencode выполняется не более 1 раза на кадр.
        Возвращает: (jpeg_bytes, cache_key, is_live).
        """
        with self.frame_lock:
            frame = self.raw_frame
            cur_seq = self._frame_seq

        if frame is None:
            now = time.time()
            with self._jpeg_cache_lock:
                # Обновляем заглушку максимум 1 раз в секунду вместо 30 раз/сек
                if self._placeholder_jpeg is not None and (now - self._placeholder_ts) < 1.0:
                    return self._placeholder_jpeg, ("placeholder", int(self._placeholder_ts)), False
                err_hint = self._last_camera_error or f"Connecting to camera ({self.camera_source})..."
                placeholder = self._create_placeholder_frame(err_hint)
                ok, jpeg = cv2.imencode('.jpg', placeholder, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
                if ok:
                    self._placeholder_jpeg = jpeg.tobytes()
                    self._placeholder_ts = now
                    return self._placeholder_jpeg, ("placeholder", int(now)), False
                return None, ("empty",), False

        with self.results_lock:
            cached_results = list(self.cached_detections)
            last_time = self.last_detection_time
            det_seq = self._det_seq

        overlay_active = (time.time() - last_time) < 1.5 and bool(cached_results)
        cache_key = (cur_seq, overlay_active, det_seq if overlay_active else 0)

        with self._jpeg_cache_lock:
            if self._cached_jpeg is not None and self._cached_jpeg_key == cache_key:
                return self._cached_jpeg, cache_key, True

        # Копируем кадр под коротким замком только если нужно перекодировать JPEG
        with self.frame_lock:
            latest = self.raw_frame
            if latest is None:
                return self._placeholder_jpeg, ("placeholder", int(self._placeholder_ts)), False
            frame_copy = latest.copy()

        if overlay_active and cached_results:
            for det in cached_results:
                self._draw_detection(frame_copy, det)

        with self.frame_lock:
            self.output_frame = frame_copy
            self._output_frame = frame_copy

        ok, jpeg = cv2.imencode('.jpg', frame_copy, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
        if not ok:
            return None, ("empty",), True

        jpeg_bytes = jpeg.tobytes()
        with self._jpeg_cache_lock:
            self._cached_jpeg = jpeg_bytes
            self._cached_jpeg_key = cache_key

        return jpeg_bytes, cache_key, True

    def get_jpeg_frame(self) -> Optional[bytes]:
        """Неблокирующее получение кадра для стрима (использует общий кэш JPEG)."""
        jpeg_bytes, _, _ = self.get_jpeg_frame_with_meta()
        return jpeg_bytes

    def _draw_detection(self, frame: np.ndarray, det: Dict[str, Any]):
        """Отрисовка только чистой зеленой рамки детекции без текста и вопросиков."""
        bbox = det.get("bbox")
        if not bbox or len(bbox) < 4:
            return
        x, y, bw, bh = [int(v) for v in bbox[:4]]
        # Рисуем строго только зеленый прямоугольник
        cv2.rectangle(frame, (x, y), (x + bw, y + bh), (0, 255, 0), 2)

    def _create_placeholder_frame(self, text: str = "Connecting to camera...") -> np.ndarray:
        frame = np.zeros((480, 640, 3), dtype=np.uint8)
        frame[:] = (15, 23, 42)
        for y in range(0, 480, 40):
            cv2.line(frame, (0, y), (640, y), (30, 41, 59), 1)
        for x in range(0, 640, 40):
            cv2.line(frame, (x, 0), (x, 480), (30, 41, 59), 1)

        cv2.putText(frame, "ARGUS KIOSK VISION", (20, 40), cv2.FONT_HERSHEY_SIMPLEX, 0.7, (56, 189, 248), 2)
        safe_text = text.encode("ascii", errors="ignore").decode("ascii") or "Connecting to camera..."
        cv2.putText(frame, safe_text[:48], (60, 240), cv2.FONT_HERSHEY_SIMPLEX, 0.65, (226, 232, 240), 2)
        t_str = time.strftime("%H:%M:%S")
        cv2.putText(frame, f"STATUS: STANDBY | TIME: {t_str}", (20, 450), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (148, 163, 184), 1)
        return frame

    def _stop_locked(self):
        """Остановка текущей сессии потоков под self._lifecycle_lock."""
        self._running = False
        if self._session_stop is not None:
            self._session_stop.set()
        self.stop_event.set()

        cap_t = self._capture_thread
        proc_t = self._process_thread
        self._capture_thread = None
        self._process_thread = None

        if cap_t and cap_t.is_alive():
            cap_t.join(timeout=3.5)
        if proc_t and proc_t.is_alive():
            proc_t.join(timeout=2.5)

        if self.cap:
            try:
                self.cap.release()
            except Exception:
                pass
            self.cap = None

        with self.frame_lock:
            self.raw_frame = None
            self._raw_frame = None
            self.output_frame = None
            self._output_frame = None

        with self.results_lock:
            self.cached_detections = []
            self.last_detection_time = 0.0
            self._det_seq += 1

        with self._jpeg_cache_lock:
            self._cached_jpeg = None
            self._cached_jpeg_key = None
            self._placeholder_jpeg = None

        self._camera_connected = False

    def start(self, camera_source: str = "0", threshold: float = 0.48, idle_timeout: int = 6, is_active: bool = True, flip_horizontal: bool = True):
        with self._lifecycle_lock:
            if self._running or self._capture_thread is not None or self._process_thread is not None:
                self._stop_locked()

            self.camera_source = str(camera_source).strip()
            self.video_source = self.camera_source
            self.recognition_threshold = threshold
            self.idle_timeout = idle_timeout
            self.is_active = is_active
            self.flip_horizontal = flip_horizontal
            self._last_camera_error = None

            # Создаем индивидуальный Event на сессию, чтобы старые потоки никогда не ожили после restart
            session_stop = threading.Event()
            self._session_stop = session_stop
            self.stop_event = session_stop
            self._running = True

            self._capture_thread = threading.Thread(
                target=self._capture_loop,
                args=(session_stop, self.camera_source),
                name="CameraCaptureThread",
                daemon=True,
            )
            self._process_thread = threading.Thread(
                target=self._process_loop,
                args=(session_stop,),
                name="CameraProcessThread",
                daemon=True,
            )

            self._capture_thread.start()
            self._process_thread.start()
            logger.info(
                f"[Камера] Видеомодуль запущен: источник={self.camera_source}, "
                f"порог={self.recognition_threshold}, зеркало={self.flip_horizontal}"
            )

    def set_flip_horizontal(self, flip: bool):
        self.flip_horizontal = bool(flip)

    def stop(self):
        with self._lifecycle_lock:
            self._stop_locked()

    def restart_camera(self, camera_source: str, threshold: Optional[float] = None, idle_timeout: Optional[int] = None, is_active: Optional[bool] = None, flip_horizontal: Optional[bool] = None):
        th = threshold if threshold is not None else self.recognition_threshold
        to = idle_timeout if idle_timeout is not None else self.idle_timeout
        act = is_active if is_active is not None else self.is_active
        flip = flip_horizontal if flip_horizontal is not None else self.flip_horizontal
        self.start(camera_source=camera_source, threshold=th, idle_timeout=to, is_active=act, flip_horizontal=flip)

    def _capture_loop(self, stop_ev: threading.Event, source: str):
        """Непрерывный захват свежих кадров в отдельном потоке с защитой от спина и спама в логи."""
        cap: Optional[cv2.VideoCapture] = None
        backoff_steps = [2.0, 5.0, 10.0, 20.0, 30.0]
        backoff_idx = 0
        next_open_attempt = 0.0
        consecutive_failures = 0
        has_received_first_frame = False
        error_logged = False

        try:
            while not stop_ev.is_set() and self._running:
                if cap is None or not cap.isOpened():
                    now = time.time()
                    if now >= next_open_attempt:
                        if cap is not None:
                            try:
                                cap.release()
                            except Exception:
                                pass
                            cap = None

                        opened_cap = self._open_capture_device(source)
                        if stop_ev.is_set() or not self._running:
                            if opened_cap is not None:
                                try:
                                    opened_cap.release()
                                except Exception:
                                    pass
                            break

                        if opened_cap is not None and opened_cap.isOpened():
                            cap = opened_cap
                            self.cap = cap
                            backoff_idx = 0
                            consecutive_failures = 0
                            has_received_first_frame = False
                            error_logged = False
                            self._last_camera_error = None
                        else:
                            delay = backoff_steps[min(backoff_idx, len(backoff_steps) - 1)]
                            backoff_idx += 1
                            next_open_attempt = time.time() + delay
                            self._camera_connected = False
                            self._last_camera_error = f"Camera source '{source}' unavailable"
                            if not error_logged:
                                logger.warning(f"[Камера] Источник '{source}' недоступен. Повторное подключение в фоне.")
                                error_logged = True
                    stop_ev.wait(0.5)
                    continue

                loop_t0 = time.time()
                try:
                    ret, frame = cap.read()
                    if stop_ev.is_set() or not self._running:
                        break

                    if not ret or frame is None or frame.size == 0:
                        consecutive_failures += 1
                        # На холодном старте (AVFoundation/V4L2) допускаем до 100 попыток прогрева (~3с)
                        fail_limit = 50 if has_received_first_frame else 100
                        if consecutive_failures >= fail_limit:
                            logger.warning(f"[Камера] Потерян сигнал источника '{source}', переподключение...")
                            self._camera_connected = False
                            self._last_camera_error = f"Signal lost ({source})"
                            with self.frame_lock:
                                self.raw_frame = None
                                self._raw_frame = None
                            try:
                                cap.release()
                            except Exception:
                                pass
                            cap = None
                            self.cap = None
                            consecutive_failures = 0
                            has_received_first_frame = False
                            next_open_attempt = time.time() + 2.0
                            continue
                        stop_ev.wait(0.03)
                        continue

                    consecutive_failures = 0
                    has_received_first_frame = True
                    if not self._camera_connected:
                        self._camera_connected = True
                        self._last_camera_error = None
                        logger.info(f"[Камера] Видеопоток активен ({frame.shape[1]}x{frame.shape[0]}, источник={source})")

                    if self.flip_horizontal:
                        frame = cv2.flip(frame, 1)

                    with self.frame_lock:
                        self.raw_frame = frame
                        self._raw_frame = frame
                        self._frame_seq += 1

                    elapsed = time.time() - loop_t0
                    if elapsed < 0.025:
                        stop_ev.wait(0.025 - elapsed)

                except cv2.error:
                    stop_ev.wait(0.05)
                except Exception:
                    stop_ev.wait(0.05)
        finally:
            if cap is not None:
                try:
                    cap.release()
                except Exception:
                    pass
            if self.cap is cap:
                self.cap = None
            self._camera_connected = False

    def _run_detection(
        self,
        frame_to_process: np.ndarray,
        max_faces: Optional[int] = 1,
        det_size: int = 320,
        skip_arcface: bool = False,
    ) -> Tuple[List[Tuple[Tuple[int, int, int, int], np.ndarray, float]], float]:
        """
        Даунскейл кадра перед детекцией (ширина не более 640px)
        и инференс детектора SCRFD Buffalo_l без удержания замков.
        """
        if self.vision is None or frame_to_process is None or frame_to_process.size == 0:
            return [], 1.0

        h, w = frame_to_process.shape[:2]
        if w > 640:
            scale = 640.0 / w
            small_frame = cv2.resize(frame_to_process, (640, int(h * scale)))
        else:
            scale = 1.0
            small_frame = frame_to_process

        faces_data = self.vision.detect_and_align(
            small_frame,
            max_faces=max_faces,
            det_size=det_size,
            skip_arcface=skip_arcface,
        )
        return faces_data, scale

    def _run_recognition(
        self,
        frame_to_process: np.ndarray,
        faces_data: List[Tuple[Tuple[int, int, int, int], np.ndarray, float]],
        scale: float = 1.0,
    ) -> Tuple[List[Dict[str, Any]], Optional[int], Optional[str], float]:
        """
        Масштабирование координат рамок обратно на 1.0 / scale и сопоставление векторов ArcFace.
        """
        if not faces_data:
            return [], None, None, 0.0

        inv_scale = 1.0 / scale if scale > 0 else 1.0

        with self.inference_lock:
            if isinstance(self.known_teachers, dict):
                teachers_snapshot = dict(self.known_teachers)
            else:
                teachers_snapshot = {
                    t["teacher_id"]: {
                        "teacher_id": t["teacher_id"],
                        "name": t.get("full_name") or t.get("name"),
                        "full_name": t.get("full_name") or t.get("name"),
                        "embeddings": np.array([t["vector"]], dtype=np.float32) if "vector" in t else t.get("embeddings"),
                    }
                    for t in self.known_teachers if t.get("teacher_id") is not None
                }

        sorted_faces = sorted(faces_data, key=lambda item: item[0][2] * item[0][3], reverse=True)

        results = []
        best_sim = 0.0
        best_id = None
        best_name = None

        for bbox, face_emb, score in sorted_faces:
            bx, by, bw, bh = bbox
            orig_x = max(0, int(bx * inv_scale))
            orig_y = max(0, int(by * inv_scale))
            orig_w = max(1, int(bw * inv_scale))
            orig_h = max(1, int(bh * inv_scale))
            orig_bbox = [orig_x, orig_y, orig_w, orig_h]

            face_max_sim = 0.0
            matched_id = None
            matched_name = None

            current_embedding = face_emb.flatten()
            c_norm = np.linalg.norm(current_embedding)
            if c_norm > 1e-6:
                current_embedding = current_embedding / c_norm

                for t_id, teacher in teachers_snapshot.items():
                    embs = teacher.get("embeddings")
                    if embs is None or len(embs) == 0:
                        continue
                    # Мультивекторное сравнение со всеми снимками преподавателя
                    sims = np.dot(embs, current_embedding)
                    teacher_max_sim = float(np.max(sims))
                    if teacher_max_sim > face_max_sim:
                        face_max_sim = teacher_max_sim
                        if teacher_max_sim >= self.recognition_threshold:
                            matched_id = t_id
                            matched_name = teacher.get("name") or teacher.get("full_name")

            # В результатах для оверлея сохраняем только bbox для чистой рамки
            results.append({
                "bbox": orig_bbox,
                "score": round(face_max_sim, 2),
                "matched_id": matched_id,
            })

            if matched_id and best_id is None:
                best_sim = face_max_sim
                best_id = matched_id
                best_name = matched_name
            elif best_id is None and face_max_sim > best_sim:
                best_sim = face_max_sim

        return results, best_id, best_name, best_sim

    def _handle_idle_state(self, now: float):
        """Проверка таймаутов ухода преподавателя и сброс UI статуса при простое."""
        if (now - self._last_face_seen_time) > 1.5 and not self._face_recognition_idle_broadcasted:
            idle_payload = {
                "type": "FACE_RECOGNITION",
                "event": "FACE_RECOGNITION",
                "recognized": False,
                "name": None,
                "similarity": 0.0,
                "teacher_id": None,
            }
            self._last_face_rec_payload = idle_payload
            self._last_face_rec_time = now
            self._face_recognition_idle_broadcasted = True
            self.ws_manager.broadcast_from_thread(idle_payload)

        if self._active_teacher_id is not None and (now - self._last_seen_time) > self.idle_timeout:
            logger.info(f"Преподаватель #{self._active_teacher_id} отошел от экрана. Возврат в общее расписание.")
            self._active_teacher_id = None
            self._history.clear()
            self._last_detected_id = None
            self.ws_manager.broadcast_from_thread({
                "event": "TIMEOUT_EXPIRED",
                "timestamp": time.strftime("%Y-%m-%d %H:%M:%S"),
            })

    def _process_loop(self, stop_ev: threading.Event):
        """Неблокирующий поток инференса с кэшированием детекций, детектором движения и ограничением CPU."""
        last_processed_seq = -1
        prev_tiny: Optional[np.ndarray] = None
        last_full_scan_time = 0.0
        last_arcface_time = 0.0

        while not stop_ev.is_set() and self._running:
            now = time.time()

            # 1. Минимальная область видимости frame_lock (только проверка seq и копия)
            with self.frame_lock:
                cur_seq = self._frame_seq
                if self.raw_frame is None or not self.is_active or cur_seq == last_processed_seq:
                    frame_to_process = None
                else:
                    frame_to_process = self.raw_frame.copy()
                    last_processed_seq = cur_seq

            if frame_to_process is None:
                self._handle_idle_state(now)
                stop_ev.wait(0.05)
                continue

            # Pass-through сквозной режим, если модели InsightFace отсутствуют
            if self.vision is None:
                stop_ev.wait(0.1)
                continue

            # 2. Быстрый сглаженный детектор движения для экономии CPU (игнорирует шум сенсора)
            tiny_gray = cv2.GaussianBlur(
                cv2.cvtColor(cv2.resize(frame_to_process, (64, 48)), cv2.COLOR_BGR2GRAY),
                (5, 5),
                0,
            )
            motion_pct = 1.0
            motion_mean = 10.0
            if prev_tiny is not None:
                diff = cv2.absdiff(prev_tiny, tiny_gray)
                motion_pct = float(np.mean(diff > 14))
                motion_mean = float(np.mean(diff))
            prev_tiny = tiny_gray
            has_motion = (motion_pct >= 0.015) or (motion_mean >= 2.2)

            face_tracking_active = (
                self._active_teacher_id is not None
                or bool(self.cached_detections)
                or (now - self._last_face_seen_time) < 3.0
            )
            periodic_scan_due = (now - last_full_scan_time) >= 1.5

            if not face_tracking_active and not has_motion and not periodic_scan_due:
                self._handle_idle_state(now)
                stop_ev.wait(0.2)
                continue

            # 3. Адаптивный запуск ArcFace (ResNet-50): при удержании лица в кадре сверяем вектор периодически,
            #    а в промежутках используем только быстрый SCRFD 320x320 (~100мс) для плавной рамки
            arcface_interval = 1.2 if self._active_teacher_id is not None else 0.7
            run_arcface_now = (now - last_arcface_time) >= arcface_interval

            t_infer_start = time.time()
            last_full_scan_time = t_infer_start
            faces, scale = self._run_detection(
                frame_to_process,
                max_faces=1,
                det_size=320,
                skip_arcface=not run_arcface_now,
            )
            results, detected_cand_id, detected_cand_name, max_sim = self._run_recognition(
                frame_to_process, faces, scale
            )
            infer_elapsed = time.time() - t_infer_start

            now = time.time()
            if faces and run_arcface_now:
                last_arcface_time = now
            elif not faces:
                last_arcface_time = 0.0

            # 4. Кэширование рамок (Double Buffering) под отдельным коротким замком
            with self.results_lock:
                if results:
                    self.cached_detections = results
                    self.last_detection_time = now
                    self._det_seq += 1
                elif self.cached_detections and (now - self.last_detection_time) >= 1.5:
                    self.cached_detections = []
                    self._det_seq += 1

            # Если лицо видно, но на этом проходе ArcFace был пропущен — обновляем таймер присутствия без сброса UI статуса
            if faces and not run_arcface_now:
                self._last_face_seen_time = now
                if self._active_teacher_id is not None:
                    self._last_seen_time = now
                stop_ev.wait(0.22)
                continue

            # 5. Рассылка статуса FACE_RECOGNITION через WebSocket
            face_rec_payload = None
            if faces:
                self._last_face_seen_time = now
                self._face_recognition_idle_broadcasted = False

                if detected_cand_id is not None and max_sim >= self.recognition_threshold:
                    face_rec_payload = {
                        "type": "FACE_RECOGNITION",
                        "event": "FACE_RECOGNITION",
                        "recognized": True,
                        "name": detected_cand_name,
                        "similarity": round(float(max_sim), 2),
                        "teacher_id": detected_cand_id,
                    }
                else:
                    face_rec_payload = {
                        "type": "FACE_RECOGNITION",
                        "event": "FACE_RECOGNITION",
                        "recognized": False,
                        "name": "Я не знаю такого",
                        "similarity": 0.0,
                        "teacher_id": None,
                    }
            else:
                if (now - self._last_face_seen_time) > 1.5:
                    face_rec_payload = {
                        "type": "FACE_RECOGNITION",
                        "event": "FACE_RECOGNITION",
                        "recognized": False,
                        "name": None,
                        "similarity": 0.0,
                        "teacher_id": None,
                    }

            if face_rec_payload is not None:
                payload_changed = (
                    self._last_face_rec_payload is None
                    or self._last_face_rec_payload.get("recognized") != face_rec_payload.get("recognized")
                    or self._last_face_rec_payload.get("name") != face_rec_payload.get("name")
                    or self._last_face_rec_payload.get("teacher_id") != face_rec_payload.get("teacher_id")
                )
                time_since_last = now - self._last_face_rec_time

                if payload_changed:
                    self._last_face_rec_payload = face_rec_payload
                    self._last_face_rec_time = now
                    self.ws_manager.broadcast_from_thread(face_rec_payload)
                    if face_rec_payload.get("name") is None:
                        self._face_recognition_idle_broadcasted = True
                elif not self._face_recognition_idle_broadcasted and time_since_last >= 1.5:
                    self._last_face_rec_time = now
                    self.ws_manager.broadcast_from_thread(face_rec_payload)

            # 6. Сглаживание предсказаний через скользящее окно
            self._history.append((detected_cand_id, detected_cand_name, max_sim))

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

            # 7. Адаптивная пауза после инференса, чтобы CPU никогда не упирался в 100%
            cooldown = max(0.22, min(0.50, infer_elapsed * 0.6))
            stop_ev.wait(cooldown)

    def get_raw_snapshot(self) -> Optional[np.ndarray]:
        with self.frame_lock:
            frame = self.raw_frame if self.raw_frame is not None else self._raw_frame
            if frame is not None:
                return frame.copy()
        return None

    def get_raw_snapshot_jpeg(self) -> Optional[bytes]:
        frame = self.get_raw_snapshot()
        if frame is not None:
            ret, buf = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            if ret:
                return buf.tobytes()
        return None

    def generate_mjpeg_stream(self):
        """Синхронный генератор кадров с кэшированием и адаптивной частотой."""
        last_key = None
        while True:
            frame_bytes, cur_key, is_live = self.get_jpeg_frame_with_meta()
            if frame_bytes and cur_key != last_key:
                last_key = cur_key
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
                )
            time.sleep(0.035 if is_live else 0.5)


# Глобальный синглтон
camera_service = FaceRecognitionCamera()
face_recognition_service = camera_service
FaceRecognitionManager = FaceRecognitionCamera
