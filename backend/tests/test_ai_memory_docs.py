"""Gedaechtnisschreiber fuer Dokumente: genau ein Team, sonst nichts."""

from __future__ import annotations

from uuid import uuid4

from models import AiMessage, Role, RolePermission, User
from models.doc import Document
from models.team import Team, TeamMember
from services import ai_gedaechtnis_schreiber as schreiber
from services.auth_service import AuthService
from services.ai_chat_service import get_or_create_docs_conversation
from services.ai_limit_service import LIMIT_FIELDS, set_role_limit
from services.docs_service import DocsService
from services.role_service import set_user_roles


def _benutzer(db, name: str, *, memory: bool = True):
    user = AuthService.create_user(db, name, f"{name}@test.de", "Pass123!Pass")
    user.email_verified = True
    role = Role(name=f"memory-{name}", is_system=False)
    db.add(role)
    db.flush()
    if memory:
        db.add(RolePermission(role_id=role.id, permission_key="ai.memory.use"))
    set_role_limit(db, role.id, {field: None for field in LIMIT_FIELDS})
    db.commit()
    set_user_roles(db, user, [role.id])
    db.refresh(user)
    return user


def _team(db, owner, name: str, *, manage_memory: bool = True):
    team = Team(name=name, owner_user_id=owner.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(
        team_id=team.id, user_id=owner.id, role="owner", added_by=owner.id,
        can_manage_memory=manage_memory,
    ))
    db.commit()
    db.refresh(team)
    return team


def _gespraech(db, user, team):
    daten = DocsService.create_document(db, user, team_id=team.id, title="Gedaechtnis")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    gespraech = get_or_create_docs_conversation(db, user, doc.id)
    db.add(AiMessage(
        id=str(uuid4()),
        conversation_id=gespraech.id,
        role="user",
        content="Teamregel: Wartungsfenster ist immer Dienstag 18 Uhr.",
        status="complete",
    ))
    db.commit()
    return doc, gespraech


def test_dokumentgedaechtnis_schreibt_nur_das_dokumentteam(db):
    owner = _benutzer(db, "mem_doc_a")
    team = _team(db, owner, "Gedaechtnis-Team")
    _doc, gespraech = _gespraech(db, owner, team)

    gelesen = schreiber._gespraech_lesen(db, gespraech.id)

    assert gelesen is not None and gelesen.auftrag is not None
    assert gelesen.auftrag.nur_team_id == team.id

    bereiche = schreiber._bereiche(db, owner, gelesen.auftrag, persoenlich=False)
    assert len(bereiche) == 1
    assert bereiche[0].scope == "team"
    assert bereiche[0].team_id == team.id
    assert bereiche[0].identity == f"team:{team.id}"


def test_ohne_memory_schalter_kein_teambereich(db):
    owner = _benutzer(db, "mem_doc_b")
    team = _team(db, owner, "Ohne-Schalter", manage_memory=False)
    _doc, gespraech = _gespraech(db, owner, team)

    gelesen = schreiber._gespraech_lesen(db, gespraech.id)

    assert gelesen is not None and gelesen.auftrag is not None
    assert schreiber._bereiche(db, owner, gelesen.auftrag, persoenlich=False) == []


def test_link_gast_erzeugt_keinen_gedaechtnisauftrag(db):
    owner = _benutzer(db, "mem_doc_c")
    gast = _benutzer(db, "mem_doc_d")
    team = _team(db, owner, "Link-Gedaechtnis")
    daten = DocsService.create_document(db, owner, team_id=team.id, title="Gast")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    gespraech = get_or_create_docs_conversation(db, gast, doc.id)
    db.add(AiMessage(
        id=str(uuid4()),
        conversation_id=gespraech.id,
        role="user",
        content="Nur ein Gast.",
        status="complete",
    ))
    db.commit()

    gelesen = schreiber._gespraech_lesen(db, gespraech.id)

    assert gelesen is not None
    assert gelesen.auftrag is None
