from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


def _now() -> datetime:
    return datetime.now(timezone.utc)


class UserPresence(Base):
    """Was der Mensch selbst gewählt hat: sein Status.

    Die Anwesenheit selbst steht nicht hier, sondern in den Sitzungen
    (`user_presence_sessions`): je Gerät eine Zeile mit Lebenszeichen. Diese
    Zeile trägt nur die Wahl, die über allen Geräten gilt.

    ``manual_status``:
    - ``auto``: Vorhandensein und Abwesenheit ergeben sich aus den Sitzungen
      (Vorgabe; nach fünf Minuten ohne Eingabe „abwesend“).
    - ``online``: bleibt online, solange ein Gerät verbunden ist.
    - ``away``: bleibt abwesend.
    - ``invisible``: für andere immer offline, unabhängig von den Sitzungen.
    """

    __tablename__ = "user_presences"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    manual_status: Mapped[str] = mapped_column(
        String(16), default="auto", server_default="auto", nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )

    user: Mapped["User"] = relationship("User")


class UserPresenceSession(Base):
    """Ein Gerät, das gerade offen ist.

    Eine Zeile je Gerät und Konto, nicht je Tab: mehrere Tabs desselben
    Browsers teilen sich die Kennung und schreiben dieselbe Zeile. Ohne diese
    Trennung überschrieb die letzte Meldung die vorige, und ein versteckter Tab
    nahm einem sichtbaren das „online“ weg (bis 27.10.2026 gab es nur eine
    Zeile je Konto).

    ``client`` sagt, welche Oberfläche es ist (Web-Panel, Pontis, MSS), ``plattform``
    worauf sie läuft. ``vorn`` markiert die Sitzung im Vordergrund; sie liefert
    Plattform und Aktivität für die Anzeige.
    """

    __tablename__ = "user_presence_sessions"
    __table_args__ = (
        UniqueConstraint("user_id", "geraet", name="uq_user_presence_session_geraet"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    # Zufallskennung des Geräts, in dessen Ablage gespeichert.
    geraet: Mapped[str] = mapped_column(String(64), nullable=False)
    # web | pontis | mss
    client: Mapped[str] = mapped_column(String(16), default="web", nullable=False)
    # web | desktop | mobile
    plattform: Mapped[str] = mapped_column(String(16), default="web", nullable=False)
    # online | away — was dieses Gerät gerade ist.
    zustand: Mapped[str] = mapped_column(String(16), default="online", nullable=False)
    # Schlüssel aus der Aktivitätenliste der Oberfläche, nie freier Text.
    activity_key: Mapped[str | None] = mapped_column(String(48), nullable=True)
    vorn: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_seen_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, nullable=False
    )

    user: Mapped["User"] = relationship("User")
