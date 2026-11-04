"""Team-Tresor ohne geteiltes Passwort: DEK pro Mitglied verpackt.

Revision ID: 20261104_01
Revises: 20261103_04
Create Date: 2026-11-04
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261104_01"
down_revision: Union[str, None] = "20261103_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FALLENDE_SPALTEN = [
    "vault_salt",
    "vault_pending_salt",
    "vault_old_salt",
    "vault_hint",
    "vault_last_hint_requested_at",
]


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "team_vault_keys" not in tables:
        op.create_table(
            "team_vault_keys",
            sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("key_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("wrapped_dek", sa.Text(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.func.now(),
            ),
            sa.UniqueConstraint(
                "team_id", "user_id", "key_version", name="uq_team_vault_key"
            ),
        )
        op.create_index(
            "ix_team_vault_key_team", "team_vault_keys", ["team_id", "key_version"]
        )
        op.create_index("ix_team_vault_key_user", "team_vault_keys", ["user_id"])
    if "teams" in tables:
        columns = {column["name"] for column in inspector.get_columns("teams")}
        with op.batch_alter_table("teams") as batch:
            if "vault_key_version" not in columns:
                batch.add_column(
                    sa.Column(
                        "vault_key_version",
                        sa.Integer(),
                        server_default="1",
                        nullable=False,
                    )
                )
            for name in _FALLENDE_SPALTEN:
                if name in columns:
                    batch.drop_column(name)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    tables = set(inspector.get_table_names())
    if "teams" in tables:
        columns = {column["name"] for column in inspector.get_columns("teams")}
        with op.batch_alter_table("teams") as batch:
            if "vault_key_version" in columns:
                batch.drop_column("vault_key_version")
            if "vault_salt" not in columns:
                batch.add_column(
                    sa.Column("vault_salt", sa.String(length=128), nullable=True)
                )
            if "vault_pending_salt" not in columns:
                batch.add_column(
                    sa.Column("vault_pending_salt", sa.String(length=128), nullable=True)
                )
            if "vault_old_salt" not in columns:
                batch.add_column(
                    sa.Column("vault_old_salt", sa.String(length=128), nullable=True)
                )
            if "vault_hint" not in columns:
                batch.add_column(sa.Column("vault_hint", sa.Text(), nullable=True))
            if "vault_last_hint_requested_at" not in columns:
                batch.add_column(
                    sa.Column(
                        "vault_last_hint_requested_at",
                        sa.DateTime(timezone=True),
                        nullable=True,
                    )
                )
    if "team_vault_keys" in tables:
        op.drop_index("ix_team_vault_key_user", table_name="team_vault_keys")
        op.drop_index("ix_team_vault_key_team", table_name="team_vault_keys")
        op.drop_table("team_vault_keys")
