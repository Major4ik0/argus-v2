# -*- coding: utf-8 -*-
import os
import json
import time
import shutil
import asyncio
from datetime import date
from typing import List, Optional, Tuple
from urllib.parse import quote

from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import HTMLResponse, StreamingResponse, RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from ..core.config import settings
from ..services.ad_auth import authenticate_ad
from ..api.v1.admin import (
    resolve_argus_token,
    get_user_permissions,
    is_superadmin,
    ARGUS_SESSION_COOKIE,
)
from . import database as db
from .camera import JournalFaceRecognitionCamera
from .excel_export import generate_attendance_report

MODULE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_JOURNAL_DIR = os.path.abspath(
    os.path.join(os.path.dirname(os.path.dirname(MODULE_DIR)), "data", "journal")
)
UPLOAD_DIR = os.path.join(DATA_JOURNAL_DIR, "uploads")
CONFIG_PATH = os.path.join(DATA_JOURNAL_DIR, "config.json")
STATIC_DIR = os.path.join(MODULE_DIR, "static")
TEMPLATES_DIR = os.path.join(MODULE_DIR, "templates")

os.makedirs(DATA_JOURNAL_DIR, exist_ok=True)
os.makedirs(UPLOAD_DIR, exist_ok=True)

app = FastAPI(title="Электронный журнал посещаемости", docs_url=None, redoc_url=None)
app.add_middleware(
    SessionMiddleware,
    secret_key=os.environ.get("JOURNAL_SESSION_SECRET", "argus-journal-session-key-change-in-prod"),
    session_cookie="journal_session",
    same_site="lax",
)
app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="journal_uploads")
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="journal_static")

templates = Jinja2Templates(directory=TEMPLATES_DIR)


def _load_config() -> dict:
    default_config = {
        "video_source": "0",
        "initial_admin": getattr(settings, "initial_admin", "24-zhuravlev.a.d"),
    }
    if os.path.exists(CONFIG_PATH):
        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                data = json.load(f)
                default_config.update(data)
        except Exception as e:
            print(f"[Journal] Ошибка чтения конфигурации: {e}")
    else:
        _save_config(default_config)
    return default_config


def _save_config(cfg: dict) -> None:
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=4)


config = _load_config()
db.init_db(initial_admin=config.get("initial_admin", "24-zhuravlev.a.d"))
cam = JournalFaceRecognitionCamera(
    path_images=UPLOAD_DIR,
    video_source=config.get("video_source", "0"),
    delay=15.0,
)


def _base_prefix(request: Request) -> str:
    root = (request.scope.get("root_path") or "/journal").rstrip("/")
    return root or "/journal"


def _url(request: Request, path: str) -> str:
    clean = path if path.startswith("/") else f"/{path}"
    return f"{_base_prefix(request)}{clean}"


def _redirect(request: Request, path: str) -> RedirectResponse:
    return RedirectResponse(url=_url(request, path), status_code=303)


def _is_journal_admin(username: Optional[str]) -> bool:
    if not username:
        return False
    if is_superadmin(username):
        return True
    perms = get_user_permissions(username)
    if perms.get("can_view_admin") or perms.get("can_manage_kiosk"):
        return True
    return db.is_user_admin(username)


def _can_access_journal(username: Optional[str]) -> bool:
    if not username:
        return False
    if is_superadmin(username):
        return True
    return bool(get_user_permissions(username).get("can_view_journal", False))


def _resolve_user(request: Request, token: Optional[str] = None) -> Tuple[Optional[str], bool]:
    """
    Возвращает (username, forbidden_due_to_permissions).
    Проверяет токен/cookie АРГУСа в первую очередь, затем сессию журнала.
    """
    argus_tok = token or request.cookies.get(ARGUS_SESSION_COOKIE)
    if argus_tok:
        argus_user = resolve_argus_token(argus_tok)
        if argus_user:
            if not _can_access_journal(argus_user):
                request.session.pop("user", None)
                return argus_user, True
            request.session["user"] = argus_user
            return argus_user, False

    session_user = request.session.get("user")
    if session_user:
        if not _can_access_journal(session_user):
            request.session.pop("user", None)
            return session_user, True
        return session_user, False

    return None, False


