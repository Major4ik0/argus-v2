# -*- coding: utf-8 -*-
import json
import logging
import asyncio
import threading
from datetime import datetime
from collections import deque
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query

router = APIRouter()

# Кольцевой буфер на 500 записей
log_buffer: deque = deque(maxlen=500)


class LogWebSocketManager:
    """Управление постоянными WebSocket-клиентами для стриминга логов в реальном времени."""

    def __init__(self, buffer: deque):
        self.active_connections: List[WebSocket] = []
        self._lock = threading.Lock()
        self.loop: Optional[asyncio.AbstractEventLoop] = None
        self.buffer = buffer

    def set_loop(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        with self._lock:
            self.active_connections.append(websocket)

        # При подключении сразу отправляем последние 100 строк
        initial_logs = list(self.buffer)[-100:]
        try:
            await websocket.send_json({
                "type": "INIT_LOGS",
                "logs": initial_logs
            })
        except Exception:
            self.disconnect(websocket)

    def disconnect(self, websocket: WebSocket):
        with self._lock:
            if websocket in self.active_connections:
                self.active_connections.remove(websocket)

    def broadcast_log(self, entry: Dict[str, Any]):
        """Потокобезопасная отправка новой записи всем подключенным клиентам."""
        if not self.loop or not self.loop.is_running():
            return

        with self._lock:
            conns = list(self.active_connections)

        if not conns:
            return

        async def _send_all():
            dead = []
            msg = {"type": "NEW_LOG", "log": entry}
            for ws in conns:
                try:
                    await ws.send_json(msg)
                except Exception:
                    dead.append(ws)
            if dead:
                with self._lock:
                    for d in dead:
                        if d in self.active_connections:
                            self.active_connections.remove(d)

        asyncio.run_coroutine_threadsafe(_send_all(), self.loop)


log_ws_manager = LogWebSocketManager(log_buffer)


class BroadcastLogHandler(logging.Handler):
    """
    Кастомный logging.Handler:
    - Записывает логи в кольцевой буфер (500 записей).
    - Транслирует каждую запись лога в реальном времени клиентам WebSocket.
    """

    def __init__(self, buffer: deque, ws_manager: LogWebSocketManager):
        super().__init__()
        self.buffer = buffer
        self.ws_manager = ws_manager

    def emit(self, record: logging.LogRecord):
        try:
            msg = self.format(record)
            entry = {
                "timestamp": datetime.fromtimestamp(record.created).strftime("%Y-%m-%d %H:%M:%S"),
                "level": record.levelname,
                "logger": record.name,
                "message": msg,
            }
            self.buffer.append(entry)
            self.ws_manager.broadcast_log(entry)
        except Exception:
            self.handleError(record)


broadcast_log_handler = BroadcastLogHandler(log_buffer, log_ws_manager)
broadcast_log_handler.setFormatter(logging.Formatter("%(name)s: %(message)s"))


def setup_log_broadcaster(loop: asyncio.AbstractEventLoop):
    """Регистрация обработчика логов в корневом логгере и настройка цикла событий."""
    log_ws_manager.set_loop(loop)
    root_logger = logging.getLogger()
    if broadcast_log_handler not in root_logger.handlers:
        root_logger.addHandler(broadcast_log_handler)
    # Также подключаем к логгерам uvicorn и argus
    for log_name in ("uvicorn", "uvicorn.error", "uvicorn.access", "argus", "fastapi"):
        l = logging.getLogger(log_name)
        if broadcast_log_handler not in l.handlers:
            l.addHandler(broadcast_log_handler)


@router.websocket("/ws/logs")
async def logs_websocket_endpoint(websocket: WebSocket):
    """
    WebSocket эндпоинт для трансляции системных логов:
    - Отдает последние 100 строк при установке соединения.
    - Транслирует каждую новую запись: timestamp, level, message.
    """
    await log_ws_manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        log_ws_manager.disconnect(websocket)
    except Exception:
        log_ws_manager.disconnect(websocket)


@router.get("/logs", summary="Получить последние записи журнала логов")
async def get_system_logs(limit: int = Query(100, ge=1, le=500)):
    """Резервный REST эндпоинт для получения логов."""
    items = list(log_buffer)[-limit:]
    return {
        "total": len(items),
        "logs": items,
    }


@router.post("/logs/clear", summary="Очистить буфер логов")
async def clear_system_logs():
    """Очистка локального буфера логов."""
    log_buffer.clear()
    return {"success": True, "message": "Буфер логов очищен"}
