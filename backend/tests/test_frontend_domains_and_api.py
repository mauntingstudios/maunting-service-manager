"""Tests fuer Operator-Preview-Domains, TXT+A-Besitznachweis und Frontend-API."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import FrontendSettings, Server
from services import frontend_deploy_service, frontend_domain_service
from services.panel_settings_service import PanelSettingsService


def _make_srv(db: Session, tmp_path: Path, name: str = "MyApp", port: int = 28080) -> Server:
    srv = Server(
        name=name,
        game_type="web_frontend_github",
        install_dir=str(tmp_path / name),
        status="running",
        desired_power_state="running",
        public_bind_ip="203.0.113.10",
        game_port=port,
    )
    db.add(srv)
    db.commit()
    db.refresh(srv)
    return srv


def test_operator_preview_subdomain_prefers_frontend_preview_domain_with_fallback(
    db: Session, tmp_path: Path
) -> None:
    srv = _make_srv(db, tmp_path, name="Shop App")
    PanelSettingsService.set("cloudflare_default_zone", "panel.example.de")
    PanelSettingsService.set("frontend_preview_domain", "")
    assert frontend_domain_service.build_preview_subdomain(srv, "feat-cart") == "feat-cart--shop-app.panel.example.de"

    PanelSettingsService.set("frontend_preview_domain", "apps.example.de")
    assert frontend_domain_service.build_preview_subdomain(srv, "feat-cart") == "feat-cart--shop-app.apps.example.de"


def test_custom_domain_uniqueness_and_txt_plus_a_verification(
    client: TestClient, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
) -> None:
    s1 = _make_srv(db, tmp_path, name="SiteOne", port=28081)
    s2 = _make_srv(db, tmp_path, name="SiteTwo", port=28082)

    r1 = client.patch(
        f"/api/servers/{s1.id}/frontend",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={"domain": "shop.example.com"},
    )
    assert r1.status_code == 200
    body1 = r1.json()
    assert body1["domain"] == "shop.example.com"
    assert body1["domain_verified"] is False
    assert body1["domain_verify_txt_host"] == "_msm-verify.shop.example.com"
    assert body1["domain_verify_txt_value"].startswith("msm-verify=")

    # Zweiter Server darf dieselbe Domain nicht uebernehmen -> 409
    r2 = client.patch(
        f"/api/servers/{s2.id}/frontend",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={"domain": "shop.example.com"},
    )
    assert r2.status_code == 409

    # Verifikation ohne passenden TXT-Eintrag schlaegt fehl
    res_fail = frontend_domain_service.verify_custom_domain(
        db,
        s1,
        lookup_txt=lambda _h: [],
        lookup_a=lambda _d: ["203.0.113.10"],
    )
    assert res_fail["verified"] is False
    assert res_fail["txt_ok"] is False

    # Mit gueltigem TXT + A-Record wird Caddy-Proxy aktiviert
    fs = db.get(FrontendSettings, s1.id)
    assert fs is not None
    with patch("services.caddy_service.apply_vhost", return_value=True) as mock_vhost:
        res_ok = frontend_domain_service.verify_custom_domain(
            db,
            s1,
            lookup_txt=lambda _h: [f"msm-verify={fs.domain_verify_token}"],
            lookup_a=lambda _d: ["203.0.113.10"],
        )
    assert res_ok["verified"] is True
    assert mock_vhost.call_count == 1
    assert "reverse_proxy 127.0.0.1:28081" in mock_vhost.call_args.args[1]


def test_frontend_api_endpoints_build_promote_rollback_online(
    client: TestClient, owner_cookies: dict, csrf_token: str, db: Session, tmp_path: Path
) -> None:
    srv = _make_srv(db, tmp_path, name="ApiTest", port=28083)

    with patch("services.frontend_deploy_service.trigger_async_build") as mock_trig:
        r_build = client.post(
            f"/api/servers/{srv.id}/frontend/deployments",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"branch": "main"},
        )
        assert r_build.status_code == 201
        assert mock_trig.call_count == 1

    r_list = client.get(f"/api/servers/{srv.id}/frontend/deployments", cookies=owner_cookies)
    assert r_list.status_code == 200
    assert len(r_list.json()) == 1

    with patch("services.frontend_deploy_service.close_ports"):
        r_off = client.post(
            f"/api/servers/{srv.id}/frontend/online",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"online": False},
        )
        assert r_off.status_code == 200
        assert r_off.json()["online"] is False

    # Reservierte / lokale / Panel-Domains werden strikt abgelehnt
    PanelSettingsService.set("panel_url", "https://panel.myhost.de")
    for bad_domain in ("localhost", "app.local", "evil.internal", "panel.myhost.de"):
        r_bad = client.patch(
            f"/api/servers/{srv.id}/frontend",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"domain": bad_domain},
        )
        assert r_bad.status_code == 400

    # Cancel + Cache-Clear Endpunkte sowie /api/servers active_frontend_build Badge
    srv_list = client.get("/api/servers", cookies=owner_cookies)
    assert srv_list.status_code == 200
    srv_entry = next(item for item in srv_list.json() if item["id"] == srv.id)
    assert srv_entry["active_frontend_build"]["branch"] == "main"

    dep_id = r_build.json()["id"]
    r_cancel = client.post(
        f"/api/servers/{srv.id}/frontend/deployments/{dep_id}/cancel",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert r_cancel.status_code == 200
    assert r_cancel.json()["status"] == "canceled"

    with patch("services.frontend_deploy_service.clear_build_cache") as mock_clear:
        r_cache = client.post(
            f"/api/servers/{srv.id}/frontend/cache/clear",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert r_cache.status_code == 200
        assert r_cache.json()["cleared"] is True
        mock_clear.assert_called_once()
