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


def _jpeg_bytes(color: tuple[int, int, int] = (10, 60, 120)) -> bytes:
    img = Image.new("RGB", (64, 64), color=color)
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
        assert bild.headers["cache-control"] == "private, no-cache"
        assert bild.headers["etag"].startswith('"custom-')
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


class TestETag:
    """Web und MSS fragen bei jedem Aufruf an — 304 ohne Bytes, solange
    sich nichts geaendert hat, frische Bytes bei neuem ETag."""

    def _bild(self, client, server_id, cookies, etag=None):
        headers = {"If-None-Match": etag} if etag else {}
        return client.get(
            f"/api/servers/{server_id}/wallpaper", cookies=cookies, headers=headers
        )

    def test_gleicher_etag_gibt_304_ohne_bytes(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        _upload(client, test_server.id, owner_cookies, csrf_token)
        erste = self._bild(client, test_server.id, owner_cookies)
        assert erste.status_code == 200
        etag = erste.headers["etag"]
        zweite = self._bild(client, test_server.id, owner_cookies, etag)
        assert zweite.status_code == 304
        assert zweite.content == b""

    def test_neuer_upload_wechselt_etag(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        _upload(client, test_server.id, owner_cookies, csrf_token)
        alt = self._bild(client, test_server.id, owner_cookies).headers["etag"]
        _upload(client, test_server.id, owner_cookies, csrf_token)
        neu = self._bild(client, test_server.id, owner_cookies).headers["etag"]
        assert neu != alt
        # Der alte ETag liefert wieder volle Bytes (kein 304):
        assert self._bild(client, test_server.id, owner_cookies, alt).status_code == 200

    def test_reaktivieren_wechselt_etag_zurueck(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        erste = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        _upload(client, test_server.id, owner_cookies, csrf_token)
        etag_erste = self._bild(client, test_server.id, owner_cookies).headers["etag"]
        client.post(
            f"/api/servers/{test_server.id}/wallpaper/{erste}/activate",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        etag_reaktiviert = self._bild(client, test_server.id, owner_cookies).headers["etag"]
        assert etag_reaktiviert != etag_erste
        assert etag_reaktiviert == f'"custom-{erste}"'

    def test_steam_cache_hat_eigenen_etag(
        self, client, db, owner_cookies, test_server, wallpaper_dirs
    ):
        desk = ws.resolve_wallpaper(db, test_server)
        assert desk.source == "steam" and desk.app_id is not None
        (wallpaper_dirs / "steam").mkdir(parents=True, exist_ok=True)
        (wallpaper_dirs / "steam" / f"{desk.app_id}.webp").write_bytes(
            ws.sanitize_and_compress_wallpaper(_jpeg_bytes())
        )
        erste = self._bild(client, test_server.id, owner_cookies)
        assert erste.status_code == 200
        assert erste.headers["etag"] == f'"steam-{desk.app_id}"'
        assert (
            self._bild(client, test_server.id, owner_cookies, erste.headers["etag"]).status_code
            == 304
        )


class TestVersionierteUrl:
    """`?v=` adressiert Inhalt, nicht Stand: immutable, ohne jede Anfrage
    aus dem Cache malbar — und eine alte Version liefert alte Bytes."""

    def test_detail_und_liste_nennen_version(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        bild_id = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        detail = client.get(f"/api/servers/{test_server.id}", cookies=owner_cookies).json()
        assert detail["wallpaper_version"] == f"custom-{bild_id}"
        liste = client.get("/api/servers", cookies=owner_cookies).json()
        eintrag = next(s for s in liste if s["id"] == test_server.id)
        assert eintrag["wallpaper_version"] == f"custom-{bild_id}"

    def test_steam_und_panorama_version(
        self, client, db, owner_cookies, test_server, wallpaper_dirs
    ):
        detail = client.get(f"/api/servers/{test_server.id}", cookies=owner_cookies).json()
        assert detail["wallpaper_version"].startswith("steam-")
        fremd = Server(name="Fremd", game_type="spiel_ohne_blueprint_xyz", install_dir="/tmp/f")
        db.add(fremd)
        db.commit()
        db.refresh(fremd)
        pano = client.get(f"/api/servers/{fremd.id}", cookies=owner_cookies).json()
        assert pano["wallpaper_source"] == "panorama"
        assert pano["wallpaper_url"] is None
        assert pano["wallpaper_version"] is None

    def test_versioniert_ist_immutable(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        bild_id = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        resp = client.get(
            f"/api/servers/{test_server.id}/wallpaper?v=custom-{bild_id}",
            cookies=owner_cookies,
        )
        assert resp.status_code == 200
        assert resp.headers["cache-control"] == "private, max-age=31536000, immutable"
        assert resp.headers["etag"] == f'"custom-{bild_id}"'
        assert resp.content.startswith(b"RIFF")

    def test_alte_version_liefert_alte_bytes(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        alt = _upload(
            client, test_server.id, owner_cookies, csrf_token,
            _jpeg_bytes((200, 30, 30)),
        ).json()["id"]
        neu = _upload(
            client, test_server.id, owner_cookies, csrf_token,
            _jpeg_bytes((30, 30, 200)),
        ).json()["id"]
        stale = client.get(
            f"/api/servers/{test_server.id}/wallpaper?v=custom-{alt}",
            cookies=owner_cookies,
        )
        assert stale.status_code == 200
        assert stale.headers["etag"] == f'"custom-{alt}"'
        galerie_alt = client.get(
            f"/api/servers/{test_server.id}/wallpaper/gallery/{alt}/image",
            cookies=owner_cookies,
        ).content
        galerie_neu = client.get(
            f"/api/servers/{test_server.id}/wallpaper/gallery/{neu}/image",
            cookies=owner_cookies,
        ).content
        assert galerie_alt != galerie_neu
        assert stale.content == galerie_alt

    def test_ungueltige_version_400_geloeschte_404(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        for schlecht in ("quatsch", "custom-", "custom-abc", "steam-", "custom-1-2"):
            resp = client.get(
                f"/api/servers/{test_server.id}/wallpaper?v={schlecht}",
                cookies=owner_cookies,
            )
            assert resp.status_code == 400
        bild_id = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        _loeschen(client, test_server.id, bild_id, owner_cookies, csrf_token)
        fehlt = client.get(
            f"/api/servers/{test_server.id}/wallpaper?v=custom-{bild_id}",
            cookies=owner_cookies,
        )
        assert fehlt.status_code == 404

    def test_steam_version_nur_fuer_eigenes_spiel(
        self, client, db, owner_cookies, test_server, wallpaper_dirs
    ):
        desk = ws.resolve_wallpaper(db, test_server)
        assert desk.source == "steam" and desk.app_id is not None
        (wallpaper_dirs / "steam").mkdir(parents=True, exist_ok=True)
        (wallpaper_dirs / "steam" / f"{desk.app_id}.webp").write_bytes(
            ws.sanitize_and_compress_wallpaper(_jpeg_bytes())
        )
        eigen = client.get(
            f"/api/servers/{test_server.id}/wallpaper?v=steam-{desk.app_id}",
            cookies=owner_cookies,
        )
        assert eigen.status_code == 200
        assert "immutable" in eigen.headers["cache-control"]
        fremd = client.get(
            f"/api/servers/{test_server.id}/wallpaper?v=steam-123",
            cookies=owner_cookies,
        )
        assert fremd.status_code == 404


def _loeschen(client: TestClient, server_id: int, bild_id: int, cookies: dict, csrf: str):
    return client.delete(
        f"/api/servers/{server_id}/wallpaper/gallery/{bild_id}",
        cookies=cookies,
        headers={"X-CSRF-Token": csrf},
    )


class TestGalerieLoeschen:
    def test_loeschen_entfernt_zeile_und_datei(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        erste = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        zweite = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        resp = _loeschen(client, test_server.id, erste, owner_cookies, csrf_token)
        assert resp.status_code == 200
        galerie = client.get(
            f"/api/servers/{test_server.id}/wallpaper/gallery", cookies=owner_cookies
        ).json()
        assert [g["id"] for g in galerie] == [zweite]
        assert galerie[0]["is_active"] is True
        dateien = list((wallpaper_dirs / "wallpapers" / "dayz").glob("wallpaper_*.webp"))
        assert [d.name for d in dateien] == [f"wallpaper_{zweite}.webp"]

    def test_loeschen_des_aktiven_faellt_auf_steam_zurueck(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        bild_id = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        resp = _loeschen(client, test_server.id, bild_id, owner_cookies, csrf_token)
        assert resp.status_code == 200
        detail = client.get(f"/api/servers/{test_server.id}", cookies=owner_cookies).json()
        assert detail["has_custom_wallpaper"] is False
        assert detail["wallpaper_source"] == "steam"
        galerie = client.get(
            f"/api/servers/{test_server.id}/wallpaper/gallery", cookies=owner_cookies
        ).json()
        assert galerie == []

    def test_loeschen_fremder_id_404(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        resp = _loeschen(client, test_server.id, 9999, owner_cookies, csrf_token)
        assert resp.status_code == 404

    def test_loeschen_braucht_manage_recht(
        self, client, db, regular_user, user_cookies, user_csrf_token,
        test_server, owner_cookies, csrf_token, wallpaper_dirs,
    ):
        bild_id = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        _nur_sehen(db, regular_user, test_server)
        resp = _loeschen(client, test_server.id, bild_id, user_cookies, user_csrf_token)
        assert resp.status_code == 403

    def test_loeschen_ohne_csrf_403(
        self, client, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        bild_id = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        resp = client.delete(
            f"/api/servers/{test_server.id}/wallpaper/gallery/{bild_id}",
            cookies=owner_cookies,
        )
        assert resp.status_code == 403

    def test_loeschen_schreibt_audit(
        self, client, db, owner_cookies, csrf_token, test_server, wallpaper_dirs
    ):
        bild_id = _upload(client, test_server.id, owner_cookies, csrf_token).json()["id"]
        _loeschen(client, test_server.id, bild_id, owner_cookies, csrf_token)
        eintrag = (
            db.query(AuditLog)
            .filter(AuditLog.action == "server.wallpaper.delete")
            .order_by(AuditLog.id.desc())
            .first()
        )
        assert eintrag is not None
        assert eintrag.target_id == str(test_server.id)
