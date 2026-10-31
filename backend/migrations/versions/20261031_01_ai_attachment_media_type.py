"""`ai_attachments.media_type` nimmt die langen Office-MIME-Typen auf.

Die Spalte war 64 Zeichen breit. Die kanonischen OOXML-Typen sind laenger
(`application/vnd.openxmlformats-officedocument.wordprocessingml.document`),
und ein Upload einer DOCX endete deshalb in einem Datenbankfehler statt in
einem Anhang. Die Verbreiterung ist additiv; bestehende Werte bleiben.

Revision ID: 20261031_01
Revises: 20261028_01
Create Date: 2026-10-31
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261031_01"
down_revision: Union[str, None] = "20261028_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "ai_attachments" not in sa.inspect(op.get_bind()).get_table_names():
        return
    with op.batch_alter_table("ai_attachments") as batch:
        batch.alter_column(
            "media_type",
            existing_type=sa.String(length=64),
            type_=sa.String(length=128),
            existing_nullable=False,
        )


def downgrade() -> None:
    if "ai_attachments" not in sa.inspect(op.get_bind()).get_table_names():
        return
    with op.batch_alter_table("ai_attachments") as batch:
        batch.alter_column(
            "media_type",
            existing_type=sa.String(length=128),
            type_=sa.String(length=64),
            existing_nullable=False,
        )
