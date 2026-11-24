"""Add news_posts table for editorial news & AI-curated announcements.

Revision ID: 20261124_05
Revises: 20261124_04
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124_05"
down_revision: Union[str, None] = "20261124_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def _index_names(inspector, table: str) -> set[str]:
    return {idx["name"] for idx in inspector.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "news_posts" not in _table_names(inspector):
        op.create_table(
            "news_posts",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column("slug", sa.String(140), nullable=False),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("summary", sa.String(400), nullable=False, server_default=""),
            sa.Column("content_markdown", sa.Text(), nullable=False),
            sa.Column(
                "category",
                sa.String(32),
                nullable=False,
                server_default="announcement",
            ),
            sa.Column("related_game_type", sa.String(64), nullable=True),
            sa.Column("sources_json", sa.Text(), nullable=True),
            sa.Column("cover_image_filename", sa.String(255), nullable=True),
            sa.Column("cover_version", sa.String(64), nullable=True),
            sa.Column(
                "is_published",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column(
                "is_pinned",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            ),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column(
                "author_user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("author_display_name", sa.String(120), nullable=True),
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
                "category IN ('announcement', 'game_update', 'infrastructure', 'maintenance', 'promo', 'world_news')",
                name="ck_news_posts_category",
            ),
            sa.UniqueConstraint("slug", name="uq_news_posts_slug"),
        )
        inspector = sa.inspect(bind)

    existing_indexes = _index_names(inspector, "news_posts")
    for idx_name, cols, unique in (
        ("ix_news_posts_slug", ["slug"], True),
        ("ix_news_posts_category", ["category"], False),
        ("ix_news_posts_related_game_type", ["related_game_type"], False),
        ("ix_news_posts_is_published", ["is_published"], False),
        ("ix_news_posts_published_at", ["published_at"], False),
    ):
        if idx_name not in existing_indexes:
            op.create_index(idx_name, "news_posts", cols, unique=unique)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "news_posts" in _table_names(inspector):
        op.drop_table("news_posts")
