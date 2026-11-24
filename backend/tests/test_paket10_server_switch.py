"""Tests fuer Paket 10: Server-Wechsel 2.0 (Kunden-Cooldown/Limits, Steam-Branch, Minecraft-Version & Edition)."""

from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient

from games.updater import _steam_effective_branch
from models import AuditLog, Server, ServerPermission, ShopEntitlement, ShopOrder, ShopPlan
from services import (
    minecraft_version_service,
    server_runtime_env,
    shop_lifecycle_settings_service,
)


def _create_plan(db, *, game_type: str, price_cents: int, ram_mb: int = 4096, cpu: int = 2) -> ShopPlan:
    plan = ShopPlan(
        game_type=game_type,
        name=f"{game_type} {uuid4().hex[:6]}",
        description="Paket 10 Testtarif",
        price_cents=price_cents,
        currency="EUR",
        billing_interval="month",
        tax_rate_percent=19,
        ram_included_mb=ram_mb,
        ram_max_mb=16384,
        ram_step_mb=1024,
        price_per_ram_step_cents=100,
        cpu_included=cpu,
        cpu_max=8,
        cpu_step=1,
        price_per_cpu_step_cents=150,
        slots_included=10,
        slots_max=50,
        slots_step=1,
        price_per_slot_step_cents=30,
        active=True,
        sort_order=0,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)
    return plan


