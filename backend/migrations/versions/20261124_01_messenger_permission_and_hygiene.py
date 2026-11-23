"""Messenger-Berechtigung `messenger.use` und Abwärtskompatibilität für Bestandsrollen.

Revision ID: 20261124_01
Revises: 20261122_04
Create Date: 2026-11-24
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261124_01"
down_revision: Union[str, None] = "20261122_04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_names(inspector) -> set[str]:
    return set(inspector.get_table_names())


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    tables = _table_names(inspector)
    if not {"roles", "role_permissions"}.issubset(tables):
        return

    admin_role_id = bind.execute(
        sa.text("SELECT id FROM roles WHERE name = 'admin' LIMIT 1")
    ).scalar()

    target_role_ids: set[int] = set()
    if admin_role_id is not None:
        target_role_ids.add(int(admin_role_id))

    shop_enabled_raw = None
    if "panel_settings" in tables:
        shop_enabled_raw = bind.execute(
            sa.text("SELECT value FROM panel_settings WHERE key = 'shop_enabled' LIMIT 1")
        ).scalar()

    is_shop_active = str(shop_enabled_raw or "").strip().lower() in {"1", "true", "yes", "on"}
    if not is_shop_active:
        legacy_roles = bind.execute(
            sa.text(
                "SELECT DISTINCT role_id FROM role_permissions "
                "WHERE permission_key IN ('calendar.use', 'notes.use', 'docs.use')"
            )
        ).scalars().all()
        for rid in legacy_roles:
            target_role_ids.add(int(rid))

    for role_id in sorted(target_role_ids):
        exists = bind.execute(
            sa.text(
                "SELECT id FROM role_permissions "
                "WHERE role_id = :role_id AND permission_key = 'messenger.use' LIMIT 1"
            ),
            {"role_id": role_id},
        ).scalar()
        if exists is None:
            bind.execute(
                sa.text(
                    "INSERT INTO role_permissions (role_id, permission_key) "
                    "VALUES (:role_id, 'messenger.use')"
                ),
                {"role_id": role_id},
            )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if "role_permissions" not in _table_names(inspector):
        return
    bind.execute(
        sa.text("DELETE FROM role_permissions WHERE permission_key = 'messenger.use'")
    )
