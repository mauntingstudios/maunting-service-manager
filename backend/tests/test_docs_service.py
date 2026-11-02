"""Dokumente: ACL, Krypto, Store und Freigaben.

Die Krypto laeuft ueber den DIS-Mock aus conftest (`test-enc-v1:`), der die
AAD mitschreibt und beim Entschluesseln vergleicht. Damit sind AAD-Bindung und
Klartextfreiheit ohne Node-Sidecar pruefbar.
"""

from __future__ import annotations

import base64
import hashlib

import pytest
from fastapi import HTTPException

from models.doc import DocRevision, Document
from models.team import Team, TeamMember
from models.user import User
from services.auth_service import AuthService
from services.docs_collab_service import DocsCollabService
from services.docs_crypto import decrypt_state
from services.docs_service import DocsService


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


def _mitglied(db, team, user, role: str = "member") -> None:
    db.add(TeamMember(team_id=team.id, user_id=user.id, role=role, added_by=team.owner_user_id))
    db.commit()


def _docs_recht(db, user) -> None:
    """Gibt dem Benutzer den Dokumentzugang (`docs.use`, Befund 42)."""
    from models.role import Role, RolePermission
    from services.role_service import set_user_roles

    rolle = Role(name=f"docs-nutzer-{user.username}", description="Dokumentzugang", is_system=False)
    db.add(rolle)
    db.flush()
    db.add(RolePermission(role_id=rolle.id, permission_key="docs.use", granted=True))
    db.commit()
    set_user_roles(db, user, [rolle.id])


def _payload(roh: bytes, inhalt: str, **extra):
    return {
        "state_b64": base64.b64encode(roh).decode("ascii"),
        "state_sha256": hashlib.sha256(roh).hexdigest(),
        "content_text": inhalt,
        "content_truncated": False,
        "expected_rev": 0,
        "origin": "user:1",
        **extra,
    }


def test_persoenliches_dokument_anlegen_und_lesen(db):
    user = _benutzer(db, "docs_a")
    daten = DocsService.create_document(db, user, title="Notizen")
    assert daten["title"] == "Notizen"
    assert daten["role"] == "editor"
    assert daten["can_manage"] is True

    liste = DocsService.list_documents(db, user)
    assert [eintrag["uid"] for eintrag in liste] == [daten["uid"]]
    assert DocsService.get_document(db, user, daten["uid"])["title"] == "Notizen"


def test_titel_und_inhalt_sind_verschluesselt(db):
    user = _benutzer(db, "docs_b")
    daten = DocsService.create_document(db, user, title="Geheimtitel")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    assert "Geheimtitel" not in doc.title_encrypted
    assert doc.title_encrypted.startswith("test-enc-v1:")


def test_fremdes_dokument_ist_404(db):
    a = _benutzer(db, "docs_c")
    b = _benutzer(db, "docs_d")
    daten = DocsService.create_document(db, a, title="Privat")
    with pytest.raises(HTTPException) as fehler_info:
        DocsService.get_document(db, b, daten["uid"])
    assert fehler_info.value.status_code == 404


def test_team_default_rolle_und_override(db):
    owner = _benutzer(db, "docs_e")
    mitglied = _benutzer(db, "docs_f")
    team = _team(db, owner, "Doku-Team")
    _mitglied(db, team, mitglied)
    daten = DocsService.create_document(db, owner, team_id=team.id, title="Gemeinsam")

    assert DocsService.get_document(db, mitglied, daten["uid"])["role"] == "editor"

    DocsService.update_document(db, owner, daten["uid"], {"default_role": "viewer"})
    assert DocsService.get_document(db, mitglied, daten["uid"])["role"] == "viewer"

    DocsService.put_member(db, owner, daten["uid"], mitglied.id, "commenter")
    assert DocsService.get_document(db, mitglied, daten["uid"])["role"] == "commenter"

    DocsService.delete_member(db, owner, daten["uid"], mitglied.id)
    assert DocsService.get_document(db, mitglied, daten["uid"])["role"] == "viewer"


def test_team_austritt_entzieht_zugriff(db):
    owner = _benutzer(db, "docs_g")
    mitglied = _benutzer(db, "docs_h")
    team = _team(db, owner, "Austritt")
    _mitglied(db, team, mitglied)
    daten = DocsService.create_document(db, owner, team_id=team.id)
    assert DocsService.get_document(db, mitglied, daten["uid"])["role"] == "editor"

    db.query(TeamMember).filter(TeamMember.team_id == team.id, TeamMember.user_id == mitglied.id).delete()
    db.commit()
    with pytest.raises(HTTPException) as fehler_info:
        DocsService.get_document(db, mitglied, daten["uid"])
    assert fehler_info.value.status_code == 404


def test_share_link_gibt_viewer_und_endet_mit_dem_link(db):
    owner = _benutzer(db, "docs_i")
    extern = _benutzer(db, "docs_j")
    daten = DocsService.create_document(db, owner, title="Geteilt")

    freigabe = DocsService.create_share(db, owner, daten["uid"], role="viewer", expires_in_days=7)
    token = freigabe["url"].rsplit("/", 1)[-1]
    detail = DocsService.claim_share(db, extern, token)
    assert detail["role"] == "viewer"
    assert detail["can_edit"] is False

    DocsService.delete_share(db, owner, daten["uid"])
    with pytest.raises(HTTPException) as fehler_info:
        DocsService.get_document(db, extern, daten["uid"])
    assert fehler_info.value.status_code == 404


def test_freigabe_claim_kommt_aus_dem_body(db):
    """Befund 50: Claim per POST /shared/claim mit {token} im Body — gueltig
    200, ungueltig 404. Der alte Pfad mit Token ist weg (404). Am alten
    Stand stand das Token im Pfad und landete in Server-Logs."""
    from fastapi.testclient import TestClient

    from database import get_db
    from dependencies import verify_csrf
    from main import app
    from routers.docs import _docs_user

    owner = _benutzer(db, "docs_s50_a")
    extern = _benutzer(db, "docs_s50_b")
    daten = DocsService.create_document(db, owner, title="Geteilt")
    freigabe = DocsService.create_share(db, owner, daten["uid"], role="viewer", expires_in_days=7)
    token = freigabe["url"].rsplit("/", 1)[-1]

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[_docs_user] = lambda: extern
    app.dependency_overrides[verify_csrf] = lambda: None
    try:
        with TestClient(app) as client:
            gueltig = client.post("/api/docs/shared/claim", json={"token": token})
            assert gueltig.status_code == 200
            assert gueltig.json()["role"] == "viewer"

            ungueltig = client.post("/api/docs/shared/claim", json={"token": "0" * 64})
            assert ungueltig.status_code == 404

            alt_post = client.post(f"/api/docs/shared/{token}/claim")
            assert alt_post.status_code == 404
            alt_get = client.get(f"/api/docs/shared/{token}/claim")
            assert alt_get.status_code == 404
    finally:
        app.dependency_overrides.clear()


