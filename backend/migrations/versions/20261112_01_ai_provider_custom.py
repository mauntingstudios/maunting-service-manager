"""Custom Provider Spalten fuer lokale und selbst gehostete KI-Endpunkte.

Revision ID: 20261112_01
Revises: 20261111_02
Create Date: 2026-11-12
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "20261112_01"
down_revision: Union[str, None] = "20261111_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "ai_providers" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("ai_providers")}
    with op.batch_alter_table("ai_providers") as batch:
        if "custom_base_url" not in columns:
            batch.add_column(sa.Column("custom_base_url", sa.String(length=512), nullable=True))
        if "custom_chat_protocol" not in columns:
            batch.add_column(
                sa.Column(
                    "custom_chat_protocol",
                    sa.String(length=32),
                    nullable=False,
                    server_default=sa.text("'chat_completions'"),
                )
            )
        if "custom_reasoning_dialect" not in columns:
            batch.add_column(
                sa.Column(
                    "custom_reasoning_dialect",
                    sa.String(length=32),
                    nullable=False,
                    server_default=sa.text("'none'"),
                )
            )
        if "custom_context_tokens" not in columns:
            batch.add_column(sa.Column("custom_context_tokens", sa.Integer(), nullable=True))
        if "custom_max_output_tokens" not in columns:
            batch.add_column(sa.Column("custom_max_output_tokens", sa.Integer(), nullable=True))
        if "custom_supports_vision" not in columns:
            batch.add_column(sa.Column("custom_supports_vision", sa.Boolean(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "ai_providers" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("ai_providers")}
    with op.batch_alter_table("ai_providers") as batch:
        for column_name in (
            "custom_supports_vision",
            "custom_max_output_tokens",
            "custom_context_tokens",
            "custom_reasoning_dialect",
            "custom_chat_protocol",
            "custom_base_url",
        ):
            if column_name in columns:
                batch.drop_column(column_name)