def _create_server_with_perm(
    db,
    *,
    user_id: int,
    game_type: str,
    ram_limit_mb: int = 4096,
    cpu_limit_percent: int = 200,
    status: str = "stopped",
    is_hoster_managed: bool = False,
    plan: ShopPlan | None = None,
    install_dir: str = "",
) -> Server:
    srv = Server(
        name=f"srv-{uuid4().hex[:6]}",
        game_type=game_type,
        ram_limit_mb=ram_limit_mb,
        cpu_limit_percent=cpu_limit_percent,
        status=status,
        install_dir=install_dir,
        container_name=f"msm-test-{uuid4().hex[:8]}",
    )
    db.add(srv)
    db.commit()
    db.refresh(srv)

    db.add(
        ServerPermission(
            user_id=user_id,
            server_id=srv.id,
            permission_key="server.config.write",
        )
    )
    if is_hoster_managed and plan is not None:
        from models import ShopOrderItem

        order = ShopOrder(
            number=f"ORD-{uuid4().hex[:8].upper()}",
            user_id=user_id,
            months=1,
            status="paid",
        )
        db.add(order)
        db.flush()
        order_item = ShopOrderItem(
            order_id=order.id,
            plan_id=plan.id,
            game_type=game_type,
            name=plan.name,
            unit_price_cents=plan.price_cents,
            tax_rate_percent=19,
            net_cents=plan.price_cents,
            tax_cents=0,
            gross_cents=plan.price_cents,
        )
        db.add(order_item)
        db.flush()
        db.add(
            ShopEntitlement(
                user_id=user_id,
                order_id=order.id,
                order_item_id=order_item.id,
                kind="server",
                label=srv.name,
                plan_id=plan.id,
                server_id=srv.id,
                status="active",
                ram_mb=ram_limit_mb,
                cpu=max(1, cpu_limit_percent // 100),
            )
        )
    db.commit()
    return srv


def test_shop_game_switch_settings_and_public_policy(
    client: TestClient, owner_cookies: dict, csrf_token: str, db
) -> None:
    pub = client.get("/api/shop/public-policy")
    assert pub.status_code == 200
    body = pub.json()
    assert body["shop_game_switch_cooldown_hours"] == 24
    assert body["shop_game_switch_max_per_30d"] == 4
    assert body["shop_game_switch_allow_higher_price_plan"] is False

    current = shop_lifecycle_settings_service.read(db=db)
    current["shop_game_switch_cooldown_hours"] = 12
    current["shop_game_switch_max_per_30d"] = 6
    current["shop_game_switch_allow_higher_price_plan"] = True
    upd = client.put(
        "/api/shop/admin/lifecycle-settings",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json=current,
    )
    assert upd.status_code == 200, upd.text
    assert upd.json()["shop_game_switch_cooldown_hours"] == 12
    assert upd.json()["shop_game_switch_max_per_30d"] == 6
    assert upd.json()["shop_game_switch_allow_higher_price_plan"] is True


def test_customer_switch_options_filtering_and_abuse_guards(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
    regular_user,
    db,
) -> None:
    plan_mc_paper = _create_plan(db, game_type="minecraft_paper", price_cents=1000, ram_mb=4096)
    _create_plan(db, game_type="minecraft_purpur", price_cents=1000, ram_mb=4096)
    _create_plan(db, game_type="minecraft_vanilla", price_cents=2500, ram_mb=4096)
    _create_plan(db, game_type="ark_survival_evolved", price_cents=1000, ram_mb=16384)

    customer_srv = _create_server_with_perm(
        db,
        user_id=regular_user.id,
        game_type="minecraft_paper",
        ram_limit_mb=4096,
        cpu_limit_percent=200,
        is_hoster_managed=True,
        plan=plan_mc_paper,
    )
    customer_srv.steam_branch = "experimental"
    db.commit()

    # 1. Switch options zeigen im Kundenmodus nur aktive Tarife + korrekte Sperrgruende
    opt_res = client.get(f"/api/servers/{customer_srv.id}/switch-options", cookies=user_cookies)
    assert opt_res.status_code == 200, opt_res.text
    opt_data = opt_res.json()
    assert opt_data["mode"] == "shop_customer"
    by_id = {row["id"]: row for row in opt_data["options"]}
    assert "postgres" not in by_id
    assert by_id["minecraft_paper"]["is_current"] is True
    assert by_id["minecraft_purpur"]["selectable"] is True
    assert by_id["minecraft_vanilla"]["selectable"] is False
    assert by_id["minecraft_vanilla"]["blocked_reason"] == "higher_price_plan"
    assert by_id["ark_survival_evolved"]["selectable"] is False
    assert by_id["ark_survival_evolved"]["blocked_reason"] == "insufficient_ram"

    # 2. Hoeherpreisiges Zielspiel wird vom Server hart abgelehnt (403)
    res_higher = client.post(
        f"/api/servers/{customer_srv.id}/switch-blueprint",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"new_blueprint_id": "minecraft_vanilla"},
    )
    assert res_higher.status_code == 403

    # 3. Kompatibler Wechsel klappt, setzt last_blueprint_switch_at, leert steam_branch & schreibt AuditLog
    verified_backup = SimpleNamespace(id=901, verified_at=datetime.now(timezone.utc))
    with (
        patch("services.backup_orchestrator.create_server_backup", return_value=verified_backup),
        patch("services.server_file_access_service.wipe_server_root", return_value=4),
        patch("services.port_allocation_service.allocate_ports", return_value=[]),
        patch("services.server_lifecycle_service.sync_desired_state_to_agent"),
        patch("games.blueprint_plugin.BlueprintPlugin.install"),
    ):
        ok_res = client.post(
            f"/api/servers/{customer_srv.id}/switch-blueprint",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"new_blueprint_id": "minecraft_purpur"},
        )
        assert ok_res.status_code == 200, ok_res.text

        db.refresh(customer_srv)
        assert customer_srv.game_type == "minecraft_purpur"
        assert customer_srv.last_blueprint_switch_at is not None
        assert customer_srv.steam_branch is None
        assert customer_srv.steam_branch_password_encrypted is None

        audit_row = (
            db.query(AuditLog)
            .filter(
                AuditLog.action == "server.blueprint.switch",
                AuditLog.target_id == str(customer_srv.id),
            )
            .first()
        )
        assert audit_row is not None

        # Install abgeschlossen -> Server ist wieder gestoppt
        customer_srv.status = "stopped"
        db.commit()

        # 4. Sofortiger Zweitwechsel schlaegt am Cooldown fehl (429)
        cooldown_res = client.post(
            f"/api/servers/{customer_srv.id}/switch-blueprint",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"new_blueprint_id": "minecraft_paper"},
        )
        assert cooldown_res.status_code == 429

        # 5. Cooldown auf 0, Max pro 30d auf 1 -> 30-Tage-Limit greift (429)
        settings_now = shop_lifecycle_settings_service.read(db=db)
        settings_now["shop_game_switch_cooldown_hours"] = 0
        settings_now["shop_game_switch_max_per_30d"] = 1
        client.put(
            "/api/shop/admin/lifecycle-settings",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json=settings_now,
        )
        limit_res = client.post(
            f"/api/servers/{customer_srv.id}/switch-blueprint",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"new_blueprint_id": "minecraft_paper"},
        )
        assert limit_res.status_code == 429

        # 6. Admin / Owner ist von Kunden-Cooldown und -Limit ausgenommen
        admin_res = client.post(
            f"/api/servers/{customer_srv.id}/switch-blueprint",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"new_blueprint_id": "minecraft_paper"},
        )
        assert admin_res.status_code == 200, admin_res.text

    # 7. Self-Hosting Server ohne ShopEntitlement nutzt mode="full"
    self_srv = _create_server_with_perm(
        db,
        user_id=regular_user.id,
        game_type="minecraft_paper",
        is_hoster_managed=False,
    )
    full_opts = client.get(f"/api/servers/{self_srv.id}/switch-options", cookies=user_cookies)
    assert full_opts.status_code == 200
    assert full_opts.json()["mode"] == "full"


