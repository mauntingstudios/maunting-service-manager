"""Der Dokument-Chat ist derselbe Chat wie der Dauerchat — nur mit eigenem Fenster."""

from __future__ import annotations

from uuid import uuid4

from models.ai_conversation import AiConversation
from models.ai_conversation import AiMessage
from services import ai_chat_service, ai_provider_service
from services.docs_service import DocsService
from services.openai_compatible_adapter import StreamChunk


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


def test_docs_stream_schreibt_nur_ins_dokumentfenster_und_ohne_worker(
    db, client, owner_cookies, csrf_token, owner_user, monkeypatch
):
    """Der eigentliche Sendepfad, nicht nur das Lesen der Unterhaltung."""
    from services import ai_stream_service

    provider = ai_provider_service.create_provider(
        db,
        name="Docs-Test",
        provider_kind="openrouter",
        default_model="test-model",
        enabled=True,
        requires_api_key=True,
        operator_api_key="sk-or-v1-operator-secret",
    )
    db.commit()
    db.refresh(provider)
    doc = _dokument(db, owner_user)
    gesehen = []

    async def fake_stream(
        _client, *, provider, api_key, messages, usage, tools=None, tool_choice=None,
        reasoning=False, reasoning_effort=None, cache_marke=False, model=None,
    ):
        gesehen.append(tools or [])
        usage.total_tokens = 1
        yield StreamChunk("content", "Gelesen.")

    monkeypatch.setattr(ai_stream_service, "stream_chat_completion", fake_stream)
    request_id = str(uuid4())

    antwort = client.post(
        "/api/ai/conversation/messages/stream",
        json={
            "content": "Fasse das Dokument zusammen.",
            "provider_id": provider.id,
            "request_id": request_id,
            "document_uid": doc["uid"],
        },
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )

    assert antwort.status_code == 200
    assert "Gelesen." in antwort.text
    db.expire_all()
    nachricht = db.query(AiMessage).filter(AiMessage.request_id == request_id).one()
    gespraech = db.get(AiConversation, nachricht.conversation_id)
    assert gespraech.kind == "docs"
    assert gespraech.document_id is not None
    primary = ai_chat_service.get_or_create_primary_conversation(db, owner_user)
    assert (
        db.query(AiMessage)
        .filter(
            AiMessage.conversation_id == primary.id,
            AiMessage.request_id == request_id,
        )
        .count()
        == 0
    )
    namen = {
        eintrag["function"]["name"]
        for eintrag in gesehen[0]
        if isinstance(eintrag, dict) and "function" in eintrag
    }
    assert "worker_start" not in namen
    assert "list_documents" not in namen
    for verboten in (
        "propose_server_create",
        "propose_server_delete",
        "propose_server_lifecycle",
        "propose_mod_install",
        "propose_config_update",
    ):
        assert verboten not in namen


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
