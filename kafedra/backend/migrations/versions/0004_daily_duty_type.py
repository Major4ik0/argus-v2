"""Вид наряда у групп суточного наряда («Обязанности») — подставляется в график при назначении человека.

Revision ID: 0004
Revises: 0003
Create Date: 2026-11-07

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: Union[str, Sequence[str], None] = "0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# копия kafedra.calc.duty.DAILY_DUTY_TYPES на момент миграции (миграции не зависят от кода приложения)
TYPES = {
    "дежурный по академии": "ДА",
    "помощник дежурного по академии": "ПДА",
    "патруль": "П79",
    "старший на пункте управления": "СтПУ",
    "областной сборный пункт": "ОСП",
}


def upgrade() -> None:
    op.add_column("assignment_lists", sa.Column("duty_type", sa.Text(), nullable=False, server_default=""))
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, title FROM assignment_lists WHERE section = 'daily_duty'")).all()
    for list_id, title in rows:
        code = TYPES.get(" ".join((title or "").split()).lower())
        if code:
            conn.execute(sa.text("UPDATE assignment_lists SET duty_type = :c WHERE id = :i"), {"c": code, "i": list_id})


def downgrade() -> None:
    op.drop_column("assignment_lists", "duty_type")
