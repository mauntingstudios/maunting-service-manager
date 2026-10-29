"""Dokumente in ein anderes Team verschieben — strikt und nachvollziehbar."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from models.doc import DocMember, Document
from models.team import Team, TeamMember
from services.auth_service import AuthService
from services.docs_service import DocsService


def _benutzer(db, name: str):
    user = AuthService.create_user(db, name, f"{name}@test.de", "Pass123!Pass")
    user.email_verified = True
    db.commit()
    db.refresh(user)
    return user


def _team(db, owner, name: str) -> Team:
    team = Team(name=name, owner_user_id=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, user_id=owner.id, role="owner", added_by=owner.id))
    db.commit()
    db.refresh(team)
    return team


def _mitglied(db, team, user, role: str = "member") -> None:
    db.add(TeamMember(team_id=team.id, user_id=user.id, role=role, added_by=team.owner_user_id))
    db.commit()


def test_umzug_entfernt_link_und_fremde_mitglieder(db):
    chef = _benutzer(db, "umzug_chef")
    fremd = _benutzer(db, "umzug_fremd")
    kollege = _benutzer(db, "umzug_kollege")
    quelle = _team(db, chef, "Quelle")
    ziel = _team(db, chef, "Ziel")
    _mitglied(db, quelle, fremd)
    _mitglied(db, ziel, kollege)
    ordner_ziel = DocsService.create_folder(db, chef, team_id=ziel.id, parent_uid=None, name="Zielordner")
    doc = DocsService.create_document(db, chef, team_id=quelle.id, title="Wandert")
    db.add(DocMember(document_id=db.query(Document).filter(Document.doc_uid == doc["uid"]).one().id, user_id=fremd.id, role="editor", source="manual"))
    db.add(DocMember(document_id=db.query(Document).filter(Document.doc_uid == doc["uid"]).one().id, user_id=kollege.id, role="viewer", source="manual"))
    db.commit()
    share = DocsService.create_share(db, chef, doc["uid"], role="viewer", expires_in_days=7)

    DocsService.update_document(
        db, chef, doc["uid"], {"team_id": ziel.id, "folder_uid": ordner_ziel["uid"]}
    )

    db.expire_all()
    verschoben = DocsService.get_document(db, chef, doc["uid"])
    assert verschoben["team_id"] == ziel.id
    assert verschoben["folder_uid"] == ordner_ziel["uid"]
    assert verschoben["share_role"] is None
    assert verschoben["shared"] is False
    assert share["url"]
    eintraege = {
        row.user_id: row.source
        for row in db.query(DocMember)
        .filter(DocMember.document_id == db.query(Document).filter(Document.doc_uid == doc["uid"]).one().id)
        .all()
    }
    assert fremd.id not in eintraege
    assert eintraege.get(kollege.id) == "manual"


def test_editor_darf_nicht_umziehen(db):
    chef = _benutzer(db, "umzug2_chef")
    redakteur = _benutzer(db, "umzug2_redakteur")
    quelle = _team(db, chef, "Quelle2")
    ziel = _team(db, chef, "Ziel2")
    _mitglied(db, quelle, redakteur)
    _mitglied(db, ziel, redakteur)
    doc = DocsService.create_document(db, chef, team_id=quelle.id)
    DocsService.put_member(db, chef, doc["uid"], redakteur.id, "editor")

    with pytest.raises(HTTPException) as fehler:
        DocsService.update_document(db, redakteur, doc["uid"], {"team_id": ziel.id})
    assert fehler.value.status_code == 403


def test_fremder_ordner_und_fremdes_team_werden_abgewiesen(db):
    chef = _benutzer(db, "umzug3_chef")
    fremd = _benutzer(db, "umzug3_fremd")
    quelle = _team(db, chef, "Quelle3")
    ziel = _team(db, chef, "Ziel3")
    fremdteam = _team(db, fremd, "Fremd3")
    _mitglied(db, quelle, fremd)
    ordner_quelle = DocsService.create_folder(db, chef, team_id=quelle.id, parent_uid=None, name="Alt")
    doc = DocsService.create_document(db, chef, team_id=quelle.id)

    with pytest.raises(HTTPException) as ordner:
        DocsService.update_document(
            db, chef, doc["uid"], {"team_id": ziel.id, "folder_uid": ordner_quelle["uid"]}
        )
    assert ordner.value.status_code == 404

    with pytest.raises(HTTPException) as team:
        DocsService.update_document(db, chef, doc["uid"], {"team_id": fremdteam.id})
    assert team.value.status_code in (403, 404)


def test_ohne_zielmitgliedschaft_kein_umzug(db):
    chef = _benutzer(db, "umzug4_chef")
    fremd = _benutzer(db, "umzug4_fremd")
    quelle = _team(db, chef, "Quelle4")
    ziel = _team(db, fremd, "Ziel4")
    doc = DocsService.create_document(db, chef, team_id=quelle.id)

    with pytest.raises(HTTPException) as fehler:
        DocsService.update_document(db, chef, doc["uid"], {"team_id": ziel.id})
    assert fehler.value.status_code in (403, 404)
