"""Учётная запись ↔ человек из личного состава («Только я» в графиках).

Revision ID: 0005
Revises: 0004
Create Date: 2026-11-07

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0005"
down_revision: Union[str, Sequence[str], None] = "0004"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("person_id", sa.Integer(), nullable=True))
    op.create_foreign_key(op.f("fk_users_person_id_persons"), "users", "persons", ["person_id"], ["id"],
                          ondelete="SET NULL")


def downgrade() -> None:
    op.drop_constraint(op.f("fk_users_person_id_persons"), "users", type_="foreignkey")
    op.drop_column("users", "person_id")