def test_steam_branch_switching_security_and_effective_branch(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    user_cookies: dict,
    user_csrf_token: str,
    regular_user,
    db,
) -> None:
    steam_plan = _create_plan(db, game_type="abiotic_factor", price_cents=1200, ram_mb=4096)
    customer_steam = _create_server_with_perm(
        db,
        user_id=regular_user.id,
        game_type="abiotic_factor",
        status="running",
        is_hoster_managed=True,
        plan=steam_plan,
    )

    # Laufender Server muss zuerst gestoppt werden (400)
    res_running = client.post(
        f"/api/servers/{customer_steam.id}/switch-branch",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"branch": "public"},
    )
    assert res_running.status_code == 400

    customer_steam.status = "stopped"
    db.commit()

    # Ungueltige Branch-Zeichen abweisen (422)
    res_invalid = client.post(
        f"/api/servers/{customer_steam.id}/switch-branch",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"branch": "bad branch;rm"},
    )
    assert res_invalid.status_code == 422

    # Kunde darf weder beliebigen Branch noch Beta-Passwort setzen (403)
    res_forbidden = client.post(
        f"/api/servers/{customer_steam.id}/switch-branch",
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token},
        json={"branch": "secret_qa", "branch_password": "top-secret-beta-key"},
    )
    assert res_forbidden.status_code == 403

    # Admin setzt beliebigen Branch + Beta-Passwort verschluesselt (niemals Klartext in API-Response)
    admin_steam = _create_server_with_perm(
        db,
        user_id=regular_user.id,
        game_type="abiotic_factor",
        status="stopped",
        is_hoster_managed=False,
    )
    verified_backup = SimpleNamespace(id=902, verified_at=datetime.now(timezone.utc))
    with (
        patch("services.backup_orchestrator.create_server_backup", return_value=verified_backup) as m_backup,
        patch("games.blueprint_plugin.BlueprintPlugin.install") as m_install,
        patch("services.server_lifecycle_service.sync_desired_state_to_agent"),
    ):
        res_ok = client.post(
            f"/api/servers/{admin_steam.id}/switch-branch",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"branch": "experimental", "branch_password": "beta-secret-xyz"},
        )
        assert res_ok.status_code == 200, res_ok.text
        assert m_backup.call_count == 1
        assert m_install.call_count == 1

    db.refresh(admin_steam)
    assert admin_steam.steam_branch == "experimental"
    assert admin_steam.steam_branch_password_encrypted
    assert "beta-secret-xyz" not in admin_steam.steam_branch_password_encrypted

    srv_get = client.get(f"/api/servers/{admin_steam.id}", cookies=owner_cookies)
    assert srv_get.status_code == 200
    srv_json = srv_get.json()
    assert srv_json["steam_branch"] == "experimental"
    assert srv_json["has_branch_password"] is True
    assert "beta-secret-xyz" not in srv_get.text

    # Updater nutzt den pro Server gespeicherten Branch vor dem Blueprint-Default
    bp_steam = SimpleNamespace(branch="public")
    assert _steam_effective_branch(bp_steam, server=admin_steam) == "experimental"