def test_store_zaehlt_rev_und_ist_idempotent(db):
    user = _benutzer(db, "docs_k")
    daten = DocsService.create_document(db, user, title="Zustand")
    roh = b"\x01\x02\x03yjs"
    payload = _payload(roh, "Hallo Welt", author_user_id=user.id, reason="autosave")

    ergebnis = DocsCollabService.store(db, daten["uid"], payload)
    assert ergebnis["stored"] is True
    assert ergebnis["rev"] == 1
    assert ergebnis["revision_rev"] == 1

    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    assert doc.state_bytes == len(roh)
    assert doc.state_sha256 == payload["state_sha256"]
    assert decrypt_state(doc.state_encrypted, daten["uid"]) == roh

    ergebnis2 = DocsCollabService.store(db, daten["uid"], payload)
    assert ergebnis2["stored"] is False
    assert ergebnis2["rev"] == 1


def test_checkpoint_erzeugt_version_ohne_aenderung(db):
    user = _benutzer(db, "docs_l")
    daten = DocsService.create_document(db, user, title="Checkpoint")
    roh = b"stand-1"
    DocsCollabService.store(
        db, daten["uid"], _payload(roh, "Stand eins", author_user_id=user.id)
    )
    # Rev 2 ohne eigene Version: anderer Stand, aber kein expliziter Grund.
    DocsCollabService.store(
        db,
        daten["uid"],
        _payload(b"stand-2", "Stand zwei", author_user_id=user.id),
    )
    anzahl_vorher = db.query(DocRevision).count()
    ergebnis = DocsCollabService.store(
        db,
        daten["uid"],
        _payload(b"stand-2", "Stand zwei", author_user_id=user.id, reason="checkpoint", force_revision=True, summary="Vor Umbau"),
    )
    assert ergebnis["stored"] is False
    assert ergebnis["revision_rev"] == 2
    assert db.query(DocRevision).count() == anzahl_vorher + 1


def test_store_verweigert_viewer(db):
    owner = _benutzer(db, "docs_m")
    mitglied = _benutzer(db, "docs_n")
    team = _team(db, owner, "NurLesen")
    _mitglied(db, team, mitglied)
    daten = DocsService.create_document(db, owner, team_id=team.id)
    DocsService.update_document(db, owner, daten["uid"], {"default_role": "viewer"})

    with pytest.raises(HTTPException) as fehler_info:
        DocsCollabService.store(
            db,
            daten["uid"],
            _payload(b"x", "x", author_user_id=mitglied.id),
        )
    assert fehler_info.value.status_code == 403
    assert fehler_info.value.detail["code"] == "DOCS_READ_ONLY"


def test_store_mit_veraltetem_stand_ist_konflikt(db):
    """Befund 9: expected_rev ungleich Rev → 409 mit aktuellem Stand, nichts
    gespeichert. Passender Stand und 0 ("unbekannt") speichern wie bisher.
    Am alten Stand wurde der veraltete Zustand still daruebergespeichert."""
    user = _benutzer(db, "docs_rev_a")
    daten = DocsService.create_document(db, user)
    DocsCollabService.store(db, daten["uid"], _payload(b"eins", "eins", author_user_id=user.id))

    with pytest.raises(HTTPException) as info:
        DocsCollabService.store(
            db, daten["uid"],
            _payload(b"alt", "alt", author_user_id=user.id, expected_rev=999),
        )
    assert info.value.status_code == 409
    assert info.value.detail["code"] == "DOC_REV_CONFLICT"
    assert info.value.detail["current_rev"] == 1

    db.expire_all()
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    assert doc.rev == 1
    assert decrypt_state(doc.state_encrypted, daten["uid"]) == b"eins"

    frisch = DocsCollabService.store(
        db, daten["uid"],
        _payload(b"zwei", "zwei", author_user_id=user.id, expected_rev=1),
    )
    assert frisch["stored"] is True
    assert frisch["rev"] == 2
    altweg = DocsCollabService.store(
        db, daten["uid"],
        _payload(b"drei", "drei", author_user_id=user.id, expected_rev=0),
    )
    assert altweg["rev"] == 3


