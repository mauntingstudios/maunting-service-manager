"""Tests fuer CPU-Prozent-Normalisierung (150 = 150 %) und abgeleitete Rollen-Kontingente auf Add-ons."""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    AiProvider,
    Role,
    RoleAiLimit,
    RoleAiModelAccess,
    RolePermission,
    RoleVaultQuota,
    Server,
    ShopEntitlement,
    User,
)
from services.node_capacity import normalize_cpu_limit_percent
from tests.test_multi_node_placement_and_capacity import (
    _csrf_headers,
    _mk_node,
    _mk_plan,
    _patch_runtime_env,
)


def _harmless_role_with_quotas(db: Session, *, name: str) -> Role:
    role = Role(name=name, is_system=False)
    db.add(role)
    db.flush()
    db.add(RolePermission(role_id=role.id, permission_key="ai.chat.use"))

    provider = AiProvider(
        name=f"prov-{uuid4().hex[:6]}",
        provider_kind="openai",
    )
    db.add(provider)
    db.flush()

    db.add(RoleVaultQuota(role_id=role.id, quota_bytes=50 * 1024 * 1024 * 1024))
    db.add(
        RoleAiLimit(
            role_id=role.id,
            daily_token_limit=25_000,
            monthly_token_limit=500_000,
            monthly_realtime_minutes_limit=60,
            monthly_dictation_minutes_limit=120,
            allow_all_models=False,
        )
    )
    db.add(
        RoleAiModelAccess(
            role_id=role.id,
            provider_id=provider.id,
            allow_all=False,
            allowed_models_json=json.dumps(["gpt-5", "gpt-5-mini"]),
        )
    )
    db.commit()
    db.refresh(role)
    return role


def test_normalize_cpu_limit_percent_rules() -> None:
    assert normalize_cpu_limit_percent(None) is None
    assert normalize_cpu_limit_percent(0) is None
    assert normalize_cpu_limit_percent(-5) is None
    assert normalize_cpu_limit_percent(1) == 100
    assert normalize_cpu_limit_percent(2) == 200
    assert normalize_cpu_limit_percent(32) == 3200
    assert normalize_cpu_limit_percent(33) == 33
    assert normalize_cpu_limit_percent(150) == 150
    assert normalize_cpu_limit_percent(250) == 250


def test_percent_cpu_plan_150_available_and_provisioned_as_150_percent(
    client: TestClient,
    db: Session,
    owner_user: User,
    user_cookies: dict,
    monkeypatch,
    tmp_path: Path,
) -> None:
    _patch_runtime_env(monkeypatch, tmp_path)
    # 4-Kern-Node (400 % CPU-Budget), 32 GB RAM: 150 % (= 1,5 Kerne) muss verfuegbar sein.
    _mk_node(
        db,
        name="Node 4C",
        host="10.0.2.1",
        is_local=True,
        ram_total_mb=32768,
        cpu_total=4.0,
    )
    plan = _mk_plan(
        db,
        owner_user,
        cpu_included=150,
        cpu_max=300,
        cpu_step=50,
        ram_included_mb=4096,
        ram_max_mb=16384,
    )

    catalog = client.get("/api/shop/catalog")
    assert catalog.status_code == 200
    row = next(r for r in catalog.json() if r["id"] == plan.id)
    assert row["available"] is True
    assert row["max_available_cpu"] == 300

    avail_150 = client.post(
        "/api/shop/availability",
        json={"plan_id": plan.id, "ram_mb": 4096, "cpu": 150},
    )
    assert avail_150.status_code == 200
    assert avail_150.json()["available"] is True

    order = client.post(
        "/api/shop/orders",
        json={"plan_id": plan.id, "ram_mb": 4096, "cpu": 150, "slots": 8, "months": 1},
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert order.status_code == 200, order.text

    paid = client.post(
        f"/api/shop/orders/{order.json()['id']}/demo-pay",
        cookies=user_cookies,
        headers=_csrf_headers(user_cookies),
    )
    assert paid.status_code == 200, paid.text

    ent = (
        db.query(ShopEntitlement)
        .filter(ShopEntitlement.order_id == order.json()["id"], ShopEntitlement.kind == "server")
        .first()
    )
    assert ent is not None and ent.server_id is not None
    srv = db.query(Server).filter(Server.id == ent.server_id).first()
    assert srv is not None
    assert srv.cpu_limit_percent == 150


def test_role_addon_exposes_derived_vault_and_ai_benefits(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
    csrf_token: str,
) -> None:
    role = _harmless_role_with_quotas(db, name=f"PaketPro-{uuid4().hex[:6]}")

    res = client.post(
        "/api/shop/addons",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
        json={
            "slug": f"role-pack-{uuid4().hex[:6]}",
            "name": "Singra & Tresor Pro",
            "description": "Rollenbasiertes KI- und Speicherpaket.",
            "category": "role",
            "price_cents": 899,
            "currency": "EUR",
            "billing_interval": "month",
            "tax_rate_percent": 19,
            "role_id": role.id,
            "active": True,
            "sort_order": 0,
        },
    )
    assert res.status_code == 200, res.text
    created = res.json()
    assert created["role_benefits"] is not None
    assert created["role_benefits"]["role_name"] == role.name
    assert created["role_benefits"]["vault_quota_bytes"] == 50 * 1024 * 1024 * 1024
    assert created["role_benefits"]["ai_daily_tokens"] == 25_000
    assert created["role_benefits"]["ai_monthly_tokens"] == 500_000
    assert created["role_benefits"]["ai_realtime_minutes"] == 60
    assert created["role_benefits"]["ai_dictation_minutes"] == 120
    assert created["role_benefits"]["ai_model_count"] == 2

    public = client.get("/api/shop/catalog/addons")
    assert public.status_code == 200
    entry = next(item for item in public.json() if item["id"] == created["id"])
    assert "role_id" not in entry
    assert entry["grants_role"] is True
    assert entry["role_benefits"]["vault_quota_bytes"] == 50 * 1024 * 1024 * 1024
    assert entry["role_benefits"]["ai_monthly_tokens"] == 500_000
    assert entry["role_benefits"]["ai_model_count"] == 2
