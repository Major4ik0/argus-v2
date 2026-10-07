from fastapi import APIRouter
from .references import router as references_router
from .schedule import router as schedule_router
from .workload import router as workload_router
from .recommendations import router as recommendations_router
from .excel import router as excel_router
from .colors import router as colors_router

api_router = APIRouter()

api_router.include_router(references_router, prefix="/references", tags=["Справочники"])
api_router.include_router(schedule_router, prefix="/schedule", tags=["Расписание"])
api_router.include_router(workload_router, prefix="/workload", tags=["Нагрузка"])
api_router.include_router(recommendations_router, prefix="/recommendations", tags=["Замены и рекомендации"])
api_router.include_router(excel_router, prefix="/excel", tags=["Excel интеграция"])
api_router.include_router(colors_router, prefix="/colors", tags=["Цветовая схема"])