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
# Этап 1б: Интерфейс приложения 12 кафедры (папка kafedra/), адрес /kafedra/
# -------------------------------------------------------------
FROM node:22-alpine AS kafedra-frontend
WORKDIR /kafedra/frontend
COPY kafedra/frontend/package*.json ./
RUN npm ci
COPY kafedra/frontend/ ./
ENV KAFEDRA_BASE=/kafedra/
RUN npm run build

# -------------------------------------------------------------
# Этап 2: Финальный образ бэкенда (Python + OpenCV + ONNX)
# -------------------------------------------------------------
FROM python:3.11-slim
WORKDIR /app

# Системные библиотеки для OpenCV
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Создание пустой целевой директории под монтирование
RUN mkdir -p /app/models/insightface/models/buffalo_l /app/backend/models /app/backend/uploads/teachers /app/backend/uploads/photos /app/backend/data/journal/uploads

# Зависимости Python
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Зависимости приложения 12 кафедры
COPY kafedra/backend/requirements.txt ./kafedra-requirements.txt
RUN pip install --no-cache-dir -r kafedra-requirements.txt

# Копирование бэкенда
COPY backend/ /app/backend/

# Копирование собранного фронтенда в статику бэкенда
COPY --from=frontend-builder /app/frontend/dist /app/backend/static_dist

# Приложение 12 кафедры: backend и собранный интерфейс
COPY kafedra/backend/ /app/kafedra_backend/
COPY --from=kafedra-frontend /kafedra/frontend/dist /app/kafedra_backend/static_dist
ENV KAFEDRA_FRONTEND_DIR=/app/kafedra_backend/static_dist

ENV PYTHONPATH=/app/backend:/app:/app/kafedra_backend
EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
