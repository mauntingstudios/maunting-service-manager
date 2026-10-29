"""Der eine E2EE-Transport: Nachrichten, Chat-Schluessel und Lesestaende.

Die alten Wege (blinde Mailbox, Geraete-Queue, Delivery-Inbox) sind ersetzt.
Eine Nachricht liegt genau einmal in ``e2ee_messages``; sie ist mit dem
symmetrischen ``chat_key`` ihres Gespraechs verschluesselt. Der Schluessel
liegt je Empfaenger in ``e2ee_chat_keys``, verpackt gegen dessen
Konto-Identitaetsschluessel. Der Server sieht nur Chiffrat.

Die Tabellen tragen bewusst keinen Klartext. ``sender_user_id`` und
``chat_id`` sind Zustellmetadaten; der Inhalt bleibt verschlossen.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class E2eeAccount(Base):
    """Die Konto-Identitaet: ein RSA- und ein ECDSA-Schluessel je Mensch.

    Nicht je Geraet. Jedes freigegebene Geraet desselben Kontos haelt denselben
    privaten Schluessel und kann damit jeden Chat-Schluessel oeffnen, auch fuer
    Nachrichten von vor Jahren.
    """

    __tablename__ = "e2ee_accounts"

    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        primary_key=True,
    )
    public_key_jwk: Mapped[str] = mapped_column(Text, nullable=False)
    signing_public_key_jwk: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )


class E2eeAccountKeyVault(Base):
    """Der private Konto-Schluessel, fuer genau ein Geraet verpackt.

    Der Schluesselbund selbst verlaesst das Geraet nie im Klartext. Beim
    Freigeben eines neuen Geraets verpackt ein freigegebenes Geraet den Bund
    gegen den oeffentlichen Geraeteschluessel des neuen Geraets. Der Server
    reicht nur Chiffrat weiter.
    """

    __tablename__ = "e2ee_account_key_vault"
    __table_args__ = (
        UniqueConstraint("user_id", "device_id", name="uq_e2ee_account_key_device"),
        Index("ix_e2ee_account_key_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    device_id: Mapped[str] = mapped_column(String(64), nullable=False)
    encrypted_bundle: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )


class DirectChatMember(Base):
    """Wer zu einem Direktgespraech gehoert.

    Die Zeile traegt nur die Zuordnung, keinen Namen. Sie ist die Schranke fuer
    Lesen, Senden und Chat-Schluessel: wer hier nicht steht, bekommt nichts.
    """

    __tablename__ = "direct_chat_members"
    __table_args__ = (
        UniqueConstraint("chat_id", "user_id", name="uq_direct_chat_member"),
        Index("ix_direct_chat_member_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chat_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("direct_chats.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )


class E2eeChatKey(Base):
    """Ein symmetrischer 256-Bit-Chat-Schluessel, je Empfaenger verpackt."""

    __tablename__ = "e2ee_chat_keys"
    __table_args__ = (
        UniqueConstraint(
            "chat_type", "chat_id", "user_id", "key_version",
            name="uq_e2ee_chat_key",
        ),
        Index("ix_e2ee_chat_key_chat", "chat_type", "chat_id", "key_version"),
        Index("ix_e2ee_chat_key_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    chat_type: Mapped[str] = mapped_column(String(16), nullable=False)
    chat_id: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    key_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    encrypted_chat_key: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )


class E2eeMessage(Base):
    """Eine Nachricht, genau einmal, fuer alle Geraete und Jahre."""

    __tablename__ = "e2ee_messages"
    __table_args__ = (
        UniqueConstraint("client_uuid", name="uq_e2ee_message_client_uuid"),
        Index("ix_e2ee_messages_chat_cursor", "chat_type", "chat_id", "id"),
        Index("ix_e2ee_messages_expires", "expires_at"),
        Index("ix_e2ee_messages_sender", "sender_user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    client_uuid: Mapped[str] = mapped_column(String(64), nullable=False)
    chat_type: Mapped[str] = mapped_column(String(16), nullable=False)
    chat_id: Mapped[int] = mapped_column(Integer, nullable=False)
    sender_user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    key_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    encrypted_payload: Mapped[str] = mapped_column(Text, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    is_pinned: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=false(), nullable=False
    )
    pinned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pinned_by_user_id: Mapped[int | None] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )

    reactions: Mapped[list["E2eeMessageReaction"]] = relationship(
        "E2eeMessageReaction",
        back_populates="message",
        cascade="all, delete-orphan",
    )


class E2eeMessageReaction(Base):
    """Eine Reaktion, mit dem Chat-Schluessel verschluesselt."""

    __tablename__ = "e2ee_message_reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_e2ee_message_reaction"),
        Index("ix_e2ee_message_reaction_message", "message_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    message_id: Mapped[int] = mapped_column(
        BigInteger,
        ForeignKey("e2ee_messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    encrypted_reaction: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )

    message: Mapped[E2eeMessage] = relationship("E2eeMessage", back_populates="reactions")


class E2eeChatState(Base):
    """Die Wasserstaende eines Kontos in einem Gespraech."""

    __tablename__ = "e2ee_chat_states"
    __table_args__ = (
        UniqueConstraint("chat_type", "chat_id", "user_id", name="uq_e2ee_chat_state"),
        Index("ix_e2ee_chat_state_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    chat_type: Mapped[str] = mapped_column(String(16), nullable=False)
    chat_id: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    last_delivered_message_id: Mapped[int] = mapped_column(
        BigInteger, default=0, nullable=False
    )
    last_read_message_id: Mapped[int] = mapped_column(
        BigInteger, default=0, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )
