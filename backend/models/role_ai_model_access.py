"""Freigaben fuer AI-Provider und Provider-Modelle je Rolle."""

from sqlalchemy import Boolean, ForeignKey, Integer, Text, UniqueConstraint
import sqlalchemy as sa
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class RoleAiModelAccess(Base):
    """Bestimmt, welche AI-Provider und Modelle eine Rolle nutzen darf.

    Greift nur, wenn `RoleAiLimit.allow_all_models` auf False steht.
    """

    __tablename__ = "role_ai_model_access"
    __table_args__ = (
        UniqueConstraint("role_id", "provider_id", name="uq_role_ai_model_access_role_provider"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    role_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("roles.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    provider_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("ai_providers.id", ondelete="CASCADE"),
        index=True,
        nullable=False,
    )
    # Wenn True, sind alle fuer diesen Provider global freigegebenen Modelle erlaubt.
    allow_all: Mapped[bool] = mapped_column(
        Boolean,
        default=True,
        server_default=sa.true(),
        nullable=False,
    )
    # JSON-Array der explizit erlaubten Modell-IDs (z. B. '["gpt-5", "claude-3-opus"]').
    allowed_models_json: Mapped[str | None] = mapped_column(
        Text,
        nullable=True,
        default=None,
    )
