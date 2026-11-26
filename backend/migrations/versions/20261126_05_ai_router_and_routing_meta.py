"""Add Singra AI Router configuration, role routing flags, and message routing metadata.

Revision ID: 20261126_05
Revises: 20261126_04
Create Date: 2026-11-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261126_05"
down_revision: Union[str, None] = "20261126_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ai_router_configs" not in tables:
        op.create_table(
            "ai_router_configs",
            sa.Column("id", sa.Integer(), primary_key=True, nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("eco_models_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("standard_models_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("flagship_models_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("fallback_models_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("eco_weight", sa.Float(), nullable=False, server_default="1.0"),
            sa.Column("standard_weight", sa.Float(), nullable=False, server_default="1.0"),
            sa.Column("flagship_weight", sa.Float(), nullable=False, server_default="1.0"),
            sa.Column("fallback_weight", sa.Float(), nullable=False, server_default="1.0"),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )

    if "role_ai_limits" in tables:
        cols = {c["name"] for c in inspector.get_columns("role_ai_limits")}
        if "router_only" not in cols:
            op.add_column(
                "role_ai_limits",
                sa.Column("router_only", sa.Boolean(), nullable=False, server_default=sa.false()),
            )
        if "soft_cap_downgrade" not in cols:
            op.add_column(
                "role_ai_limits",
                sa.Column(
                    "soft_cap_downgrade",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.false(),
                ),
            )

    if "ai_messages" in tables:
        msg_cols = {c["name"] for c in inspector.get_columns("ai_messages")}
        if "routed_tier" not in msg_cols:
            op.add_column("ai_messages", sa.Column("routed_tier", sa.String(16), nullable=True))
        if "routed_model" not in msg_cols:
            op.add_column("ai_messages", sa.Column("routed_model", sa.String(256), nullable=True))
        if "routed_provider_name" not in msg_cols:
            op.add_column(
                "ai_messages",
                sa.Column("routed_provider_name", sa.String(128), nullable=True),
            )
        if "routed_reason" not in msg_cols:
            op.add_column("ai_messages", sa.Column("routed_reason", sa.String(128), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ai_messages" in tables:
        msg_cols = {c["name"] for c in inspector.get_columns("ai_messages")}
        for col in ("routed_reason", "routed_provider_name", "routed_model", "routed_tier"):
            if col in msg_cols:
                op.drop_column("ai_messages", col)

    if "role_ai_limits" in tables:
        cols = {c["name"] for c in inspector.get_columns("role_ai_limits")}
        for col in ("soft_cap_downgrade", "router_only"):
            if col in cols:
                op.drop_column("role_ai_limits", col)

    if "ai_router_configs" in tables:
        op.drop_table("ai_router_configs")
