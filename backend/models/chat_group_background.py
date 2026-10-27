from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class ChatGroupBackground(Base):
    """Der geteilte Hintergrund einer Gruppe — verschlüsselt.

    Der Block enthält die Wahl (Vorlage oder eigenes Bild) und gegebenenfalls
    das Bild selbst. Er wird mit dem Gruppenschlüssel verschlüsselt; der Server
    sieht nur Chiffrat, Größe und Revision. Die Zeile ist bewusst von
    ``chat_group_infos`` getrennt, weil der Hintergrund eine eigene Berechtigung
    (``set_group_background``) hat und deutlich größer werden darf als die
    Allgemeinangaben.
    """

    __tablename__ = "chat_group_backgrounds"

    group_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("chat_groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    blob: Mapped[str] = mapped_column(Text, nullable=False)
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, default=1)
    # Nur für die Grenzprüfung und Diagnose; der Inhalt bleibt undurchsichtig.
    mime: Mapped[str | None] = mapped_column(String(100), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )
