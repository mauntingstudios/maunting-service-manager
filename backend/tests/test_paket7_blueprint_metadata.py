"""Tests fuer Paket 7: Blueprint-Metadaten 2.0, Steam-Store-Cache und Katalog-Integration."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from blueprints.schema import (
    BlueprintSteamBranch,
    BlueprintSteamSource,
    BlueprintVersioning,
    load_blueprint_file,
)
from models import GameStoreMetadata, ShopPlan
from schemas.shop import ShopPlanWrite
from services import shop_catalog_service, steam_metadata_service

NATIVE_DIR = Path(__file__).resolve().parents[1] / "blueprints" / "native"


def test_all_native_blueprints_validate_and_have_curated_metadata() -> None:
    files = sorted(NATIVE_DIR.glob("*.blueprint.json"))
    assert len(files) >= 56

    mc_files = [p for p in files if p.name.startswith("minecraft_")]
    assert len(mc_files) == 8

    for path in files:
        bp = load_blueprint_file(path)
        if path in mc_files:
            assert bp.meta.versioning is not None, f"{path.name}: versioning fehlt"
            assert bp.meta.shopTagline, f"{path.name}: shopTagline fehlt"
            assert bp.meta.shopStory, f"{path.name}: shopStory fehlt"

    for bp_id in ("ark_ascended", "arma_reforger", "farming_simulator_22", "farming_simulator_25", "palworld", "seven_days_to_die"):
        bp = load_blueprint_file(NATIVE_DIR / f"{bp_id}.blueprint.json")
        assert bp.meta.platforms == ["pc", "ps5", "xbox", "crossplay"]

    valheim = load_blueprint_file(NATIVE_DIR / "valheim.blueprint.json")
    assert valheim.meta.platforms == ["pc", "xbox", "crossplay"]

    for bp_id in ("dayz", "satisfactory", "project_zomboid", "valheim", "rust", "seven_days_to_die", "arma_reforger"):
        bp = load_blueprint_file(NATIVE_DIR / f"{bp_id}.blueprint.json")
        assert bp.source.steam is not None
        branch_ids = [b.id for b in bp.source.steam.branches]
        assert "public" in branch_ids
        assert len(branch_ids) >= 2


def test_schema_rejects_invalid_branch_id_and_env_key() -> None:
    with pytest.raises(ValidationError):
        BlueprintSteamBranch(id="bad branch;rm", label="Broken")

    with pytest.raises(ValidationError):
        BlueprintVersioning(provider="mojang", envKey="bad-key")

    src = BlueprintSteamSource(
        appId="223350",
        platform="linux",
        branches=[
            BlueprintSteamBranch(id="public", label="Standard"),
            BlueprintSteamBranch(id="public", label="Duplikat"),
            BlueprintSteamBranch(id="experimental", label="Experimental"),
        ],
    )
    assert [b.id for b in src.branches] == ["public", "experimental"]
    assert [b.id for b in src.effective_branches()] == ["public", "experimental"]


def test_strip_html_to_plain_text_removes_scripts_and_tags() -> None:
    raw = (
        "<p>Willkommen in <strong>Chernarus</strong>!</p>"
        "<script>alert('xss')</script><style>body{display:none}</style>"
        "<br/>Ueberlebe &amp; baue deine Basis."
    )
    cleaned = steam_metadata_service.strip_html_to_plain_text(raw, max_len=200)
    assert cleaned == "Willkommen in Chernarus! Ueberlebe & baue deine Basis."
    assert "<" not in cleaned
    assert "xss" not in cleaned


def test_steam_metadata_cache_refresh_ttl_and_fallback(db) -> None:
    calls: list[str] = []

    class _FakeResp:
        def __init__(self, status_code: int, payload: dict | None = None) -> None:
            self.status_code = status_code
            self._payload = payload

        def json(self) -> dict:
            if self._payload is None:
                raise ValueError("kaputt")
            return self._payload

    class _FakeClient:
        def get(self, url: str, *, params: dict, headers: dict):
            lang = params["l"]
            calls.append(lang)
            return _FakeResp(
                200,
                {
                    "221100": {
                        "success": True,
                        "data": {
                            "short_description": (
                                "<p>Wie lange kannst du <b>ueberleben</b>?</p>"
                                if lang == "german"
                                else "<p>How long can you <b>survive</b>?</p>"
                            ),
                            "genres": [{"description": "Action"}, {"description": "Survival"}],
                            "developers": ["Bohemia Interactive"],
                        },
                    }
                },
            )

    res = steam_metadata_service.refresh_steam_metadata(
        db, "221100", http_client=_FakeClient()
    )
    assert set(res.keys()) == {"de", "en"}
    assert res["de"]["short_description"] == "Wie lange kannst du ueberleben?"
    assert res["en"]["short_description"] == "How long can you survive?"
    assert res["de"]["genres"] == ["Action", "Survival"]
    assert len(calls) == 2

    # Innerhalb der TTL wird nicht erneut angefragt.
    res_cached = steam_metadata_service.refresh_steam_metadata(
        db, "221100", http_client=_FakeClient()
    )
    assert len(calls) == 2
    assert res_cached["de"]["short_description"] == "Wie lange kannst du ueberleben?"

    # Nach Ablauf der TTL schlaegt Netz fehl -> kein Absturz, gespeicherte Beschreibung bleibt abrufbar.
    for row in db.query(GameStoreMetadata).filter(GameStoreMetadata.steam_app_id == "221100").all():
        row.fetched_at = datetime.now(timezone.utc) - timedelta(days=10)
    db.commit()

    class _BrokenClient:
        def get(self, *args, **kwargs):
            raise RuntimeError("Netzwerk nicht erreichbar")

    res_broken = steam_metadata_service.refresh_steam_metadata(
        db, "221100", http_client=_BrokenClient()
    )
    assert res_broken == {}
    row_de = (
        db.query(GameStoreMetadata)
        .filter(GameStoreMetadata.steam_app_id == "221100", GameStoreMetadata.lang == "de")
        .first()
    )
    assert row_de is not None
    assert row_de.fetch_status == "error"
    assert row_de.short_description == "Wie lange kannst du ueberleben?"


def test_catalog_plan_story_priority_and_branches(db) -> None:
    admin_id = 1
    from models import User

    if db.query(User).filter(User.id == admin_id).first() is None:
        db.add(User(id=admin_id, username="admin_p7", email="admin_p7@example.com", password_hash="x", is_owner=True))
        db.commit()

    # Steam-Cache fuer DayZ (workshopAppId = 221100) befuellen.
    db.add_all(
        [
            GameStoreMetadata(
                steam_app_id="221100",
                lang="de",
                short_description="Steam DE Story fuer DayZ",
                genres_json='["Action", "Survival"]',
                developers_json='["Bohemia Interactive"]',
                fetch_status="ok",
                fetched_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ),
            GameStoreMetadata(
                steam_app_id="221100",
                lang="en",
                short_description="Steam EN Story for DayZ",
                genres_json='["Action", "Survival"]',
                developers_json='["Bohemia Interactive"]',
                fetch_status="ok",
                fetched_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            ),
        ]
    )
    db.commit()

    # 1. Ohne Plan-Beschreibung greift der Steam-Store-Cache.
    plan_dayz = shop_catalog_service.create_plan(
        db,
        ShopPlanWrite(game_type="dayz", name="DayZ Standard", price_cents=1200),
        actor_id=admin_id,
    )
    out_dayz = shop_catalog_service.catalog_plan(db, plan_dayz)
    assert out_dayz.steam_app_id == "221100"
    assert out_dayz.game_story_de == "Steam DE Story fuer DayZ"
    assert out_dayz.game_story_en == "Steam EN Story for DayZ"
    assert out_dayz.genres == ["Action", "Survival"]
    assert out_dayz.platforms == ["pc", "ps5", "xbox"]
    assert [b.id for b in out_dayz.available_branches] == ["public", "experimental"]

    # 2. Plan-Override gewinnt ueber Steam-Cache.
    plan_override = shop_catalog_service.create_plan(
        db,
        ShopPlanWrite(
            game_type="dayz",
            name="DayZ Custom",
            description="Eigene Betreiber-Story",
            price_cents=1500,
        ),
        actor_id=admin_id,
    )
    out_override = shop_catalog_service.catalog_plan(db, plan_override)
    assert out_override.game_story_de == "Eigene Betreiber-Story"
    assert out_override.game_story_en == "Eigene Betreiber-Story"

    # 3. Nicht-Steam-Blueprint nutzt blueprint.meta.shopStory vor meta.description.
    plan_mc = shop_catalog_service.create_plan(
        db,
        ShopPlanWrite(game_type="minecraft_paper", name="Paper Starter", price_cents=500),
        actor_id=admin_id,
    )
    out_mc = shop_catalog_service.catalog_plan(db, plan_mc)
    assert out_mc.steam_app_id is None
    assert out_mc.game_tagline
    assert out_mc.game_story_de
    assert out_mc.game_story_de != out_mc.game_description
    assert out_mc.available_branches == []
