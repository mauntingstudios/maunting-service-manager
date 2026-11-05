"""Singra KI-Plattform: Multi-Chat, Projekte, Projektdateien, MCP-Server und Multi-Modell-Provider.

Revision ID: 20261105_01
Revises: 20261104_01
Create Date: 2026-11-05
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261105_01"
down_revision: Union[str, None] = "20261104_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # 1. ai_projects
    if "ai_projects" not in tables:
        op.create_table(
            "ai_projects",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("instructions", sa.Text(), nullable=True),
            sa.Column("icon", sa.String(length=32), nullable=False, server_default="folder"),
            sa.Column("color", sa.String(length=32), nullable=False, server_default="emerald"),
            sa.Column(
                "workspace_mode",
                sa.String(length=16),
                nullable=False,
                server_default="docs",
            ),
            sa.Column("local_path", sa.Text(), nullable=True),
            sa.Column("git_provider", sa.String(length=16), nullable=True),
            sa.Column("git_repo_url", sa.Text(), nullable=True),
            sa.Column("git_branch", sa.String(length=128), nullable=True, server_default="main"),
            sa.Column(
                "git_credential_id",
                sa.Integer(),
                sa.ForeignKey("user_credentials.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("archived", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.CheckConstraint(
                "workspace_mode IN ('docs', 'sandbox', 'desktop')",
                name="ck_ai_projects_workspace_mode",
            ),
        )
        op.create_index("ix_ai_projects_user_id", "ai_projects", ["user_id"])
        op.create_index("ix_ai_projects_team_id", "ai_projects", ["team_id"])
        op.create_index("ix_ai_projects_user_updated", "ai_projects", ["user_id", "updated_at"])
        op.create_index("ix_ai_projects_team_updated", "ai_projects", ["team_id", "updated_at"])

    # 2. ai_project_files
    if "ai_project_files" not in tables:
        op.create_table(
            "ai_project_files",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "project_id",
                sa.String(length=36),
                sa.ForeignKey("ai_projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("path", sa.String(length=512), nullable=False),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column(
                "mime_type",
                sa.String(length=128),
                nullable=False,
                server_default="text/markdown",
            ),
            sa.Column("size_bytes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("updated_by_ai", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
        )
        op.create_index("ix_ai_project_files_project_id", "ai_project_files", ["project_id"])
        op.create_index(
            "ix_ai_project_files_project_path",
            "ai_project_files",
            ["project_id", "path"],
            unique=True,
        )

    # 3. ai_mcp_servers
    if "ai_mcp_servers" not in tables:
        op.create_table(
            "ai_mcp_servers",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("name", sa.String(length=128), nullable=False),
            sa.Column("description", sa.String(length=512), nullable=True),
            sa.Column("scope", sa.String(length=16), nullable=False, server_default="user"),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="CASCADE"),
                nullable=True,
            ),
            sa.Column("transport", sa.String(length=16), nullable=False, server_default="http"),
            sa.Column("endpoint_url", sa.Text(), nullable=True),
            sa.Column("command", sa.Text(), nullable=True),
            sa.Column("args_json", sa.Text(), nullable=True),
            sa.Column("auth_token_encrypted", sa.Text(), nullable=True),
            sa.Column("auth_token_hint", sa.String(length=32), nullable=True),
            sa.Column("cached_tools_json", sa.Text(), nullable=True),
            sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("last_checked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_status", sa.String(length=32), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.CheckConstraint(
                "transport IN ('http', 'sse', 'stdio')",
                name="ck_ai_mcp_servers_transport",
            ),
            sa.CheckConstraint(
                "scope IN ('global', 'team', 'user')",
                name="ck_ai_mcp_servers_scope",
            ),
        )
        op.create_index("ix_ai_mcp_servers_user_id", "ai_mcp_servers", ["user_id"])
        op.create_index("ix_ai_mcp_servers_team_id", "ai_mcp_servers", ["team_id"])
        op.create_index("ix_ai_mcp_servers_scope_user", "ai_mcp_servers", ["scope", "user_id"])
        op.create_index("ix_ai_mcp_servers_scope_team", "ai_mcp_servers", ["scope", "team_id"])

    # 4. ai_conversations: Multi-Chat + project_id + pinned
    if "ai_conversations" in tables:
        conv_cols = {c["name"] for c in inspector.get_columns("ai_conversations")}
        conv_indexes = {idx["name"] for idx in inspector.get_indexes("ai_conversations")}
        if "uq_ai_conversations_user_kind" in conv_indexes:
            op.drop_index("uq_ai_conversations_user_kind", table_name="ai_conversations")
        op.create_index(
            "uq_ai_conversations_user_kind",
            "ai_conversations",
            ["user_id", "kind"],
            unique=True,
            postgresql_where=sa.text("kind IN ('guardian')"),
            sqlite_where=sa.text("kind IN ('guardian')"),
        )
        with op.batch_alter_table("ai_conversations") as batch:
            if "project_id" not in conv_cols:
                batch.add_column(sa.Column("project_id", sa.String(length=36), nullable=True))
            if "pinned" not in conv_cols:
                batch.add_column(
                    sa.Column("pinned", sa.Boolean(), nullable=False, server_default=sa.false())
                )
        conv_indexes_after = {idx["name"] for idx in sa.inspect(bind).get_indexes("ai_conversations")}
        if "ix_ai_conversations_project_id" not in conv_indexes_after:
            op.create_index("ix_ai_conversations_project_id", "ai_conversations", ["project_id"])

    # 5. ai_providers: enabled_models_json + allow_all_models
    if "ai_providers" in tables:
        prov_cols = {c["name"] for c in inspector.get_columns("ai_providers")}
        with op.batch_alter_table("ai_providers") as batch:
            if "enabled_models_json" not in prov_cols:
                batch.add_column(
                    sa.Column("enabled_models_json", sa.String(length=16384), nullable=True)
                )
            if "allow_all_models" not in prov_cols:
                batch.add_column(
                    sa.Column(
                        "allow_all_models",
                        sa.Boolean(),
                        nullable=False,
                        server_default=sa.false(),
                    )
                )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ai_providers" in tables:
        prov_cols = {c["name"] for c in inspector.get_columns("ai_providers")}
        with op.batch_alter_table("ai_providers") as batch:
            if "allow_all_models" in prov_cols:
                batch.drop_column("allow_all_models")
            if "enabled_models_json" in prov_cols:
                batch.drop_column("enabled_models_json")

    if "ai_conversations" in tables:
        conv_cols = {c["name"] for c in inspector.get_columns("ai_conversations")}
        conv_indexes = {idx["name"] for idx in inspector.get_indexes("ai_conversations")}
        if "ix_ai_conversations_project_id" in conv_indexes:
            op.drop_index("ix_ai_conversations_project_id", table_name="ai_conversations")
        with op.batch_alter_table("ai_conversations") as batch:
            if "pinned" in conv_cols:
                batch.drop_column("pinned")
            if "project_id" in conv_cols:
                batch.drop_column("project_id")

    if "ai_mcp_servers" in tables:
        op.drop_table("ai_mcp_servers")
    if "ai_project_files" in tables:
        op.drop_table("ai_project_files")
    if "ai_projects" in tables:
        op.drop_table("ai_projects")
