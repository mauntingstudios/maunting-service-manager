"""Tests fuer das Projekt-Wiki (DeepWiki): RBAC, Workspace-Sync, Embeddings, Docs & Worker."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

import numpy as np
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import AiConversation, AiProjectWikiChunk, AiProjectWikiPage, AiRun, Role, RolePermission, User
from services import (
    ai_context_service,
    ai_embedding_service,
    ai_project_service,
    ai_project_wiki_service,
    permission_catalog,
    role_service,
    shop_fulfillment_service,
)
from services.ai_action_errors import AiActionValidationError
from services.ai_tools.project_tools import projekt_werkzeug
from services.auth_service import AuthService


def _login(client: TestClient, username: str, password: str) -> tuple[dict, str]:
    resp = client.post(
        "/api/auth/login",
        json={"username": username, "password": password, "otp_code": None},
    )
    assert resp.status_code == 200
    cookies = dict(resp.cookies)
    return cookies, cookies.get("__Secure-csrf_token") or ""


def _create_user_with_perms(db: Session, *, extra_perms: tuple[str, ...] = ()) -> tuple[User, str, str]:
    uname = f"wiki-{uuid4().hex[:6]}"
    pw = "WikiPass123!"
    user = AuthService.create_user(db, uname, f"{uname}@test.de", pw)
    user.email_verified = True
    role = Role(name=f"role-{uuid4().hex[:6]}", is_system=False)
    db.add(role)
    db.flush()
    for key in ("ai.projects.manage", "ai.coding.use", *extra_perms):
        db.add(RolePermission(role_id=role.id, permission_key=key))
    db.commit()
    role_service.set_user_roles(db, user, [role.id])
    db.refresh(user)
    return user, uname, pw


def _mock_encode_factory(model_tag: str = ai_embedding_service.MODEL_TAG):
    """Deterministischer Vektor-Encoder auf Einheitsbasis fuer semantische Tests ohne Modell-Download."""

    def _encode(texts: list[str], *, db: Session | None = None):
        vectors = []
        dim = ai_embedding_service.EMBEDDING_DIMENSIONS
        for text in texts:
            low = (text or "").lower()
            vec = np.zeros(dim, dtype=np.float32)
            if any(w in low for w in ("auth", "token", "login", "jwt")):
                vec[0] = 1.0
            if any(w in low for w in ("database", "schema", "postgres", "table", "migration")):
                vec[1] = 1.0
            if any(w in low for w in ("route", "endpoint", "api", "fastapi")):
                vec[2] = 1.0
            if float(np.linalg.norm(vec)) == 0.0:
                vec[3] = 1.0
            vec = vec / float(np.linalg.norm(vec))
            vectors.append(tuple(float(x) for x in vec))
        return ai_embedding_service.Kodierung(
            vektoren=vectors,
            modell=model_tag,
        )

    return _encode


def test_wiki_permission_in_catalog_and_shop_allowlist_and_routes_require_permission(
    client: TestClient, db: Session, tmp_path: Path, monkeypatch
):
    monkeypatch.setattr("config.settings.servers_dir", str(tmp_path))
    assert "ai.projects.wiki" in permission_catalog.ALL_KEYS
    assert "ai.projects.wiki" in shop_fulfillment_service.SHOP_ALLOWED_ROLE_PERMISSIONS

    user_no_wiki, uname1, pw1 = _create_user_with_perms(db)
    cookies1, csrf1 = _login(client, uname1, pw1)
    proj = ai_project_service.create_project(db, user_no_wiki, name="NoWikiRepo")

    res_get = client.get(f"/api/ai/projects/{proj.id}/wiki", cookies=cookies1)
    assert res_get.status_code == 403

    res_patch = client.patch(
        f"/api/ai/projects/{proj.id}/wiki/settings",
        json={"wiki_enabled": True},
        cookies=cookies1,
        headers={"X-CSRF-Token": csrf1},
    )
    assert res_patch.status_code == 403

    user_wiki, uname2, pw2 = _create_user_with_perms(db, extra_perms=("ai.projects.wiki",))
    cookies2, csrf2 = _login(client, uname2, pw2)
    proj2 = ai_project_service.create_project(db, user_wiki, name="WikiRepo")

    overview = client.get(f"/api/ai/projects/{proj2.id}/wiki", cookies=cookies2)
    assert overview.status_code == 200
    body = overview.json()
    assert body["wiki_enabled"] is False
    assert body["wiki_auto_update"] is False
    assert body["wiki_path"] == ".singra/wiki"


def test_workspace_markdown_sync_and_path_traversal_guard(
    db: Session, tmp_path: Path, monkeypatch
):
    monkeypatch.setattr("config.settings.servers_dir", str(tmp_path))
    user, _, _ = _create_user_with_perms(db, extra_perms=("ai.projects.wiki",))
    proj = ai_project_service.create_project(db, user, name="LocalOnlyProject")
    assert not proj.git_repo_url

    with patch(
        "services.ai_embedding_service.encode",
        side_effect=_mock_encode_factory(),
    ):
        updated_settings = ai_project_wiki_service.update_wiki_settings(
            db, user, proj.id, wiki_enabled=True, wiki_auto_update=True
        )
        assert updated_settings["wiki_enabled"] is True
        assert updated_settings["wiki_auto_update"] is True

        # Path traversal wird blockiert und sauber auf .singra/wiki normalisiert
        try:
            ai_project_wiki_service.update_wiki_settings(
                db, user, proj.id, wiki_path="../outside"
            )
            raised = False
        except Exception:
            raised = True
        assert raised is True

        detail = ai_project_wiki_service.upsert_wiki_page(
            db,
            user,
            proj.id,
            slug="architecture",
            title="System Architecture",
            category="architecture",
            summary="Core design and mermaid flow",
            markdown="# Overview\n\n```mermaid\nflowchart LR\n  UI-->API\n```\n\n## Database\nPostgres schema handles persistence.",
            source_files=["backend/main.py", "frontend/src/App.tsx"],
        )
        assert detail["slug"] == "architecture"
        assert detail["category"] == "architecture"
        assert detail["file_path"] == ".singra/wiki/architecture.md"
        assert (
            db.query(AiProjectWikiChunk)
            .filter(AiProjectWikiChunk.project_id == proj.id)
            .count()
            >= 2
        )

        # Markdown existiert direkt im lokalen Workspace ohne GitHub-Repo
        disk_content = ai_project_service.read_project_file(
            db, user, proj.id, ".singra/wiki/architecture.md"
        ).content
        assert 'title: "System Architecture"' in disk_content
        assert "source_files:" in disk_content

        # Zweite Datei direkt auf dem Dateisystem (ohne AiProjectFile-Eintrag) ablegen und sync_from_workspace testen
        ws = ai_project_service.ensure_project_workspace(proj)
        (ws / ".singra" / "wiki" / "auth-flow.md").write_text(
            (
                "---\n"
                "title: Authentication Flow\n"
                "category: api\n"
                "summary: Session cookie and JWT verification\n"
                "source_files:\n"
                "  - backend/routers/auth.py\n"
                "---\n\n"
                "## Login & Tokens\n"
                "Login endpoints verify password hashes and issue short-lived tokens.\n"
            ),
            encoding="utf-8",
        )
        sync_res = ai_project_wiki_service.sync_from_workspace(db, user, proj.id)
        assert sync_res["updated"] >= 1
        page = ai_project_wiki_service.get_wiki_page(db, user, proj.id, "auth-flow")
        assert page["title"] == "Authentication Flow"
        assert page["source_files"] == ["backend/routers/auth.py"]


def test_semantic_search_reuses_embeddings_and_handles_model_migration(
    db: Session, tmp_path: Path, monkeypatch
):
    monkeypatch.setattr("config.settings.servers_dir", str(tmp_path))
    user, _, _ = _create_user_with_perms(db, extra_perms=("ai.projects.wiki",))
    proj = ai_project_service.create_project(db, user, name="SemanticSearchRepo")
    ai_project_wiki_service.update_wiki_settings(db, user, proj.id, wiki_enabled=True)

    with patch(
        "services.ai_embedding_service.encode",
        side_effect=_mock_encode_factory(model_tag=ai_embedding_service.MODEL_TAG),
    ):
        ai_project_wiki_service.upsert_wiki_page(
            db,
            user,
            proj.id,
            slug="database",
            title="Datenmodell",
            category="data",
            summary="PostgreSQL Tabellen und Migrationen",
            markdown="# Database\n\nPostgreSQL schema and table migrations store wiki chunks.",
            source_files=["backend/models/ai_project.py"],
        )
        ai_project_wiki_service.upsert_wiki_page(
            db,
            user,
            proj.id,
            slug="auth",
            title="Authentifizierung",
            category="api",
            summary="Login und Token",
            markdown="# Auth\n\nLogin flow issues JWT and session tokens.",
            source_files=["backend/routers/auth.py"],
        )

        hits = ai_project_wiki_service.search_wiki(db, user, proj.id, "postgres table migration")
        assert len(hits) >= 1
        assert hits[0]["slug"] == "database"
        assert hits[0]["score"] >= 0.5

    # Wechsel auf Remote-Fallback-Modelltag: gespeicherte Chunks werden sauber neu indiziert
    with patch(
        "services.ai_embedding_service.encode",
        side_effect=_mock_encode_factory(model_tag="openai:text-embedding-3-small"),
    ):
        hits2 = ai_project_wiki_service.search_wiki(db, user, proj.id, "login token jwt")
        assert len(hits2) >= 1
        assert hits2[0]["slug"] == "auth"
        chunks = db.query(AiProjectWikiChunk).filter(AiProjectWikiChunk.project_id == proj.id).all()
        assert all(c.embedding_model == "openai:text-embedding-3-small" for c in chunks)


def test_docs_collab_bridge_fallback_and_roundtrip(
    db: Session, tmp_path: Path, monkeypatch
):
    monkeypatch.setattr("config.settings.servers_dir", str(tmp_path))
    user, _, _ = _create_user_with_perms(
        db, extra_perms=("ai.projects.wiki", "docs.use")
    )
    proj = ai_project_service.create_project(db, user, name="CollabWikiRepo")
    ai_project_wiki_service.update_wiki_settings(db, user, proj.id, wiki_enabled=True)

    with patch("services.ai_embedding_service.encode", side_effect=_mock_encode_factory()):
        ai_project_wiki_service.upsert_wiki_page(
            db,
            user,
            proj.id,
            slug="overview",
            title="Projektueberblick",
            category="overview",
            summary="Startseite",
            markdown="# Start\n\nInitialer Inhalt.",
        )

        # Fallback auf Markdown wenn docs-sidecar aus ist
        with patch("services.docs_collab_service.DocsCollabService.module_enabled", return_value=False):
            res_off = ai_project_wiki_service.open_page_doc(db, user, proj.id, "overview")
            assert res_off["mode"] == "markdown"
            assert res_off["doc_uid"] is None

        # Sidecar-Fehler beim Initialisieren raeumt das Temp-Dokument sauber auf
        from fastapi import HTTPException

        with (
            patch("services.docs_collab_service.DocsCollabService.module_enabled", return_value=True),
            patch(
                "services.docs_collab_service.DocsCollabService.ai_edit",
                side_effect=HTTPException(status_code=503, detail="sidecar offline"),
            ),
        ):
            failed_open = ai_project_wiki_service.open_page_doc(db, user, proj.id, "overview")
            assert failed_open["mode"] == "markdown"
            assert failed_open["doc_uid"] is None

        # Aktiver Docs-Sidecar: Dokument verknuepfen, laden und Aenderung ins Wiki uebernehmen
        with (
            patch("services.docs_collab_service.DocsCollabService.module_enabled", return_value=True),
            patch("services.docs_collab_service.DocsCollabService.ai_edit", return_value={"ok": True}) as mock_ai_edit,
            patch(
                "services.docs_collab_service.DocsCollabService.render",
                return_value=(b"# Start\n\nGemeinsam bearbeiteter Inhalt.", "text/markdown", "wiki.md"),
            ),
        ):
            opened = ai_project_wiki_service.open_page_doc(db, user, proj.id, "overview")
            assert opened["mode"] == "docs"
            assert opened["doc_uid"]
            assert mock_ai_edit.call_count == 1

            synced = ai_project_wiki_service.sync_page_from_doc(db, user, proj.id, "overview")
            assert "Gemeinsam bearbeiteter Inhalt." in synced["content_markdown"]


def test_project_tools_context_and_worker_auto_update_debounce(
    db: Session, tmp_path: Path, monkeypatch
):
    monkeypatch.setattr("config.settings.servers_dir", str(tmp_path))
    ai_project_wiki_service._LAST_AUTO_UPDATE.clear()
    user, _, _ = _create_user_with_perms(
        db, extra_perms=("ai.projects.wiki", "ai.background.use")
    )
    proj = ai_project_service.create_project(db, user, name="AgentWikiRepo")

    # Solange wiki_enabled False ist, blockt project_workspace(action='wiki_upsert') das Umgehen des Opt-ins
    try:
        projekt_werkzeug(
            db,
            user=user,
            arguments={
                "action": "wiki_upsert",
                "project_id": proj.id,
                "slug": "blocked",
                "title": "Blocked",
                "content": "Should not bypass opt-in",
            },
        )
        bypassed = False
    except AiActionValidationError:
        bypassed = True
    assert bypassed is True

    ai_project_wiki_service.update_wiki_settings(
        db, user, proj.id, wiki_enabled=True, wiki_auto_update=True
    )

    with patch("services.ai_embedding_service.encode", side_effect=_mock_encode_factory()):
        upsert_res = projekt_werkzeug(
            db,
            user=user,
            arguments={
                "action": "wiki_upsert",
                "project_id": proj.id,
                "slug": "api-routes",
                "title": "API Endpunkte",
                "category": "api",
                "summary": "REST Endpunkte mit FastAPI",
                "content": "# API\n\nFastAPI router endpoints handle project operations.",
                "source_files": ["backend/routers/ai_projects.py"],
            },
        )
        assert upsert_res["slug"] == "api-routes"

        read_res = projekt_werkzeug(
            db,
            user=user,
            arguments={"action": "wiki_read", "project_id": proj.id, "slug": "api-routes"},
        )
        assert read_res["title"] == "API Endpunkte"

        search_res = projekt_werkzeug(
            db,
            user=user,
            arguments={"action": "wiki_search", "project_id": proj.id, "query": "fastapi api endpoint"},
        )
        assert len(search_res["hits"]) >= 1
        assert search_res["hits"][0]["slug"] == "api-routes"

        # Kontext-Injektion liefert Knowledge-Card-Uebersicht + semantische Treffer
        ctx = ai_project_wiki_service.build_project_wiki_context(
            db, user, proj, "fastapi api endpoint"
        )
        assert ctx is not None
        assert "api-routes" in ctx
        assert "FastAPI router endpoints" in ctx

        # Auto-Update Debounce nach write_file (nach Ablauf des Cooldowns)
        proj.wiki_last_updated_at = None
        db.commit()
        with patch(
            "services.ai_worker_service.worker_start",
            return_value={"started": True, "job_id": "job-wiki-1"},
        ) as mock_worker:
            projekt_werkzeug(
                db,
                user=user,
                arguments={
                    "action": "write_file",
                    "project_id": proj.id,
                    "path": "backend/main.py",
                    "content": "print('hello')",
                },
            )
            assert mock_worker.call_count == 1
            assert mock_worker.call_args.kwargs.get("project_id") == proj.id

            # Zweites write_file innerhalb des Debounce-Fensters startet keinen zweiten Worker
            projekt_werkzeug(
                db,
                user=user,
                arguments={
                    "action": "write_file",
                    "project_id": proj.id,
                    "path": "backend/other.py",
                    "content": "print('world')",
                },
            )
            assert mock_worker.call_count == 1

            # Schreiben direkt in .singra/wiki/* loest keine Auto-Update-Endlosschleife aus
            ai_project_wiki_service._LAST_AUTO_UPDATE.clear()
            proj.wiki_last_updated_at = None
            db.commit()
            projekt_werkzeug(
                db,
                user=user,
                arguments={
                    "action": "write_file",
                    "project_id": proj.id,
                    "path": ".singra/wiki/notes.md",
                    "content": "# Notes",
                },
            )
            assert mock_worker.call_count == 1

    # Worker-Nachbereitung setzt wiki_status sauber auf error bzw. idle
    conv = AiConversation(
        id=str(uuid4()),
        user_id=user.id,
        title="Wiki aufbauen",
        kind="worker",
        project_id=proj.id,
    )
    db.add(conv)
    db.flush()
    run = AiRun(
        id=str(uuid4()),
        conversation_id=conv.id,
        user_id=user.id,
        status="failed",
    )
    db.add(run)
    proj.wiki_status = "generating"
    db.commit()

    ai_project_wiki_service.on_worker_finished(db, run, {"fehler": "Provider Timeout"})
    db.refresh(proj)
    assert proj.wiki_status == "error"
    assert proj.wiki_last_error == "Provider Timeout"

    run.status = "completed"
    proj.wiki_status = "updating"
    db.commit()
    ai_project_wiki_service.on_worker_finished(db, run, {})
    db.refresh(proj)
    assert proj.wiki_status == "idle"
    assert proj.wiki_last_error is None