def _render(request: Request, name: str, context: dict, status_code: int = 200) -> HTMLResponse:
    ctx = {"request": request, "base": _base_prefix(request), **context}
    return templates.TemplateResponse(request, name, ctx, status_code=status_code)


def _render_forbidden(request: Request, username: Optional[str]) -> HTMLResponse:
    return _render(request, "forbidden.html", {"username": username or ""}, status_code=403)


def get_all_students() -> List[str]:
    students = []
    if os.path.exists(UPLOAD_DIR):
        for item in os.listdir(UPLOAD_DIR):
            if item.startswith("."):
                continue
            item_path = os.path.join(UPLOAD_DIR, item)
            if os.path.isdir(item_path):
                students.append(item)
            elif item.lower().endswith((".jpg", ".jpeg", ".png")):
                students.append(os.path.splitext(item)[0])
    return sorted(list(set(students)))


def get_students_with_photos(base_prefix: str) -> List[dict]:
    students_data = {}
    if os.path.exists(UPLOAD_DIR):
        for item in sorted(os.listdir(UPLOAD_DIR)):
            if item.startswith("."):
                continue
            item_path = os.path.join(UPLOAD_DIR, item)
            if os.path.isdir(item_path):
                photos = [
                    f"{base_prefix}/uploads/{quote(item)}/{quote(f)}"
                    for f in sorted(os.listdir(item_path))
                    if f.lower().endswith((".jpg", ".jpeg", ".png"))
                ]
                students_data[item] = photos
            elif item.lower().endswith((".jpg", ".jpeg", ".png")):
                s_name = os.path.splitext(item)[0]
                students_data.setdefault(s_name, []).append(f"{base_prefix}/uploads/{quote(item)}")
    return [{"name": k, "photos": v} for k, v in sorted(students_data.items())]


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    user, forbidden = _resolve_user(request)
    if forbidden:
        return _render_forbidden(request, user)
    if user:
        return _redirect(request, "/")
    return _render(request, "login.html", {"error": None})


@app.post("/login")
async def login_post(request: Request, username: str = Form(...), password: str = Form(...)):
    clean_user = username.strip()
    if await authenticate_ad(clean_user, password):
        if not _can_access_journal(clean_user):
            return _render(
                request,
                "login.html",
                {"error": "Доступ к разделу «Электронный журнал» не выдан администратором АРГУСа"},
                status_code=403,
            )
        request.session["user"] = clean_user
        return _redirect(request, "/")
    return _render(
        request,
        "login.html",
        {"error": "Неверный логин или пароль Active Directory"},
        status_code=401,
    )


@app.get("/sso")
async def sso_login(request: Request, token: Optional[str] = None):
    user, forbidden = _resolve_user(request, token=token)
    if forbidden:
        return _render_forbidden(request, user)
    if not user:
        return _redirect(request, "/login")
    return _redirect(request, "/")


@app.get("/logout")
async def logout(request: Request):
    request.session.clear()
    return _redirect(request, "/login")


@app.get("/api/status")
async def recognition_status(request: Request):
    user, forbidden = _resolve_user(request)
    if forbidden:
        return JSONResponse({"error": "forbidden"}, status_code=403)
    if not user:
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    cam.touch_viewer()
    return {
        "recognized_names": cam.active_recognized_names,
        "display_name": cam.display_name,
        "unknown_present": cam.unknown_present,
        "capture_fps": round(cam.capture_fps, 1),
        "process_fps": round(cam.process_fps, 1),
        "shared_camera": cam.uses_shared_camera(),
    }


