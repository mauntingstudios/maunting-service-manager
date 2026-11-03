"""Maximaler KI-Dateispeicherplatz (MB) fuer Rollen.

Revision ID: 20261031_04
Revises: 20261031_03
Create Date: 2026-10-31
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "20261031_04"
down_revision: Union[str, None] = "20261031_03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "role_ai_limits" not in inspector.get_table_names():
        return
    columns = {
        column["name"] for column in inspector.get_columns("role_ai_limits")
    }
    if "max_attachment_storage_mb" in columns:
        return
    with op.batch_alter_table("role_ai_limits") as batch:
        batch.add_column(sa.Column("max_attachment_storage_mb", sa.Integer(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "role_ai_limits" not in inspector.get_table_names():
        return
    columns = {
        column["name"] for column in inspector.get_columns("role_ai_limits")
    }
    if "max_attachment_storage_mb" not in columns:
        return
    with op.batch_alter_table("role_ai_limits") as batch:
        batch.drop_column("max_attachment_storage_mb")
