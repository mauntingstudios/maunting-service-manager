"""Add game_store_metadata table for cached Steam Store descriptions and genres.

Revision ID: 20261124_07
Revises: 20261124_06
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124_07"
down_revision: Union[str, None] = "20261124_06"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _index_names(inspector, table: str) -> set[str]:
    return {idx["name"] for idx in inspector.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "game_store_metadata" not in _table_names(inspector):
        op.create_table(
            "game_store_metadata",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("steam_app_id", sa.String(16), nullable=False),
            sa.Column("lang", sa.String(8), nullable=False),
            sa.Column("short_description", sa.Text(), nullable=True),
            sa.Column("genres_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("developers_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("fetch_status", sa.String(16), nullable=False, server_default="ok"),
            sa.Column(
                "fetched_at",
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
            sa.UniqueConstraint("steam_app_id", "lang", name="uq_game_store_metadata_app_lang"),
        )
        inspector = sa.inspect(bind)

    if "ix_game_store_metadata_app_lang" not in _index_names(inspector, "game_store_metadata"):
        op.create_index(
            "ix_game_store_metadata_app_lang",
            "game_store_metadata",
            ["steam_app_id", "lang"],
            unique=False,
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "game_store_metadata" not in _table_names(inspector):
        return
    if "ix_game_store_metadata_app_lang" in _index_names(inspector, "game_store_metadata"):
        op.drop_index("ix_game_store_metadata_app_lang", table_name="game_store_metadata")
    op.drop_table("game_store_metadata")
