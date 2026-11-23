"""Tests fuer Whitelabeling & Branding (Einstellungen, WebP-Logo-Upload, Prompt-Integration)."""

from __future__ import annotations

import io
from pathlib import Path
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
import pytest
from sqlalchemy.orm import Session

from config import settings
from models import PanelSetting
from services import ai_prompt, branding_service
from services.panel_settings_service import PanelSettingsService


def _png_bytes(color: tuple[int, int, int, int] = (40, 120, 220, 255)) -> bytes:
    img = Image.new("RGBA", (32, 32), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture(autouse=True)
def _isolated_branding(tmp_path: Path, monkeypatch, db: Session):
    monkeypatch.setattr(settings, "branding_dir", str(tmp_path / "branding"))
    PanelSettingsService.invalidate_cache()
    yield
    db.query(PanelSetting).filter(PanelSetting.key.like("brand_%")).delete(
        synchronize_session=False
    )
    db.commit()
    PanelSettingsService.invalidate_cache()


def test_branding_settings_update_and_public_payload(
    client: TestClient, owner_cookies: dict, csrf_token: str | None
):
    headers = {"X-CSRF-Token": csrf_token or ""}
    res = client.post(
        "/api/settings",
        cookies=owner_cookies,
        headers=headers,
        json={
            "brand_name": "CloudCraft Hosting",
            "brand_tagline": "Fast Game Servers",
            "brand_ai_name": "Nova",
            "brand_ai_email": "nova@cloudcraft.example",
            "brand_logo_mode": "default",
            "brand_season_logo_mode": "disabled",
        },
    )
    assert res.status_code == 200

    # Kein Akzentfarben-Override im Schema/Public-Payload
    pub = client.get("/api/settings/public")
    assert pub.status_code == 200
    branding = pub.json()["branding"]
    assert branding["name"] == "CloudCraft Hosting"
    assert branding["custom_name"] == "CloudCraft Hosting"
    assert branding["tagline"] == "Fast Game Servers"
    assert branding["ai_name"] == "Singra"
    assert branding["season_logo_mode"] == "disabled"
    assert "accent_color" not in branding

    # Admin-Settings geben dieselben Felder zurueck
    priv = client.get("/api/settings", cookies=owner_cookies)
    assert priv.status_code == 200
    assert priv.json()["brand_ai_email"] == "nova@cloudcraft.example"

    # Ungueltige KI-E-Mail -> 400
    bad_email = client.post(
        "/api/settings",
        cookies=owner_cookies,
        headers=headers,
        json={"brand_ai_email": "keine-email"},
    )
    assert bad_email.status_code == 400


def test_branding_logo_upload_serve_and_delete(
    client: TestClient, owner_cookies: dict, csrf_token: str | None
):
    headers = {"X-CSRF-Token": csrf_token or ""}

    # SVG-/Schad-Upload muss mit 400 abgelehnt werden
    bad = client.post(
        "/api/settings/branding/logo/default",
        cookies=owner_cookies,
        headers=headers,
        files={"file": ("evil.svg", b"<svg onload='alert(1)'/>", "image/svg+xml")},
    )
    assert bad.status_code == 400

    # Gueltiger PNG-Upload wird zu WebP komprimiert und oeffentlich ausgeliefert
    up = client.post(
        "/api/settings/branding/logo/default",
        cookies=owner_cookies,
        headers=headers,
        files={"file": ("brand.png", _png_bytes(), "image/png")},
    )
    assert up.status_code == 200
    body = up.json()
    assert body["slot"] == "default"
    assert body["configured"] is True
    assert body["url"].startswith("/api/settings/public/branding/logo/default?v=")

    pub = client.get("/api/settings/public").json()["branding"]
    assert pub["logo_mode"] == "custom"
    assert pub["logo_url"] == body["url"]

    img_res = client.get(body["url"])
    assert img_res.status_code == 200
    assert img_res.headers["content-type"] == "image/webp"
    assert img_res.content[:4] == b"RIFF"

    # Loeschen setzt Slot und Modus sauber zurueck
    rm = client.delete(
        "/api/settings/branding/logo/default",
        cookies=owner_cookies,
        headers=headers,
    )
    assert rm.status_code == 200
    assert client.get("/api/settings/public/branding/logo/default").status_code == 404
    pub_after = client.get("/api/settings/public").json()["branding"]
    assert pub_after["logo_mode"] == "default"
    assert pub_after["logo_url"] is None


def test_ai_prompt_keeps_default_and_respects_custom_branding(db: Session):
    default_prompt = ai_prompt.build(db=db)
    assert "Du heißt Singra" in default_prompt
    assert "Markennamen" not in default_prompt

    PanelSettingsService.set("brand_ai_name", f"Astra-{uuid4().hex[:4]}", db=db)
    PanelSettingsService.set("brand_name", "AstraHost", db=db)
    db.commit()

    custom_prompt = ai_prompt.build(db=db)
    ai_label = branding_service.get_effective_ai_name(db=db)
    assert ai_label == "Singra"
    assert "Du heißt Singra" in custom_prompt
    assert "AstraHost" in custom_prompt
