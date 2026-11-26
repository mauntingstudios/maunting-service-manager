"""Add routing_mode column on ai_router_configs for Free-First routing.

Revision ID: 20261126_07
Revises: 20261126_06
Create Date: 2026-11-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261126_07"
down_revision: Union[str, None] = "20261126_06"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ai_router_configs" in tables:
        cols = {c["name"] for c in inspector.get_columns("ai_router_configs")}
        if "routing_mode" not in cols:
            op.add_column(
                "ai_router_configs",
                sa.Column(
                    "routing_mode",
                    sa.String(24),
                    nullable=False,
                    server_default="quality",
                ),
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ai_router_configs" in tables:
        cols = {c["name"] for c in inspector.get_columns("ai_router_configs")}
        if "routing_mode" in cols:
            op.drop_column("ai_router_configs", "routing_mode")
