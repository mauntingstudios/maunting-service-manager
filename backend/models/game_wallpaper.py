from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class GameWallpaper(Base):
    """Custom-Hintergrundbild eines Spiels (game-scoped Galerie).

    Gehoert zum Spiel (``game_type``), nicht zu einer Server-Instanz: Alle
    Server desselben Spiels teilen sich das aktive Bild. Hoechstens ein
    Eintrag je Spiel ist aktiv (``is_active``); ein Reset hebt nur den
    Zeiger auf, die Datei bleibt bis zur Retention in der Galerie.
    """

    __tablename__ = "game_wallpapers"
    __table_args__ = (
        Index("ix_game_wallpapers_game_active", "game_type", "is_active"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    game_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    file_name: Mapped[str] = mapped_column(String(128), nullable=False)
    # Anzeigename des Uploaders ("system" fuer Galerie-Seeds).
    uploaded_by: Mapped[str] = mapped_column(String(128), nullable=False, default="system")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
