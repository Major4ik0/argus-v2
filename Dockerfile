# -------------------------------------------------------------
# Этап 1: Сборка React-фронтенда
# -------------------------------------------------------------
FROM node:20-alpine AS frontend-builder
WORKDIR /build

# Кэшируем установку npm-пакетов
COPY frontend/package*.json ./
RUN npm ci

# Копируем исходники фронтенда и собираем статичный бандл
COPY frontend/ ./
RUN npm run build

# -------------------------------------------------------------
# Этап 2: Финальный образ FastAPI + скомпилированная статика
# -------------------------------------------------------------
FROM python:3.11-slim
WORKDIR /app

# Установка системных утилит (если требуются для сборки)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Установка зависимостей бэкенда
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Копируем код бэкенда
COPY backend/app ./app

# Забираем готовую статику фронтенда из первого этапа
COPY --from=frontend-builder /build/dist ./static_dist

EXPOSE 5123

# Запуск приложения на боевом порту 5123
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "5123"]