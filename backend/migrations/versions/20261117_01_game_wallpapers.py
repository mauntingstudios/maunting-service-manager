"""Tabelle fuer Custom-Server-Wallpapers (Galerie pro Spiel).

Revision ID: 20261117_01
Revises: 20261116_02
Create Date: 2026-11-17
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "20261117_01"
down_revision: Union[str, None] = "20261116_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())

    if "game_wallpapers" not in tables:
        op.create_table(
            "game_wallpapers",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("game_type", sa.String(length=64), nullable=False),
            sa.Column("file_name", sa.String(length=128), nullable=False),
            sa.Column(
                "uploaded_by",
                sa.String(length=128),
                nullable=False,
                server_default="system",
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column(
                "is_active", sa.Boolean(), nullable=False, server_default=sa.text("false")
            ),
        )
        op.create_index("ix_game_wallpapers_id", "game_wallpapers", ["id"])
        op.create_index(
            "ix_game_wallpapers_game_type", "game_wallpapers", ["game_type"]
        )
        op.create_index(
            "ix_game_wallpapers_game_active",
            "game_wallpapers",
            ["game_type", "is_active"],
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "game_wallpapers" in tables:
        op.drop_table("game_wallpapers")
