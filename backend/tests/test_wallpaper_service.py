"""Tests fuer services/wallpaper_service (Resolver, Sanitisierung, Galerie)."""

from __future__ import annotations

import importlib.util
import io
from pathlib import Path

import pytest
from PIL import Image
from sqlalchemy.orm import Session

from blueprints.schema import load_blueprint_dict
from config import settings
from models.server import Server
from services import wallpaper_service as ws
from services.wallpaper_service import (
    WallpaperValidationError,
    artwork_app_id_for_blueprint,
)


def _bild_bytes(fmt: str = "JPEG", breite: int = 64, hoehe: int = 64) -> bytes:
    img = Image.new("RGB", (breite, hoehe), color=(10, 60, 120))
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


def _server_anlegen(db: Session, game_type: str) -> Server:
    server = Server(name=f"srv-{game_type}", game_type=game_type, install_dir="/tmp/x")
    db.add(server)
    db.commit()
    db.refresh(server)
    return server


def _minimal_steam_dict() -> dict:
    return {
        "version": 1,
        "meta": {"id": "t", "name": "T", "category": "steam_game"},
        "runtime": {"image": "debian:bookworm-slim", "startup": "./start"},
        "ports": [{"name": "game", "protocol": "udp"}],
        "source": {
            "type": "steam",
            "steam": {"appId": "380870", "platform": "linux"},
        },
        "mods": {"workshopAppId": "108600"},
    }


@pytest.fixture
def wallpaper_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "wallpaper_dir", str(tmp_path / "wallpapers"))
    monkeypatch.setattr(settings, "steam_wallpaper_cache_dir", str(tmp_path / "steam"))
    return tmp_path


# ── Sanitisierung ────────────────────────────────────────────────────────


class TestSanitize:
    @pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
    def test_gueltige_formate_werden_webp(self, fmt):
        out = ws.sanitize_and_compress_wallpaper(_bild_bytes(fmt))
        assert out.startswith(b"RIFF") and out[8:12] == b"WEBP"
        with Image.open(io.BytesIO(out)) as img:
            assert img.size == (64, 64)

    def test_grosses_bild_wird_auf_2560_begrenzt(self):
        out = ws.sanitize_and_compress_wallpaper(_bild_bytes("JPEG", 3000, 100))
        with Image.open(io.BytesIO(out)) as img:
            assert img.size[0] == 2560

    def test_svg_wird_abgewiesen(self):
        with pytest.raises(WallpaperValidationError):
            ws.sanitize_and_compress_wallpaper(b'<svg xmlns="http://x"></svg>' + b" " * 16)

    def test_text_wird_abgewiesen(self):
        with pytest.raises(WallpaperValidationError):
            ws.sanitize_and_compress_wallpaper(b"kein bild, nur text!!" + b" " * 16)

    def test_zu_gross_wird_abgewiesen(self):
        with pytest.raises(WallpaperValidationError):
            ws.sanitize_and_compress_wallpaper(
                b"\xff\xd8\xff" + b"\x00" * (ws.MAX_WALLPAPER_BYTES + 1)
            )

    def test_zu_klein_wird_abgewiesen(self):
        with pytest.raises(WallpaperValidationError):
            ws.sanitize_and_compress_wallpaper(b"\xff\xd8\xff")

    def test_korruptes_bild_wird_abgewiesen(self):
        with pytest.raises(WallpaperValidationError):
            ws.sanitize_and_compress_wallpaper(b"\x89PNG\r\n\x1a\n" + b"\x00" * 40)


# ── Artwork-Kette ────────────────────────────────────────────────────────


class TestArtworkKette:
    def test_artwork_app_id_gewinnt(self):
        d = _minimal_steam_dict()
        d["source"]["steam"]["artworkAppId"] = "252490"
        assert artwork_app_id_for_blueprint(load_blueprint_dict(d)) == "252490"

    def test_workshop_fallback(self):
        assert artwork_app_id_for_blueprint(load_blueprint_dict(_minimal_steam_dict())) == "108600"

    def test_app_id_fallback(self):
        d = _minimal_steam_dict()
        d["mods"] = {"workshopAppId": None}
        assert artwork_app_id_for_blueprint(load_blueprint_dict(d)) == "380870"

    def test_nicht_steam_gibt_none(self):
        d = _minimal_steam_dict()
        d["meta"]["category"] = "non_steam_game"
        d["source"] = {"type": "dockerOnly"}
        assert artwork_app_id_for_blueprint(load_blueprint_dict(d)) is None

    def test_none_blueprint_gibt_none(self):
        assert artwork_app_id_for_blueprint(None) is None

    def test_alle_nativen_steam_blueprints_loesen_numerisch_auf(self):
        import re

        from blueprints.schema import load_blueprint_file

        native = Path(__file__).resolve().parent.parent / "blueprints" / "native"
        geprüft = 0
        for datei in sorted(native.glob("*.blueprint.json")):
            bp = load_blueprint_file(datei)
            if bp.source.type.value != "steam":
                continue
            ketten_id = artwork_app_id_for_blueprint(bp)
            assert ketten_id is not None, datei.name
            assert re.fullmatch(r"\d{1,10}", ketten_id), datei.name
            geprüft += 1
        assert geprüft > 30


