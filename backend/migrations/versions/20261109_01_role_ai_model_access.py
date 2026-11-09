"""Role AI model access control and provider permissions.

Revision ID: 20261109_01
Revises: 20261108_01
Create Date: 2026-11-09
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261109_01"
down_revision: Union[str, None] = "20261108_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    # 1. Spalte allow_all_models an role_ai_limits ergaenzen
    if "role_ai_limits" in tables:
        cols = {c["name"] for c in inspector.get_columns("role_ai_limits")}
        if "allow_all_models" not in cols:
            op.add_column(
                "role_ai_limits",
                sa.Column("allow_all_models", sa.Boolean(), nullable=False, server_default=sa.true()),
            )

    # 2. Tabelle role_ai_model_access erstellen
    if "role_ai_model_access" not in tables:
        op.create_table(
            "role_ai_model_access",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "role_id",
                sa.Integer(),
                sa.ForeignKey("roles.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "provider_id",
                sa.Integer(),
                sa.ForeignKey("ai_providers.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "allow_all",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            ),
            sa.Column("allowed_models_json", sa.Text(), nullable=True),
            sa.UniqueConstraint("role_id", "provider_id", name="uq_role_ai_model_access_role_provider"),
        )
        op.create_index("ix_role_ai_model_access_role_id", "role_ai_model_access", ["role_id"])
        op.create_index("ix_role_ai_model_access_provider_id", "role_ai_model_access", ["provider_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "role_ai_model_access" in tables:
        try:
            op.drop_index("ix_role_ai_model_access_provider_id", table_name="role_ai_model_access")
            op.drop_index("ix_role_ai_model_access_role_id", table_name="role_ai_model_access")
        except Exception:
            pass
        op.drop_table("role_ai_model_access")

    if "role_ai_limits" in tables:
        cols = {c["name"] for c in inspector.get_columns("role_ai_limits")}
        if "allow_all_models" in cols:
            op.drop_column("role_ai_limits", "allow_all_models")
