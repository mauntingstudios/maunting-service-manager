"""Zwei-Phasen-Rotation: Pending-/Alt-Bucket fuer Team- und Privat-Tresor.

Revision ID: 20261102_01
Revises: 20261101_01
Create Date: 2026-11-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261102_01"
down_revision: Union[str, None] = "20261101_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TEAM_COLS = [
    ("vault_pending_bucket_id", sa.String(length=64)),
    ("vault_pending_salt", sa.String(length=128)),
    ("vault_rotation_state", sa.String(length=16)),
    ("vault_old_bucket_id", sa.String(length=64)),
    ("vault_old_salt", sa.String(length=128)),
    ("vault_rotation_cleanup_after", sa.DateTime(timezone=True)),
]
_PRIVAT_COLS = [
    ("pending_bucket_id", sa.String(length=64)),
    ("pending_salt", sa.String(length=128)),
    ("rotation_state", sa.String(length=16)),
    ("old_bucket_id", sa.String(length=64)),
    ("old_salt", sa.String(length=128)),
    ("rotation_cleanup_after", sa.DateTime(timezone=True)),
]


def upgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "teams" in tables:
        with op.batch_alter_table("teams") as batch:
            for name, typ in _TEAM_COLS:
                batch.add_column(sa.Column(name, typ, nullable=True))
    if "vault_user_settings" in tables:
        with op.batch_alter_table("vault_user_settings") as batch:
            for name, typ in _PRIVAT_COLS:
                batch.add_column(sa.Column(name, typ, nullable=True))


def downgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "vault_user_settings" in tables:
        with op.batch_alter_table("vault_user_settings") as batch:
            for name, _ in reversed(_PRIVAT_COLS):
                batch.drop_column(name)
    if "teams" in tables:
        with op.batch_alter_table("teams") as batch:
            for name, _ in reversed(_TEAM_COLS):
                batch.drop_column(name)
