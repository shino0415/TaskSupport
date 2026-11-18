"""add status column to company

Revision ID: c4d8f2a6e1b3
Revises: b7c3e1a9d4f2
Create Date: 2026-11-18 12:00:00.000000

企業に選考状態（選考中/内定/お見送り）を追加する（spec.md「## 決定事項」の
「企業の選考状態と次回選考の表示」参照）。既存の企業はserver_defaultにより
すべて選考中になる。ダウングレードでは追加した列を削除するのみで、
企業以外のテーブルには触れない。
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "c4d8f2a6e1b3"
down_revision: str | Sequence[str] | None = "b7c3e1a9d4f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Upgrade schema."""
    with op.batch_alter_table("company") as batch_op:
        batch_op.add_column(
            sa.Column("status", sa.String(), server_default="選考中", nullable=False)
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table("company") as batch_op:
        batch_op.drop_column("status")
