"""Tabellen fuer Frontend-Deployments, Einstellungen und Rollen-Build-Quotas.

Revision ID: 20261116_02
Revises: 20261116_01
Create Date: 2026-11-16
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "20261116_02"
down_revision: Union[str, None] = "20261116_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "frontend_deployments" not in tables:
        op.create_table(
            "frontend_deployments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "server_id",
                sa.Integer(),
                sa.ForeignKey("servers.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(length=16), nullable=False, server_default="production"),
            sa.Column("branch", sa.String(length=255), nullable=False),
            sa.Column("branch_slug", sa.String(length=64), nullable=False),
            sa.Column("commit_sha", sa.String(length=64), nullable=True),
            sa.Column("commit_message", sa.String(length=255), nullable=True),
            sa.Column("commit_author", sa.String(length=128), nullable=True),
            sa.Column("source", sa.String(length=24), nullable=False, server_default="manual"),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="queued"),
            sa.Column("is_live", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("port", sa.Integer(), nullable=True),
            sa.Column("url", sa.String(length=512), nullable=True),
            sa.Column("log_path", sa.String(length=512), nullable=True),
            sa.Column("error_summary", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_frontend_deployments_server_id", "frontend_deployments", ["server_id"])
        op.create_index(
            "ix_frontend_deployments_server_created",
            "frontend_deployments",
            ["server_id", "created_at"],
        )
        op.create_index(
            "ix_frontend_deployments_server_branch",
            "frontend_deployments",
            ["server_id", "branch_slug", "status"],
        )

    if "frontend_settings" not in tables:
        op.create_table(
            "frontend_settings",
            sa.Column(
                "server_id",
                sa.Integer(),
                sa.ForeignKey("servers.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("production_branch", sa.String(length=255), nullable=False, server_default="main"),
            sa.Column("auto_deploy", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("previews_enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("online", sa.Boolean(), nullable=False, server_default=sa.text("true")),
            sa.Column("domain", sa.String(length=255), nullable=True, unique=True),
            sa.Column("domain_verified", sa.Boolean(), nullable=False, server_default=sa.text("false")),
            sa.Column("domain_verify_token", sa.String(length=128), nullable=True),
            sa.Column("webhook_url_token", sa.String(length=64), nullable=False, unique=True),
            sa.Column("webhook_secret_enc", sa.Text(), nullable=True),
            sa.Column("github_hook_id", sa.Integer(), nullable=True),
            sa.Column("last_webhook_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("env_production_enc", sa.Text(), nullable=True),
            sa.Column("env_preview_enc", sa.Text(), nullable=True),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )

    if "role_frontend_build_quotas" not in tables:
        op.create_table(
            "role_frontend_build_quotas",
            sa.Column(
                "role_id",
                sa.Integer(),
                sa.ForeignKey("roles.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("max_cpu_cores", sa.Integer(), nullable=False, server_default="2"),
            sa.Column("max_memory_mb", sa.Integer(), nullable=False, server_default="2048"),
            sa.Column("build_timeout_seconds", sa.Integer(), nullable=False, server_default="900"),
            sa.Column("max_concurrent_builds", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("max_previews_per_server", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "role_frontend_build_quotas" in tables:
        op.drop_table("role_frontend_build_quotas")
    if "frontend_settings" in tables:
        op.drop_table("frontend_settings")
    if "frontend_deployments" in tables:
        op.drop_table("frontend_deployments")
