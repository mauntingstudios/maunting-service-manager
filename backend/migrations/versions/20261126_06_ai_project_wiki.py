"""Add Projekt-Wiki (DeepWiki) fields on ai_projects and wiki page/chunk tables.

Revision ID: 20261126_06
Revises: 20261126_05
Create Date: 2026-11-26
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261126_06"
down_revision: Union[str, None] = "20261126_05"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ai_projects" in tables:
        cols = {c["name"] for c in inspector.get_columns("ai_projects")}
        additions: list[tuple[str, sa.Column]] = [
            ("wiki_enabled", sa.Column("wiki_enabled", sa.Boolean(), nullable=False, server_default=sa.false())),
            ("wiki_auto_update", sa.Column("wiki_auto_update", sa.Boolean(), nullable=False, server_default=sa.false())),
            ("wiki_path", sa.Column("wiki_path", sa.String(120), nullable=False, server_default=".singra/wiki")),
            ("wiki_status", sa.Column("wiki_status", sa.String(24), nullable=False, server_default="idle")),
            ("wiki_last_indexed_commit", sa.Column("wiki_last_indexed_commit", sa.String(64), nullable=True)),
            ("wiki_last_updated_at", sa.Column("wiki_last_updated_at", sa.DateTime(timezone=True), nullable=True)),
            ("wiki_last_error", sa.Column("wiki_last_error", sa.Text(), nullable=True)),
        ]
        for name, column in additions:
            if name not in cols:
                op.add_column("ai_projects", column)

    if "ai_project_wiki_pages" not in tables:
        op.create_table(
            "ai_project_wiki_pages",
            sa.Column("id", sa.String(36), primary_key=True, nullable=False),
            sa.Column(
                "project_id",
                sa.String(36),
                sa.ForeignKey("ai_projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("slug", sa.String(120), nullable=False),
            sa.Column("title", sa.Text(), nullable=False),
            sa.Column("category", sa.String(32), nullable=False, server_default="module"),
            sa.Column("summary", sa.Text(), nullable=False, server_default=""),
            sa.Column("file_path", sa.String(320), nullable=False),
            sa.Column(
                "doc_uid",
                sa.String(36),
                sa.ForeignKey("documents.doc_uid", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("source_files_json", sa.Text(), nullable=False, server_default="[]"),
            sa.Column("content_markdown", sa.Text(), nullable=False, server_default=""),
            sa.Column("content_hash", sa.String(64), nullable=False, server_default=""),
            sa.Column("sort_order", sa.Integer(), nullable=False, server_default="100"),
            sa.Column("updated_by", sa.String(24), nullable=False, server_default="ai"),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("project_id", "slug", name="uq_ai_project_wiki_pages_project_slug"),
        )
        op.create_index("ix_ai_project_wiki_pages_project_id", "ai_project_wiki_pages", ["project_id"])
        op.create_index("ix_ai_project_wiki_pages_doc_uid", "ai_project_wiki_pages", ["doc_uid"])
        op.create_index(
            "ix_ai_project_wiki_pages_project_sort",
            "ai_project_wiki_pages",
            ["project_id", "sort_order"],
        )

    if "ai_project_wiki_chunks" not in tables:
        op.create_table(
            "ai_project_wiki_chunks",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True, nullable=False),
            sa.Column(
                "page_id",
                sa.String(36),
                sa.ForeignKey("ai_project_wiki_pages.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "project_id",
                sa.String(36),
                sa.ForeignKey("ai_projects.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("heading", sa.Text(), nullable=False, server_default=""),
            sa.Column("content", sa.Text(), nullable=False, server_default=""),
            sa.Column("embedding", sa.LargeBinary(), nullable=True),
            sa.Column("embedding_model", sa.String(64), nullable=True),
            sa.Column("chunk_index", sa.Integer(), nullable=False, server_default="0"),
        )
        op.create_index("ix_ai_project_wiki_chunks_page_id", "ai_project_wiki_chunks", ["page_id"])
        op.create_index("ix_ai_project_wiki_chunks_project_id", "ai_project_wiki_chunks", ["project_id"])
        op.create_index(
            "ix_ai_project_wiki_chunks_project_page",
            "ai_project_wiki_chunks",
            ["project_id", "page_id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = set(inspector.get_table_names())

    if "ai_project_wiki_chunks" in tables:
        op.drop_index("ix_ai_project_wiki_chunks_project_page", table_name="ai_project_wiki_chunks")
        op.drop_index("ix_ai_project_wiki_chunks_project_id", table_name="ai_project_wiki_chunks")
        op.drop_index("ix_ai_project_wiki_chunks_page_id", table_name="ai_project_wiki_chunks")
        op.drop_table("ai_project_wiki_chunks")

    if "ai_project_wiki_pages" in tables:
        op.drop_index("ix_ai_project_wiki_pages_project_sort", table_name="ai_project_wiki_pages")
        op.drop_index("ix_ai_project_wiki_pages_doc_uid", table_name="ai_project_wiki_pages")
        op.drop_index("ix_ai_project_wiki_pages_project_id", table_name="ai_project_wiki_pages")
        op.drop_table("ai_project_wiki_pages")

    if "ai_projects" in tables:
        cols = {c["name"] for c in inspector.get_columns("ai_projects")}
        for col in (
            "wiki_last_error",
            "wiki_last_updated_at",
            "wiki_last_indexed_commit",
            "wiki_status",
            "wiki_path",
            "wiki_auto_update",
            "wiki_enabled",
        ):
            if col in cols:
                op.drop_column("ai_projects", col)
