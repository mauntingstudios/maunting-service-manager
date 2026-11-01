"""Passwort-Hinweis fuer den Team-Tresor.

Erlaubt Teams (z.B. Familien oder Organisationen) einen optionalen
Passwort-Hinweis fuer das Master-Passwort des Team-Tresors zu hinterlegen
und bei Bedarf per E-Mail anzufordern (identisch zum persoenlichen Tresor).

Revision ID: 20261101_01
Revises: 20261031_04
Create Date: 2026-11-01
"""

from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = "20261101_01"
down_revision: Union[str, None] = "20261031_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "teams" not in sa.inspect(op.get_bind()).get_table_names():
        return
    with op.batch_alter_table("teams") as batch:
        batch.add_column(sa.Column("vault_hint", sa.Text(), nullable=True))
        batch.add_column(
            sa.Column("vault_last_hint_requested_at", sa.DateTime(timezone=True), nullable=True)
        )


def downgrade() -> None:
    if "teams" not in sa.inspect(op.get_bind()).get_table_names():
        return
    with op.batch_alter_table("teams") as batch:
        batch.drop_column("vault_last_hint_requested_at")
        batch.drop_column("vault_hint")
