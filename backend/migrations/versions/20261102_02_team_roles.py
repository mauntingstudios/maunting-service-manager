"""Team-Rollen und Tresor-Zugriffsberechtigung (can_access_vault).

Revision ID: 20261102_02
Revises: 20261102_01
Create Date: 2026-11-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261102_02"
down_revision: Union[str, None] = "20261102_01"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()

    # 1. team_roles Tabelle anlegen
    if "team_roles" not in tables:
        op.create_table(
            "team_roles",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "team_id",
                sa.Integer(),
                sa.ForeignKey("teams.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(length=32), nullable=False),
            sa.Column("color", sa.String(length=16), nullable=False, server_default="#3b82f6"),
            sa.Column("can_access_vault", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("can_manage_skills", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("can_manage_memory", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("is_default", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("team_id", "name", name="uq_team_roles_team_name"),
        )
        op.create_index("ix_team_roles_team_id", "team_roles", ["team_id"])

    # 2. team_members Spalten ergänzen
    if "team_members" in tables:
        with op.batch_alter_table("team_members") as batch:
            batch.add_column(
                sa.Column("can_access_vault", sa.Boolean(), nullable=False, server_default=sa.true())
            )
            batch.add_column(
                sa.Column(
                    "team_role_id",
                    sa.Integer(),
                    sa.ForeignKey("team_roles.id", ondelete="SET NULL"),
                    nullable=True,
                )
            )

    # 3. team_invitations Spalten ergänzen
    if "team_invitations" in tables:
        with op.batch_alter_table("team_invitations") as batch:
            batch.add_column(
                sa.Column("can_access_vault", sa.Boolean(), nullable=False, server_default=sa.true())
            )
            batch.add_column(
                sa.Column(
                    "team_role_id",
                    sa.Integer(),
                    sa.ForeignKey("team_roles.id", ondelete="SET NULL"),
                    nullable=True,
                )
            )


def downgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()
    if "team_invitations" in tables:
        with op.batch_alter_table("team_invitations") as batch:
            batch.drop_column("team_role_id")
            batch.drop_column("can_access_vault")

    if "team_members" in tables:
        with op.batch_alter_table("team_members") as batch:
            batch.drop_column("team_role_id")
            batch.drop_column("can_access_vault")

    if "team_roles" in tables:
        op.drop_table("team_roles")
