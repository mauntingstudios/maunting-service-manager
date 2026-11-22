"""Tests fuer die durchschaltbare Spiel-Galerie (Steam Screenshots + Custom Uploads)."""

from __future__ import annotations

import io
import json
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from sqlalchemy.orm import Session

from config import settings
from models import ShopPlan
from services import wallpaper_service as ws


def _jpeg_bytes(color: tuple[int, int, int] = (20, 80, 140)) -> bytes:
    img = Image.new("RGB", (64, 36), color=color)
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


class _FakeHttpResp:
    def __init__(
        self,
        *,
        status_code: int = 200,
        content: bytes = b"",
        json_data: dict | None = None,
    ) -> None:
        self.status_code = status_code
        self._json_data = json_data
        self.content = (
            json.dumps(json_data).encode("utf-8") if json_data is not None else content
        )
        self.headers = {"content-type": "application/json" if json_data else "image/jpeg"}

    def json(self) -> dict:
        if self._json_data is not None:
            return self._json_data
        return json.loads(self.content.decode("utf-8"))


@pytest.fixture
def gallery_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "wallpaper_dir", str(tmp_path / "wallpapers"))
    monkeypatch.setattr(settings, "steam_wallpaper_cache_dir", str(tmp_path / "steam"))
    return tmp_path


class TestSteamGalleryAndSsrf:
    def test_filters_non_steam_cdn_hosts_and_caps_at_six(self, gallery_dirs, monkeypatch):
        app_id = "108600"
        aufrufe: list[str] = []

        def fake_get(url: str, timeout: float = 5.0):
            aufrufe.append(url)
            if "store.steampowered.com/api/appdetails" in url:
                return _FakeHttpResp(
                    json_data={
                        app_id: {
                            "success": True,
                            "data": {
                                "screenshots": [
                                    {"path_full": "http://shared.akamai.steamstatic.com/plain_http.jpg"},
                                    {"path_full": "https://127.0.0.1/ssrf.jpg"},
                                    {"path_full": "https://evil.example.com/x.jpg"},
                                    *[
                                        {
                                            "path_full": f"https://shared.akamai.steamstatic.com/shot_{i}.jpg"
                                        }
                                        for i in range(8)
                                    ],
                                ]
                            },
                        }
                    }
                )
            return _FakeHttpResp(status_code=404)

        monkeypatch.setattr(ws.httpx, "get", fake_get)
        urls = ws.fetch_steam_screenshots(app_id)
        assert len(urls) == 6
        assert all(u.startswith("https://shared.akamai.steamstatic.com/") for u in urls)
        # Zweiter Aufruf kommt aus dem Manifest-Cache
        urls_cached = ws.fetch_steam_screenshots(app_id)
        assert urls_cached == urls
        assert len(aufrufe) == 1

    def test_negative_cache_blocks_repeated_failed_appdetails_calls(
        self, gallery_dirs, monkeypatch
    ):
        aufrufe: list[str] = []

        def fake_get(url: str, timeout: float = 5.0):
            aufrufe.append(url)
            return _FakeHttpResp(status_code=503)

        monkeypatch.setattr(ws.httpx, "get", fake_get)
        assert ws.fetch_steam_screenshots("999111") == []
        assert len(aufrufe) == 1
        assert ws.fetch_steam_screenshots("999111") == []
        assert len(aufrufe) == 1


class TestGalleryRouterAndAdmin:
    def test_gallery_combines_custom_and_steam_and_serves_cached_webp(
        self, client: TestClient, db: Session, gallery_dirs, monkeypatch
    ):
        jpeg = _jpeg_bytes()

        def fake_get(url: str, timeout: float = 5.0):
            if "store.steampowered.com/api/appdetails" in url:
                return _FakeHttpResp(
                    json_data={
                        "108600": {
                            "success": True,
                            "data": {
                                "screenshots": [
                                    {"path_full": "https://shared.akamai.steamstatic.com/s0.jpg"},
                                    {"path_full": "https://shared.akamai.steamstatic.com/s1.jpg"},
                                ]
                            },
                        }
                    }
                )
            if "library_hero.jpg" in url or "shared.akamai.steamstatic.com" in url:
                return _FakeHttpResp(status_code=200, content=jpeg)
            return _FakeHttpResp(status_code=404)

        monkeypatch.setattr(ws.httpx, "get", fake_get)

        webp = ws.sanitize_and_compress_wallpaper(_jpeg_bytes((180, 40, 40)))
        row = ws.store_wallpaper(db, "project_zomboid", webp, "admin")

        res = client.get("/api/shop/artwork/project_zomboid/gallery")
        assert res.status_code == 200, res.text
        items = res.json()
        assert len(items) == 4
        assert items[0]["id"] == f"custom-{row.id}"
        assert items[0]["is_primary"] is True
        assert items[1]["id"] == "steam-108600-hero"
        assert items[2]["id"] == "steam-108600-0"
        assert items[3]["id"] == "steam-108600-1"

        img = client.get(items[2]["url"])
        assert img.status_code == 200
        assert img.headers["content-type"] == "image/webp"
        assert img.headers["x-content-type-options"] == "nosniff"

        # Mismatched App-ID fuer anderes Spiel wird abgewiesen
        mismatch = client.get("/api/shop/artwork/project_zomboid/gallery/steam-252490-0")
        assert mismatch.status_code == 404

        # Ungueltige Galerie-ID wird als 400 abgewiesen
        bad = client.get("/api/shop/artwork/project_zomboid/gallery/not-valid-id")
        assert bad.status_code == 400

    def test_admin_can_activate_and_delete_individual_plan_gallery_item(
        self,
        client: TestClient,
        db: Session,
        owner_cookies: dict,
        csrf_token: str,
        gallery_dirs,
    ):
        plan = ShopPlan(
            game_type="minecraft_paper",
            name=f"Paper Gallery {uuid4().hex[:6]}",
            price_cents=500,
            currency="EUR",
            billing_interval="month",
            tax_rate_percent=19,
            artwork_mode="custom",
            active=True,
        )
        db.add(plan)
        db.commit()
        db.refresh(plan)

        r1 = client.post(
            f"/api/shop/plans/{plan.id}/artwork",
            files={"file": ("one.jpg", _jpeg_bytes((10, 10, 200)), "image/jpeg")},
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert r1.status_code == 200
        r2 = client.post(
            f"/api/shop/plans/{plan.id}/artwork",
            files={"file": ("two.jpg", _jpeg_bytes((10, 200, 10)), "image/jpeg")},
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert r2.status_code == 200

        gal = client.get("/api/shop/artwork/minecraft_paper/gallery").json()
        assert len(gal) == 2
        inactive = next(item for item in gal if not item["is_primary"])

        act = client.post(
            f"/api/shop/plans/{plan.id}/artwork/{inactive['wallpaper_id']}/activate",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert act.status_code == 200

        gal_after = client.get("/api/shop/artwork/minecraft_paper/gallery").json()
        new_primary = next(item for item in gal_after if item["is_primary"])
        assert new_primary["wallpaper_id"] == inactive["wallpaper_id"]

        dele = client.delete(
            f"/api/shop/plans/{plan.id}/artwork/{inactive['wallpaper_id']}",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert dele.status_code == 200
        gal_final = client.get("/api/shop/artwork/minecraft_paper/gallery").json()
        assert len(gal_final) == 1
