from __future__ import annotations

import io
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from config import settings
from models import NewsPost, Role, RolePermission, User, UserRole
from services import ai_tool_registry
from services.ai_action_errors import AiActionValidationError
from services.ai_action_service import _execute_global_read_tool
from services.ai_proposal_service import _AusfuehrungsRahmen
from services.ai_proposals.task_proposals import (
    _ausfuehren_news_upsert,
    _news_upsert_payload,
)
from services.dis_client import DisClient
from services.news_service import covers_dir


def _png_bytes(width: int = 32, height: int = 24) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(24, 118, 210))
    img.save(buf, format="PNG")
    return buf.getvalue()


def _rahmen(payload: dict, user: User) -> _AusfuehrungsRahmen:
    return _AusfuehrungsRahmen(
        payload=payload,
        server_id=None,
        active_user=user,
        correlation_id="corr_news_test",
        expected_revision=None,
        row_id="prop_news_test",
        guardian=None,
        tool_name="propose_news_upsert",
    )


def _create_user_with_permissions(
    db: Session,
    *,
    username: str,
    email: str,
    permissions: tuple[str, ...],
) -> User:
    user = User(
        username=username,
        email=email,
        password_hash=DisClient.hash_password("TestPasswort123!"),
        is_owner=False,
        email_verified=True,
    )
    db.add(user)
    db.flush()

    if permissions:
        role = Role(name=f"role_{username}", is_system=False)
        db.add(role)
        db.flush()
        for key in permissions:
            db.add(RolePermission(role_id=role.id, permission_key=key))
        db.add(UserRole(user_id=user.id, role_id=role.id))

    db.commit()
    db.refresh(user)
    return user


def _login(client: TestClient, username: str, password: str = "TestPasswort123!") -> tuple[dict, str]:
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return dict(resp.cookies), resp.cookies.get("__Secure-csrf_token", "")


def test_news_crud_draft_protection_filters_and_slug_collisions(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    db: Session,
):
    headers = {"X-CSRF-Token": csrf_token}

    # Anfangs leer
    empty = client.get("/api/news")
    assert empty.status_code == 200
    assert empty.json() == {"items": [], "total": 0}
    summary = client.get("/api/news/summary")
    assert summary.status_code == 200
    assert summary.json()["published_count"] == 0

    # Entwurf anlegen (Umlaute werden sauber in Slug ueberfuehrt)
    draft_resp = client.post(
        "/api/news/admin",
        json={
            "title": "Großes Palworld Update für März",
            "summary": "Kurzinfo zum Entwurf.",
            "content_markdown": "## Details\nDer Patch bringt neue Reittiere.",
            "category": "game_update",
            "related_game_type": "palworld",
            "sources": [{"title": "Offizielle Patchnotes", "url": "https://example.com/patch"}],
            "is_published": False,
        },
        cookies=owner_cookies,
        headers=headers,
    )
    assert draft_resp.status_code == 201, draft_resp.text
    draft = draft_resp.json()
    assert draft["slug"] == "grosses-palworld-update-fuer-maerz"
    assert draft["is_published"] is False

    # Oeffentlich weiterhin unsichtbar (404 + nicht in Liste)
    assert client.get("/api/news").json()["total"] == 0
    assert client.get(f"/api/news/{draft['slug']}").status_code == 404

    # Zweiter Beitrag mit demselben Titel bekommt eindeutigen -2 Slug und ist gepinnt + live
    pub_resp = client.post(
        "/api/news/admin",
        json={
            "title": "Großes Palworld Update für März",
            "summary": "Live-Version mit Quelle.",
            "content_markdown": "Alle Server lassen sich direkt umstellen.",
            "category": "game_update",
            "related_game_type": "palworld",
            "sources": [{"title": "Release Notes", "url": "https://example.com/live"}],
            "is_published": True,
            "is_pinned": True,
        },
        cookies=owner_cookies,
        headers=headers,
    )
    assert pub_resp.status_code == 201
    pub = pub_resp.json()
    assert pub["slug"] == "grosses-palworld-update-fuer-maerz-2"
    assert pub["is_published"] is True
    assert pub["is_pinned"] is True
    assert pub["published_at"] is not None

    # Zukunftsbeitrag bleibt oeffentlich verborgen
    future_resp = client.post(
        "/api/news/admin",
        json={
            "title": "Geplante Wartung nächste Woche",
            "content_markdown": "Folgt in Kürze.",
            "category": "maintenance",
            "is_published": True,
            "published_at": (datetime.now(timezone.utc) + timedelta(days=2)).isoformat(),
        },
        cookies=owner_cookies,
        headers=headers,
    )
    assert future_resp.status_code == 201
    future = future_resp.json()
    assert client.get(f"/api/news/{future['slug']}").status_code == 404

    # Zweiter veroeffentlichter Beitrag (welt-news, nicht angepinnt)
    world_resp = client.post(
        "/api/news/admin",
        json={
            "title": "Hardware-Markt: Neue EPYC-Generation",
            "summary": "Überblick zu aktuellen Server-CPUs.",
            "content_markdown": "Mehr Kerne pro Node senken den Strombedarf.",
            "category": "world_news",
            "sources": [{"title": "Hardware-Bericht", "url": "https://example.org/epyc"}],
            "is_published": True,
            "is_pinned": False,
        },
        cookies=owner_cookies,
        headers=headers,
    )
    assert world_resp.status_code == 201

    # Liste zeigt nur 2 veroeffentlichte, angepinnt zuerst, keine internen User-IDs/E-Mails
    list_resp = client.get("/api/news")
    assert list_resp.status_code == 200
    body = list_resp.json()
    assert body["total"] == 2
    assert [item["slug"] for item in body["items"]] == [
        "grosses-palworld-update-fuer-maerz-2",
        "hardware-markt-neue-epyc-generation",
    ]
    assert "author_user_id" not in body["items"][0]
    assert "@" not in str(body["items"][0])

    # Filter nach game_type, category und Suche q
    assert client.get("/api/news?game_type=palworld").json()["total"] == 1
    assert client.get("/api/news?category=world_news").json()["total"] == 1
    assert client.get("/api/news?q=EPYC").json()["total"] == 1
    assert client.get("/api/news/summary").json()["published_count"] == 2

    # Loeschen des Entwurfs funktioniert
    del_resp = client.delete(f"/api/news/admin/{draft['id']}", cookies=owner_cookies, headers=headers)
    assert del_resp.status_code == 204


