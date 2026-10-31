"""Team-Tresor: Bucket-ID, Salz und Rotations-Flag fuer Teams.

Erlaubt Teams (z.B. Familien oder Organisationen) einen eigenen,
Ende-zu-Ende verschluesselten Tresor mit gemeinsamem Master-Passwort
und automatischem Rotationshinweis bei Mitglieder-Austritt.

Revision ID: 20261031_03
Revises: 20261031_02
Create Date: 2026-10-31
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261031_03"
down_revision: Union[str, None] = "20261031_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "teams" not in sa.inspect(op.get_bind()).get_table_names():
        return
    with op.batch_alter_table("teams") as batch:
        batch.add_column(sa.Column("vault_bucket_id", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("vault_salt", sa.String(length=128), nullable=True))
        batch.add_column(
            sa.Column(
                "vault_needs_rotation",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            )
        )


def downgrade() -> None:
    if "teams" not in sa.inspect(op.get_bind()).get_table_names():
        return
    with op.batch_alter_table("teams") as batch:
        batch.drop_column("vault_needs_rotation")
        batch.drop_column("vault_salt")
        batch.drop_column("vault_bucket_id")
