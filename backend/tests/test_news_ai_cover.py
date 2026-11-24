"""Tests fuer Singra-News-Titelbilder (URL/SSRF + Spiel-Artwork) und Standard-Autor."""

from __future__ import annotations

import io
import socket

import httpx
import pytest
from PIL import Image
from sqlalchemy.orm import Session

from models import NewsPost, User
from services import news_service, wallpaper_service
from services.ai_action_errors import AiActionValidationError
from services.ai_proposal_service import _AusfuehrungsRahmen
from services.ai_proposals.task_proposals import (
    _ausfuehren_news_upsert,
    _news_upsert_payload,
)


def _png_bytes(width: int = 32, height: int = 24) -> bytes:
    buf = io.BytesIO()
    img = Image.new("RGB", (width, height), color=(36, 140, 200))
    img.save(buf, format="PNG")
    return buf.getvalue()


def _rahmen(payload: dict, user: User) -> _AusfuehrungsRahmen:
    return _AusfuehrungsRahmen(
        payload=payload,
        server_id=None,
        active_user=user,
        correlation_id="corr_news_cover_test",
        expected_revision=None,
        row_id="prop_news_cover_test",
        guardian=None,
        tool_name="propose_news_upsert",
    )


def test_default_author_singra_ai_und_ssrf_cover_validierung(
    db: Session,
    owner_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload, preview = _news_upsert_payload(
        db,
        owner_user,
        {
            "title": "Palworld Update 0.5",
            "summary": "Kurzer Ueberblick",
            "content_markdown": "Alle Details.",
            "category": "game_update",
        },
    )
    assert payload["author_display_name"] == "Singra AI"
    assert preview["author_display_name"] == "Singra AI"

    res = _ausfuehren_news_upsert(db, _rahmen(payload, owner_user))
    assert res.result["author_display_name"] == "Singra AI"
    post = db.get(NewsPost, res.result["post_id"])
    assert post is not None
    assert post.author_display_name == "Singra AI"

    # Unsichere und private/SSRF-Ziele muessen abgelehnt werden
    for ungueltig in (
        "http://cdn.example.org/hero.png",
        "https://localhost/hero.png",
        "https://127.0.0.1/hero.png",
        "https://169.254.169.254/latest/meta-data",
        "https://10.0.0.5/hero.png",
        "https://user:pass@cdn.example.org/hero.png",
    ):
        with pytest.raises(AiActionValidationError):
            _news_upsert_payload(
                db,
                owner_user,
                {
                    "title": "Bad Cover",
                    "content_markdown": "Text",
                    "cover_image_url": ungueltig,
                },
            )

    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_a, **_kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("127.0.0.1", 0))],
    )
    with pytest.raises(AiActionValidationError):
        _news_upsert_payload(
            db,
            owner_user,
            {
                "title": "DNS Rebind",
                "content_markdown": "Text",
                "cover_image_url": "https://rebind.example.org/hero.png",
            },
        )


def test_propose_news_upsert_cover_url_download_und_entfernen(
    db: Session,
    owner_user: User,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(news_service, "covers_dir", lambda: tmp_path / "news-covers")
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_a, **_kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))],
    )

    class _FakeResp:
        def __init__(self, *, status_code=200, content=b"", headers=None, is_redirect=False):
            self.status_code = status_code
            self.content = content
            self.headers = headers or {}
            self.is_redirect = is_redirect

    class _FakeClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def get(self, _url, **_kwargs):
            return _FakeResp(
                status_code=200,
                content=_png_bytes(),
                headers={"content-type": "image/png"},
            )

    monkeypatch.setattr(httpx, "Client", _FakeClient)

    payload, preview = _news_upsert_payload(
        db,
        owner_user,
        {
            "title": "Patch mit Cover",
            "content_markdown": "Inhalt mit Bild.",
            "cover_image_url": "https://cdn.example.org/patch.png?size=large",
            "is_pinned": True,
        },
    )
    assert preview["has_cover_change"] is True

    res = _ausfuehren_news_upsert(db, _rahmen(payload, owner_user))
    assert res.result["created"] is True
    assert res.result["cover_url"] is True
    post = db.get(NewsPost, res.result["post_id"])
    assert post is not None
    assert post.is_pinned is True
    assert post.cover_image_filename and post.cover_image_filename.endswith(".webp")

    # Titelbild ueber remove_cover wieder entfernen
    del_payload, del_preview = _news_upsert_payload(
        db,
        owner_user,
        {"post_id": post.id, "remove_cover": True},
    )
    assert del_preview["has_cover_change"] is True
    del_res = _ausfuehren_news_upsert(db, _rahmen(del_payload, owner_user))
    assert del_res.result["cover_url"] is False


def test_propose_news_upsert_cover_download_fehler_rettet_entwurf_und_spiel_fallback(
    db: Session,
    owner_user: User,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path,
) -> None:
    monkeypatch.setattr(news_service, "covers_dir", lambda: tmp_path / "news-covers")
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_a, **_kw: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 0))],
    )

    class _FailClient:
        def __init__(self, **_kwargs):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def get(self, _url, **_kwargs):
            raise httpx.ConnectError("offline")

    monkeypatch.setattr(httpx, "Client", _FailClient)

    fail_payload, _ = _news_upsert_payload(
        db,
        owner_user,
        {
            "title": "Entwurf trotz Bildfehler",
            "content_markdown": "Text bleibt gespeichert.",
            "cover_image_url": "https://cdn.example.org/broken.png",
        },
    )
    fail_res = _ausfuehren_news_upsert(db, _rahmen(fail_payload, owner_user))
    assert fail_res.result["created"] is True
    assert fail_res.result["cover_url"] is False
    assert "cover_error" in fail_res.result

    # Spiel-Artwork-Fallback ueber related_game_type
    artwork_file = tmp_path / "steam_palworld.png"
    artwork_file.write_bytes(_png_bytes(48, 32))
    monkeypatch.setattr(wallpaper_service, "_blueprint_for_game_type", lambda _gt: object())
    monkeypatch.setattr(wallpaper_service, "artwork_app_id_for_blueprint", lambda _bp: "1623730")
    monkeypatch.setattr(wallpaper_service, "ensure_steam_cached", lambda _app_id: artwork_file)

    game_payload, _ = _news_upsert_payload(
        db,
        owner_user,
        {
            "title": "Palworld Wochenbericht",
            "content_markdown": "Neuer Patch.",
            "category": "game_update",
            "related_game_type": "palworld",
        },
    )
    game_res = _ausfuehren_news_upsert(db, _rahmen(game_payload, owner_user))
    assert game_res.result["cover_url"] is True
    post = db.get(NewsPost, game_res.result["post_id"])
    assert post is not None
    assert post.cover_image_filename is not None
