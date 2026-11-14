"""Сверка личного состава с АРГУСом (ФИО, звание, ПМК): предпросмотр и применение — ЗНК и администратор."""

from __future__ import annotations

from fastapi import APIRouter

from ..integration import argus_sync
from .deps import DB, WriteDept

router = APIRouter(prefix="/api/argus-sync", tags=["сверка с АРГУСом"])


@router.get("")
def preview(dept: WriteDept, db: DB, cathedra_id: int | None = None) -> dict:
    return argus_sync.preview(db, dept, cathedra_id)


@router.post("")
def apply(data: argus_sync.ApplyIn, dept: WriteDept, db: DB) -> dict:
    result = argus_sync.apply(db, dept, data)
    return {**result, "preview": argus_sync.preview(db, dept, data.cathedra_id)}
