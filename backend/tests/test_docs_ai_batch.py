"""Dokument-KI: Batch-Werkzeug, atomarer Store und Konfliktantworten."""

from __future__ import annotations

import base64
import hashlib

import pytest
from fastapi import HTTPException

from models.doc import DocRevision, Document
from models.team import Team, TeamMember
from services import ai_autonomy_service
from services.ai_action_errors import AiActionValidationError
from services.ai_tools import document_tools
from services.ai_tools.document_tools import ToolKontext, _edits
from services.auth_service import AuthService
from services.docs_collab_service import DocsCollabService
from services.docs_crypto import decrypt_state
from services.docs_service import DocsService, fehler


def _benutzer(db, name: str):
    user = AuthService.create_user(db, name, f"{name}@test.de", "Pass123!Pass")
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user


def _team(db, owner, name: str):
    team = Team(name=name, owner_user_id=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner.id, role="owner", added_by=owner.id))
    db.commit()
    db.refresh(team)
    return team


def _b64(roh: bytes) -> str:
    return base64.b64encode(roh).decode("ascii")


def _hash(roh: bytes) -> str:
    return hashlib.sha256(roh).hexdigest()


def _ai_payload(pre: bytes, post: bytes, user_id: int, **extra):
    return {
        "pre_state_b64": _b64(pre),
        "pre_state_sha256": _hash(pre),
        "state_b64": _b64(post),
        "state_sha256": _hash(post),
        "pre_content_text": "Alt",
        "content_text": "Neu",
        "content_truncated": False,
        "origin": "ai:7:run-1:call-1",
        "author_user_id": user_id,
        "author_family": None,
        "ai_run_id": "run-1",
        "summary": "Drei Aenderungen",
        "edits_applied": 3,
        "schema_version": 1,
        **extra,
    }


def test_edit_document_schema_nutzt_batch_und_struktur():
    definitionen = {
        eintrag["function"]["name"]: eintrag["function"]["parameters"]
        for eintrag in document_tools._dokument_tool_definitions()
    }

    edit = definitionen["edit_document"]
    assert "edits" in edit["properties"]
    assert edit["properties"]["edits"]["maxItems"] == 20
    assert edit["required"] == ["edits", "summary"]
    assert "operation" not in edit["properties"]

    struktur = definitionen["read_document_structure"]
    assert {"offset", "limit"} <= set(struktur["properties"])


def test_altaufruf_wird_zu_einer_aenderung():
    assert _edits({"operation": "append", "markdown": "Neu"}) == [
        {"op": "append", "markdown": "Neu", "target": {}}
    ]
    with pytest.raises(AiActionValidationError):
        _edits({"operation": "append", "markdown": ""})
    with pytest.raises(AiActionValidationError):
        _edits({"edits": []})
    with pytest.raises(AiActionValidationError):
        _edits({"edits": [{"op": "replace_block", "markdown": "x"}]})
    # Ein Zitat ohne Fingerabdruck reicht im Batch nicht mehr.
    with pytest.raises(AiActionValidationError):
        _edits(
            {
                "edits": [
                    {
                        "op": "replace_block",
                        "target": {"quote": "alte"},
                        "markdown": "x",
                    }
                ]
            }
        )


def test_mehr_als_zwanzig_aenderungen_werden_abgelehnt():
    edits = [
        {"op": "append", "markdown": "x", "target": {}}
        for _ in range(21)
    ]
    with pytest.raises(AiActionValidationError):
        _edits({"edits": edits})


def test_sidecar_konflikt_wird_als_ergebnis_zurueckgegeben(db, monkeypatch):
    owner = _benutzer(db, "batch_a")
    team = _team(db, owner, "Batch-Team")
    daten = DocsService.create_document(db, owner, team_id=team.id)
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()

    monkeypatch.setattr(
        document_tools.permission_service,
        "has_global_permission",
        lambda db_, user_, key: True,
    )
    monkeypatch.setattr(
        "services.docs_collab_service.DocsCollabService.module_enabled",
        classmethod(lambda cls: True),
    )
    monkeypatch.setattr(
        ai_autonomy_service, "autonomie_grundlage", lambda *args, **kwargs: object()
    )

    def _konflikt(*_args, **_kwargs):
        raise fehler(
            409,
            "AI_EDIT_TARGET_NOT_FOUND",
            "Der Zielblock wurde nicht gefunden",
            candidates=[{"index": 2, "fingerprint": "abc"}],
            edit_index=1,
        )

    monkeypatch.setattr(DocsCollabService, "ai_edit", staticmethod(_konflikt))

    ergebnis = document_tools.execute_document_tool(
        db,
        user=owner,
        tool_name="edit_document",
        arguments={
            "edits": [
                {
                    "op": "replace_block",
                    "target": {"fingerprint": "0123456789ab", "index": 0},
                    "markdown": "Neu",
                }
            ],
            "summary": "Neu",
        },
        kontext=ToolKontext(
            run_id="run-1",
            conversation_id="egal",
            document_uid=doc.doc_uid,
            team_id=team.id,
        ),
    )

    assert ergebnis["ok"] is False
    assert ergebnis["code"] == "AI_EDIT_TARGET_NOT_FOUND"
    assert ergebnis["edit_index"] == 1
    assert ergebnis["candidates"] == [{"index": 2, "fingerprint": "abc"}]


