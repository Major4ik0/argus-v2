# -*- coding: utf-8 -*-
import os
import time
import platform
import threading
import warnings
from queue import Queue
from collections import deque, Counter
from typing import List, Optional, Tuple

import cv2
import numpy as np

from ..services.camera import camera_service
from .database import mark_attendance

warnings.filterwarnings("ignore", category=FutureWarning)


class JournalFaceRecognitionCamera:
    """
    Неблокирующий модуль видеоаналитики для электронного журнала посещаемости:
    - Использует уже загруженные ONNX-модели ARGUS (`camera_service.vision`) без дублирования RAM.
    - При совпадении источника с основной камерой киоска берет кадры из `camera_service.get_raw_snapshot()`
      без повторного захвата устройства (исключает блокировки AVFoundation и рост CPU).
    - При задании отдельного RTSP-потока / другой камеры запускает собственный поток захвата.
    """

    def __init__(self, path_images: str, video_source="0", delay: float = 15.0):
        self.path_images = path_images
        os.makedirs(self.path_images, exist_ok=True)

        self.video_source_raw = str(video_source or "0").strip()
        self.video_source = self._parse_source(self.video_source_raw)
        self.delay = delay
        self.similarity_threshold = 0.48

        self.known_face_encodings: List[np.ndarray] = []
        self.known_face_names: List[str] = []
        self.last_detected_name: str = ""
        self.last_detection_time: float = 0.0

        self.inference_lock = threading.Lock()
        self.frame_lock = threading.Lock()
        self._lifecycle_lock = threading.Lock()
        self.frame_queue: Queue = Queue(maxsize=1)

        self.running = False
        self.processing = False

        self.name_history = deque(maxlen=5)
        self.display_name = "Unknown"
        self.active_recognized_names: List[str] = []
        self.unknown_present = False

        self.capture_fps = 0.0
        self.process_fps = 0.0

        self.cap = None
        self.output_frame: Optional[np.ndarray] = None
        self.raw_frame: Optional[np.ndarray] = None
        self._cached_placeholder: Optional[bytes] = None
        self.cached_boxes: list = []
        self.cached_boxes_time: float = 0.0

        self._last_viewer_time: float = 0.0
        self.capture_thread: Optional[threading.Thread] = None
        self.process_thread: Optional[threading.Thread] = None

        self.load_known_faces()

    @staticmethod
    def _parse_source(source):
        s = str(source).strip()
        if s.isdigit():
            return int(s)
        return s

    def touch_viewer(self) -> None:
        self._last_viewer_time = time.time()

    def uses_shared_camera(self) -> bool:
        argus_src = str(getattr(camera_service, "camera_source", "0")).strip()
        cur_src = str(self.video_source_raw).strip()
        if cur_src.startswith(("rtsp://", "http://", "https://")):
            return False
        return cur_src == argus_src

    def _get_vision(self):
        return getattr(camera_service, "vision", None)

    def _extract_face_embedding(self, image_path: str) -> Optional[np.ndarray]:
        vision = self._get_vision()
        if vision is None:
            return None
        try:
            img = self._imread_unicode(image_path)
            if img is None:
                return None

            faces = vision.detect_and_align(img, max_faces=1, det_size=640, skip_arcface=False)
            if not faces:
                enhanced = self._enhance_contrast(img)
                faces = vision.detect_and_align(enhanced, max_faces=1, det_size=640, skip_arcface=False)

            if not faces:
                return None

            faces.sort(key=lambda item: item[0][2] * item[0][3], reverse=True)
            _, feat, _ = faces[0]
            norm = np.linalg.norm(feat)
            if norm > 1e-6:
                return (feat / norm).astype(np.float32)
            return None
        except Exception as e:
            print(f"[Journal] Ошибка извлечения эмбеддинга из {image_path}: {e}")
            return None

    def load_known_faces(self) -> None:
        if not os.path.exists(self.path_images):
            return

        new_encodings: List[np.ndarray] = []
        new_names: List[str] = []

        for item in sorted(os.listdir(self.path_images)):
            if item.startswith("."):
                continue
            item_path = os.path.join(self.path_images, item)
            if os.path.isdir(item_path):
                student_name = item
                for filename in sorted(os.listdir(item_path)):
                    if filename.lower().endswith((".jpg", ".jpeg", ".png")):
                        emb = self._extract_face_embedding(os.path.join(item_path, filename))
                        if emb is not None:
                            new_encodings.append(emb)
                            new_names.append(student_name)
            elif item.lower().endswith((".jpg", ".jpeg", ".png")):
                student_name = os.path.splitext(item)[0]
                emb = self._extract_face_embedding(item_path)
                if emb is not None:
                    new_encodings.append(emb)
                    new_names.append(student_name)

        with self.inference_lock:
            self.known_face_encodings = new_encodings
            self.known_face_names = new_names

        print(f"[Journal] Загружено эмбеддингов студентов: {len(self.known_face_encodings)}")

    def load_fresh_faces(self) -> None:
        self.load_known_faces()

    def add_single_face(self, image_path: str, name: str) -> bool:
        emb = self._extract_face_embedding(image_path)
        if emb is None:
            return False
        with self.inference_lock:
            self.known_face_encodings.append(emb)
            self.known_face_names.append(name)
        return True

    def ensure_started(self) -> None:
        with self._lifecycle_lock:
            if not self.running:
                self.start_threads()

    def _open_dedicated_camera(self):
        is_rtsp = isinstance(self.video_source, str) and self.video_source.startswith(("rtsp://", "http://", "https://"))
        if is_rtsp:
            for transport in ("tcp", "udp"):
                try:
                    os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = (
                        f"rtsp_transport;{transport}|fflags;nobuffer|max_delay;500000|flags;low_delay"
                    )
                    cap = cv2.VideoCapture(self.video_source, cv2.CAP_FFMPEG)
                    cap.set(cv2.CAP_PROP_BUFFERSIZE, 1)
                    if cap.isOpened():
                        ret, frame = cap.read()
                        if ret and frame is not None and frame.size > 0:
                            print(f"[Journal Camera] Подключен RTSP ({transport}): {self.video_source}")
                            return cap
                        cap.release()
                except Exception as e:
                    print(f"[Journal Camera] Ошибка RTSP ({transport}): {e}")
            return None

        backend = cv2.CAP_AVFOUNDATION if platform.system() == "Darwin" else cv2.CAP_ANY
        cap = cv2.VideoCapture(self.video_source, backend)
        if cap.isOpened():
            cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
            cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)
            return cap
        return None

    def capture_frames(self) -> None:
        frame_count = 0
        fps_start = time.time()
        last_infer_push = 0.0

        while self.running:
            now = time.time()
            has_viewer = (now - self._last_viewer_time) < 6.0

            if self.uses_shared_camera():
                # Без открытой вкладки журнала не запускаем лишнюю копию инференса поверх киоска
                if not has_viewer:
                    time.sleep(0.4)
                    continue
                frame = camera_service.get_raw_snapshot()
                if frame is None:
                    with self.frame_lock:
                        self.output_frame = None
                    time.sleep(0.25)
                    continue
            else:
                if not self.cap or not self.cap.isOpened():
                    time.sleep(0.5)
                    continue
                ret, frame = self.cap.read()
                if not ret or frame is None or frame.size == 0:
                    time.sleep(0.05)
                    continue

            with self.frame_lock:
                self.raw_frame = frame.copy()

            # Ограничиваем частоту подачи кадров на инференс для снижения нагрузки на CPU
            infer_interval = 0.75 if has_viewer else 1.2
            if (now - last_infer_push) >= infer_interval and self.frame_queue.empty():
                try:
                    self.frame_queue.put_nowait(frame.copy())
                    last_infer_push = now
                except Exception:
                    pass

            if has_viewer:
                display = frame.copy()
                with self.frame_lock:
                    if self.cached_boxes and (now - self.cached_boxes_time < 1.0):
                        for box in self.cached_boxes:
                            left, top, right, bottom = box["bbox"]
                            color = box["color"]
                            cv2.rectangle(display, (left, top), (right, bottom), color, 2)
                    self.output_frame = display

            frame_count += 1
            if frame_count >= 20:
                elapsed = time.time() - fps_start
                if elapsed > 0:
                    self.capture_fps = frame_count / elapsed
                frame_count = 0
                fps_start = time.time()

            time.sleep(0.08 if (self.uses_shared_camera() and has_viewer) else (0.4 if self.uses_shared_camera() else 0.01))

    def process_frames(self) -> None:
        frame_count = 0
        fps_start = time.time()

        while self.processing:
            try:
                try:
                    frame = self.frame_queue.get(timeout=0.2)
                except Exception:
                    continue

                vision = self._get_vision()
                if vision is None:
                    time.sleep(0.2)
                    continue

                with self.inference_lock:
                    known_matrix = (
                        np.array(self.known_face_encodings, dtype=np.float32)
                        if self.known_face_encodings
                        else None
                    )
                    known_names = list(self.known_face_names)

                has_known = known_matrix is not None and len(known_matrix) > 0
                faces = vision.detect_and_align(
                    frame,
                    max_faces=3,
                    det_size=320,
                    skip_arcface=not has_known,
                )

                detected_boxes = []
                recognized_list: List[str] = []
                any_unknown = False
                h, w = frame.shape[:2]

                for (bx, by, bw, bh), feat, _score in faces:
                    left = max(0, int(bx))
                    top = max(0, int(by))
                    right = min(w, int(bx + bw))
                    bottom = min(h, int(by + bh))

                    face_name = "Unknown"
                    is_recognized = False

                    if has_known and feat is not None and np.linalg.norm(feat) > 1e-6:
                        sims = np.dot(known_matrix, feat)
                        best_idx = int(np.argmax(sims))
                        best_score = float(sims[best_idx])
                        if best_score >= self.similarity_threshold:
                            face_name = known_names[best_idx]
                            is_recognized = True
                            if face_name not in recognized_list:
                                recognized_list.append(face_name)

                    if not is_recognized:
                        any_unknown = True

                    color = (0, 220, 120) if is_recognized else (0, 165, 255)
                    detected_boxes.append(
                        {
                            "bbox": (left, top, right, bottom),
                            "label": face_name,
                            "color": color,
                            "recognized": is_recognized,
                        }
                    )

                primary_name = recognized_list[0] if recognized_list else "Unknown"
                self.name_history.append(primary_name)
                if self.name_history:
                    self.display_name = Counter(self.name_history).most_common(1)[0][0]
                self.active_recognized_names = recognized_list
                self.unknown_present = any_unknown and not recognized_list

                if self.display_name != "Unknown":
                    now = time.time()
                    if (
                        self.display_name != self.last_detected_name
                        or (now - self.last_detection_time) > self.delay
                    ):
                        self.save_attendance(self.display_name)
                        self.last_detected_name = self.display_name
                        self.last_detection_time = now

                with self.frame_lock:
                    self.cached_boxes = detected_boxes
                    self.cached_boxes_time = time.time()

                frame_count += 1
                if frame_count >= 10:
                    elapsed = time.time() - fps_start
                    if elapsed > 0:
                        self.process_fps = frame_count / elapsed
                    frame_count = 0
                    fps_start = time.time()

            except Exception as e:
                print(f"[Journal] Ошибка в потоке обработки: {e}")
                time.sleep(0.1)

    def _get_placeholder_jpeg(self) -> bytes:
        if self._cached_placeholder is None:
            img = np.zeros((360, 640, 3), dtype=np.uint8)
            img[:] = (17, 24, 39)
            cv2.putText(
                img,
                "NO CAMERA SIGNAL",
                (170, 185),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.9,
                (148, 163, 184),
                2,
                cv2.LINE_AA,
            )
            ok, jpeg = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
            self._cached_placeholder = jpeg.tobytes() if ok else b""
        return self._cached_placeholder

    def get_jpeg_frame(self) -> bytes:
        self.touch_viewer()
        with self.frame_lock:
            frame = self.output_frame.copy() if self.output_frame is not None else None
        if frame is None:
            snap = camera_service.get_raw_snapshot() if self.uses_shared_camera() else None
            if snap is None:
                return self._get_placeholder_jpeg()
            frame = snap
        ok, jpeg = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
        return jpeg.tobytes() if ok else self._get_placeholder_jpeg()

    def save_snapshot(self, file_path: str) -> bool:
        try:
            with self.frame_lock:
                if self.raw_frame is not None:
                    frame_to_save = self.raw_frame.copy()
                else:
                    frame_to_save = None

            if frame_to_save is None and self.uses_shared_camera():
                frame_to_save = camera_service.get_raw_snapshot()

            if frame_to_save is None:
                return False

            return self._imwrite_unicode(file_path, frame_to_save)
        except Exception as e:
            print(f"[Journal] Ошибка сохранения снимка: {e}")
            return False

    def start_threads(self) -> None:
        if self.running:
            return
        self.cap = None if self.uses_shared_camera() else self._open_dedicated_camera()
        self.running = True
        self.processing = True

        self.capture_thread = threading.Thread(target=self.capture_frames, daemon=True)
        self.process_thread = threading.Thread(target=self.process_frames, daemon=True)
        self.capture_thread.start()
        self.process_thread.start()

    def stop_threads(self) -> None:
        with self._lifecycle_lock:
            self.running = False
            self.processing = False

            if self.capture_thread is not None and self.capture_thread.is_alive():
                self.capture_thread.join(timeout=1.5)
            if self.process_thread is not None and self.process_thread.is_alive():
                self.process_thread.join(timeout=1.5)

            with self.frame_lock:
                if self.cap is not None:
                    try:
                        self.cap.release()
                    except Exception:
                        pass
                    self.cap = None

    def change_source(self, new_source: str) -> None:
        self.stop_threads()
        while not self.frame_queue.empty():
            try:
                self.frame_queue.get_nowait()
            except Exception:
                break
        self.video_source_raw = str(new_source or "0").strip()
        self.video_source = self._parse_source(self.video_source_raw)
        self.start_threads()

    def save_attendance(self, name: str) -> None:
        try:
            mark_attendance(student_name=name)
            print(f"[Journal] Отмечен студент: {name}")
        except Exception as e:
            print(f"[Journal] Ошибка сохранения посещаемости: {e}")

    @staticmethod
    def _enhance_contrast(image_bgr: np.ndarray) -> np.ndarray:
        try:
            lab = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2LAB)
            l, a, b = cv2.split(lab)
            clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
            cl = clahe.apply(l)
            return cv2.cvtColor(cv2.merge((cl, a, b)), cv2.COLOR_LAB2BGR)
        except Exception:
            return image_bgr

    @staticmethod
    def _imread_unicode(path: str):
        try:
            data = np.fromfile(path, dtype=np.uint8)
            img = cv2.imdecode(data, cv2.IMREAD_COLOR)
            if img is not None:
                return img
        except Exception:
            pass
        return cv2.imread(path)

    @staticmethod
    def _imwrite_unicode(path: str, img) -> bool:
        try:
            ext = os.path.splitext(path)[1] or ".jpg"
            ok, buf = cv2.imencode(ext, img)
            if ok:
                buf.tofile(path)
                return True
        except Exception:
            pass
        return bool(cv2.imwrite(path, img))
