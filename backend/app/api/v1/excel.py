# -*- coding: utf-8 -*-
from typing import Optional
from fastapi import APIRouter, Depends, UploadFile, File, Query, HTTPException, status
from fastapi.responses import StreamingResponse
import asyncpg

from ...core.database import get_db_connection
from ...schemas.excel import ExcelImportResult
from ...services.excel_service import ExcelService

router = APIRouter()


@router.post("/import", response_model=ExcelImportResult, summary="Импорт расписания из Excel (.xlsx)")
async def import_excel_schedule(
    file: UploadFile = File(..., description="Файл Excel формата .xlsx"),
    sh_var_id: int = Query(1, description="ID варианта расписания"),
    dry_run: bool = Query(False, description="Режим предпросмотра (проверить без записи в базу)"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    if not file.filename.endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Поддерживаются только файлы формата Excel (.xlsx, .xls)"
        )

    content = await file.read()
    service = ExcelService(conn)
    result = await service.import_schedule_from_excel(
        file_bytes=content,
        sh_var_id=sh_var_id,
        dry_run=dry_run
    )
    return result


@router.get("/export", summary="Экспорт расписания в Excel")
async def export_excel_schedule(
    group_id: Optional[int] = Query(None, description="Фильтр по группе"),
    teacher_id: Optional[int] = Query(None, description="Фильтр по преподавателю"),
    sh_var_id: int = Query(1, description="ID варианта расписания"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    service = ExcelService(conn)
    file_stream = await service.export_schedule_to_excel(
        group_id=group_id,
        teacher_id=teacher_id,
        sh_var_id=sh_var_id
    )

    filename = f"schedule_export_var_{sh_var_id}.xlsx"
    return StreamingResponse(
        file_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"}
    )