"""Der Dokument-Chat ist derselbe Chat wie der Dauerchat — nur mit eigenem Fenster."""

from __future__ import annotations

from models.ai_conversation import AiConversation
from models.ai_conversation import AiMessage
from services import ai_chat_service
from services.docs_service import DocsService


def _dokument(db, owner_user):
    return DocsService.create_document(db, owner_user, title="Chat-Dokument")


def _nachricht(db, conversation):
    message = AiMessage(
        id=f"msg-{conversation.id[:8]}",
        conversation_id=conversation.id,
        role="user",
        content="Hallo",
        status="complete",
    )
    db.add(message)
    db.commit()
    return message


def test_docs_konversation_wird_ueber_die_dokument_uid_aufgeloest(
    db, client, owner_cookies, owner_user
):
    doc = _dokument(db, owner_user)

    antwort = client.get(
        "/api/ai/conversation",
        params={"kind": "docs", "document_uid": doc["uid"]},
        cookies=owner_cookies,
    )

    assert antwort.status_code == 200
    assert antwort.json()["kind"] == "docs"


def test_clear_loescht_nur_das_dokumentfenster(
    db, client, owner_cookies, csrf_token, owner_user
):
    doc = _dokument(db, owner_user)
    docs_conv, _, _ = __import__(
        "services.ai_docs_chat_scope", fromlist=["resolve"]
    ).resolve(db, owner_user, doc["uid"])
    primary = ai_chat_service.get_or_create_primary_conversation(db, owner_user)
    db.commit()
    _nachricht(db, docs_conv)
    _nachricht(db, primary)

    antwort = client.delete(
        "/api/ai/conversation/messages",
        params={"document_uid": doc["uid"]},
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
    )

    assert antwort.status_code == 204
    db.expire_all()
    assert (
        db.query(AiMessage).filter(AiMessage.conversation_id == docs_conv.id).count()
        == 0
    )
    assert (
        db.query(AiMessage).filter(AiMessage.conversation_id == primary.id).count()
        == 1
    )
    assert (
        db.query(AiConversation)
        .filter(AiConversation.id == docs_conv.id)
        .count()
        == 1
    )


def test_stop_und_actions_funktionieren_im_dokumentfenster(
    db, client, owner_cookies, csrf_token, owner_user
):
    doc = _dokument(db, owner_user)

    stop = client.post(
        "/api/ai/conversation/stop",
        params={"document_uid": doc["uid"]},
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert stop.status_code == 200
    assert stop.json()["ok"] is True

    actions = client.get(
        "/api/ai/conversation/actions",
        params={"document_uid": doc["uid"]},
        cookies=owner_cookies,
    )
    assert actions.status_code == 200
    assert actions.json() == []


def test_anhang_vor_der_ersten_nachricht_landet_im_dokumentfenster(
    db, client, owner_cookies, csrf_token, owner_user
):
    doc = _dokument(db, owner_user)
    docs_conv, _, _ = __import__(
        "services.ai_docs_chat_scope", fromlist=["resolve"]
    ).resolve(db, owner_user, doc["uid"])

    antwort = client.post(
        "/api/ai/conversation/attachments",
        params={"document_uid": doc["uid"]},
        files={"file": ("notiz.txt", b"Hallo Dokument", "text/plain")},
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
    )

    assert antwort.status_code == 201
    assert antwort.json()["conversation_id"] == docs_conv.id


def test_ohne_ai_docs_use_bleibt_das_fenster_verschlossen(
    db, client, user_cookies, owner_user
):
    doc = _dokument(db, owner_user)

    antwort = client.get(
        "/api/ai/conversation",
        params={"kind": "docs", "document_uid": doc["uid"]},
        cookies=user_cookies,
    )

    assert antwort.status_code == 403
