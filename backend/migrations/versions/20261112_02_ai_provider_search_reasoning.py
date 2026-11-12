"""Feste Denkstufe fuer die Suchzusammenfassung je Anbieter.

Revision ID: 20261112_02
Revises: 20261112_01
Create Date: 2026-11-12
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "20261112_02"
down_revision: Union[str, None] = "20261112_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "ai_providers" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("ai_providers")}
    if "search_summary_reasoning_effort" not in columns:
        with op.batch_alter_table("ai_providers") as batch:
            batch.add_column(sa.Column("search_summary_reasoning_effort", sa.String(length=16), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "ai_providers" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("ai_providers")}
    if "search_summary_reasoning_effort" in columns:
        with op.batch_alter_table("ai_providers") as batch:
            batch.drop_column("search_summary_reasoning_effort")