# ── Galerie ──────────────────────────────────────────────────────────────


class TestGalerie:
    def test_store_macht_bild_aktiv(self, db, wallpaper_dirs):
        webp = ws.sanitize_and_compress_wallpaper(_bild_bytes())
        row = ws.store_wallpaper(db, "project_zomboid", webp, "anna")
        assert row.is_active is True
        assert row.file_name == f"wallpaper_{row.id}.webp"
        assert (wallpaper_dirs / "wallpapers" / "project_zomboid" / row.file_name).is_file()

    def test_zweiter_upload_deaktiviert_ersten(self, db, wallpaper_dirs):
        webp = ws.sanitize_and_compress_wallpaper(_bild_bytes())
        first = ws.store_wallpaper(db, "project_zomboid", webp, "anna")
        second = ws.store_wallpaper(db, "project_zomboid", webp, "bob")
        db.refresh(first)
        assert first.is_active is False
        assert second.is_active is True
        assert len(ws.get_gallery(db, "project_zomboid")) == 2

    def test_reaktivieren_wechselt_aktiv(self, db, wallpaper_dirs):
        webp = ws.sanitize_and_compress_wallpaper(_bild_bytes())
        first = ws.store_wallpaper(db, "project_zomboid", webp, "anna")
        ws.store_wallpaper(db, "project_zomboid", webp, "bob")
        ws.set_active_wallpaper(db, "project_zomboid", first.id)
        assert ws.get_active_wallpaper(db, "project_zomboid").id == first.id

    def test_reset_hebt_nur_zeiger_auf(self, db, wallpaper_dirs):
        webp = ws.sanitize_and_compress_wallpaper(_bild_bytes())
        row = ws.store_wallpaper(db, "project_zomboid", webp, "anna")
        ws.reset_wallpaper(db, "project_zomboid")
        assert ws.get_active_wallpaper(db, "project_zomboid") is None
        # Datei bleibt in der Galerie:
        assert len(ws.get_gallery(db, "project_zomboid")) == 1
        pfad = wallpaper_dirs / "wallpapers" / "project_zomboid" / row.file_name
        assert pfad.is_file()

    def test_retention_loescht_aelteste_inaktive(self, db, wallpaper_dirs, monkeypatch):
        monkeypatch.setattr(ws, "GALLERY_RETENTION_PER_GAME", 3)
        webp = ws.sanitize_and_compress_wallpaper(_bild_bytes())
        ids = [ws.store_wallpaper(db, "project_zomboid", webp, "u").id for _ in range(4)]
        galerie = ws.get_gallery(db, "project_zomboid")
        assert len(galerie) == 3
        assert ids[0] not in {r.id for r in galerie}
        assert not (wallpaper_dirs / "wallpapers" / "project_zomboid" / f"wallpaper_{ids[0]}.webp").exists()

    def test_fremdes_spiel_ist_getrennt(self, db, wallpaper_dirs):
        webp = ws.sanitize_and_compress_wallpaper(_bild_bytes())
        ws.store_wallpaper(db, "project_zomboid", webp, "anna")
        assert ws.get_active_wallpaper(db, "dayz") is None
        assert ws.get_gallery(db, "dayz") == []

    def test_pfad_traversal_wird_abgewiesen(self, db, wallpaper_dirs):
        with pytest.raises(WallpaperValidationError):
            ws.store_wallpaper(db, "../etc", b"RIFF....WEBP" + b"\x00" * 40, "anna")


# ── Resolver ─────────────────────────────────────────────────────────────


class TestResolver:
    def test_custom_gewinnt_ueber_steam(self, db, wallpaper_dirs):
        server = _server_anlegen(db, "project_zomboid")
        webp = ws.sanitize_and_compress_wallpaper(_bild_bytes())
        ws.store_wallpaper(db, "project_zomboid", webp, "anna")
        desk = ws.resolve_wallpaper(db, server)
        assert desk.source == "custom"
        assert desk.url == f"/api/servers/{server.id}/wallpaper"

    def test_steam_ohne_custom(self, db, wallpaper_dirs):
        server = _server_anlegen(db, "project_zomboid")
        desk = ws.resolve_wallpaper(db, server)
        assert desk.source == "steam"
        assert desk.app_id == "108600"  # workshopAppId des nativen Blueprints
        assert desk.url == f"/api/servers/{server.id}/wallpaper"

    def test_panorama_ohne_blueprint(self, db, wallpaper_dirs):
        server = _server_anlegen(db, "gibt_es_nicht")
        desk = ws.resolve_wallpaper(db, server)
        assert desk.source == "panorama"
        assert desk.url is None

    def test_panorama_fuer_nicht_spiel(self, db, wallpaper_dirs):
        server = _server_anlegen(db, "postgres")
        desk = ws.resolve_wallpaper(db, server)
        assert desk.source == "panorama"