def test_news_rejects_non_https_sources(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
):
    headers = {"X-CSRF-Token": csrf_token}
    for bad_url in ("http://insecure.example.com", "javascript:alert(1)", "not-a-url"):
        resp = client.post(
            "/api/news/admin",
            json={
                "title": "Ungültige Quelle",
                "content_markdown": "Inhalt",
                "sources": [{"title": "Quelle", "url": bad_url}],
            },
            cookies=owner_cookies,
            headers=headers,
        )
        assert resp.status_code == 422


def test_news_cover_upload_webp_cache_and_draft_isolation(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    tmp_path,
    monkeypatch,
):
    monkeypatch.setattr(settings, "news_covers_dir", str(tmp_path / "news-covers"))
    headers = {"X-CSRF-Token": csrf_token}

    created = client.post(
        "/api/news/admin",
        json={
            "title": "Artikel mit Titelbild",
            "content_markdown": "Text mit Cover.",
            "is_published": False,
        },
        cookies=owner_cookies,
        headers=headers,
    ).json()

    # Ungueltige Bildbytes abweisen
    bad = client.post(
        f"/api/news/admin/{created['id']}/cover",
        files={"file": ("evil.svg", b"<svg onload=alert(1)></svg>", "image/svg+xml")},
        cookies=owner_cookies,
        headers=headers,
    )
    assert bad.status_code == 400

    # Gueltiges PNG -> als WebP sanitisiert speichern
    ok = client.post(
        f"/api/news/admin/{created['id']}/cover",
        files={"file": ("cover.png", _png_bytes(), "image/png")},
        cookies=owner_cookies,
        headers=headers,
    )
    assert ok.status_code == 200
    data = ok.json()
    assert data["cover_version"]
    assert data["cover_url"] == f"/api/news/admin/{created['id']}/cover?v={data['cover_version']}"

    # Entwurf: oeffentlicher Cover-Endpunkt muss 404 liefern, Admin-Endpunkt 200
    assert client.get(f"/api/news/{created['slug']}/cover").status_code == 404
    admin_img = client.get(data["cover_url"], cookies=owner_cookies)
    assert admin_img.status_code == 200
    assert admin_img.headers["content-type"] == "image/webp"

    # Veroeffentlichen -> Admin behaelt admin-Cover-URL, oeffentlicher Detail-Endpunkt nutzt Slug-Cover-URL
    pub_admin = client.put(
        f"/api/news/admin/{created['id']}",
        json={"is_published": True},
        cookies=owner_cookies,
        headers=headers,
    ).json()
    assert pub_admin["cover_url"] == f"/api/news/admin/{created['id']}/cover?v={data['cover_version']}"
    pub = client.get(f"/api/news/{created['slug']}").json()
    assert pub["cover_url"] == f"/api/news/{created['slug']}/cover?v={data['cover_version']}"

    pub_img = client.get(pub["cover_url"])
    assert pub_img.status_code == 200
    assert "immutable" in pub_img.headers["cache-control"]
    etag = pub_img.headers["etag"]

    not_mod = client.get(pub["cover_url"], headers={"If-None-Match": etag})
    assert not_mod.status_code == 304

    no_v_img = client.get(f"/api/news/{created['slug']}/cover")
    assert "no-cache" in no_v_img.headers["cache-control"]

    # Cover loeschen entfernt Datei
    cover_files_before = list(covers_dir().glob("*.webp"))
    assert len(cover_files_before) == 1
    del_cov = client.delete(f"/api/news/admin/{created['id']}/cover", cookies=owner_cookies, headers=headers)
    assert del_cov.status_code == 200
    assert del_cov.json()["cover_url"] is None
    assert list(covers_dir().glob("*.webp")) == []


