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


def test_modulschalter_im_authorize(db, monkeypatch):
    from services.panel_settings_service import PanelSettingsService

    user = _benutzer(db, "docs_q")
    daten = DocsService.create_document(db, user)
    monkeypatch.setattr(PanelSettingsService, "get", classmethod(lambda cls, key, default="", db=None: "false" if key == "docs_enabled" else default))
    antwort = DocsCollabService.authorize(
        db, doc_uid=daten["uid"], user_id=user.id, role="editor", fam=None
    )
    assert antwort["module_enabled"] is False


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
