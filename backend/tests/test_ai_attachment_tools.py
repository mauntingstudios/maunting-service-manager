"""Tests für KI-Werkzeuge: search_chat_attachments und read_chat_attachment."""

from datetime import datetime, timezone, timedelta
from uuid import uuid4
import pytest
from sqlalchemy.orm import Session

from models import AiAttachment, AiConversation, Role, RolePermission, User
from services.ai_action_errors import AiActionValidationError
from services.ai_action_service import _execute_global_read_tool
from services.dis_client import DisClient
from services.role_service import set_user_roles


def _enable_attachments(db: Session, user: User) -> None:
    role = Role(name=f"attachment-role-{uuid4().hex[:8]}")
    db.add(role)
    db.flush()
    db.add_all([
        RolePermission(role_id=role.id, permission_key="ai.chat.use"),
        RolePermission(role_id=role.id, permission_key="ai.attachments.use"),
    ])
    db.commit()
    set_user_roles(db, user, [role.id])


def _create_attachment(
    db: Session,
    user: User,
    conversation_id: str,
    *,
    name: str = "einkaufsliste.md",
    text: str = "- [ ] Brot\n- [ ] Milch",
    media_type: str = "text/markdown",
    created_at: datetime | None = None,
) -> AiAttachment:
    from services.ai_attachment_service import _aad
    aid = str(uuid4())
    row = AiAttachment(
        id=aid,
        conversation_id=conversation_id,
        user_id=user.id,
        original_name=name,
        media_type=media_type,
        size_bytes=len(text.encode("utf-8")),
        sha256="fake-sha256",
        content_encrypted=DisClient.encrypt(text, aad=_aad(aid, "content")),
        extracted_text_encrypted=DisClient.encrypt(text, aad=_aad(aid, "text")),
        status="ready",
        created_at=created_at or datetime.now(timezone.utc),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def test_search_and_read_chat_attachments(db: Session, regular_user: User) -> None:
    _enable_attachments(db, regular_user)
    conv = AiConversation(id=str(uuid4()), user_id=regular_user.id, title="Test Chat")
    db.add(conv)
    db.commit()

    # 1. Attachment vor 2 Tagen um 13:45 Uhr
    jetzt = datetime.now(timezone.utc)
    vor_zwei_tagen = jetzt - timedelta(days=2)
    ziel_zeit = vor_zwei_tagen.replace(hour=13, minute=45, second=0, microsecond=0)

    altes_anhang = _create_attachment(
        db, regular_user, conv.id,
        name="alte_einkaufsliste.txt",
        text="Alte Einkaufsliste: Butter, Eier, Mehl",
        created_at=ziel_zeit,
    )

    neues_anhang = _create_attachment(
        db, regular_user, conv.id,
        name="neue_notizen.md",
        text="Projektplanung Q4",
        created_at=jetzt,
    )

    # 2. Suche nach Name
    res_name = _execute_global_read_tool(
        db, user=regular_user, tool_name="search_chat_attachments",
        arguments={"query": "einkaufsliste"},
    )
    assert res_name["count"] == 1
    assert res_name["attachments"][0]["attachment_id"] == altes_anhang.id
    assert res_name["attachments"][0]["filename"] == "alte_einkaufsliste.txt"

    # 3. Suche mit unscharfer Zeitangabe: ~14:00 Uhr vor 2 Tagen (Toleranz 2h findet 13:45 Uhr)
    gesuchte_zeit = vor_zwei_tagen.replace(hour=14, minute=0, second=0, microsecond=0).isoformat()
    res_zeit = _execute_global_read_tool(
        db, user=regular_user, tool_name="search_chat_attachments",
        arguments={"referenz_zeit": gesuchte_zeit, "toleranz_stunden": 2.0},
    )
    assert res_zeit["count"] == 1
    assert res_zeit["attachments"][0]["attachment_id"] == altes_anhang.id

    # 4. Suche mit engem Zeitfenster findet es NICHT (z. B. 0.1 Stunden Toleranz um 15:00 Uhr)
    falsche_zeit = vor_zwei_tagen.replace(hour=15, minute=0, second=0, microsecond=0).isoformat()
    res_kein_treffer = _execute_global_read_tool(
        db, user=regular_user, tool_name="search_chat_attachments",
        arguments={"referenz_zeit": falsche_zeit, "toleranz_stunden": 0.1},
    )
    assert res_kein_treffer["count"] == 0

    # 5. Inhalt mit read_chat_attachment lesen
    read_res = _execute_global_read_tool(
        db, user=regular_user, tool_name="read_chat_attachment",
        arguments={"attachment_id": altes_anhang.id},
    )
    assert read_res["attachment_id"] == altes_anhang.id
    assert read_res["filename"] == "alte_einkaufsliste.txt"
    assert "Alte Einkaufsliste: Butter, Eier, Mehl" in read_res["content_text"]

    # 6. Fremder Anhang darf nicht gelesen werden
    anderer_user = User(
        id=9999,
        username="hacker",
        email="hacker@example.com",
        password_hash="hash",
        is_active=True,
    )
    db.add(anderer_user)
    db.commit()
    _enable_attachments(db, anderer_user)

    with pytest.raises(AiActionValidationError, match="Keine Berechtigung"):
        _execute_global_read_tool(
            db, user=anderer_user, tool_name="read_chat_attachment",
            arguments={"attachment_id": altes_anhang.id},
        )