@app.get("/video_feed")
async def video_feed(request: Request):
    user, forbidden = _resolve_user(request)
    if forbidden:
        return JSONResponse({"error": "forbidden"}, status_code=403)
    if not user:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    cam.ensure_started()
    cam.touch_viewer()

    async def generate():
        try:
            while True:
                if await request.is_disconnected():
                    break
                frame_bytes = cam.get_jpeg_frame()
                yield (
                    b"--frame\r\n"
                    b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
                )
                await asyncio.sleep(0.066)
        except asyncio.CancelledError:
            pass

    return StreamingResponse(
        generate(),
        media_type="multipart/x-mixed-replace; boundary=frame",
        headers={"Cache-Control": "no-cache, no-store, must-revalidate"},
    )


@app.get("/", response_class=HTMLResponse)
async def index(request: Request, selected_date: Optional[str] = None, token: Optional[str] = None):
    user, forbidden = _resolve_user(request, token=token)
    if forbidden:
        return _render_forbidden(request, user)
    if not user:
        return _redirect(request, "/login")

    cam.ensure_started()
    cam.touch_viewer()

    if not selected_date:
        selected_date = date.today().isoformat()

    all_students = get_all_students()
    records = db.get_attendance_by_date(selected_date, all_students)
    current_cfg = _load_config()

    return _render(
        request,
        "index.html",
        {
            "records": records,
            "selected_date": selected_date,
            "username": user,
            "is_admin": _is_journal_admin(user),
            "current_video_source": current_cfg.get("video_source", "0"),
        },
    )


@app.post("/update-camera")
async def update_camera(request: Request, video_source: str = Form(...)):
    user, forbidden = _resolve_user(request)
    if forbidden:
        return _render_forbidden(request, user)
    if not _is_journal_admin(user):
        return _redirect(request, "/")

    current_cfg = _load_config()
    current_cfg["video_source"] = video_source.strip()
    _save_config(current_cfg)
    await asyncio.to_thread(cam.change_source, current_cfg["video_source"])
    return _redirect(request, "/")


@app.post("/update-attendance")
async def update_attendance(
    request: Request,
    student_name: str = Form(...),
    selected_date: str = Form(...),
    status: str = Form(...),
    reason: str = Form(""),
):
    user, forbidden = _resolve_user(request)
    if forbidden or not _is_journal_admin(user):
        return _redirect(request, f"/?selected_date={selected_date}")

    clean_reason = "" if status == "present" else reason.strip()
    db.mark_attendance(student_name, target_date=selected_date, status=status, reason=clean_reason)
    return _redirect(request, f"/?selected_date={selected_date}")


@app.get("/admins", response_class=HTMLResponse)
async def admins_page(request: Request):
    user, forbidden = _resolve_user(request)
    if forbidden:
        return _render_forbidden(request, user)
    if not _is_journal_admin(user):
        return _redirect(request, "/")

    return _render(
        request,
        "admins.html",
        {
            "admins": db.get_all_admins(),
            "username": user,
        },
    )


@app.post("/admins/add")
async def add_admin_route(request: Request, username: str = Form(...)):
    user, forbidden = _resolve_user(request)
    if not forbidden and _is_journal_admin(user) and username.strip():
        db.add_admin(username)
    return _redirect(request, "/admins")


@app.post("/admins/remove")
async def remove_admin_route(request: Request, username: str = Form(...)):
    user, forbidden = _resolve_user(request)
    if not forbidden and _is_journal_admin(user):
        if username.lower().strip() != user.lower().strip():
            db.remove_admin(username)
    return _redirect(request, "/admins")


@app.get("/export-attendance")
async def export_attendance(
    request: Request,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
):
    user, forbidden = _resolve_user(request)
    if forbidden:
        return _render_forbidden(request, user)
    if not _is_journal_admin(user):
        return _redirect(request, "/")

    today_str = date.today().isoformat()
    if not start_date:
        start_date = today_str
    if not end_date:
        end_date = start_date
    if start_date > end_date:
        start_date, end_date = end_date, start_date

    all_students = get_all_students()
    records = db.get_attendance_for_period(start_date, end_date)
    excel_stream = generate_attendance_report(start_date, end_date, all_students, records)

    filename = f"attendance_{start_date}_to_{end_date}.xlsx"
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return StreamingResponse(
        excel_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers=headers,
    )


