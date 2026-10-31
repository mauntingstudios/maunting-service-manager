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
    if "role_ai_limits" not in sa.inspect(op.get_bind()).get_table_names():
        return
    with op.batch_alter_table("role_ai_limits") as batch:
        batch.add_column(sa.Column("max_attachment_storage_mb", sa.Integer(), nullable=True))


def downgrade() -> None:
    if "role_ai_limits" not in sa.inspect(op.get_bind()).get_table_names():
        return
    with op.batch_alter_table("role_ai_limits") as batch:
        batch.drop_column("max_attachment_storage_mb")
