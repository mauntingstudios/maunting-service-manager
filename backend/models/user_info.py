from __future__ import annotations

from datetime import datetime, timezone
from sqlalchemy import DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base
from models.dis_text import DisText


def _now() -> datetime:
    return datetime.now(timezone.utc)


class UserInfo(Base):
    """Der freiwillige „Info“-Text eines Kontos, wie ihn WhatsApp kennt.

    Nicht zu verwechseln mit dem Anwesenheitsstatus (`user_presences`) oder mit
    den Stories. Sichtbarkeit und Ablauf entscheidet der Server; den Text selbst
    liest er nie im Klartext — in der Datenbank steht nur Chiffrat
    (`msm-dis-v1:`), wie bei allen Nutzerinhalten.

    ``visibility``:
    - ``friends``: bestätigte Freunde und das eigene Konto
    - ``public``: jeder, der das Profil sehen darf
    - ``nobody``: nur das eigene Konto

    ``expires_at`` ist NULL, wenn die Info „für immer“ gilt.
    """

    __tablename__ = "user_infos"

    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    text: Mapped[str] = mapped_column(
        DisText(aad="msm:social:user_infos.text"), nullable=False
    )
    visibility: Mapped[str] = mapped_column(
        String(16), default="friends", server_default="friends", nullable=False
    )
    expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_now, onupdate=_now, nullable=False
    )

    user: Mapped["User"] = relationship("User")
