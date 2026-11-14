"""Вход через АРГУС: запомненные входы АРГУСа и связь сессии с токеном АРГУСа.

Revision ID: 0006
Revises: 0005
Create Date: 2026-11-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "argus_tokens",
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("login", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("token_hash", name=op.f("pk_argus_tokens")),
    )
    op.create_index(op.f("ix_argus_tokens_expires_at"), "argus_tokens", ["expires_at"])
    op.add_column("user_sessions", sa.Column("argus_token_hash", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("user_sessions", "argus_token_hash")
    op.drop_index(op.f("ix_argus_tokens_expires_at"), table_name="argus_tokens")
    op.drop_table("argus_tokens")
