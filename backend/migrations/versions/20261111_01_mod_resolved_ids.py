"""Mod resolved IDs fuer deklarative Mod-Manager Targets.

Revision ID: 20261111_01
Revises: 20261109_02
Create Date: 2026-11-11
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261111_01"
down_revision: Union[str, None] = "20261109_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    if "mods" not in set(inspector.get_table_names()):
        return set()
    return {col["name"] for col in inspector.get_columns("mods")}


def upgrade() -> None:
    cols = _columns()
    if cols:
        if "resolved_ids_json" not in cols:
            op.add_column("mods", sa.Column("resolved_ids_json", sa.Text(), nullable=True))
        if "resolved_at" not in cols:
            op.add_column("mods", sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True))
        if "resolve_error" not in cols:
            op.add_column("mods", sa.Column("resolve_error", sa.String(256), nullable=True))


def downgrade() -> None:
    cols = _columns()
    if cols:
        if "resolve_error" in cols:
            op.drop_column("mods", "resolve_error")
        if "resolved_at" in cols:
            op.drop_column("mods", "resolved_at")
        if "resolved_ids_json" in cols:
            op.drop_column("mods", "resolved_ids_json")