def test_minecraft_version_list_upgrade_and_downgrade_world_safety(
    client: TestClient,
    owner_cookies: dict,
    csrf_token: str,
    owner_user,
    db,
    tmp_path,
) -> None:
    minecraft_version_service.clear_cache_for_tests()
    (tmp_path / "server.properties").write_text("motd=Paket10\n", encoding="utf-8")
    for folder in ("world", "world_nether", "world_the_end"):
        (tmp_path / folder).mkdir()
        (tmp_path / folder / "level.dat").write_bytes(b"mcworld")

    mc_srv = _create_server_with_perm(
        db,
        user_id=owner_user.id,
        game_type="minecraft_paper",
        status="stopped",
        install_dir=str(tmp_path),
    )
    server_runtime_env.set_runtime_env(mc_srv.id, {"VERSION": "1.21.4"}, db=db)

    fake_releases = [
        {"version": "1.21.5", "release_type": "release", "published_at": "2026-01-01"},
        {"version": "1.21.4", "release_type": "release", "published_at": "2025-12-01"},
        {"version": "1.20.4", "release_type": "release", "published_at": "2024-12-01"},
        {"version": "25w10a", "release_type": "snapshot", "published_at": "2026-02-01"},
    ]
    with patch("services.minecraft_version_service.fetch_provider_versions", return_value=fake_releases):
        list_res = client.get(f"/api/servers/{mc_srv.id}/minecraft/versions", cookies=owner_cookies)
        assert list_res.status_code == 200, list_res.text
        payload = list_res.json()
        assert payload["current_version"] == "1.21.4"
        rels = {row["version"]: row["relation"] for row in payload["versions"]}
        assert rels["1.21.5"] == "upgrade"
        assert rels["1.21.4"] == "same"
        assert rels["1.20.4"] == "downgrade"
        assert "25w10a" not in rels
        assert any(ed["id"] == "minecraft_purpur" for ed in payload["editions"])

    verified_backup = SimpleNamespace(id=903, verified_at=datetime.now(timezone.utc))

    # 1. Upgrade laesst Weltordner intakt und schreibt runtime env
    with (
        patch("services.backup_orchestrator.create_server_backup", return_value=verified_backup),
        patch("services.server_lifecycle_service.sync_desired_state_to_agent"),
    ):
        up_res = client.post(
            f"/api/servers/{mc_srv.id}/minecraft/switch-version",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"target_version": "1.21.5", "reset_world": False},
        )
        assert up_res.status_code == 200, up_res.text
        assert (tmp_path / "world").exists()
        assert server_runtime_env.get_runtime_env(mc_srv.id, db=db)["VERSION"] == "1.21.5"

    # 2. Downgrade ohne Reset oder Bestaetigung -> 409 Conflict
    warn_res = client.post(
        f"/api/servers/{mc_srv.id}/minecraft/switch-version",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={"target_version": "1.20.4"},
    )
    assert warn_res.status_code == 409

    # 3. Fehlgeschlagenes Backup bricht ab, bevor irgendein Weltordner geloescht wird
    with patch("services.backup_orchestrator.create_server_backup", side_effect=RuntimeError("S3 down")):
        fail_res = client.post(
            f"/api/servers/{mc_srv.id}/minecraft/switch-version",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"target_version": "1.20.4", "reset_world": True},
        )
        assert fail_res.status_code == 500
        assert (tmp_path / "world").exists()
        assert (tmp_path / "world_nether").exists()
        assert (tmp_path / "world_the_end").exists()

    # 4. Downgrade mit reset_world=True nach verifiziertem Backup loescht NUR world*, erhaelt server.properties
    call_order: list[str] = []

    def _backup_first(*args, **kwargs):
        call_order.append("backup")
        assert (tmp_path / "world").exists()
        return verified_backup

    orig_wipe = minecraft_version_service._wipe_minecraft_world_dirs

    def _wipe_after(*args, **kwargs):
        call_order.append("wipe")
        return orig_wipe(*args, **kwargs)

    with (
        patch("services.backup_orchestrator.create_server_backup", side_effect=_backup_first),
        patch("services.minecraft_version_service._wipe_minecraft_world_dirs", side_effect=_wipe_after),
        patch("services.server_lifecycle_service.sync_desired_state_to_agent"),
    ):
        down_res = client.post(
            f"/api/servers/{mc_srv.id}/minecraft/switch-version",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"target_version": "1.20.4", "reset_world": True},
        )
        assert down_res.status_code == 200, down_res.text
        assert call_order == ["backup", "wipe"]
        assert not (tmp_path / "world").exists()
        assert not (tmp_path / "world_nether").exists()
        assert not (tmp_path / "world_the_end").exists()
        assert (tmp_path / "server.properties").exists()
        assert server_runtime_env.get_runtime_env(mc_srv.id, db=db)["VERSION"] == "1.20.4"
