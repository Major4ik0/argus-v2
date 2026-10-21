# -*- coding: utf-8 -*-
import logging
from typing import Optional

from fastapi import APIRouter, Depends, UploadFile, File, Query, HTTPException, status
from fastapi.responses import StreamingResponse
import asyncpg

from ...core.database import get_db_connection
from ...schemas.excel import ExcelImportResult
from ...services.excel_service import ExcelService

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post(
    "/import",
    response_model=ExcelImportResult,
    summary="Импорт расписания из Excel (.xlsx / .xls)",
    description=(
        "Парсит матричную сетку расписания кафедры из Excel-файла. "
        "Поддерживает форматы .xlsx (openpyxl) и .xls (xlrd). "
        "При dry_run=true — только анализирует файл без записи в базу данных."
    ),
)
async def import_excel_schedule(
    file: UploadFile = File(..., description="Excel-файл расписания (.xlsx или .xls)"),
    sh_var_id: Optional[int] = Query(
        None,
        description=(
            "ID варианта расписания (nnz_schedule_variants.sh_var_id). "
            "Если не указан — определяется автоматически по датам из файла."
        )
    ),
    cathedra_id: Optional[int] = Query(
        None,
        description="ID кафедры для записи в поле idcathedra (необязательно)"
    ),
    dry_run: bool = Query(
        False,
        description="Режим предпросмотра: анализировать файл без записи в БД"
    ),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    filename = file.filename or ""
    if not filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Поддерживаются только файлы формата Excel (.xlsx, .xls)"
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Загруженный файл пустой"
        )

    logger.info(
        "Excel import started: file=%s size=%d bytes sh_var_id=%s dry_run=%s cathedra_id=%s",
        filename, len(content), sh_var_id, dry_run, cathedra_id
    )

    service = ExcelService(conn)
    try:
        result = await service.import_schedule_from_excel(
            file_bytes=content,
            filename=filename,
            sh_var_id=sh_var_id,
            dry_run=dry_run,
            cathedra_id=cathedra_id,
        )
    except Exception as exc:
        import traceback
        traceback.print_exc()
        logger.error("Excel import failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Критическая ошибка при импорте файла: {exc}"
        )

    logger.info(
        "Excel import done: imported=%d updated=%d skipped=%d failed=%d",
        result.imported_count, result.updated_count,
        result.skipped_count, result.failed_count,
    )
    return result


@router.get(
    "/export",
    summary="Экспорт расписания в Excel",
    description="Формирует красиво оформленный Excel-отчёт расписания для группы или преподавателя.",
)
async def export_excel_schedule(
    group_id: Optional[int] = Query(None, description="Фильтр по учебной группе (gid)"),
    teacher_id: Optional[int] = Query(None, description="Фильтр по преподавателю (mid)"),
    sh_var_id: int = Query(1, description="ID варианта расписания"),
    conn: asyncpg.Connection = Depends(get_db_connection),
):
    service = ExcelService(conn)
    file_stream = await service.export_schedule_to_excel(
        group_id=group_id,
        teacher_id=teacher_id,
        sh_var_id=sh_var_id,
    )

    filename = f"schedule_export_var_{sh_var_id}.xlsx"
    return StreamingResponse(
        file_stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