@app.get("/upload", response_class=HTMLResponse)
async def upload_page(request: Request):
    user, forbidden = _resolve_user(request)
    if forbidden:
        return _render_forbidden(request, user)
    if not _is_journal_admin(user):
        return _redirect(request, "/")

    cam.ensure_started()
    cam.touch_viewer()

    base = _base_prefix(request)
    return _render(
        request,
        "upload.html",
        {
            "students": get_students_with_photos(base),
            "username": user,
        },
    )


@app.post("/upload")
async def handle_upload(
    request: Request,
    name: str = Form(...),
    file: UploadFile = File(...),
):
    user, forbidden = _resolve_user(request)
    if forbidden or not _is_journal_admin(user):
        return _redirect(request, "/")

    clean_name = name.strip().replace("/", "_").replace("\\", "_")
    student_dir = os.path.join(UPLOAD_DIR, clean_name)
    os.makedirs(student_dir, exist_ok=True)

    ext = os.path.splitext(file.filename or "photo.jpg")[1] or ".jpg"
    file_path = os.path.join(student_dir, f"{int(time.time() * 1000)}{ext}")

    content = await file.read()
    with open(file_path, "wb") as buf:
        buf.write(content)

    await asyncio.to_thread(cam.add_single_face, file_path, clean_name)
    return _redirect(request, "/upload")


@app.post("/capture-student")
async def capture_student(request: Request, name: str = Form(...)):
    user, forbidden = _resolve_user(request)
    if forbidden or not _is_journal_admin(user):
        return _redirect(request, "/")

    cam.ensure_started()
    clean_name = name.strip().replace("/", "_").replace("\\", "_")
    student_dir = os.path.join(UPLOAD_DIR, clean_name)
    os.makedirs(student_dir, exist_ok=True)

    file_path = os.path.join(student_dir, f"{int(time.time() * 1000)}.jpg")
    saved = await asyncio.to_thread(cam.save_snapshot, file_path)
    if saved:
        await asyncio.to_thread(cam.add_single_face, file_path, clean_name)

    return _redirect(request, "/upload")


@app.post("/delete-student")
async def delete_student(request: Request, name: str = Form(...)):
    user, forbidden = _resolve_user(request)
    if forbidden or not _is_journal_admin(user):
        return _redirect(request, "/")

    clean_name = name.strip().replace("/", "_").replace("\\", "_")
    student_dir = os.path.join(UPLOAD_DIR, clean_name)
    if os.path.exists(student_dir) and os.path.isdir(student_dir):
        shutil.rmtree(student_dir)

    for ext in (".jpg", ".jpeg", ".png"):
        single_file = os.path.join(UPLOAD_DIR, clean_name + ext)
        if os.path.exists(single_file):
            os.remove(single_file)

    await asyncio.to_thread(cam.load_fresh_faces)
    return _redirect(request, "/upload")


@app.post("/delete-photo")
async def delete_photo(request: Request, photo_path: str = Form(...)):
    user, forbidden = _resolve_user(request)
    if forbidden or not _is_journal_admin(user):
        return _redirect(request, "/")

    from urllib.parse import unquote

    decoded = unquote(photo_path.strip())
    for marker in ("/journal/uploads/", "/uploads/"):
        if marker in decoded:
            decoded = decoded.split(marker, 1)[1]
            break
    rel_path = decoded.lstrip("/")
    target = os.path.realpath(os.path.join(UPLOAD_DIR, rel_path))
    uploads_real = os.path.realpath(UPLOAD_DIR)

    if os.path.commonpath([uploads_real, target]) == uploads_real and os.path.isfile(target):
        os.remove(target)
        parent = os.path.dirname(target)
        if parent != uploads_real and os.path.isdir(parent) and not os.listdir(parent):
            os.rmdir(parent)
        await asyncio.to_thread(cam.load_fresh_faces)

    return _redirect(request, "/upload")
