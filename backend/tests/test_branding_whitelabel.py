"""Tests fuer Whitelabeling & Branding (Einstellungen, WebP-Logo-Upload, Prompt-Integration)."""

from __future__ import annotations

import io
import re
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
    # Voller Name und Kürzel sind ersetzt, nichts vom Standardnamen bleibt stehen.
    assert "Maunting Service Manager" not in custom_prompt
    assert not re.search(r"\bMSM\b", custom_prompt)
    assert "Markennamen" not in custom_prompt
    # Der Standard bleibt unverändert und nennt weiter den Standardnamen.
    assert "Maunting Service Manager (MSM)" in default_prompt


def test_apply_brand_name_replaces_both_names_and_sanitizes(db: Session):
    text = "Du betreust den Maunting Service Manager (MSM). Nutze die MSM-Werkzeuge, nicht MSM_KEY."
    assert branding_service.apply_brand_name(text, db=db) == text

    PanelSettingsService.set("brand_name", "Astra\nHost  Pro", db=db)
    db.commit()
    out = branding_service.apply_brand_name(text, db=db)
    assert out == "Du betreust den Astra Host Pro. Nutze die Astra Host Pro-Werkzeuge, nicht MSM_KEY."
    assert "\n" not in out

    PanelSettingsService.set("brand_name", "X" * 200, db=db)
    db.commit()
    assert branding_service.apply_brand_name("MSM", db=db) == "X" * 60


def test_branding_propagates_to_prompts_webhooks_passkeys_and_calendar(
    db: Session, owner_user
):
    from services import outbound_webhook_service, passkey_service
    from services.ai_ethics_service import ETHICS_SYSTEM_PROMPT
    from services.ai_mail_text import SYSTEMPROMPT as MAIL_SYSTEMPROMPT
    from services.ai_voice import live_session
    from services.calendar_service import CalendarService

    PanelSettingsService.set("brand_name", "AstraHost", db=db)
    db.commit()

    # 1. Voice-Prompt ersetzt vollen Namen und Kürzel
    voice_prompt = live_session.live_anweisungen([], "de")
    assert "AstraHost" in voice_prompt
    assert "Maunting Service Manager" not in voice_prompt
    assert not re.search(r"\bMSM\b", voice_prompt)

    # 2. Mail- & Ethics-Systemprompt ersetzen inkl. Genitiv ("Maunting Service Managers")
    mail_rendered = branding_service.apply_brand_name(MAIL_SYSTEMPROMPT, db=db)
    assert "AstraHost" in mail_rendered
    assert "Maunting Service Manager" not in mail_rendered
    ethics_rendered = branding_service.apply_brand_name(ETHICS_SYSTEM_PROMPT, db=db)
    assert "AstraHost" in ethics_rendered
    assert "Maunting Service Manager" not in ethics_rendered
    assert not re.search(r"\bMSM\b", ethics_rendered)

    # 3. Passkey RP-Name übernimmt Markenname
    opts = passkey_service.anlege_optionen(db, owner_user, "http://localhost:3000")
    assert opts["rp"]["name"] == "AstraHost"

    # 4. Outbound Discord Webhooks nutzen AstraHost statt hartem MSM / Maunting Service Manager
    import json

    guardian_json = json.loads(
        outbound_webhook_service.format_discord_payload(
            '{"server_name": "srv1", "status": "open", "incident_type": "crash"}',
            outbound_webhook_service.EVENT_GUARDIAN_INCIDENT,
        )
    )
    assert guardian_json["username"] == "AstraHost Guardian Engine"
    assert guardian_json["embeds"][0]["footer"]["text"] == "AstraHost — Guardian Engine"

    status_json = json.loads(
        outbound_webhook_service.format_discord_payload(
            '{"server_name": "srv1", "status": "running"}',
            outbound_webhook_service.EVENT_STATUS_CHANGE,
        )
    )
    assert status_json["username"] == "AstraHost"
    assert status_json["embeds"][0]["footer"]["text"] == "AstraHost"

    # 5. Kalender iCal-Name & Verbindungstest nutzen Kurz-Brand
    ics = CalendarService.export_ical(db, owner_user)
    assert "X-WR-CALNAME:AstraHost Kalender" in ics
    cal = CalendarService.get_or_create_native_calendar(db, owner_user)
    ok, msg = CalendarService.test_connection(cal)
    assert ok is True
    assert msg == "Nativer AstraHost-Kalender aktiv"
