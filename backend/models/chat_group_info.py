from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ChatGroupInfo(Base):
    """Name, Beschreibung und Logo einer Gruppe — verschlüsselt.

    Die allgemeinen Gruppenangaben lagen bis 10/2026 im gemeinsamen
    ``chat_group_configs``-Block zusammen mit den Rollen. Damit teilten sie
    sich auch die Berechtigung: wer Rollen verwalten durfte, konnte die
    Allgemeinangaben ändern, und umgekehrt. Hier stehen sie getrennt, damit
    ``edit_group`` nur diese Zeile öffnet und ``manage_roles`` nur die Rollen.

    Der Server speichert ausschließlich den ``sv-e2ee-group-...``-Umschlag
    unter dem Gruppenschlüssel. Er kennt weder Name noch Beschreibung noch
    Logo und kann die Zeile nicht öffnen.
    """

    __tablename__ = "chat_group_infos"

    group_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("chat_groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    blob: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )
