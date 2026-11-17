"""Tests fuer die Wallpaper-Endpoints (routers/servers.py)."""

from __future__ import annotations

import io

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from config import settings
from models import AuditLog, Server, ServerPermission, User
from services import wallpaper_service as ws


def _jpeg_bytes() -> bytes:
    img = Image.new("RGB", (64, 64), color=(10, 60, 120))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def kein_steam_netz(monkeypatch):
    """Router-Tests laufen offline — Steam-Fetch ist Service-Sache."""
    monkeypatch.setattr(ws, "fetch_steam_artwork", lambda app_id: None)


@pytest.fixture
def wallpaper_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "wallpaper_dir", str(tmp_path / "wallpapers"))
    monkeypatch.setattr(settings, "steam_wallpaper_cache_dir", str(tmp_path / "steam"))
    return tmp_path


def _nur_sehen(db: Session, user: User, server: Server) -> None:
    db.add(ServerPermission(user_id=user.id, server_id=server.id, permission_key="server.view"))
    db.commit()


def _upload(client: TestClient, server_id: int, cookies: dict, csrf: str, payload: bytes = None):
    return client.post(
        f"/api/servers/{server_id}/wallpaper",
        files={"file": ("bild.jpg", payload if payload is not None else _jpeg_bytes(), "image/jpeg")},
        cookies=cookies,
        headers={"X-CSRF-Token": csrf},
    )


class TestUpload:
    def test_owner_upload_wird_aktiv(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        resp = _upload(client, test_server.id, owner_cookies, csrf_token)
        assert resp.status_code == 200
        body = resp.json()
        assert body["game_type"] == "dayz"
        assert body["is_active"] is True

        bild = client.get(f"/api/servers/{test_server.id}/wallpaper", cookies=owner_cookies)
        assert bild.status_code == 200
        assert bild.headers["content-type"] == "image/webp"
        assert bild.headers["x-content-type-options"] == "nosniff"
        assert bild.headers["cache-control"] == "private, max-age=86400"
        assert bild.content.startswith(b"RIFF")

        detail = client.get(f"/api/servers/{test_server.id}", cookies=owner_cookies).json()
        assert detail["has_custom_wallpaper"] is True
        assert detail["wallpaper_source"] == "custom"
        assert detail["wallpaper_url"] == f"/api/servers/{test_server.id}/wallpaper"

    def test_detail_ohne_custom_zeigt_steam(
        self, client, owner_cookies, test_server, wallpaper_dirs
    ):
        detail = client.get(f"/api/servers/{test_server.id}", cookies=owner_cookies).json()
        assert detail["has_custom_wallpaper"] is False
        assert detail["wallpaper_source"] == "steam"
        assert detail["wallpaper_url"] == f"/api/servers/{test_server.id}/wallpaper"

    def test_svg_wird_400_und_alt_bleibt(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        first = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        bad = _upload(
            client, test_server.id, owner_cookies, csrf_token,
            b'<svg xmlns="http://x"></svg>' + b" " * 16,
        )
        assert bad.status_code == 400
        galerie = client.get(
            f"/api/servers/{test_server.id}/wallpaper/gallery", cookies=owner_cookies
        ).json()
        assert [g["id"] for g in galerie] == [first]
        assert galerie[0]["is_active"] is True

    def test_zu_gross_wird_400(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        resp = _upload(
            client, test_server.id, owner_cookies, csrf_token,
            b"\xff\xd8\xff" + b"\x00" * (ws.MAX_WALLPAPER_BYTES + 1),
        )
        assert resp.status_code == 400

    def test_ohne_csrf_403(
        self, client, owner_cookies, test_server, wallpaper_dirs
    ):
        resp = client.post(
            f"/api/servers/{test_server.id}/wallpaper",
            files={"file": ("b.jpg", _jpeg_bytes(), "image/jpeg")},
            cookies=owner_cookies,
        )
        assert resp.status_code == 403

    def test_gleiches_spiel_teilt_bild(
        self, client, db, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        _upload(client, test_server.id, owner_cookies, csrf_token)
        zweiter = Server(name="Zweiter", game_type="dayz", install_dir="/tmp/z")
        db.add(zweiter)
        db.commit()
        db.refresh(zweiter)
        bild = client.get(f"/api/servers/{zweiter.id}/wallpaper", cookies=owner_cookies)
        assert bild.status_code == 200

    def test_upload_schreibt_audit(
        self, client, db, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        _upload(client, test_server.id, owner_cookies, csrf_token)
        eintrag = (
            db.query(AuditLog)
            .filter(AuditLog.action == "server.wallpaper.upload")
            .order_by(AuditLog.id.desc())
            .first()
        )
        assert eintrag is not None
        assert eintrag.target_id == str(test_server.id)


class TestRechte:
    def test_ohne_sicht_404(
        self, client, regular_user, user_cookies, user_csrf_token, test_server, wallpaper_dirs
    ):
        assert (
            client.get(f"/api/servers/{test_server.id}/wallpaper", cookies=user_cookies).status_code
            == 404
        )
        assert (
            _upload(client, test_server.id, user_cookies, user_csrf_token).status_code == 404
        )

    def test_nur_sehen_darf_lesen_aber_nicht_schreiben(
        self, client, db, regular_user, user_cookies, user_csrf_token,
        test_server, owner_cookies, csrf_token, wallpaper_dirs,
    ):
        _nur_sehen(db, regular_user, test_server)
        _upload(client, test_server.id, owner_cookies, csrf_token)
        assert (
            client.get(f"/api/servers/{test_server.id}/wallpaper", cookies=user_cookies).status_code
            == 200
        )
        assert (
            client.get(f"/api/servers/{test_server.id}/wallpaper/gallery", cookies=user_cookies).status_code
            == 200
        )
        assert (
            _upload(client, test_server.id, user_cookies, user_csrf_token).status_code == 403
        )
        assert (
            client.delete(
                f"/api/servers/{test_server.id}/wallpaper",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
            ).status_code
            == 403
        )

    def test_voll_delegiert_darf_upload(
        self, client, regular_user, user_cookies, user_csrf_token,
        test_server, user_permission, wallpaper_dirs,
    ):
        assert _upload(client, test_server.id, user_cookies, user_csrf_token).status_code == 200


class TestGalerieReset:
    def test_reaktivieren_wechselt_aktiv(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        first = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        _upload(client, test_server.id, owner_cookies, csrf_token)
        resp = client.post(
            f"/api/servers/{test_server.id}/wallpaper/{first}/activate",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert resp.status_code == 200
        galerie = client.get(
            f"/api/servers/{test_server.id}/wallpaper/gallery", cookies=owner_cookies
        ).json()
        aktiv = [g for g in galerie if g["is_active"]]
        assert len(aktiv) == 1 and aktiv[0]["id"] == first

    def test_aktivieren_fremder_id_404(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        resp = client.post(
            f"/api/servers/{test_server.id}/wallpaper/9999/activate",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert resp.status_code == 404

    def test_reset_stellt_steam_wieder_her(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        _upload(client, test_server.id, owner_cookies, csrf_token)
        resp = client.delete(
            f"/api/servers/{test_server.id}/wallpaper",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert resp.status_code == 200
        detail = client.get(f"/api/servers/{test_server.id}", cookies=owner_cookies).json()
        assert detail["has_custom_wallpaper"] is False
        assert detail["wallpaper_source"] == "steam"
        # Galerie behält die Datei:
        galerie = client.get(
            f"/api/servers/{test_server.id}/wallpaper/gallery", cookies=owner_cookies
        ).json()
        assert len(galerie) == 1
        assert galerie[0]["is_active"] is False

    def test_leere_galerie(self, client, owner_cookies, test_server, wallpaper_dirs):
        galerie = client.get(
            f"/api/servers/{test_server.id}/wallpaper/gallery", cookies=owner_cookies
        ).json()
        assert galerie == []

    def test_galerie_einzelbild(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        bild_id = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        resp = client.get(
            f"/api/servers/{test_server.id}/wallpaper/gallery/{bild_id}/image",
            cookies=owner_cookies,
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/webp"
        assert resp.content.startswith(b"RIFF")
        fehlt = client.get(
            f"/api/servers/{test_server.id}/wallpaper/gallery/9999/image",
            cookies=owner_cookies,
        )
        assert fehlt.status_code == 404