def test_zwei_stores_gleichzeitig_einer_gewinnt(db):
    """Befund 9: Zwei Stores auf derselben Rev ueber zwei Verbindungen —
    einer speichert, der andere bekommt 409, kein IntegrityError.
    Am alten Stand krachte `uq_doc_revisions_doc_rev` oder ein Update ging
    still verloren."""
    import threading

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import NullPool

    import database as db_module

    user = _benutzer(db, "docs_rev_b")
    daten = DocsService.create_document(db, user)
    DocsCollabService.store(db, daten["uid"], _payload(b"eins", "eins", author_user_id=user.id))
    uid = daten["uid"]
    autor_id = user.id

    engine = create_engine(db_module.engine.url, poolclass=NullPool)
    sitzungen = sessionmaker(bind=engine)
    barriere = threading.Barrier(2)
    ausgang: list[str] = []
    fehler: list[Exception] = []

    def speicherung(inhalt: bytes) -> None:
        s = sitzungen()
        try:
            barriere.wait(timeout=10)
            ergebnis = DocsCollabService.store(
                s, uid, _payload(inhalt, inhalt.decode(), author_user_id=autor_id, expected_rev=1)
            )
            ausgang.append("stored" if ergebnis["stored"] else "idempotent")
        except HTTPException as exc:
            ausgang.append(f"http-{exc.status_code}")
        except Exception as exc:  # noqa: BLE001 — alles ausser 409 ist ein Fehler
            fehler.append(exc)
        finally:
            s.close()

    try:
        threads = [
            threading.Thread(target=speicherung, args=(b"zweig-a",)),
            threading.Thread(target=speicherung, args=(b"zweig-b",)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert not any(t.is_alive() for t in threads)
    finally:
        engine.dispose()

    assert fehler == []
    assert sorted(ausgang) == ["http-409", "stored"]
    db.expire_all()
    assert db.query(Document).filter(Document.doc_uid == uid).one().rev == 2
    assert (
        db.query(DocRevision)
        .join(Document, DocRevision.document_id == Document.id)
        .filter(Document.doc_uid == uid, DocRevision.rev == 2)
        .count()
    ) == 1


def test_ki_store_ohne_autor_ist_erlaubt(db):
    user = _benutzer(db, "docs_o")
    daten = DocsService.create_document(db, user)
    ergebnis = DocsCollabService.store(
        db,
        daten["uid"],
        _payload(b"ki", "Von Singra", origin="ai:run:call", reason="ai_edit"),
    )
    assert ergebnis["stored"] is True
    revision = (
        db.query(DocRevision)
        .filter(DocRevision.document_id == db.query(Document.id).filter(Document.doc_uid == daten["uid"]).scalar_subquery())
        .order_by(DocRevision.rev.desc())
        .first()
    )
    assert revision.author_kind == "ai"


def test_aad_bindung_scheitert_bei_falscher_uid(db):
    user = _benutzer(db, "docs_p")
    daten = DocsService.create_document(db, user)
    DocsCollabService.store(db, daten["uid"], _payload(b"abc", "abc", author_user_id=user.id))
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    with pytest.raises(Exception):
        decrypt_state(doc.state_encrypted, "andere-uid")


def test_geteilter_titel_helfer_behaelt_aad(db):
    """Befund 19: Collab nutzt den Titel-Helfer des Dienstes — ein Bestand,
    eine AAD. Die Helfer-AAD gleicht der frueheren literalen, sodass
    bestehende Titel weiter lesbar sind. Am alten Stand gab es zwei
    Definitionen und das Literal im Collab-Dienst."""
    import pathlib

    import services.docs_collab_service as collab
    from services.docs_crypto import aad_title
    from services.docs_service import _titel as dienst_titel

    assert collab._titel is dienst_titel
    assert "msm:docs:v1" not in pathlib.Path(collab.__file__).read_text(encoding="utf-8")

    user = _benutzer(db, "docs_titel_a")
    daten = DocsService.create_document(db, user, title="Gemeinsamer Titel")
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    assert collab._titel(doc) == "Gemeinsamer Titel"
    assert aad_title(daten["uid"]) == f"msm:docs:v1:{daten['uid']}:title"


def test_modulschalter_im_authorize(db, monkeypatch):
    from services.panel_settings_service import PanelSettingsService

    user = _benutzer(db, "docs_q")
    daten = DocsService.create_document(db, user)
    monkeypatch.setattr(PanelSettingsService, "get", classmethod(lambda cls, key, default="", db=None: "false" if key == "docs_enabled" else default))
    antwort = DocsCollabService.authorize(
        db, doc_uid=daten["uid"], user_id=user.id, role="editor", fam=None
    )
    assert antwort["module_enabled"] is False


def test_unbekannte_sitzungsfamilie_wird_abgewiesen(db):
    """Befund 8: Fremde oder widerrufene Familie → 403, am alten Stand 200.

    Gueltige Familie und fehlendes Merkmal (sitzunglose Wege) laufen;
    der Owner bleibt von der Familienbindung ausgenommen.
    """
    from datetime import datetime, timedelta, timezone

    from models.refresh_token import RefreshToken

    def sitzung(user_id, familie, widerrufen=False):
        db.add(RefreshToken(
            user_id=user_id,
            token_hash=f"hash-{familie}",
            family=familie,
            expires_at=datetime.now(timezone.utc) + timedelta(days=1),
            revoked_at=datetime.now(timezone.utc) if widerrufen else None,
        ))
        db.commit()

    user = _benutzer(db, "docs_fam_a")
    daten = DocsService.create_document(db, user)
    sitzung(user.id, "fam-gueltig")
    sitzung(user.id, "fam-tot", widerrufen=True)

    assert DocsCollabService.authorize(
        db, doc_uid=daten["uid"], user_id=user.id, role="editor", fam="fam-gueltig"
    )["ok"] is True
    assert DocsCollabService.authorize(
        db, doc_uid=daten["uid"], user_id=user.id, role="editor", fam=None
    )["ok"] is True

    for familie in ("fam-fremd", "fam-tot"):
        with pytest.raises(HTTPException) as info:
            DocsCollabService.authorize(
                db, doc_uid=daten["uid"], user_id=user.id, role="editor", fam=familie
            )
        assert info.value.status_code == 403

    owner = _benutzer(db, "docs_fam_owner")
    owner.is_owner = True
    db.commit()
    assert DocsCollabService.authorize(
        db, doc_uid=daten["uid"], user_id=owner.id, role="editor", fam="fam-fremd"
    )["ok"] is True


def test_collab_token_traegt_frische_kennung(db):
    """Befund 41: Jedes Token bekommt eine frische jti — zwei Tabs teilen
    sich nie eine Kennung, sonst sperrte die Verbindungsbindung den zweiten
    Tab. Am alten Stand kam die Kennung aus der Sitzung."""
    from jose import jwt as jose_jwt

    from config import settings

    user = _benutzer(db, "docs_jti_a")
    daten = DocsService.create_document(db, user)
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    eins = DocsCollabService.issue_token(db, user, doc, fam="fam-x")
    zwei = DocsCollabService.issue_token(db, user, doc, fam="fam-x")

    geheimnis = settings.docs_collab_secret or settings.secret_key
    kennungen = [
        jose_jwt.decode(
            paket["token"], geheimnis, algorithms=["HS256"],
            audience="msm-docs", issuer="msm",
        )["jti"]
        for paket in (eins, zwei)
    ]
    assert kennungen[0] != kennungen[1]
    import uuid as uuid_mod

    for kennung in kennungen:
        assert str(uuid_mod.UUID(str(kennung))) == str(kennung)


def test_rollenwechsel_trennt_collab_verbindung(db, monkeypatch):
    """Befund 41: Rollenwechsel (set_member_roles, update_member) trennt die
    Collab-Verbindungen des Mitglieds je Team-Dokument — sonst tippte es mit
    der alten Rolle weiter. Am alten Stand blieb die Verbindung offen."""
    import services.team_service as team_dienst

    getrennt: list[tuple] = []
    monkeypatch.setattr(
        DocsCollabService, "disconnect_user",
        staticmethod(lambda doc_uid, user_id: getrennt.append((doc_uid, user_id))),
    )
    chef = _benutzer(db, "docs_dc_a")
    gast = _benutzer(db, "docs_dc_b")
    team = _team(db, chef, "Trenn-Team")
    _mitglied(db, team, gast)
    daten = DocsService.create_document(db, chef, team_id=team.id)

    team_dienst.set_member_roles(
        db, team=team, user=chef, member_user_id=gast.id, role_ids=[]
    )
    assert getrennt == [(daten["uid"], gast.id)]

    getrennt.clear()
    team_dienst.update_member(
        db, team=team, user=chef, member_user_id=gast.id,
        can_manage_skills=False, can_manage_memory=False,
    )
    assert getrennt == [(daten["uid"], gast.id)]


def test_falsches_service_token_wird_abgewiesen(client, monkeypatch):
    from config import settings

    monkeypatch.setattr(settings, "docs_sidecar_token", "richtig")
    antwort = client.post("/internal/docs/authorize", json={
        "doc_uid": "x", "user_id": 1, "role": "editor", "fam": None, "jti": None,
    }, headers={"Authorization": "Bearer falsch"})
    assert antwort.status_code == 401


def test_dokument_schnitt_ist_geschlossen_und_kennt_keinen_worker():
    from services.ai_tool_registry import docs_kontext_schnitt

    erlaubt = docs_kontext_schnitt(True)
    assert "edit_document" in erlaubt
    assert "read_document" in erlaubt
    assert "read_server_status" in erlaubt
    assert "read_team_notes" in erlaubt
    assert "read_team_notes" not in docs_kontext_schnitt(False)
    # Der Lauf haengt an genau einem Dokument; eine Dokumentliste wuerde bei
    # einem persoenlichen Dokument sogar fremde Teams nennen.
    assert "list_documents" not in erlaubt
    for verboten in (
        "web_search",
        "send_mail",
        "restart_server",
        "desktop_system",
        "search_docs",
        "read_server_logs",
        "read_config",
        "list_server_files",
        "read_database",
        "execute_server_action",
        "list_users",
        "cloudflare_list_zones",
        "list_tasks",
        "popups_read",
        "search_memory",
        "read_skill",
        "learn_skill",
        "worker_start",
        "worker_cancel",
        "worker_antwort",
        "worker_frage",
        "wait_until",
    ):
        assert verboten not in erlaubt


def test_dokumentwerkzeuge_ohne_freigabe_nicht_angeboten(db, monkeypatch):
    from services import permission_service
    from services.ai_tool_registry import DOCUMENTS_TOOLS
    from services.ai_tools import server_tools

    user = _benutzer(db, "docs_r")
    monkeypatch.setattr(permission_service, "rechte_irgendwo", lambda db, user, keys: set())
    monkeypatch.setattr(
        "services.docs_collab_service.DocsCollabService.module_enabled",
        classmethod(lambda cls: True),
    )
    angeboten = server_tools.angebotene_werkzeuge(db, user)
    assert DOCUMENTS_TOOLS.isdisjoint(angeboten)


def test_dokument_tool_ohne_kontext_verweigert(db, monkeypatch):
    from services.ai_action_errors import AiActionValidationError
    from services.ai_tools import document_tools

    user = _benutzer(db, "docs_s")
    monkeypatch.setattr(document_tools.permission_service, "has_global_permission", lambda db, user, key: True)
    with pytest.raises(AiActionValidationError):
        document_tools.execute_document_tool(
            db, user=user, tool_name="read_document", arguments={}, kontext=None
        )


def test_dokumentlauf_sieht_nur_team_skills(db):
    from models.ai_skill import AiSkill
    from services import ai_skill_service

    user = _benutzer(db, "docs_t")
    team_a = _team(db, user, "Team A")
    team_b = _team(db, user, "Team B")
    for key, team in (("a-skill", team_a), ("b-skill", team_b)):
        db.add(AiSkill(
            id=f"skill-{key}", scope_identity=f"team:{team.id}", team_id=team.id,
            skill_key=key, name=key, description="Test", body="Text",
            origin="operator", status="active", enabled=True,
        ))
    db.commit()

    nur_a = ai_skill_service.visible_skills(db, user, nur_team_id=team_a.id)
    assert [eintrag.skill_key for eintrag in nur_a] == ["a-skill"]
    alle = ai_skill_service.visible_skills(db, user)
    assert {"a-skill", "b-skill"}.issubset({eintrag.skill_key for eintrag in alle})


def test_dokumentlauf_sieht_nur_team_gedaechtnis(db):
    from services.ai_gedaechtnis_abruf import sichtbare_bereiche

    user = _benutzer(db, "docs_u")
    team = _team(db, user, "Gedaechtnis-Team")
    assert sichtbare_bereiche(
        db, user, persoenlich=True, anlage=None, nur_team_id=team.id
    ) == [f"team:{team.id}"]


def test_router_legt_dokument_an_und_listet(db):
    from fastapi.testclient import TestClient
    from main import app
    from database import get_db
    from dependencies import get_current_user, verify_csrf

    user = _benutzer(db, "docs_v")
    user.is_owner = True
    db.commit()
    db.refresh(user)

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[verify_csrf] = lambda: None
    try:
        with TestClient(app) as client:
            status = client.get("/api/docs/status")
            assert status.status_code == 200
            assert status.json()["enabled"] is True

            erstellt = client.post("/api/docs", json={"title": "Vom Router"})
            assert erstellt.status_code == 201, erstellt.text
            doc = erstellt.json()
            assert doc["title"] == "Vom Router"
            assert doc["role"] == "editor"

            liste = client.get("/api/docs")
            assert liste.status_code == 200
            assert any(eintrag["uid"] == doc["uid"] for eintrag in liste.json())

            einzeln = client.get(f"/api/docs/{doc['uid']}")
            assert einzeln.status_code == 200
    finally:
        app.dependency_overrides.clear()


def test_modell_kann_worker_kein_dokument_unterschieben(db, monkeypatch):
    from services.ai_tools import server_tools

    user = _benutzer(db, "docs_w")
    gesehen = {}

    def fake_global(db, **kwargs):
        gesehen.update(kwargs)
        return {"ok": True}

    monkeypatch.setattr(server_tools, "_execute_global_read_tool", fake_global)
    server_tools.execute_read_tool(
        db,
        user=user,
        tool_name="worker_start",
        arguments={"_docs_document_uid": "fremd", "_docs_team_id": 99, "auftrag": "x"},
        kontext=None,
    )
    assert "_docs_document_uid" not in gesehen["arguments"]
    assert "_docs_team_id" not in gesehen["arguments"]


def test_papierkorb_ist_sichtbar_und_wiederherstellbar(db):
    user = _benutzer(db, "docs_x")
    daten = DocsService.create_document(db, user, title="Weg damit")
    DocsService.trash_document(db, user, daten["uid"])

    assert not any(e["uid"] == daten["uid"] for e in DocsService.list_documents(db, user))
    assert any(e["uid"] == daten["uid"] for e in DocsService.list_documents(db, user, trash=True))
    detail = DocsService.get_document(db, user, daten["uid"])
    assert detail["deleted"] is True

    wieder = DocsService.restore_document(db, user, daten["uid"])
    assert wieder["deleted"] is False
    DocsService.trash_document(db, user, daten["uid"])
    DocsService.delete_permanent(db, user, daten["uid"])
    with pytest.raises(HTTPException):
        DocsService.get_document(db, user, daten["uid"])


def _asset_token(url: str) -> dict:
    from urllib.parse import parse_qs, urlparse

    teile = parse_qs(urlparse(url).query)
    return {
        "doc_uid": teile["doc"][0],
        "token": teile["token"][0],
        "expires": int(teile["expires"][0]),
        "user_id": int(teile["user_id"][0]),
    }


def test_asset_upload_und_signierte_url(db):
    user = _benutzer(db, "docs_y")
    _docs_recht(db, user)
    daten = DocsService.create_document(db, user)
    roh = b"\x89PNG\r\n\x1a\nfake"
    hochgeladen = DocsService.upload_asset(
        db,
        user,
        daten["uid"],
        file_name="bild.png",
        mime="image/png",
        data_base64=base64.b64encode(roh).decode(),
        sha256=hashlib.sha256(roh).hexdigest(),
    )
    assert hochgeladen["asset_uid"]
    assert "/api/docs/assets/" in hochgeladen["signed_url"]

    teile = _asset_token(hochgeladen["signed_url"])
    asset, _, inhalt = DocsService.asset_content(db, asset_uid=hochgeladen["asset_uid"], **teile)
    assert asset.mime == "image/png"
    assert inhalt == roh

    with pytest.raises(HTTPException) as falsch:
        DocsService.asset_content(
            db,
            asset_uid=hochgeladen["asset_uid"],
            doc_uid=teile["doc_uid"],
            token="0" * 64,
            expires=teile["expires"],
            user_id=teile["user_id"],
        )
    assert falsch.value.status_code == 403


def test_asset_inhalt_prueft_modul_und_zugriff(db, monkeypatch):
    """Befund 42: Die Signatur allein genuegt nicht — abgeschaltetes Modul
    und entzogene Mitgliedschaft sind 403, auch mit gueltiger URL.
    Am alten Stand las jede gueltige Signatur den Inhalt."""
    from services.panel_settings_service import PanelSettingsService

    chef = _benutzer(db, "docs_az_a")
    gast = _benutzer(db, "docs_az_b")
    _docs_recht(db, gast)
    team = _team(db, chef, "Asset-Team")
    _mitglied(db, team, gast)
    daten = DocsService.create_document(db, chef, team_id=team.id)
    roh = b"geheim"
    hochgeladen = DocsService.upload_asset(
        db, chef, daten["uid"], file_name="a.png", mime="image/png",
        data_base64=base64.b64encode(roh).decode(), sha256=hashlib.sha256(roh).hexdigest(),
    )
    url, _ = DocsService.asset_signed_url(db, gast, daten["uid"], hochgeladen["asset_uid"])
    teile = _asset_token(url)

    _, _, inhalt = DocsService.asset_content(db, asset_uid=hochgeladen["asset_uid"], **teile)
    assert inhalt == roh

    monkeypatch.setattr(
        PanelSettingsService, "get",
        classmethod(lambda cls, key, default="", db=None: "false" if key == "docs_enabled" else default),
    )
    with pytest.raises(HTTPException) as aus:
        DocsService.asset_content(db, asset_uid=hochgeladen["asset_uid"], **teile)
    assert aus.value.status_code == 403
    assert aus.value.detail["code"] == "DOCS_DISABLED"
    monkeypatch.undo()

    db.query(TeamMember).filter(
        TeamMember.team_id == team.id, TeamMember.user_id == gast.id
    ).delete()
    db.commit()
    with pytest.raises(HTTPException) as raus:
        DocsService.asset_content(db, asset_uid=hochgeladen["asset_uid"], **teile)
    assert raus.value.status_code == 403
    assert raus.value.detail["code"] == "DOCS_FORBIDDEN"


def test_signieren_ohne_geheimnis_ist_503(db, monkeypatch):
    """Befund 10: Ohne MSM_DOCS_SIGNING_SECRET antworten Signieren und
    Pruefen mit 503 — kein Fallback auf Service-Token oder bekannten Wert.
    Am alten Stand signierte der feste Wert "msm-docs" gueltige URLs."""
    from config import settings

    user = _benutzer(db, "docs_sig_a")
    daten = DocsService.create_document(db, user)
    roh = b"signatur-test"
    hochgeladen = DocsService.upload_asset(
        db, user, daten["uid"], file_name="a.png", mime="image/png",
        data_base64=base64.b64encode(roh).decode(), sha256=hashlib.sha256(roh).hexdigest(),
    )
    assert "/api/docs/assets/" in hochgeladen["signed_url"]

    monkeypatch.setattr(settings, "docs_signing_secret", "")
    with pytest.raises(HTTPException) as signieren:
        DocsService.asset_signed_url(db, user, daten["uid"], hochgeladen["asset_uid"])
    assert signieren.value.status_code == 503
    assert signieren.value.detail["code"] == "DOCS_SIGNING_NOT_CONFIGURED"
    with pytest.raises(HTTPException) as pruefen:
        DocsService.asset_content(db, asset_uid=hochgeladen["asset_uid"], **_asset_token(hochgeladen["signed_url"]))
    assert pruefen.value.status_code == 503
    assert pruefen.value.detail["code"] == "DOCS_SIGNING_NOT_CONFIGURED"


def test_asset_weist_falsche_pruefsumme_und_svg_ab(db):
    user = _benutzer(db, "docs_z")
    daten = DocsService.create_document(db, user)
    with pytest.raises(HTTPException) as summe:
        DocsService.upload_asset(
            db, user, daten["uid"], file_name="a.png", mime="image/png",
            data_base64=base64.b64encode(b"abc").decode(), sha256="0" * 64,
        )
    assert summe.value.status_code == 422

    with pytest.raises(HTTPException) as svg:
        DocsService.upload_asset(
            db, user, daten["uid"], file_name="a.svg", mime="image/svg+xml",
            data_base64=base64.b64encode(b"<svg/>").decode(),
            sha256=hashlib.sha256(b"<svg/>").hexdigest(),
        )
    assert svg.value.status_code == 422


def _zwei_verbindungen():
    """Eigene Engine mit zwei unabhaengigen Verbindungen (Befund 43/9)."""
    import threading

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import NullPool

    import database as db_module

    engine = create_engine(db_module.engine.url, poolclass=NullPool)
    return engine, sessionmaker(bind=engine), threading.Barrier(2)


def test_quote_haelt_bei_gleichzeitigen_anlagen(db, monkeypatch):
    """Befund 43: Zwei Anlagen zugleich ueber zwei Verbindungen — eine
    gewinnt, die andere bekommt 413, die Quote steht nie drueber.
    Am alten Stand zaehlten beide vorbei und legten beide an."""
    import threading

    import services.docs_service as dienst

    monkeypatch.setattr(dienst, "MAX_DOCUMENTS_PER_TEAM", 3)
    user = _benutzer(db, "docs_q_a")
    team = _team(db, user, "Quoten-Team")
    DocsService.create_document(db, user, team_id=team.id)
    DocsService.create_document(db, user, team_id=team.id)
    team_id = team.id
    benutzer_id = user.id

    engine, sitzungen, barriere = _zwei_verbindungen()
    ausgang: list[str] = []
    try:
        def anlage() -> None:
            s = sitzungen()
            try:
                leser = s.get(User, benutzer_id)
                barriere.wait(timeout=10)
                dienst.DocsService.create_document(s, leser, team_id=team_id)
                ausgang.append("ok")
            except HTTPException as exc:
                ausgang.append(f"http-{exc.status_code}")
            finally:
                s.close()

        threads = [threading.Thread(target=anlage) for _ in range(2)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert not any(t.is_alive() for t in threads)
    finally:
        engine.dispose()

    assert sorted(ausgang) == ["http-413", "ok"]
    db.expire_all()
    assert (
        db.query(Document).filter(Document.team_id == team_id).count()
    ) == 3


def test_quote_haelt_bei_gleichzeitigen_uploads(db, monkeypatch):
    """Befund 43: Zwei Uploads zugleich ueber zwei Verbindungen — einer
    gewinnt, der andere bekommt 413, die Quote steht nie drueber.
    Am alten Stand zaehlten beide vorbei und luden beide hoch."""
    import threading

    import services.docs_service as dienst

    monkeypatch.setattr(dienst, "MAX_ASSETS_PER_DOC", 2)
    user = _benutzer(db, "docs_q_b")
    daten = DocsService.create_document(db, user)
    DocsService.upload_asset(
        db, user, daten["uid"], file_name="a.png", mime="image/png",
        data_base64=base64.b64encode(b"eins").decode(),
        sha256=hashlib.sha256(b"eins").hexdigest(),
    )
    uid = daten["uid"]
    benutzer_id = user.id

    engine, sitzungen, barriere = _zwei_verbindungen()
    ausgang: list[str] = []
    try:
        def hochladen(roh: bytes) -> None:
            s = sitzungen()
            try:
                leser = s.get(User, benutzer_id)
                barriere.wait(timeout=10)
                dienst.DocsService.upload_asset(
                    s, leser, uid, file_name="b.png", mime="image/png",
                    data_base64=base64.b64encode(roh).decode(),
                    sha256=hashlib.sha256(roh).hexdigest(),
                )
                ausgang.append("ok")
            except HTTPException as exc:
                ausgang.append(f"http-{exc.status_code}")
            finally:
                s.close()

        threads = [
            threading.Thread(target=hochladen, args=(b"zwei-a",)),
            threading.Thread(target=hochladen, args=(b"zwei-b",)),
        ]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)
        assert not any(t.is_alive() for t in threads)
    finally:
        engine.dispose()

    assert sorted(ausgang) == ["http-413", "ok"]
    db.expire_all()
    doc = db.query(Document).filter(Document.doc_uid == uid).one()
    from models.doc import DocAsset

    assert (
        db.query(DocAsset)
        .filter(DocAsset.document_id == doc.id, DocAsset.deleted_at.is_(None))
        .count()
    ) == 2


def test_kommentare_mit_anker_und_rolle(db):
    user = _benutzer(db, "docs_aa")
    daten = DocsService.create_document(db, user)
    erstellt = DocsService.create_comment(
        db, user, daten["uid"], body="Bitte pruefen",
        parent_uid=None, anchor={"quote": "Stelle", "from": 1, "to": 7},
    )
    liste = DocsService.list_comments(db, user, daten["uid"])
    assert liste[0]["uid"] == erstellt["uid"]
    assert liste[0]["anchor"]["quote"] == "Stelle"
    DocsService.update_comment(
        db, user, daten["uid"], erstellt["uid"], body=None, status="resolved"
    )
    assert DocsService.list_comments(db, user, daten["uid"])[0]["status"] == "resolved"


def test_ordner_anlegen_verschieben_und_loeschen(db):
    user = _benutzer(db, "docs_ab")
    ordner = DocsService.create_folder(
        db, user, team_id=None, parent_uid=None, name="Projekte"
    )
    daten = DocsService.create_document(
        db, user, folder_uid=ordner["uid"], title="Im Ordner"
    )
    assert daten["folder_uid"] == ordner["uid"]
    assert DocsService.list_documents(db, user, folder_uid=ordner["uid"])[0]["title"] == "Im Ordner"

    with pytest.raises(HTTPException) as konflikt:
        DocsService.create_folder(db, user, team_id=None, parent_uid=None, name="projekte")
    assert konflikt.value.status_code == 409

    DocsService.delete_folder(db, user, ordner["uid"])
    assert DocsService.get_document(db, user, daten["uid"])["folder_uid"] is None


def test_ordner_patch_unterscheidet_null_und_fehlend(db):
    """Befund 17: Nicht-String als Name → 422 (kein 500); explizites
    `parent_uid: null` verschiebt nach oben; Weglassen aendert nichts.
    Am alten Stand war Nicht-String ein 500 und `null` wirkungslos."""
    from fastapi.testclient import TestClient

    from database import get_db
    from dependencies import verify_csrf
    from main import app
    from routers.docs import _docs_user

    user = _benutzer(db, "docs_ord_a")
    elter = DocsService.create_folder(db, user, team_id=None, parent_uid=None, name="Elter")
    kind = DocsService.create_folder(db, user, team_id=None, parent_uid=elter["uid"], name="Kind")
    assert kind["parent_uid"] == elter["uid"]

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[_docs_user] = lambda: user
    app.dependency_overrides[verify_csrf] = lambda: None
    try:
        with TestClient(app) as client:
            antwort = client.patch(f"/api/docs/folders/{kind['uid']}", json={"name": 123})
            assert antwort.status_code == 422

            antwort = client.patch(f"/api/docs/folders/{kind['uid']}", json={"name": "KindNeu"})
            assert antwort.status_code == 200
            assert antwort.json()["name"] == "KindNeu"
            assert antwort.json()["parent_uid"] == elter["uid"]

            antwort = client.patch(f"/api/docs/folders/{kind['uid']}", json={"parent_uid": None})
            assert antwort.status_code == 200
            assert antwort.json()["parent_uid"] is None
    finally:
        app.dependency_overrides.clear()


def test_revisionen_enthalten_vorschau(db):
    user = _benutzer(db, "docs_ac")
    daten = DocsService.create_document(db, user)
    DocsCollabService.store(
        db, daten["uid"], _payload(b"eins", "Erster Text", author_user_id=user.id)
    )
    DocsCollabService.store(
        db,
        daten["uid"],
        _payload(
            b"zwei",
            "Zweiter Text",
            author_user_id=user.id,
            reason="checkpoint",
            force_revision=True,
        ),
    )
    revisionen = DocsService.list_revisions(db, user, daten["uid"])
    assert {eintrag["rev"] for eintrag in revisionen} >= {1, 2}
    assert any("Erster Text" in (eintrag["preview"] or "") for eintrag in revisionen)


def test_export_nutzt_sidecar_und_faellt_bei_txt_zurueck(db, monkeypatch):
    import services.docs_collab_service as collab

    user = _benutzer(db, "docs_ad")
    daten = DocsService.create_document(db, user)
    DocsCollabService.store(
        db, daten["uid"], _payload(b"x", "Exporttext", author_user_id=user.id)
    )

    monkeypatch.setattr(
        collab, "_call_sidecar",
        lambda *args, **kwargs: {"content": "<h1>Export</h1>", "mime": "text/html"},
    )
    inhalt, mime, name = DocsCollabService.render(db, user, daten["uid"], format="html")
    assert inhalt == b"<h1>Export</h1>"
    assert mime == "text/html"
    assert name.endswith(".html")

    def ausfall(*args, **kwargs):
        raise collab.fehler(503, "DOCS_SIDECAR_UNAVAILABLE", "down")

    monkeypatch.setattr(collab, "_call_sidecar", ausfall)
    inhalt, mime, _ = DocsCollabService.render(db, user, daten["uid"], format="txt")
    assert inhalt.decode() == "Exporttext"


def test_export_bettet_bilder_ein_und_hinweist_ueber_limit(db, monkeypatch):
    import services.docs_collab_service as collab

    user = _benutzer(db, "docs_ae")
    daten = DocsService.create_document(db, user)
    DocsCollabService.store(
        db, daten["uid"], _payload(b"x", "Bildtext", author_user_id=user.id)
    )
    roh = b"\x89PNG\r\n\x1a\nfake"
    asset = DocsService.upload_asset(
        db,
        user,
        daten["uid"],
        file_name="bild.png",
        mime="image/png",
        data_base64=base64.b64encode(roh).decode(),
        sha256=hashlib.sha256(roh).hexdigest(),
    )
    html_antwort = {
        "content": (
            '<html><body><img src="/alt" alt="b" data-asset-uid="'
            f'{asset["asset_uid"]}"></body></html>'
        ),
        "mime": "text/html",
    }
    monkeypatch.setattr(collab, "_call_sidecar", lambda *args, **kwargs: html_antwort)

    inhalt, _, _ = DocsCollabService.render(db, user, daten["uid"], format="html")
    text = inhalt.decode()
    assert f"data:image/png;base64,{base64.b64encode(roh).decode()}" in text
    assert 'src="/alt"' not in text

    monkeypatch.setattr(collab, "MAX_EXPORT_IMAGE_BYTES", 1)
    inhalt, _, _ = DocsCollabService.render(db, user, daten["uid"], format="html")
    text = inhalt.decode()
    assert "data:image/png" not in text
    assert "/api/docs/assets/" in text
    assert "Exportlimit von 10 MiB" in text


def test_router_sperrt_bei_deaktiviertem_modul(db, monkeypatch):
    from fastapi.testclient import TestClient
    from main import app
    from database import get_db
    from dependencies import get_current_user, verify_csrf
    from services.panel_settings_service import PanelSettingsService

    user = _benutzer(db, "docs_ae")
    user.is_owner = True
    db.commit()

    monkeypatch.setattr(
        PanelSettingsService,
        "get",
        classmethod(lambda cls, key, default="", db=None: "false" if key == "docs_enabled" else default),
    )
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    app.dependency_overrides[verify_csrf] = lambda: None
    try:
        with TestClient(app) as client:
            antwort = client.get("/api/docs")
            assert antwort.status_code == 403
            assert antwort.json()["detail"]["code"] == "DOCS_DISABLED"
    finally:
        app.dependency_overrides.clear()


def test_sitzungsmerkmale_kommen_auch_aus_dem_dev_cookie(monkeypatch):
    """Befund 16: Im Dev-Stack liest die Collab-Anmeldung das Zugangstoken
    aus `msm_dev_access_token` — fam/jti kommen an. Am alten Stand las sie
    nur `__Secure-access_token` und lieferte (None, None)."""
    import config
    from fastapi import Request

    from routers.docs import _session_claims
    from services.auth_service import AuthService

    def schalte(an: bool) -> None:
        monkeypatch.setattr(config.settings, "dev_http_cookies", an, raising=False)
        monkeypatch.setattr(config.settings, "debug", True, raising=False)
        monkeypatch.setattr(config.settings, "panel_url", "http://localhost:3000", raising=False)
        monkeypatch.setattr(config.settings, "api_url", "", raising=False)

    monkeypatch.setattr(
        AuthService, "decode_token",
        staticmethod(lambda t: {"familie": "fam-x", "jti": "jti-y"} if t == "dev-token" else None),
    )

    def anfrage(cookie: str) -> Request:
        return Request({"type": "http", "headers": [(b"cookie", cookie.encode())]})

    schalte(True)
    assert _session_claims(anfrage("msm_dev_access_token=dev-token")) == ("fam-x", "jti-y")

    schalte(False)
    assert _session_claims(anfrage("__Secure-access_token=dev-token")) == ("fam-x", "jti-y")


def test_dokumentgespraech_ist_je_dokument_eindeutig(db):
    from services import ai_chat_service

    user = _benutzer(db, "docs_af")
    daten = DocsService.create_document(db, user)
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    erst = ai_chat_service.get_or_create_docs_conversation(db, user, doc.id)
    db.commit()
    zweit = ai_chat_service.get_or_create_docs_conversation(db, user, doc.id)
    assert erst.id == zweit.id
    assert zweit.kind == "docs"
    assert zweit.document_id == doc.id
    assert zweit.title == "Dokument"


def test_dis_ausfall_beim_store_bleibt_503_und_unveraendert(db, monkeypatch):
    import services.docs_collab_service as collab
    from services.dis_client import DisSidecarError

    user = _benutzer(db, "docs_ag")
    daten = DocsService.create_document(db, user)

    def ausfall(*args, **kwargs):
        raise DisSidecarError("down")

    monkeypatch.setattr(collab, "encrypt_state", ausfall)
    with pytest.raises(HTTPException) as fehler_info:
        DocsCollabService.store(
            db, daten["uid"], _payload(b"neu", "Neu", author_user_id=user.id)
        )
    assert fehler_info.value.status_code == 503
    db.rollback()
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    assert doc.rev == 0
    assert doc.state_encrypted is None


def test_purge_entfernt_abgelaufene_papierkorb_dokumente(db):
    from datetime import datetime, timedelta, timezone

    user = _benutzer(db, "docs_ah")
    daten = DocsService.create_document(db, user)
    doc = db.query(Document).filter(Document.doc_uid == daten["uid"]).one()
    doc.deleted_at = datetime.now(timezone.utc) - timedelta(days=31)
    doc.purge_after = datetime.now(timezone.utc) - timedelta(minutes=1)
    db.commit()

    assert DocsService.purge_deleted(db) == 1
    assert db.query(Document).filter(Document.doc_uid == daten["uid"]).first() is None


def test_suche_entschluesselt_gebuendelt_ohne_einzelaufrufe(db, monkeypatch):
    """Befund 5: Titel und Inhalte je ein `decrypt_many`, kein `decrypt` je Dokument."""
    from services.dis_client import DisClient

    user = _benutzer(db, "docs_suche_a")
    for i in range(3):
        daten = DocsService.create_document(db, user, title=f"Protokoll {i}")
        DocsCollabService.store(
            db, daten["uid"], _payload(b"x", f"Geheiminhalt {i}", author_user_id=user.id)
        )

    einzel: list = []
    orig_decrypt = DisClient.decrypt

    def zaehle_decrypt(ciphertext: str, aad: str | None = None) -> str:
        einzel.append(ciphertext)
        return orig_decrypt(ciphertext, aad)

    gebuendelt: list = []
    orig_many = DisClient.decrypt_many

    def zaehle_many(items):  # type: ignore[no-untyped-def]
        gebuendelt.append(list(items))
        return orig_many(items)

    monkeypatch.setattr(DisClient, "decrypt", staticmethod(zaehle_decrypt))
    monkeypatch.setattr(DisClient, "decrypt_many", staticmethod(zaehle_many))

    ergebnis = DocsService.search_documents(db, user, "geheiminhalt")
    assert sorted(t["title"] for t in ergebnis["items"]) == [
        "Protokoll 0", "Protokoll 1", "Protokoll 2",
    ]
    assert ergebnis["searched"] == 3
    assert ergebnis["truncated"] is False
    assert einzel == []
    assert len(gebuendelt) == 2
    assert sorted(len(aufruf) for aufruf in gebuendelt) == [3, 3]


def test_suche_zeigt_kuerzung_bei_mehr_als_200_dokumenten(db):
    """Befund 5: jenseits der 200 juengsten schweigt die Suche nicht still."""
    user = _benutzer(db, "docs_suche_b")
    for i in range(205):
        DocsService.create_document(db, user, title=f"Suchwort {i}")

    ergebnis = DocsService.search_documents(db, user, "suchwort")
    assert ergebnis["searched"] == 200
    assert ergebnis["truncated"] is True
    assert len(ergebnis["items"]) == 50

    ergebnis = DocsService.search_documents(db, user, "   ")
    assert ergebnis == {"items": [], "searched": 0, "truncated": False}


def test_dokumentrechte_im_katalog():
    from services.ai_tool_registry import (
        DOCUMENTS_TOOLS,
        DOCUMENTS_WRITE_TOOLS,
        GEHIRN_TOOLS,
        READ_TOOLS,
    )

    assert len(DOCUMENTS_TOOLS) == 15
    assert "read_document_structure" in DOCUMENTS_TOOLS
    assert DOCUMENTS_WRITE_TOOLS <= READ_TOOLS
    assert DOCUMENTS_WRITE_TOOLS.isdisjoint(GEHIRN_TOOLS)


def test_liste_liest_zugriff_und_ordner_gebuendelt(db):
    """Befund 24: 200 Dokumente — konstante Abfragezahl, stabile Ordnung.

    Am alten Stand las die Liste je Dokument Mitgliedschaft, manuellen
    Override und Ordner einzeln (600+ Anweisungen); jetzt je einmal.
    Sortierung und Paginierung bleiben wie bisher.
    """
    from tests._statements import count_statements

    owner = _benutzer(db, "docs_liste_a")
    mitglied = _benutzer(db, "docs_liste_b")
    team = _team(db, owner, "Listen-Team")
    _mitglied(db, team, mitglied)
    ordner_a = DocsService.create_folder(db, owner, team_id=team.id, parent_uid=None, name="Ablage")
    for i in range(210):
        DocsService.create_document(
            db, owner, team_id=team.id,
            folder_uid=ordner_a["uid"] if i % 3 == 0 else None,
            title=f"Dokument {i:03d}",
        )

    db.expire_all()
    assert mitglied.is_owner is False
    with count_statements(db) as anweisungen:
        seite = DocsService.list_documents(db, mitglied, limit=200)
    assert len(seite) == 200
    assert len(anweisungen) <= 10

    # Stabile Ordnung: zwei Laeufe, eine Reihenfolge; Ordner stimmen.
    db.expire_all()
    nochmal = DocsService.list_documents(db, mitglied, limit=200)
    assert [eintrag["uid"] for eintrag in nochmal] == [eintrag["uid"] for eintrag in seite]
    assert {eintrag["folder_uid"] for eintrag in seite} <= {None, ordner_a["uid"]}
    # 70 im Ordner angelegt, 4 davon unter den 10 aeltesten ausserhalb des Limits.
    assert sum(1 for eintrag in seite if eintrag["folder_uid"] == ordner_a["uid"]) == 66
    assert {eintrag["role"] for eintrag in seite} == {"editor"}
