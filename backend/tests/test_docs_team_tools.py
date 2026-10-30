"""Dokument-KI: Teamwissen nur fuer echte Teammitglieder."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from models.ai_skill import AiSkill
from models.doc import DocMember, Document
from models.team import Team, TeamMember
from services import ai_docs_chat_scope
from services.ai_action_errors import AiActionValidationError
from services.ai_tools import document_tools
from services.ai_tools.document_tools import ToolKontext
from services.auth_service import AuthService
from services.docs_service import DocsService
from services.notes_service import NotesService


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
    db.add(TeamMember(
        team_id=team.id, user_id=owner.id, role="owner", added_by=owner.id,
        can_manage_memory=True, can_manage_skills=True,
    ))
    db.commit()
    db.refresh(team)
    return team


def _mitglied(db, team, user, *, memory=False, skills=False):
    db.add(TeamMember(
        team_id=team.id, user_id=user.id, role="member", added_by=team.owner_user_id,
        can_manage_memory=memory, can_manage_skills=skills,
    ))
    db.commit()


def _rechte(monkeypatch):
    monkeypatch.setattr(
        document_tools.permission_service, "has_global_permission",
        lambda db, user, key: True,
    )
    monkeypatch.setattr(
        "services.docs_collab_service.DocsCollabService.module_enabled",
        classmethod(lambda cls: True),
    )


def test_link_gast_bekommt_kein_teamwissen(db, monkeypatch):
    owner = _benutzer(db, "team_a")
    gast = _benutzer(db, "team_b")
    team = _team(db, owner, "Link-Team")
    daten = DocsService.create_document(db, owner, team_id=team.id, title="Geteilt")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    doc.share_token_hash = "a" * 64
    doc.share_role = "viewer"
    doc.share_expires_at = datetime.now(timezone.utc) + timedelta(days=1)
    db.add(DocMember(
        document_id=doc.id, user_id=gast.id, role="viewer", source="link",
    ))
    db.commit()
    _rechte(monkeypatch)
    monkeypatch.setattr(
        ai_docs_chat_scope.permission_service, "has_global_permission",
        lambda db, user, key: True,
    )

    _gespraech, _doc, team_id = ai_docs_chat_scope.resolve(db, gast, doc.doc_uid)
    assert team_id is None

    with pytest.raises(AiActionValidationError):
        document_tools.execute_document_tool(
            db, user=gast, tool_name="read_team_notes", arguments={},
            kontext=ToolKontext(document_uid=doc.doc_uid, team_id=None),
        )


def test_teammitglied_liest_nur_team_notizen(db, monkeypatch):
    owner = _benutzer(db, "team_c")
    mitglied = _benutzer(db, "team_d")
    team = _team(db, owner, "Notiz-Team")
    _mitglied(db, team, mitglied)
    daten = DocsService.create_document(db, owner, team_id=team.id, title="Notizen")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    NotesService.create_note(
        db, owner, title="Teamwissen", content="Gilt fuer alle",
        note_type="team", team_id=team.id,
    )
    NotesService.create_note(
        db, owner, title="Privat", content="Nur ich",
        note_type="personal",
    )
    _rechte(monkeypatch)

    ergebnis = document_tools.execute_document_tool(
        db, user=mitglied, tool_name="read_team_notes", arguments={},
        kontext=ToolKontext(document_uid=doc.doc_uid, team_id=team.id),
    )

    titel = {eintrag["title"] for eintrag in ergebnis["notes"]}
    assert titel == {"Teamwissen"}


def test_learn_team_skill_bleibt_im_dokumentteam(db, monkeypatch):
    owner = _benutzer(db, "team_e")
    team = _team(db, owner, "Skill-Team")
    daten = DocsService.create_document(db, owner, team_id=team.id, title="Skills")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    _rechte(monkeypatch)

    ergebnis = document_tools.execute_document_tool(
        db, user=owner, tool_name="learn_team_skill",
        arguments={
            "skill_key": "dokumente-pruefen",
            "name": "Dokumente prüfen",
            "description": "Prüft Dokumente auf Widersprüche.",
            "body": "Lies den Text und nenne Widersprüche.",
        },
        kontext=ToolKontext(document_uid=doc.doc_uid, team_id=team.id),
    )

    assert ergebnis["learned"] is True
    assert ergebnis["scope"] == "team"
    row = db.query(AiSkill).filter(AiSkill.skill_key == "dokumente-pruefen").one()
    assert row.team_id == team.id


def test_team_ohne_skill_schalter_lernt_nicht(db, monkeypatch):
    owner = _benutzer(db, "team_f")
    mitglied = _benutzer(db, "team_g")
    team = _team(db, owner, "Ohne-Schalter")
    _mitglied(db, team, mitglied)
    daten = DocsService.create_document(db, owner, team_id=team.id, title="Skills")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    _rechte(monkeypatch)

    ergebnis = document_tools.execute_document_tool(
        db, user=mitglied, tool_name="learn_team_skill",
        arguments={
            "skill_key": "verboten",
            "name": "Verboten",
            "description": "Darf nicht entstehen.",
            "body": "Text",
        },
        kontext=ToolKontext(document_uid=doc.doc_uid, team_id=team.id),
    )

    assert ergebnis["learned"] is False
    assert db.query(AiSkill).filter(AiSkill.skill_key == "verboten").count() == 0


def test_dokument_lesen_geht_ueber_den_dokumentzweig(db, monkeypatch):
    from services.ai_tools import server_tools

    owner = _benutzer(db, "team_i")
    team = _team(db, owner, "Dispatch")
    daten = DocsService.create_document(db, owner, team_id=team.id, title="Lesen")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    _rechte(monkeypatch)

    ergebnis = server_tools.execute_read_tool(
        db,
        user=owner,
        tool_name="read_document",
        arguments={},
        kontext=ToolKontext(document_uid=doc.doc_uid, team_id=team.id),
    )

    assert ergebnis["uid"] == doc.doc_uid
    assert ergebnis["title"] == "Lesen"


def test_persoenliche_notizen_bleiben_verschlossen(db, monkeypatch):
    owner = _benutzer(db, "team_h")
    team = _team(db, owner, "Nur-Team")
    daten = DocsService.create_document(db, owner, team_id=team.id, title="Notizen")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    _rechte(monkeypatch)

    ergebnis = document_tools.execute_document_tool(
        db, user=owner, tool_name="read_team_notes", arguments={},
        kontext=ToolKontext(document_uid=doc.doc_uid, team_id=team.id),
    )

    assert ergebnis["notes"] == []
