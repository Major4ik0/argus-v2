from fastapi import APIRouter
from .references import router as references_router
from .schedule import router as schedule_router
from .workload import router as workload_router
from .recommendations import router as recommendations_router
from .excel import router as excel_router
from .colors import router as colors_router
from .admin import router as admin_router
from .kiosk import router as kiosk_router
from .sync import router as sync_router
from .db_manager import router as db_manager_router
from .teachers import router as teachers_router

api_router = APIRouter()

api_router.include_router(references_router, prefix="/references", tags=["Справочники"])
api_router.include_router(schedule_router, prefix="/schedule", tags=["Расписание"])
api_router.include_router(workload_router, prefix="/workload", tags=["Нагрузка"])
api_router.include_router(recommendations_router, prefix="/recommendations", tags=["Замены и рекомендации"])
api_router.include_router(excel_router, prefix="/excel", tags=["Excel интеграция"])
api_router.include_router(colors_router, prefix="/colors", tags=["Цветовая схема"])
api_router.include_router(admin_router, prefix="/admin", tags=["admin"])
api_router.include_router(kiosk_router, prefix="/kiosk", tags=["Информационное табло и биометрия"])
api_router.include_router(teachers_router, prefix="/teachers", tags=["Галерея и биометрия преподавателей"])
api_router.include_router(sync_router, prefix="/sync", tags=["Синхронизация БД"])
api_router.include_router(db_manager_router, prefix="/db", tags=["Управление таблицами БД"])