# ── Steam-Cache ──────────────────────────────────────────────────────────


class _FakeResp:
    def __init__(self, status_code=200, content=b"", content_type="image/jpeg"):
        self.status_code = status_code
        self.content = content
        self.headers = {"content-type": content_type}


class TestSteamCache:
    def test_fetch_cacht_beim_ersten_treffer(self, wallpaper_dirs, monkeypatch):
        aufrufe = []

        def fake_get(url, timeout):
            aufrufe.append(url)
            return _FakeResp(content=_bild_bytes())

        monkeypatch.setattr(ws.httpx, "get", fake_get)
        pfad = ws.ensure_steam_cached("108600")
        assert pfad is not None and pfad.is_file()
        assert "108600" in aufrufe[0]
        # Zweiter Aufruf kommt aus dem Cache — kein weiterer Fetch:
        ws.ensure_steam_cached("108600")
        assert len(aufrufe) == 1

    def test_404_fuehrt_zu_negativ_cache(self, wallpaper_dirs, monkeypatch):
        aufrufe = []

        def fake_get(url, timeout):
            aufrufe.append(url)
            return _FakeResp(status_code=404, content=b"nope", content_type="text/html")

        monkeypatch.setattr(ws.httpx, "get", fake_get)
        assert ws.ensure_steam_cached("999999") is None
        n = len(aufrufe)
        assert n == 2  # primaer + fallback-host
        assert ws.ensure_steam_cached("999999") is None
        assert len(aufrufe) == n  # kein Retry dank Negativ-Cache

    def test_ungueltige_app_id_fetcht_nie(self, wallpaper_dirs, monkeypatch):
        def fail_get(url, timeout):
            raise AssertionError("darf nicht fetchen")

        monkeypatch.setattr(ws.httpx, "get", fail_get)
        assert ws.fetch_steam_artwork("../../etc") is None
        assert ws.fetch_steam_artwork("") is None


def _seed_modul():
    pfad = Path(__file__).resolve().parent.parent / "scripts" / "seed_game_wallpapers.py"
    spec = importlib.util.spec_from_file_location("seed_game_wallpapers", pfad)
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


class TestSeeds:
    def test_seed_legt_system_bild_an(self, db, wallpaper_dirs, tmp_path):
        seed = _seed_modul()
        seed_dir = tmp_path / "seeds"
        seed_dir.mkdir()
        (seed_dir / "minecraft_paper.webp").write_bytes(_bild_bytes("WEBP"))
        assert seed.seed_game_wallpapers(db, seed_dir) == ["minecraft_paper"]
        aktiv = ws.get_active_wallpaper(db, "minecraft_paper")
        assert aktiv is not None and aktiv.uploaded_by == "system"
        # Zweiter Lauf: kein Duplikat:
        assert seed.seed_game_wallpapers(db, seed_dir) == []
        assert len(ws.get_gallery(db, "minecraft_paper")) == 1

    def test_seed_ueberschreibt_keinen_upload(self, db, wallpaper_dirs, tmp_path):
        seed = _seed_modul()
        webp = ws.sanitize_and_compress_wallpaper(_bild_bytes())
        ws.store_wallpaper(db, "hytale", webp, "anna")
        seed_dir = tmp_path / "seeds"
        seed_dir.mkdir()
        (seed_dir / "hytale.webp").write_bytes(_bild_bytes("WEBP"))
        assert seed.seed_game_wallpapers(db, seed_dir) == []
        assert ws.get_active_wallpaper(db, "hytale").uploaded_by == "anna"

    def test_seed_ignoriert_schrott(self, db, wallpaper_dirs, tmp_path):
        seed = _seed_modul()
        seed_dir = tmp_path / "seeds"
        seed_dir.mkdir()
        (seed_dir / "hytale.webp").write_bytes(b"kein bild" + b" " * 32)
        (seed_dir / "notizen.txt").write_bytes(b"irrelevant")
        assert seed.seed_game_wallpapers(db, seed_dir) == []
        assert ws.get_gallery(db, "hytale") == []

    def test_seed_ohne_verzeichnis(self, db, wallpaper_dirs, tmp_path):
        seed = _seed_modul()
        assert seed.seed_game_wallpapers(db, tmp_path / "fehlt") == []