def test_fehler_vom_sidecar_traegt_kandidaten(db, monkeypatch):
    owner = _benutzer(db, "batch_b")
    daten = DocsService.create_document(db, owner)

    class Antwort:
        status_code = 409

        @staticmethod
        def json():
            return {
                "code": "AI_EDIT_TARGET_NOT_FOUND",
                "error": "Der Zielblock wurde nicht gefunden",
                "candidates": [{"index": 1}],
                "edit_index": 0,
            }

    monkeypatch.setattr(
        "services.docs_collab_service.httpx.post", lambda *args, **kwargs: Antwort()
    )

    with pytest.raises(HTTPException) as fehler_info:
        DocsCollabService.ai_edit(
            db,
            owner,
            daten["uid"],
            edits=[{"op": "append", "markdown": "x", "target": {}}],
        )
    detail = fehler_info.value.detail
    assert fehler_info.value.status_code == 409
    assert detail["candidates"] == [{"index": 1}]
    assert detail["edit_index"] == 0


def test_ai_store_schreibt_vorher_und_nachher_in_einem_commit(db, monkeypatch):
    owner = _benutzer(db, "batch_c")
    daten = DocsService.create_document(db, owner)
    pre = b"zustand-alt"
    post = b"zustand-neu"

    commits: list[int] = []
    original = db.commit

    def zaehle():
        commits.append(1)
        return original()

    monkeypatch.setattr(db, "commit", zaehle)

    ergebnis = DocsCollabService.ai_store(
        db, daten["uid"], _ai_payload(pre, post, owner.id)
    )

    assert ergebnis["stored"] is True
    assert ergebnis["rev"] == 1
    assert ergebnis["pre_revision_rev"] == 0
    assert ergebnis["revision_rev"] == 1
    assert len(commits) == 1

    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    assert decrypt_state(doc.state_encrypted, daten["uid"]) == post
    revisionen = (
        db.query(DocRevision)
        .filter(DocRevision.document_id == doc.id)
        .order_by(DocRevision.rev.asc())
        .all()
    )
    assert [row.reason for row in revisionen] == ["ai_pre_edit", "ai_edit"]
    assert all(row.author_kind == "ai" for row in revisionen)


def test_ai_store_ist_bei_wiederholung_idempotent(db):
    owner = _benutzer(db, "batch_d")
    daten = DocsService.create_document(db, owner)
    nutzlast = _ai_payload(b"alt", b"neu", owner.id)

    DocsCollabService.ai_store(db, daten["uid"], nutzlast)
    zweite = DocsCollabService.ai_store(db, daten["uid"], nutzlast)

    assert zweite["stored"] is False
    assert zweite["already"] is True
    assert db.query(DocRevision).count() == 2


def test_ai_store_rollt_bei_fehler_zurueck(db, monkeypatch):
    owner = _benutzer(db, "batch_e")
    daten = DocsService.create_document(db, owner)

    def kaputt(*_args, **_kwargs):
        raise RuntimeError("Krypto kaputt")

    monkeypatch.setattr("services.docs_collab_service.encrypt_text", kaputt)

    with pytest.raises(HTTPException) as fehler_info:
        DocsCollabService.ai_store(
            db, daten["uid"], _ai_payload(b"alt", b"neu", owner.id)
        )
    assert fehler_info.value.status_code == 503

    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    assert doc.rev == 0
    assert doc.state_sha256 is None
    assert db.query(DocRevision).count() == 0


def test_ai_store_verlangt_ki_origin(db):
    owner = _benutzer(db, "batch_f")
    daten = DocsService.create_document(db, owner)

    with pytest.raises(HTTPException) as fehler_info:
        DocsCollabService.ai_store(
            db,
            daten["uid"],
            _ai_payload(b"alt", b"neu", owner.id, origin="user:1"),
        )
    assert fehler_info.value.status_code == 403
    assert db.query(DocRevision).count() == 0