def test_news_rbac_blocks_unprivileged_and_allows_panel_news_manage(
    client: TestClient,
    db: Session,
):
    plain = _create_user_with_permissions(
        db, username="plainnewsuser", email="plainnews@example.com", permissions=()
    )
    editor = _create_user_with_permissions(
        db, username="newseditor", email="editor@example.com", permissions=("panel.news.manage",)
    )

    plain_cookies, plain_csrf = _login(client, plain.username)
    assert client.get("/api/news/admin/list", cookies=plain_cookies).status_code == 403
    assert (
        client.post(
            "/api/news/admin",
            json={"title": "Verboten", "content_markdown": "Nein"},
            cookies=plain_cookies,
            headers={"X-CSRF-Token": plain_csrf},
        ).status_code
        == 403
    )

    ed_cookies, ed_csrf = _login(client, editor.username)
    created = client.post(
        "/api/news/admin",
        json={"title": "Redaktionsbeitrag", "content_markdown": "Erlaubt"},
        cookies=ed_cookies,
        headers={"X-CSRF-Token": ed_csrf},
    )
    assert created.status_code == 201


def test_ai_news_tools_read_draft_vs_publish_confirmation(
    db: Session,
    owner_user: User,
):
    plain = _create_user_with_permissions(
        db, username="ainewsdenied", email="ainewsdenied@example.com", permissions=("ai.chat.use",)
    )

    # Ohne Recht kein Lesen und kein Payload-Bau
    with pytest.raises(AiActionValidationError, match="nicht erlaubt"):
        _execute_global_read_tool(db, user=plain, tool_name="news_read", arguments={})

    # Entwurf per AI-Vorschlag: kein always_confirm (kann autonom in Aufgaben laufen)
    payload_draft, preview_draft = _news_upsert_payload(
        db,
        owner_user,
        {
            "title": "KI-Kuration: Minecraft 1.21.5 erschienen",
            "summary": "Zusammenfassung mit realer Quelle.",
            "content_markdown": "## Neuerungen\nAlle Details im verlinkten Changelog.",
            "category": "world_news",
            "related_game_type": "minecraft",
            "sources": [{"title": "Minecraft Changelog", "url": "https://www.minecraft.net/en-us/article/1-21-5"}],
        },
    )
    assert payload_draft["is_published"] is False
    assert "always_confirm" not in preview_draft
    assert ai_tool_registry.verlangt_klick("propose_news_upsert", preview_draft) is False

    exec_res = _ausfuehren_news_upsert(db, _rahmen(payload_draft, owner_user))
    assert exec_res.result["created"] is True
    assert exec_res.result["is_published"] is False
    post_id = exec_res.result["post_id"]

    # news_read findet den Entwurf samt post_id und Quellen
    read_res = _execute_global_read_tool(
        db, user=owner_user, tool_name="news_read", arguments={"category": "world_news"}
    )
    assert read_res["count"] == 1
    assert read_res["posts"][0]["post_id"] == post_id
    assert read_res["posts"][0]["sources"][0]["url"] == "https://www.minecraft.net/en-us/article/1-21-5"

    # Veroeffentlichen ueber propose_news_upsert verlangt zwingend Klick-Bestaetigung
    payload_pub, preview_pub = _news_upsert_payload(
        db,
        owner_user,
        {"post_id": post_id, "is_published": True},
    )
    assert preview_pub["operation"] == "news_update"
    assert preview_pub["always_confirm"] is True
    assert ai_tool_registry.verlangt_klick("propose_news_upsert", preview_pub) is True

    # Nicht-HTTPS Quellen werden im Payload abgelehnt
    with pytest.raises(AiActionValidationError, match="https://"):
        _news_upsert_payload(
            db,
            owner_user,
            {
                "title": "Unsichere Quelle",
                "content_markdown": "Text",
                "sources": [{"title": "HTTP", "url": "http://example.com"}],
            },
        )
