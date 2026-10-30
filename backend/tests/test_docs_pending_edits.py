"""KI-Vorschlaege im Dokument: Vorschau, Bestaetigung und Verwerfen."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from models.doc import DocPendingEdit, DocRevision, Document
from models.team import Team, TeamMember
from services import ai_chat_service
from services.auth_service import AuthService
from services.docs_collab_service import DocsCollabService
from services.docs_pending_edit_service import DocsPendingEditService
from services.docs_service import DocsService
from services.ai_tools import document_tools
from services.ai_tools.document_tools import ToolKontext


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


def _dokument_mit_gespraech(db, user, team):
    daten = DocsService.create_document(db, user, team_id=team.id, title="Vorschlag")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    gespraech = ai_chat_service.get_or_create_docs_conversation(db, user, doc.id)
    db.commit()
    return doc, gespraech


def _vorschau(*_args, **_kwargs):
    return {
        "ok": True,
        "html": "<p>Neuer Text</p>",
        "target_block": "Alter Block",
        "target_index": 0,
    }


def test_vorschlag_legt_keine_revision_an_und_ist_nur_fuer_den_besitzer(db, monkeypatch):
    owner = _benutzer(db, "pend_a")
    fremd = _benutzer(db, "pend_b")
    team = _team(db, owner, "Vorschlags-Team")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_vorschau))

    ergebnis = DocsPendingEditService.create(
        db,
        owner,
        doc.doc_uid,
        conversation_id=gespraech.id,
        operation="replace_block",
        markdown="Neuer Text",
        anchor={"quote": "Alter Block"},
        summary="Kurz",
        run_id="run-1",
        call_id="call-1",
    )

    assert ergebnis["pending"] is True
    assert db.query(DocPendingEdit).count() == 1
    assert db.query(DocRevision).count() == 0
    assert DocsPendingEditService.list_for_user(db, owner, doc.doc_uid)["pending_edits"]
    with pytest.raises(HTTPException) as fehler:
        DocsPendingEditService.list_for_user(db, fremd, doc.doc_uid)
    assert fehler.value.status_code == 404


def test_zweiter_vorschlag_verweist_auf_den_offenen(db, monkeypatch):
    owner = _benutzer(db, "pend_c")
    team = _team(db, owner, "Ein-Vorschlag")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_vorschau))

    erste = DocsPendingEditService.create(
        db, owner, doc.doc_uid, conversation_id=gespraech.id,
        operation="append", markdown="Eins", anchor=None, summary=None,
        run_id=None, call_id=None,
    )
    zweite = DocsPendingEditService.create(
        db, owner, doc.doc_uid, conversation_id=gespraech.id,
        operation="append", markdown="Zwei", anchor=None, summary=None,
        run_id=None, call_id=None,
    )

    assert zweite["pending_uid"] == erste["pending_uid"]
    assert "offenen Vorschlag" in zweite["hinweis"]
    assert db.query(DocPendingEdit).count() == 1


def test_uebernehmen_wendet_an_und_markiert_erledigt(db, monkeypatch):
    owner = _benutzer(db, "pend_d")
    team = _team(db, owner, "Uebernehmen")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_vorschau))

    ergebnis = DocsPendingEditService.create(
        db, owner, doc.doc_uid, conversation_id=gespraech.id,
        operation="append", markdown="Neu", anchor=None, summary=None,
        run_id=None, call_id=None,
    )

    def _anwenden(db_, user_, doc_uid_, **kwargs):
        zeile = db_.query(Document).filter(Document.doc_uid == doc_uid_).one()
        zeile.rev = 2
        zeile.state_sha256 = "abc"
        db_.commit()
        return {"ok": True, "rev": 2}

    monkeypatch.setattr(DocsCollabService, "ai_edit", staticmethod(_anwenden))
    antwort = DocsPendingEditService.apply(
        db, owner, doc.doc_uid, ergebnis["pending_uid"]
    )

    assert antwort["rev"] == 2
    row = db.query(DocPendingEdit).one()
    assert row.status == "applied"
    assert row.applied_rev == 2


def test_verwerfen_laesst_das_dokument_unberuehrt(db, monkeypatch):
    owner = _benutzer(db, "pend_e")
    team = _team(db, owner, "Verwerfen")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_vorschau))
    ergebnis = DocsPendingEditService.create(
        db, owner, doc.doc_uid, conversation_id=gespraech.id,
        operation="append", markdown="Neu", anchor=None, summary=None,
        run_id=None, call_id=None,
    )

    DocsPendingEditService.reject(db, owner, doc.doc_uid, ergebnis["pending_uid"])

    row = db.query(DocPendingEdit).one()
    assert row.status == "rejected"
    assert db.query(DocRevision).count() == 0


def test_fremder_nutzer_kann_nicht_uebernehmen(db, monkeypatch):
    owner = _benutzer(db, "pend_f")
    fremd = _benutzer(db, "pend_g")
    team = _team(db, owner, "Fremd")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_vorschau))
    ergebnis = DocsPendingEditService.create(
        db, owner, doc.doc_uid, conversation_id=gespraech.id,
        operation="append", markdown="Neu", anchor=None, summary=None,
        run_id=None, call_id=None,
    )

    with pytest.raises(HTTPException) as fehler:
        DocsPendingEditService.apply(db, fremd, doc.doc_uid, ergebnis["pending_uid"])
    assert fehler.value.status_code in (403, 404)


def test_verlauf_loeschen_entfernt_offene_vorschlaege(db, monkeypatch):
    owner = _benutzer(db, "pend_j")
    team = _team(db, owner, "Verlauf")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_vorschau))
    DocsPendingEditService.create(
        db, owner, doc.doc_uid, conversation_id=gespraech.id,
        operation="append", markdown="Neu", anchor=None, summary=None,
        run_id=None, call_id=None,
    )

    ai_chat_service.clear_history(db, gespraech)
    db.commit()

    assert db.query(DocPendingEdit).count() == 0


def test_edit_document_ohne_autonomie_legt_vorschau_an(db, monkeypatch):
    from services import ai_autonomy_service

    owner = _benutzer(db, "pend_h")
    team = _team(db, owner, "Autonomie aus")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(
        document_tools.permission_service, "has_global_permission",
        lambda db_, user_, key: True,
    )
    monkeypatch.setattr(
        "services.docs_collab_service.DocsCollabService.module_enabled",
        classmethod(lambda cls: True),
    )
    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_vorschau))
    monkeypatch.setattr(
        ai_autonomy_service, "autonomie_grundlage",
        lambda *args, **kwargs: None,
    )

    ergebnis = document_tools.execute_document_tool(
        db,
        user=owner,
        tool_name="edit_document",
        arguments={
            "operation": "append",
            "markdown": "Neuer Absatz",
            "summary": "Ergänzt",
        },
        kontext=ToolKontext(
            run_id="run-1",
            conversation_id=gespraech.id,
            document_uid=doc.doc_uid,
            team_id=team.id,
        ),
    )

    assert ergebnis["pending"] is True
    assert db.query(DocPendingEdit).count() == 1


def test_edit_document_mit_autonomie_wendet_direkt_an(db, monkeypatch):
    from services import ai_autonomy_service

    owner = _benutzer(db, "pend_i")
    team = _team(db, owner, "Autonomie an")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(
        document_tools.permission_service, "has_global_permission",
        lambda db_, user_, key: True,
    )
    monkeypatch.setattr(
        "services.docs_collab_service.DocsCollabService.module_enabled",
        classmethod(lambda cls: True),
    )
    monkeypatch.setattr(
        ai_autonomy_service, "autonomie_grundlage",
        lambda *args, **kwargs: object(),
    )
    monkeypatch.setattr(
        DocsCollabService, "ai_edit",
        staticmethod(lambda *args, **kwargs: {"ok": True, "rev": 3}),
    )

    ergebnis = document_tools.execute_document_tool(
        db,
        user=owner,
        tool_name="edit_document",
        arguments={
            "operation": "append",
            "markdown": "Direkt",
            "summary": "Direkt",
        },
        kontext=ToolKontext(
            run_id="run-2",
            conversation_id=gespraech.id,
            document_uid=doc.doc_uid,
            team_id=team.id,
        ),
    )

    assert ergebnis.get("pending") is None
    assert ergebnis["ok"] is True
    assert db.query(DocPendingEdit).count() == 0


def _batch_vorschau(*_args, **_kwargs):
    return {
        "ok": True,
        "html": "<p>Neu</p>",
        "edits": [
            {
                "index": 0,
                "op": "replace_block",
                "html": "<p>Neu</p>",
                "target_index": 0,
                "target_fingerprint": "0123456789ab",
            }
        ],
    }


_BATCH_EDITS = [
    {
        "op": "replace_block",
        "target": {"fingerprint": "0123456789ab", "index": 0},
        "markdown": "Neu",
    }
]


def test_batch_vorschlag_speichert_edits_und_rendert_vorschau(db, monkeypatch):
    owner = _benutzer(db, "pend_j")
    team = _team(db, owner, "Batch")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_batch_vorschau))

    ergebnis = DocsPendingEditService.create(
        db,
        owner,
        doc.doc_uid,
        conversation_id=gespraech.id,
        edits=_BATCH_EDITS,
        summary="Neu",
        run_id="run-1",
        call_id="call-1",
    )

    row = db.query(DocPendingEdit).one()
    assert row.operation == "batch"
    assert ergebnis["pending"] is True

    vorschau = DocsPendingEditService.preview(
        db, owner, doc.doc_uid, ergebnis["pending_uid"]
    )
    assert vorschau["previews"][0]["target_fingerprint"] == "0123456789ab"
    assert vorschau["html"] == "<p>Neu</p>"


def test_batch_uebernehmen_reicht_alle_edits_weiter(db, monkeypatch):
    owner = _benutzer(db, "pend_k")
    team = _team(db, owner, "Batch-Anwenden")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_batch_vorschau))

    ergebnis = DocsPendingEditService.create(
        db,
        owner,
        doc.doc_uid,
        conversation_id=gespraech.id,
        edits=_BATCH_EDITS,
        summary="Neu",
        run_id=None,
        call_id=None,
    )

    gesehen: dict = {}

    def _anwenden(db_, user_, doc_uid_, **kwargs):
        gesehen.update(kwargs)
        zeile = db_.query(Document).filter(Document.doc_uid == doc_uid_).one()
        zeile.rev = 4
        zeile.state_sha256 = "abc"
        db_.commit()
        return {"ok": True, "rev": 4, "edits_applied": 1}

    monkeypatch.setattr(DocsCollabService, "ai_edit", staticmethod(_anwenden))
    antwort = DocsPendingEditService.apply(
        db, owner, doc.doc_uid, ergebnis["pending_uid"]
    )

    assert antwort["rev"] == 4
    assert gesehen["edits"] == _BATCH_EDITS
    row = db.query(DocPendingEdit).one()
    assert row.status == "applied"


def test_batch_preview_markiert_stale_wenn_ein_ziel_fehlt(db, monkeypatch):
    from services.docs_service import fehler

    owner = _benutzer(db, "pend_l")
    team = _team(db, owner, "Batch-Stale")
    doc, gespraech = _dokument_mit_gespraech(db, owner, team)
    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_batch_vorschau))

    ergebnis = DocsPendingEditService.create(
        db,
        owner,
        doc.doc_uid,
        conversation_id=gespraech.id,
        edits=_BATCH_EDITS,
        summary="Neu",
        run_id=None,
        call_id=None,
    )

    def _stale(*_args, **_kwargs):
        raise fehler(409, "AI_EDIT_TARGET_NOT_FOUND", "Weg")

    monkeypatch.setattr(DocsCollabService, "ai_preview", staticmethod(_stale))
    with pytest.raises(HTTPException) as fehler_info:
        DocsPendingEditService.preview(db, owner, doc.doc_uid, ergebnis["pending_uid"])
    assert fehler_info.value.status_code == 409
    assert db.query(DocPendingEdit).one().status == "stale"
