"""Ein einziger E2EE-Transport: Nachrichten, Chat-Schluessel, Lesestaende.

Revision ID: 20261025_01
Revises: 20261024_02
Create Date: 2026-10-25

Die drei alten Transportwege (blinde Mailbox, Geraete-Queue, Delivery-Inbox)
und der Double Ratchet werden durch eine Tabelle ``e2ee_messages`` ersetzt.
Die Migration ist auf beiden Seiten wiederholbar: eine frische Datenbank aus
``create_all`` hat die neuen Tabellen bereits, eine bestehende hat die alten.
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "20261025_01"
down_revision: Union[str, None] = "20261024_02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

NEW_TABLES = (
    "e2ee_message_reactions",
    "e2ee_messages",
    "e2ee_chat_states",
    "e2ee_chat_keys",
    "direct_chat_members",
    "e2ee_account_key_vault",
    "e2ee_accounts",
)

LEGACY_PREFIX = "legacy_"

OLD_TABLES = (
    "e2ee_device_queue",
    "e2ee_blind_envelopes",
    "e2ee_blind_mailboxes",
    "e2ee_mailbox_push",
    "e2ee_device_inboxes",
    "e2ee_delivery_receipts",
    "e2ee_deliveries",
    "e2ee_delivery_payloads",
)


def _tables(bind) -> set[str]:
    return set(sa.inspect(bind).get_table_names())


def _columns(bind, table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(bind).get_columns(table)}


def _indexes(bind, table: str) -> set[str]:
    return {i["name"] for i in sa.inspect(bind).get_indexes(table)}


def _fks(bind, table: str) -> set[str]:
    return {fk["name"] for fk in sa.inspect(bind).get_foreign_keys(table) if fk.get("name")}


def _drop_indexes(bind, table: str) -> None:
    # Eine UNIQUE-Bedingung legt in PostgreSQL einen Index gleichen Namens an.
    # Der laesst sich nur ueber die Bedingung entfernen; ein DROP INDEX
    # scheitert dort mit "constraint requires it".
    eindeutig = {
        c["name"]
        for c in sa.inspect(bind).get_unique_constraints(table)
        if c.get("name")
    }
    for name in sorted(eindeutig):
        op.drop_constraint(name, table, type_="unique")
    for name in sorted(_indexes(bind, table) - eindeutig):
        op.drop_index(name, table_name=table)


def _drop_table(bind, table: str) -> None:
    if table in _tables(bind):
        _drop_indexes(bind, table)
        op.drop_table(table)


def _archive_table(bind, table: str) -> None:
    """Alte Tabelle umbenennen statt loeschen.

    Die Chiffrate der alten Wege sind mit dem entfernten Ratchet nicht mehr
    lesbar, aber sie sind Nutzerdaten. Ein Loeschen in derselben Migration waere
    endgueltig und liesse sich nicht zuruecknehmen. Als ``legacy_…`` bleiben
    sie eingefroren in der Datenbank; kein Code liest sie.
    """
    tables = _tables(bind)
    legacy = f"{LEGACY_PREFIX}{table}"
    if table in tables and legacy not in tables:
        op.execute(sa.text(f'ALTER TABLE "{table}" RENAME TO "{legacy}"'))


def _restore_archives(bind) -> None:
    tables = _tables(bind)
    for table in OLD_TABLES:
        legacy = f"{LEGACY_PREFIX}{table}"
        if legacy in tables and table not in tables:
            op.execute(sa.text(f'ALTER TABLE "{legacy}" RENAME TO "{table}"'))
    if "legacy_e2ee_delivery_seq" in set(
        r[0] for r in bind.execute(sa.text(
            "SELECT sequencename FROM pg_sequences WHERE sequencename = 'legacy_e2ee_delivery_seq'"
        ))
    ):
        op.execute(sa.text("ALTER SEQUENCE legacy_e2ee_delivery_seq RENAME TO e2ee_delivery_seq"))


def _add_ephemeral(bind, table: str) -> None:
    cols = _columns(bind, table)
    if "ephemeral_ttl_seconds" not in cols:
        op.add_column(table, sa.Column("ephemeral_ttl_seconds", sa.Integer(), nullable=True))
    if "ephemeral_enabled_by_user_id" not in cols:
        op.add_column(
            table,
            sa.Column("ephemeral_enabled_by_user_id", sa.Integer(), nullable=True),
        )
    name = f"fk_{table}_ephemeral_user"
    if name not in _fks(bind, table):
        op.create_foreign_key(
            name,
            table,
            "users",
            ["ephemeral_enabled_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )


def _drop_ephemeral(bind, table: str) -> None:
    fk = f"fk_{table}_ephemeral_user"
    if fk in _fks(bind, table):
        op.drop_constraint(fk, table, type_="foreignkey")
    cols = _columns(bind, table)
    if "ephemeral_enabled_by_user_id" in cols:
        op.drop_column(table, "ephemeral_enabled_by_user_id")
    if "ephemeral_ttl_seconds" in cols:
        op.drop_column(table, "ephemeral_ttl_seconds")


def upgrade() -> None:
    bind = op.get_bind()
    tables = _tables(bind)

    if "direct_chats" in tables:
        _add_ephemeral(bind, "direct_chats")
    if "chat_groups" in tables:
        _add_ephemeral(bind, "chat_groups")

    if "e2ee_accounts" not in tables:
        op.create_table(
            "e2ee_accounts",
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("public_key_jwk", sa.Text(), nullable=False),
            sa.Column("signing_public_key_jwk", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("user_id"),
        )

    if "e2ee_account_key_vault" not in tables:
        op.create_table(
            "e2ee_account_key_vault",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("device_id", sa.String(length=64), nullable=False),
            sa.Column("encrypted_bundle", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "device_id", name="uq_e2ee_account_key_device"),
        )
        op.create_index("ix_e2ee_account_key_user", "e2ee_account_key_vault", ["user_id"])

    if "direct_chat_members" not in tables:
        op.create_table(
            "direct_chat_members",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("chat_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["chat_id"], ["direct_chats.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("chat_id", "user_id", name="uq_direct_chat_member"),
        )
        op.create_index("ix_direct_chat_member_user", "direct_chat_members", ["user_id"])

    if "e2ee_chat_keys" not in tables:
        op.create_table(
            "e2ee_chat_keys",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("chat_type", sa.String(length=16), nullable=False),
            sa.Column("chat_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("key_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("encrypted_chat_key", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "chat_type", "chat_id", "user_id", "key_version", name="uq_e2ee_chat_key"
            ),
        )
        op.create_index(
            "ix_e2ee_chat_key_chat", "e2ee_chat_keys", ["chat_type", "chat_id", "key_version"]
        )
        op.create_index("ix_e2ee_chat_key_user", "e2ee_chat_keys", ["user_id"])

    if "e2ee_messages" not in tables:
        op.create_table(
            "e2ee_messages",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("client_uuid", sa.String(length=64), nullable=False),
            sa.Column("chat_type", sa.String(length=16), nullable=False),
            sa.Column("chat_id", sa.Integer(), nullable=False),
            sa.Column("sender_user_id", sa.Integer(), nullable=False),
            sa.Column("key_version", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("encrypted_payload", sa.Text(), nullable=False),
            sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("pinned_by_user_id", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["sender_user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["pinned_by_user_id"], ["users.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("client_uuid", name="uq_e2ee_message_client_uuid"),
        )
        op.create_index(
            "ix_e2ee_messages_chat_cursor", "e2ee_messages", ["chat_type", "chat_id", "id"]
        )
        op.create_index("ix_e2ee_messages_expires", "e2ee_messages", ["expires_at"])
        op.create_index("ix_e2ee_messages_sender", "e2ee_messages", ["sender_user_id"])

    if "e2ee_message_reactions" not in tables:
        op.create_table(
            "e2ee_message_reactions",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("message_id", sa.BigInteger(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column("encrypted_reaction", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["message_id"], ["e2ee_messages.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("message_id", "user_id", name="uq_e2ee_message_reaction"),
        )
        op.create_index(
            "ix_e2ee_message_reaction_message", "e2ee_message_reactions", ["message_id"]
        )

    if "e2ee_chat_states" not in tables:
        op.create_table(
            "e2ee_chat_states",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("chat_type", sa.String(length=16), nullable=False),
            sa.Column("chat_id", sa.Integer(), nullable=False),
            sa.Column("user_id", sa.Integer(), nullable=False),
            sa.Column(
                "last_delivered_message_id", sa.BigInteger(), nullable=False, server_default="0"
            ),
            sa.Column("last_read_message_id", sa.BigInteger(), nullable=False, server_default="0"),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("chat_type", "chat_id", "user_id", name="uq_e2ee_chat_state"),
        )
        op.create_index("ix_e2ee_chat_state_user", "e2ee_chat_states", ["user_id"])

    # Alte Wege aus dem Betrieb nehmen, aber ihre Zeilen nicht vernichten.
    for table in OLD_TABLES:
        _archive_table(bind, table)
    if "e2ee_delivery_seq" in set(
        r[0] for r in bind.execute(sa.text(
            "SELECT sequencename FROM pg_sequences WHERE sequencename = 'e2ee_delivery_seq'"
        ))
    ):
        op.execute(sa.text("ALTER SEQUENCE e2ee_delivery_seq RENAME TO legacy_e2ee_delivery_seq"))


def downgrade() -> None:
    bind = op.get_bind()
    tables = _tables(bind)
    _restore_archives(bind)
    tables = _tables(bind)

    # Neue Tabellen zuerst, dann die Spalten.
    for table in NEW_TABLES:
        _drop_table(bind, table)
    if "direct_chats" in tables:
        _drop_ephemeral(bind, "direct_chats")
    if "chat_groups" in tables:
        _drop_ephemeral(bind, "chat_groups")

    # Die alten Tabellen wieder aufbauen, damit ein Downgrade nicht nur die
    # neuen Funktionen entfernt, sondern den vorherigen Stand hinterlaesst.
    if "e2ee_blind_mailboxes" not in tables:
        op.create_table(
            "e2ee_blind_mailboxes",
            sa.Column("mailbox_id", sa.String(length=64), nullable=False),
            sa.Column("auth_verifier", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("mailbox_id"),
        )

    if "e2ee_blind_envelopes" not in tables:
        op.create_table(
            "e2ee_blind_envelopes",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("blind_mailbox_id", sa.String(length=64), nullable=False),
            sa.Column("ciphertext_envelope", sa.Text(), nullable=False),
            sa.Column("ciphertext_sha256", sa.String(length=64), nullable=True),
            sa.Column("client_uuid", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "blind_mailbox_id", "client_uuid", name="uq_e2ee_envelope_mailbox_client_uuid"
            ),
        )
        op.create_index("ix_e2ee_blind_envelopes_blind_mailbox_id", "e2ee_blind_envelopes", ["blind_mailbox_id"])
        op.create_index("ix_e2ee_blind_envelopes_ciphertext_sha256", "e2ee_blind_envelopes", ["ciphertext_sha256"])
        op.create_index("ix_e2ee_blind_envelopes_client_uuid", "e2ee_blind_envelopes", ["client_uuid"])
        op.create_index("ix_e2ee_blind_envelopes_created_at", "e2ee_blind_envelopes", ["created_at"])
        op.create_index("ix_e2ee_envelope_mailbox_uuid", "e2ee_blind_envelopes", ["blind_mailbox_id", "client_uuid"])

    if "e2ee_mailbox_push" not in tables:
        op.create_table(
            "e2ee_mailbox_push",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("mailbox_id", sa.String(length=64), nullable=False),
            sa.Column("endpoint_hash", sa.String(length=64), nullable=False),
            sa.Column("endpoint", sa.Text(), nullable=False),
            sa.Column("p256dh", sa.String(length=255), nullable=False),
            sa.Column("auth", sa.String(length=64), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("mailbox_id", "endpoint_hash", name="uq_mailbox_push_ziel"),
        )
        op.create_index("ix_e2ee_mailbox_push_mailbox", "e2ee_mailbox_push", ["mailbox_id"])
        op.create_index("ix_e2ee_mailbox_push_endpoint", "e2ee_mailbox_push", ["endpoint_hash"])

    if "e2ee_device_queue" not in tables:
        op.create_table(
            "e2ee_device_queue",
            sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
            sa.Column("target_device_id", sa.Integer(), nullable=False),
            sa.Column("sender_user_id", sa.Integer(), nullable=False),
            sa.Column("sender_device_id", sa.Integer(), nullable=True),
            sa.Column("chat_type", sa.String(length=16), nullable=False),
            sa.Column("chat_id", sa.String(length=64), nullable=False),
            sa.Column("client_uuid", sa.String(length=64), nullable=False),
            sa.Column("encrypted_payload", sa.Text(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["sender_user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["target_device_id"], ["user_e2ee_devices.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_e2ee_queue_target_device", "e2ee_device_queue", ["target_device_id"])
        op.create_index("ix_e2ee_queue_client_uuid", "e2ee_device_queue", ["client_uuid"])
        op.create_index("ix_e2ee_queue_chat", "e2ee_device_queue", ["chat_id"])

    if "e2ee_device_inboxes" not in tables:
        op.create_table(
            "e2ee_device_inboxes",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("device_id", sa.Integer(), nullable=False),
            sa.Column("inbox_hash", sa.String(length=64), nullable=False),
            sa.Column("erstellt_am", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ablauf_am", sa.DateTime(timezone=True), nullable=False),
            sa.ForeignKeyConstraint(["device_id"], ["user_e2ee_devices.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("device_id", name="uq_e2ee_device_inbox_device"),
            sa.UniqueConstraint("inbox_hash", name="uq_e2ee_device_inbox_hash"),
        )
        op.create_index("ix_e2ee_device_inbox_device", "e2ee_device_inboxes", ["device_id"])

    if "e2ee_delivery_payloads" not in tables:
        op.create_table(
            "e2ee_delivery_payloads",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("ciphertext", sa.Text(), nullable=False),
            sa.Column("ciphertext_sha256", sa.String(length=64), nullable=False),
            sa.Column("groesse", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("angenommen_am", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ablauf_am", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_e2ee_delivery_payload_ablauf", "e2ee_delivery_payloads", ["ablauf_am"])
        op.create_index(
            "ix_e2ee_delivery_payloads_ciphertext_sha256",
            "e2ee_delivery_payloads",
            ["ciphertext_sha256"],
        )

    bind.execute(sa.text("CREATE SEQUENCE IF NOT EXISTS e2ee_delivery_seq"))
    if "e2ee_deliveries" not in tables:
        op.create_table(
            "e2ee_deliveries",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("payload_id", sa.String(length=36), nullable=False),
            sa.Column("inbox_hash", sa.String(length=64), nullable=False),
            sa.Column(
                "laufende_seq",
                sa.BigInteger(),
                nullable=False,
                server_default=sa.text("nextval('e2ee_delivery_seq')"),
            ),
            sa.Column("angenommen_am", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ablauf_am", sa.DateTime(timezone=True), nullable=False),
            sa.Column("quittiert_am", sa.DateTime(timezone=True), nullable=True),
            sa.ForeignKeyConstraint(
                ["payload_id"], ["e2ee_delivery_payloads.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(
                ["inbox_hash"], ["e2ee_device_inboxes.inbox_hash"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("inbox_hash", "id", name="uq_e2ee_delivery_inbox_id"),
            sa.UniqueConstraint("laufende_seq", name="uq_e2ee_delivery_seq"),
        )
        op.create_index(
            "ix_e2ee_delivery_inbox_seq", "e2ee_deliveries", ["inbox_hash", "laufende_seq"]
        )
        op.create_index("ix_e2ee_delivery_ablauf", "e2ee_deliveries", ["ablauf_am"])

    if "e2ee_delivery_receipts" not in tables:
        op.create_table(
            "e2ee_delivery_receipts",
            sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
            sa.Column("inbox_hash", sa.String(length=64), nullable=False),
            sa.Column("delivery_id", sa.String(length=36), nullable=False),
            sa.Column("request_hash", sa.String(length=64), nullable=False),
            sa.Column("ergebnis", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("angenommen_am", sa.DateTime(timezone=True), nullable=False),
            sa.Column("ablauf_am", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("inbox_hash", "delivery_id", name="uq_e2ee_delivery_receipt"),
        )
        op.create_index(
            "ix_e2ee_delivery_receipt_ablauf", "e2ee_delivery_receipts", ["ablauf_am"]
        )
