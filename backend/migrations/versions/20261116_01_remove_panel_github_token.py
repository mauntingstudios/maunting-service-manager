"""Entfernt uebernommene panelweite GitHub-Token-Eintraege.

Revision ID: 20261116_01
Revises: 20261112_02
Create Date: 2026-11-16
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "20261116_01"
down_revision: Union[str, None] = "20261112_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "panel_settings" not in inspector.get_table_names():
        return
    op.execute(
        sa.text(
            "DELETE FROM panel_settings WHERE key IN ('github_clone_token_enc', 'github_clone_token')"
        )
    )


def downgrade() -> None:
    # Ein entferntes Geheimnis wird beim Downgrade bewusst nicht wiederhergestellt.
    pass
