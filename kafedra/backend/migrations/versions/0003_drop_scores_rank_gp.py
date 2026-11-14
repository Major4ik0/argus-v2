"""Убрать «Счёт ПВО-ПРО» и поправки «Учёных»; звание «ГП» у гражданского персонала.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-07

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: Union[str, Sequence[str], None] = "0002"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_index(op.f("ix_score_records_department_id"), table_name="score_records")
    op.drop_table("score_records")
    op.execute("UPDATE persons SET rank = 'ГП' WHERE upper(kind) = 'ГП' AND coalesce(trim(rank), '') = ''")
    op.execute("UPDATE departments SET settings = settings - 'scientists_corrections'")


def downgrade() -> None:
    op.create_table(
        "score_records",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("department_id", sa.Integer(), nullable=False),
        sa.Column("series", sa.Text(), nullable=False),
        sa.Column("period_start", sa.Date(), nullable=False),
        sa.Column("period_end", sa.Date(), nullable=False),
        sa.Column("detected", sa.Integer(), nullable=False),
        sa.Column("destroyed", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["department_id"], ["departments.id"], name=op.f("fk_score_records_department_id_departments"),
                                ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_score_records")),
    )
    op.create_index(op.f("ix_score_records_department_id"), "score_records", ["department_id"], unique=False)
    op.execute("UPDATE persons SET rank = '' WHERE rank = 'ГП'")
