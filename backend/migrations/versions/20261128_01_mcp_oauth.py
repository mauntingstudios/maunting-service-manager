"""Add OAuth 2.1 columns to ai_mcp_servers.

Revision ID: 20261128_01
Revises: 20261127_01
Create Date: 2026-11-28
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261128_01"
down_revision: Union[str, None] = "20261127_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "ai_mcp_servers" not in tables:
        return

    cols = {c["name"] for c in inspector.get_columns("ai_mcp_servers")}
    if "auth_mode" not in cols:
        op.add_column(
            "ai_mcp_servers",
            sa.Column("auth_mode", sa.String(length=16), nullable=False, server_default="token"),
        )
    if "oauth_refresh_token_encrypted" not in cols:
        op.add_column(
            "ai_mcp_servers",
            sa.Column("oauth_refresh_token_encrypted", sa.Text(), nullable=True),
        )
    if "oauth_expires_at" not in cols:
        op.add_column(
            "ai_mcp_servers",
            sa.Column("oauth_expires_at", sa.DateTime(timezone=True), nullable=True),
        )
    if "oauth_client_id" not in cols:
        op.add_column(
            "ai_mcp_servers",
            sa.Column("oauth_client_id", sa.String(length=256), nullable=True),
        )
    if "oauth_token_endpoint" not in cols:
        op.add_column(
            "ai_mcp_servers",
            sa.Column("oauth_token_endpoint", sa.String(length=1024), nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())
    if "ai_mcp_servers" not in tables:
        return

    cols = {c["name"] for c in inspector.get_columns("ai_mcp_servers")}
    for col in (
        "oauth_token_endpoint",
        "oauth_client_id",
        "oauth_expires_at",
        "oauth_refresh_token_encrypted",
        "auth_mode",
    ):
        if col in cols:
            op.drop_column("ai_mcp_servers", col)
