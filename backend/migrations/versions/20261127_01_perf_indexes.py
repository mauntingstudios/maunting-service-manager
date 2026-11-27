"""Add performance indexes on server_ports, refresh_tokens, incidents, and jwt_blacklist.

Revision ID: 20261127_01
Revises: 20261126_07
Create Date: 2026-11-27
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261127_01"
down_revision: Union[str, None] = "20261126_07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(sa.inspect(bind).get_table_names())

    if "server_ports" in tables:
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_server_ports_server_id "
                "ON server_ports (server_id)"
            )
        )
    if "refresh_tokens" in tables:
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_refresh_tokens_expires_at "
                "ON refresh_tokens (expires_at)"
            )
        )
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_refresh_tokens_family_active "
                "ON refresh_tokens (family) WHERE revoked_at IS NULL"
            )
        )
    if "incidents" in tables:
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_incidents_server_open_created "
                "ON incidents (server_id, created_at DESC) WHERE status <> 'resolved'"
            )
        )
    if "jwt_blacklist" in tables:
        op.execute(
            sa.text(
                "CREATE INDEX IF NOT EXISTS ix_jwt_blacklist_expires_at "
                "ON jwt_blacklist (expires_at)"
            )
        )


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_jwt_blacklist_expires_at"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_incidents_server_open_created"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_refresh_tokens_family_active"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_refresh_tokens_expires_at"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_server_ports_server_id"))
