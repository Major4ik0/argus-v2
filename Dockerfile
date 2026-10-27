# -------------------------------------------------------------
# Этап 1: Сборка фронтенда (React + Vite)
# -------------------------------------------------------------
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# -------------------------------------------------------------
# Этап 2: Финальный образ бэкенда (Python + OpenCV + ONNX)
# -------------------------------------------------------------
FROM python:3.11-slim
WORKDIR /app

# Системные библиотеки для OpenCV и компиляции
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Зависимости Python
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Копирование бэкенда
COPY backend/ /app/backend/

# Копирование собранного фронтенда в статику бэкенда
COPY --from=frontend-builder /app/frontend/dist /app/backend/static_dist

# Копирование офлайн-моделей InsightFace и legacy_qt
COPY legacy_qt/ /app/legacy_qt/

ENV PYTHONPATH=/app/backend
EXPOSE 8000

CMD ["uvicorn", "backend.app.main:app", "--host", "0.0.0.0", "--port", "8000"]
