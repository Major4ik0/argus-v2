"""Связь с АРГУСом: кафедра ↔ cathedras.idcathedra, человек ↔ people.mid (АРГУС — главный источник ФИО и званий).

Revision ID: 0007
Revises: 0006
Create Date: 2026-11-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007"
down_revision: Union[str, Sequence[str], None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("departments", sa.Column("argus_cid", sa.Integer(), nullable=True))
    op.add_column("persons", sa.Column("argus_mid", sa.Integer(), nullable=True))
    op.create_unique_constraint(op.f("uq_persons_department_id"), "persons", ["department_id", "argus_mid"])


def downgrade() -> None:
    op.drop_constraint(op.f("uq_persons_department_id"), "persons", type_="unique")
    op.drop_column("persons", "argus_mid")
    op.drop_column("departments", "argus_cid")
