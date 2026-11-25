"""Geräteübergreifende UI-Vorlieben (Server-/Node-Favoriten & Dashboard-Reiter)."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from config import settings
from database import Base
from models import User


class TestUiPreferencesApi:
    def test_ohne_anmeldung_abgelehnt(self, client: TestClient) -> None:
        resp = client.patch("/api/auth/me/preferences", json={"server_favorites": [1]})
        assert resp.status_code == 401

    def test_ohne_csrf_abgelehnt(
        self, client: TestClient, user_cookies: dict,
    ) -> None:
        resp = client.patch(
            "/api/auth/me/preferences",
            json={"server_favorites": [1]},
            cookies=user_cookies,
        )
        assert resp.status_code == 403

    def test_me_initial_none_und_patch_speichert_kompakt_teilweise(
        self, client: TestClient, db: Session, regular_user: User,
        user_cookies: dict, user_csrf_token: str,
    ) -> None:
        me_initial = client.get("/api/auth/me", cookies=user_cookies)
        assert me_initial.status_code == 200
        assert me_initial.json()["ui_preferences"] is None

        resp1 = client.patch(
            "/api/auth/me/preferences",
            json={"server_favorites": [7, 3, 7], "node_favorites": [2]},
            headers={"X-CSRF-Token": user_csrf_token},
            cookies=user_cookies,
        )
        assert resp1.status_code == 200
        assert resp1.json() == {
            "server_favorites": [7, 3],
            "node_favorites": [2],
            "dashboard_tabs": None,
        }

        # Teil-Patch fuer Dashboard-Reiter laesst bestehende Server-/Node-Favoriten stehen.
        resp2 = client.patch(
            "/api/auth/me/preferences",
            json={"dashboard_tabs": ["/servers", "/settings?tab=shop", "/servers"]},
            headers={"X-CSRF-Token": user_csrf_token},
            cookies=user_cookies,
        )
        assert resp2.status_code == 200
        assert resp2.json() == {
            "server_favorites": [7, 3],
            "node_favorites": [2],
            "dashboard_tabs": ["/servers", "/settings?tab=shop"],
        }

        db.refresh(regular_user)
        assert regular_user.ui_preferences_json == (
            '{"server_favorites":[7,3],"node_favorites":[2],'
            '"dashboard_tabs":["/servers","/settings?tab=shop"]}'
        )

        # Reset der Reiter auf Standard per `dashboard_tabs: null` ohne Verlust der Favoriten.
        resp3 = client.patch(
            "/api/auth/me/preferences",
            json={"dashboard_tabs": None},
            headers={"X-CSRF-Token": user_csrf_token},
            cookies=user_cookies,
        )
        assert resp3.status_code == 200
        assert resp3.json() == {
            "server_favorites": [7, 3],
            "node_favorites": [2],
            "dashboard_tabs": None,
        }

        me_after = client.get("/api/auth/me", cookies=user_cookies)
        assert me_after.status_code == 200
        assert me_after.json()["ui_preferences"] == resp3.json()

    def test_weist_unzulaessige_routen_oder_zu_viele_reiter_ab(
        self, client: TestClient, user_cookies: dict, user_csrf_token: str,
    ) -> None:
        bad_route = client.patch(
            "/api/auth/me/preferences",
            json={"dashboard_tabs": ["https://evil.example/phish"]},
            headers={"X-CSRF-Token": user_csrf_token},
            cookies=user_cookies,
        )
        assert bad_route.status_code == 422

        too_many_tabs = client.patch(
            "/api/auth/me/preferences",
            json={
                "dashboard_tabs": [
                    "/servers",
                    "/admin/nodes",
                    "/admin/ai-providers",
                    "/users",
                    "/roles",
                    "/settings?tab=shop",
                ]
            },
            headers={"X-CSRF-Token": user_csrf_token},
            cookies=user_cookies,
        )
        assert too_many_tabs.status_code == 422

        bad_id = client.patch(
            "/api/auth/me/preferences",
            json={"server_favorites": [0]},
            headers={"X-CSRF-Token": user_csrf_token},
            cookies=user_cookies,
        )
        assert bad_id.status_code == 422


def test_alembic_migration_ui_preferences(pg_wegwerf) -> None:
    db_url = pg_wegwerf("ui_preferences_col")
    vorher = settings.database_url
    settings.database_url = db_url
    backend_dir = Path(__file__).resolve().parent.parent
    config = Config(str(backend_dir / "alembic.ini"))
    config.set_main_option("script_location", str(backend_dir / "migrations"))
    engine = create_engine(db_url)
    try:
        Base.metadata.create_all(engine)
        command.stamp(config, "head")

        command.downgrade(config, "20261125_02")
        engine.dispose()
        cols_down = {c["name"] for c in inspect(engine).get_columns("users")}
        assert "ui_preferences_json" not in cols_down

        command.upgrade(config, "head")
        engine.dispose()
        cols_up = {c["name"]: c for c in inspect(engine).get_columns("users")}
        assert "ui_preferences_json" in cols_up
        assert cols_up["ui_preferences_json"]["nullable"] is True
    finally:
        engine.dispose()
        settings.database_url = vorher
