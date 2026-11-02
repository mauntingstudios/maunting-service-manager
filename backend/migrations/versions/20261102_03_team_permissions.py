"""Team-Berechtigungssystem: team_role_permissions, team_role_server_grants, team_member_roles.

Revision ID: 20261102_03
Revises: 20261102_02
Create Date: 2026-11-02
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261102_03"
down_revision: Union[str, None] = "20261102_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()

    # 1. team_roles Spalten ergänzen (description, is_admin)
    if "team_roles" in tables:
        cols = [c["name"] for c in sa.inspect(op.get_bind()).get_columns("team_roles")]
        with op.batch_alter_table("team_roles") as batch:
            if "description" not in cols:
                batch.add_column(sa.Column("description", sa.String(length=255), nullable=True))
            if "is_admin" not in cols:
                batch.add_column(
                    sa.Column("is_admin", sa.Boolean(), nullable=False, server_default=sa.false())
                )

    # 2. team_role_permissions Tabelle anlegen
    if "team_role_permissions" not in tables:
        op.create_table(
            "team_role_permissions",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "role_id",
                sa.Integer(),
                sa.ForeignKey("team_roles.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("permission_key", sa.String(length=64), nullable=False),
            sa.UniqueConstraint("role_id", "permission_key", name="uq_team_role_permissions_role_key"),
        )
        op.create_index(
            "ix_team_role_permissions_lookup",
            "team_role_permissions",
            ["role_id", "permission_key"],
        )

    # 3. team_role_server_grants Tabelle anlegen
    if "team_role_server_grants" not in tables:
        op.create_table(
            "team_role_server_grants",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "role_id",
                sa.Integer(),
                sa.ForeignKey("team_roles.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "server_id",
                sa.Integer(),
                sa.ForeignKey("servers.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("permission_key", sa.String(length=64), nullable=False),
            sa.UniqueConstraint(
                "role_id", "server_id", "permission_key", name="uq_team_role_server_grants"
            ),
        )
        op.create_index(
            "ix_team_role_server_grants_lookup",
            "team_role_server_grants",
            ["server_id", "permission_key"],
        )

    # 4. team_member_roles Tabelle anlegen
    if "team_member_roles" not in tables:
        op.create_table(
            "team_member_roles",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "team_member_id",
                sa.Integer(),
                sa.ForeignKey("team_members.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column(
                "team_role_id",
                sa.Integer(),
                sa.ForeignKey("team_roles.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False),
            sa.UniqueConstraint("team_member_id", "team_role_id", name="uq_team_member_roles"),
        )
        op.create_index(
            "ix_team_member_roles_lookup",
            "team_member_roles",
            ["team_member_id", "team_role_id"],
        )


def downgrade() -> None:
    tables = sa.inspect(op.get_bind()).get_table_names()

    if "team_member_roles" in tables:
        op.drop_table("team_member_roles")

    if "team_role_server_grants" in tables:
        op.drop_table("team_role_server_grants")

    if "team_role_permissions" in tables:
        op.drop_table("team_role_permissions")

    if "team_roles" in tables:
        with op.batch_alter_table("team_roles") as batch:
            batch.drop_column("is_admin")
            batch.drop_column("description")
