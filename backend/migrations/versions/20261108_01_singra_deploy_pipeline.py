"""Singra Deployment Pipeline: server_runtime_env, singra_deployments, singra_test_runs.

Revision ID: 20261108_01
Revises: 20261105_02
Create Date: 2026-11-08
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261108_01"
down_revision: Union[str, None] = "20261105_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # 1. server_runtime_env
    if "server_runtime_env" not in tables:
        op.create_table(
            "server_runtime_env",
            sa.Column(
                "server_id",
                sa.Integer(),
                sa.ForeignKey("servers.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column("env_encrypted", sa.Text(), nullable=False),
            sa.Column("probe_url", sa.String(length=512), nullable=True),
            sa.Column("managed_by", sa.String(length=64), nullable=True, server_default="singra"),
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

    # 2. singra_deployments
    if "singra_deployments" not in tables:
        op.create_table(
            "singra_deployments",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "project_id",
                sa.String(length=36),
                sa.ForeignKey("ai_projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("environment", sa.String(length=16), nullable=False, server_default="prod"),
            sa.Column("version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("task_id", sa.String(length=36), nullable=True),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("phase", sa.String(length=32), nullable=False, server_default="snapshot"),
            sa.Column("error_code", sa.String(length=64), nullable=True),
            sa.Column("error_detail", sa.Text(), nullable=True),
            sa.Column("diagnostics_json", sa.Text(), nullable=True),
            sa.Column("release_path", sa.Text(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_singra_deployments_project_id", "singra_deployments", ["project_id"])
        op.create_index("ix_singra_deployments_task_id", "singra_deployments", ["task_id"])

    # 3. singra_test_runs
    if "singra_test_runs" not in tables:
        op.create_table(
            "singra_test_runs",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "project_id",
                sa.String(length=36),
                sa.ForeignKey("ai_projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("environment", sa.String(length=16), nullable=False, server_default="dev"),
            sa.Column("release_checksum", sa.String(length=64), nullable=True),
            sa.Column("kind", sa.String(length=32), nullable=False, server_default="e2e"),
            sa.Column("status", sa.String(length=32), nullable=False, server_default="pending"),
            sa.Column("summary_json", sa.Text(), nullable=True),
            sa.Column("artifacts_path", sa.Text(), nullable=True),
            sa.Column(
                "started_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index("ix_singra_test_runs_project_id", "singra_test_runs", ["project_id"])
        op.create_index("ix_singra_test_runs_checksum", "singra_test_runs", ["release_checksum"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "singra_test_runs" in tables:
        op.drop_index("ix_singra_test_runs_checksum", table_name="singra_test_runs")
        op.drop_index("ix_singra_test_runs_project_id", table_name="singra_test_runs")
        op.drop_table("singra_test_runs")

    if "singra_deployments" in tables:
        op.drop_index("ix_singra_deployments_task_id", table_name="singra_deployments")
        op.drop_index("ix_singra_deployments_project_id", table_name="singra_deployments")
        op.drop_table("singra_deployments")

    if "server_runtime_env" in tables:
        op.drop_table("server_runtime_env")
