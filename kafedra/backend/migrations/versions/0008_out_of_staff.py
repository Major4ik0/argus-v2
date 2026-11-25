"""Должности сверх штата («внештата» на листе «Структура кафедры»): видны в штате, в укомплектованность не входят.

Revision ID: 0008
Revises: 0007
Create Date: 2026-11-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("staff_positions", sa.Column("out_of_staff", sa.Boolean(), server_default=sa.false(), nullable=False))


def downgrade() -> None:
    op.drop_column("staff_positions", "out_of_staff")
