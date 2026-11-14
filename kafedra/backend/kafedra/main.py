from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from .api import argus_sync, auth, journals, misc, persons, staffing, timesheet, users, vacations
from .settings import settings

app = FastAPI(title="Личный состав", version="0.1.0")
for module in (auth, users, persons, timesheet, vacations, staffing, journals, misc, argus_sync):
    app.include_router(module.router)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


# Собранный frontend (Vite → frontend/dist): файлы как есть, остальные пути — index.html (маршруты SPA).
FRONTEND = Path(settings.frontend_dir).resolve()

if FRONTEND.is_dir():

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str) -> FileResponse:
        if path.startswith("api/"):
            raise HTTPException(404, "Не найдено")
        file = (FRONTEND / path).resolve()
        if path and file.is_file() and FRONTEND in file.parents:
            return FileResponse(file)
        return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-cache"})
