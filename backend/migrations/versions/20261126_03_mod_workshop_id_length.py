"""Widen mods.workshop_id from String(64) to String(128) for Modrinth/Thunderstore IDs.

Revision ID: 20261126_03
Revises: 20261126_02
Create Date: 2026-11-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261126_03"
down_revision: Union[str, None] = "20261126_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "mods" not in set(inspector.get_table_names()):
        return
    cols = {c["name"]: c for c in inspector.get_columns("mods")}
    if "workshop_id" in cols:
        op.alter_column(
            "mods",
            "workshop_id",
            existing_type=sa.String(length=64),
            type_=sa.String(length=128),
            existing_nullable=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "mods" not in set(inspector.get_table_names()):
        return
    cols = {c["name"]: c for c in inspector.get_columns("mods")}
    if "workshop_id" in cols:
        op.alter_column(
            "mods",
            "workshop_id",
            existing_type=sa.String(length=128),
            type_=sa.String(length=64),
            existing_nullable=False,
        )
