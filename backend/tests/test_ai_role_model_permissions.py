"""Umfassende Sicherheits-, Happy-Path- und Negativtests fuer rollenbasierte KI-Modell- und Provider-Freigaben.

Prueft:
1. Standardverhalten: Unkonfigurierte Rolle / allow_all_models=True loest zu uneingeschraenktem Zugriff auf (None).
2. Fail-Closed Negativtest: Nicht erlaubter Provider wird hart mit 403 (AI_PROVIDER_NOT_PERMITTED_FOR_ROLE) abgewiesen.
3. Fail-Closed Negativtest: Nicht erlaubtes Modell an freigegebenem Provider wird hart mit 403 (AI_MODEL_NOT_PERMITTED_FOR_ROLE) abgewiesen.
4. Happy-Path: Erlaubtes Modell an freigegebenem Provider streamt erfolgreich.
5. Happy-Path: allow_all=True fuer Provider erlaubt alle globalen Modelle des Providers.
6. Negativtest: Eine Rolle kann keine Modelle freigeben, die global am Provider deaktiviert sind (Global-Override-Schutz).
7. Mehre-Rollen-Union: Benutzer mit mehreren Rollen kumuliert freigegebene Provider und Modelle (Vereinigungsmenge).
8. Mehr-Rollen-Erhoehung: Eine einzige Rolle mit allow_all_models=True hebt Einschraenkungen anderer Rollen auf.
9. Negativtest (Rollen-Downgrade in bestehender Konversation): Wurde ein Modell nachtraeglich entzogen, schlaegt die naechste Nachricht in einem bestehenden Gespraech hart mit 403 fehl.
10. Provider-Katalog-Filterung: GET /api/ai/providers/available liefert nur freigegebene Provider und Modelle.
11. Einstellungen-API: GET und PUT /api/ai/settings/role-limits speichern und liefern allow_all_models und model_access.
"""

from uuid import uuid4
import json
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    AiConversation,
    AiMessage,
    AiProvider,
    Role,
    RolePermission,
    User,
)
from schemas.ai_settings import RoleAiModelAccessItem
from services import ai_limit_service, ai_provider_service
from services.ai_limit_service import (
    LIMIT_FIELDS,
    resolve_effective_allowed_models,
    set_role_limit,
    set_role_model_access,
)
from services.openai_compatible_adapter import StreamChunk
from services.role_service import set_user_roles


def _csrf(cookies: dict) -> dict[str, str]:
    return {"X-CSRF-Token": cookies.get("__Secure-csrf_token", "")}


def _create_role(db: Session, name: str) -> Role:
    role = Role(name=name, description=None, is_system=False)
    db.add(role)
    db.flush()
    db.add(RolePermission(role_id=role.id, permission_key="ai.chat.use"))
    db.commit()
    db.refresh(role)
    return role


def _create_provider(
    db: Session,
    name: str,
    default_model: str,
    enabled_models: list[str] | None = None,
    allow_all_models: bool = False,
) -> AiProvider:
    provider = ai_provider_service.create_provider(
        db,
        name=name,
        provider_kind="openrouter",
        default_model=default_model,
        enabled_models=enabled_models or [default_model],
        allow_all_models=allow_all_models,
        enabled=True,
        standard_enabled=True,
        requires_api_key=True,
        operator_api_key="sk-or-v1-operator-secret",
    )
    db.commit()
    db.refresh(provider)
    return provider


def test_ai_role_model_permissions_defaults_unrestricted(
    db: Session,
    regular_user: User,
) -> None:
    """Unkonfigurierte Rollen oder allow_all_models=True fuehren zu uneingeschraenktem Zugriff (None)."""
    role = _create_role(db, "unrestricted-role")
    set_user_roles(db, regular_user, [role.id])

    # 1. Unkonfiguriert -> None
    assert resolve_effective_allowed_models(db, regular_user) is None

    # 2. Ausdruecklich allow_all_models=True -> None
    set_role_limit(db, role.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=True)
    db.commit()
    assert resolve_effective_allowed_models(db, regular_user) is None


def test_ai_role_model_permissions_single_role_custom_models(
    db: Session,
    regular_user: User,
) -> None:
    """Eine Rolle mit allow_all_models=False beschraenkt exakt auf die angegebenen Provider und Modelle."""
    p1 = _create_provider(db, "P1", "p1-default", ["p1-default", "p1-alt"])
    role = _create_role(db, "restricted-p1-role")
    set_role_limit(db, role.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(
        db,
        role.id,
        [RoleAiModelAccessItem(provider_id=p1.id, allow_all=False, allowed_models=["p1-alt"])],
    )
    db.commit()
    set_user_roles(db, regular_user, [role.id])

    mapping = resolve_effective_allowed_models(db, regular_user)
    assert mapping is not None
    assert p1.id in mapping
    assert mapping[p1.id] == {"p1-alt"}


def test_ai_role_model_permissions_negative_globally_disabled_not_granted(
    db: Session,
    regular_user: User,
) -> None:
    """Eine Rolle kann kein Modell gewaehren, das der Provider global nicht aktiviert hat."""
    p1 = _create_provider(db, "P1-Strict", "p1-model-1", ["p1-model-1"], allow_all_models=False)
    role = _create_role(db, "role-trying-disabled-model")
    set_role_limit(db, role.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(
        db,
        role.id,
        [
            RoleAiModelAccessItem(
                provider_id=p1.id,
                allow_all=False,
                allowed_models=["p1-model-1", "p1-globally-disabled-model"],
            )
        ],
    )
    db.commit()
    set_user_roles(db, regular_user, [role.id])

    mapping = resolve_effective_allowed_models(db, regular_user)
    assert mapping is not None
    # Das global nicht aktivierte Modell darf NIEMALS im Mapping landen
    assert "p1-globally-disabled-model" not in mapping[p1.id]
    assert mapping[p1.id] == {"p1-model-1"}


def test_ai_role_model_permissions_negative_unauthorized_provider_returns_403(
    client: TestClient,
    db: Session,
    regular_user: User,
    user_cookies: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Fail-Closed Negativtest: Anfragen an nicht freigegebene Provider werden sofort mit 403 abgewiesen."""
    p_allowed = _create_provider(db, "P-Allowed", "m-allowed")
    p_forbidden = _create_provider(db, "P-Forbidden", "m-forbidden")

    role = _create_role(db, "role-only-p-allowed")
    set_role_limit(db, role.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(
        db,
        role.id,
        [RoleAiModelAccessItem(provider_id=p_allowed.id, allow_all=True, allowed_models=[])],
    )
    db.commit()
    set_user_roles(db, regular_user, [role.id])

    calls = 0

    async def fake_stream(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        yield StreamChunk("content", "Darf nicht kommen")

    monkeypatch.setattr("services.ai_stream_service.stream_chat_completion", fake_stream)

    # Versuch, den nicht freigegebenen Provider zu nutzen
    req_id = str(uuid4())
    resp = client.post(
        "/api/ai/conversation/messages/stream",
        json={
            "content": "Hallo?",
            "provider_id": p_forbidden.id,
            "request_id": req_id,
        },
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )

    # Muss mit 403 Forbidden fehlschlagen
    assert resp.status_code == 403
    assert resp.json()["detail"] == "AI_PROVIDER_NOT_PERMITTED_FOR_ROLE"
    # Keine LLM-Aufrufe, kein Leak
    assert calls == 0
    # Keine Nachricht und KEINE Konversation in der DB angelegt (keine Seiteneffekte / Fail-closed)
    assert db.query(AiMessage).filter(AiMessage.request_id == req_id).first() is None
    assert db.query(AiConversation).filter(AiConversation.user_id == regular_user.id).first() is None


def test_ai_role_model_permissions_negative_unauthorized_model_returns_403(
    client: TestClient,
    db: Session,
    regular_user: User,
    user_cookies: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Fail-Closed Negativtest: Anfragen fuer nicht freigegebene Modelle werden sofort mit 403 abgewiesen."""
    p = _create_provider(db, "P-Mixed", "m-cheap", ["m-cheap", "m-expensive-forbidden"])

    role = _create_role(db, "role-only-cheap-model")
    set_role_limit(db, role.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(
        db,
        role.id,
        [RoleAiModelAccessItem(provider_id=p.id, allow_all=False, allowed_models=["m-cheap"])],
    )
    db.commit()
    set_user_roles(db, regular_user, [role.id])

    calls = 0

    async def fake_stream(*_args, **_kwargs):
        nonlocal calls
        calls += 1
        yield StreamChunk("content", "Darf nicht kommen")

    monkeypatch.setattr("services.ai_stream_service.stream_chat_completion", fake_stream)

    req_id = str(uuid4())
    resp = client.post(
        "/api/ai/conversation/messages/stream",
        json={
            "content": "Nutze das teure Modell!",
            "provider_id": p.id,
            "model": "m-expensive-forbidden",
            "request_id": req_id,
        },
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )

    assert resp.status_code == 403
    assert resp.json()["detail"] == "AI_MODEL_NOT_PERMITTED_FOR_ROLE"
    assert calls == 0
    assert db.query(AiMessage).filter(AiMessage.request_id == req_id).first() is None
    assert db.query(AiConversation).filter(AiConversation.user_id == regular_user.id).first() is None


def test_ai_role_model_permissions_happy_path_authorized_model(
    client: TestClient,
    db: Session,
    regular_user: User,
    user_cookies: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Happy-Path: Freigegebenes Modell streamt erfolgreich."""
    p = _create_provider(db, "P-Allowed-Model", "m-allowed", ["m-allowed", "m-other"])

    role = _create_role(db, "role-allowed-model")
    set_role_limit(db, role.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(
        db,
        role.id,
        [RoleAiModelAccessItem(provider_id=p.id, allow_all=False, allowed_models=["m-allowed"])],
    )
    db.commit()
    set_user_roles(db, regular_user, [role.id])

    called_model = None

    async def fake_stream(*_args, model=None, usage=None, **_kwargs):
        nonlocal called_model
        called_model = model
        if usage is not None:
            usage.total_tokens = 25
        yield StreamChunk("content", "Erlaubte Antwort")

    monkeypatch.setattr("services.ai_stream_service.stream_chat_completion", fake_stream)

    req_id = str(uuid4())
    resp = client.post(
        "/api/ai/conversation/messages/stream",
        json={
            "content": "Hallo Erlaubtes Modell",
            "provider_id": p.id,
            "model": "m-allowed",
            "request_id": req_id,
        },
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )

    assert resp.status_code == 200
    assert "Erlaubte Antwort" in resp.text
    assert called_model == "m-allowed"


def test_ai_role_model_permissions_multi_role_union(
    client: TestClient,
    db: Session,
    regular_user: User,
    user_cookies: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Union-Test: Mehrere Rollen kombinieren erlaubte Provider und Modelle."""
    p1 = _create_provider(db, "Union-P1", "m1-a", ["m1-a", "m1-b", "m1-c"])
    p2 = _create_provider(db, "Union-P2", "m2-a", ["m2-a", "m2-b"])
    p3_unauthorized = _create_provider(db, "Union-P3", "m3-a", ["m3-a"])

    role_a = _create_role(db, "role-a")
    set_role_limit(db, role_a.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(
        db,
        role_a.id,
        [RoleAiModelAccessItem(provider_id=p1.id, allow_all=False, allowed_models=["m1-a"])],
    )

    role_b = _create_role(db, "role-b")
    set_role_limit(db, role_b.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(
        db,
        role_b.id,
        [
            RoleAiModelAccessItem(provider_id=p1.id, allow_all=False, allowed_models=["m1-b"]),
            RoleAiModelAccessItem(provider_id=p2.id, allow_all=True, allowed_models=[]),
        ],
    )
    db.commit()
    set_user_roles(db, regular_user, [role_a.id, role_b.id])

    mapping = resolve_effective_allowed_models(db, regular_user)
    assert mapping is not None
    # P1 erlaubt die Vereinigung von role_a und role_b: {"m1-a", "m1-b"}
    assert mapping[p1.id] == {"m1-a", "m1-b"}
    # P2 erlaubt alle globalen Modelle des Providers
    assert mapping[p2.id] == {"m2-a", "m2-b"}
    # P3 ist nicht enthalten
    assert p3_unauthorized.id not in mapping

    async def fake_stream(*_args, usage=None, **_kwargs):
        if usage is not None:
            usage.total_tokens = 10
        yield StreamChunk("content", "OK")

    monkeypatch.setattr("services.ai_stream_service.stream_chat_completion", fake_stream)

    # 1. P1 mit m1-a -> erlaubt
    r1 = client.post(
        "/api/ai/conversation/messages/stream",
        json={"content": "Hi", "provider_id": p1.id, "model": "m1-a", "request_id": str(uuid4())},
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )
    assert r1.status_code == 200

    # 2. P1 mit m1-b -> erlaubt
    r2 = client.post(
        "/api/ai/conversation/messages/stream",
        json={"content": "Hi", "provider_id": p1.id, "model": "m1-b", "request_id": str(uuid4())},
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )
    assert r2.status_code == 200

    # 3. P1 mit m1-c -> verboten (403)
    r3 = client.post(
        "/api/ai/conversation/messages/stream",
        json={"content": "Hi", "provider_id": p1.id, "model": "m1-c", "request_id": str(uuid4())},
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )
    assert r3.status_code == 403
    assert r3.json()["detail"] == "AI_MODEL_NOT_PERMITTED_FOR_ROLE"

    # 4. P2 mit beliebigem Modell -> erlaubt
    r4 = client.post(
        "/api/ai/conversation/messages/stream",
        json={"content": "Hi", "provider_id": p2.id, "model": "m2-b", "request_id": str(uuid4())},
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )
    assert r4.status_code == 200

    # 5. P3_unauthorized -> verboten (403)
    r5 = client.post(
        "/api/ai/conversation/messages/stream",
        json={"content": "Hi", "provider_id": p3_unauthorized.id, "request_id": str(uuid4())},
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )
    assert r5.status_code == 403
    assert r5.json()["detail"] == "AI_PROVIDER_NOT_PERMITTED_FOR_ROLE"


def test_ai_role_model_permissions_multi_role_elevation(
    db: Session,
    regular_user: User,
) -> None:
    """Wenn mindestens eine Rolle allow_all_models=True traegt, hebt sie alle Modellgrenzen auf."""
    p1 = _create_provider(db, "Elev-P1", "m1", ["m1"])
    role_restricted = _create_role(db, "role-restricted")
    set_role_limit(db, role_restricted.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(
        db,
        role_restricted.id,
        [RoleAiModelAccessItem(provider_id=p1.id, allow_all=False, allowed_models=["m1"])],
    )

    role_unrestricted = _create_role(db, "role-admin-unrestricted")
    set_role_limit(db, role_unrestricted.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=True)
    db.commit()

    # Zuerst nur eingeschraenkt
    set_user_roles(db, regular_user, [role_restricted.id])
    assert resolve_effective_allowed_models(db, regular_user) is not None

    # Zuweisung der unbeschraenkten Rolle -> loest zu None auf
    set_user_roles(db, regular_user, [role_restricted.id, role_unrestricted.id])
    assert resolve_effective_allowed_models(db, regular_user) is None


def test_ai_role_model_permissions_negative_role_downgrade_existing_conversation(
    client: TestClient,
    db: Session,
    regular_user: User,
    user_cookies: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Negativtest (Rollen-Downgrade): Nachtraeglich entzogenes Modell bricht auch in laufenden Gespraechen hart mit 403 ab."""
    p = _create_provider(db, "P-Downgrade", "m-downgrade", ["m-downgrade"])

    # 1. Zunaechst unbeschraenkt
    role = _create_role(db, "role-downgrade-user")
    set_role_limit(db, role.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=True)
    db.commit()
    set_user_roles(db, regular_user, [role.id])

    async def fake_stream(*_args, usage=None, **_kwargs):
        if usage is not None:
            usage.total_tokens = 10
        yield StreamChunk("content", "Erste Antwort")

    monkeypatch.setattr("services.ai_stream_service.stream_chat_completion", fake_stream)

    # Erste Nachricht erfolgreich senden
    first_req = str(uuid4())
    r1 = client.post(
        "/api/ai/conversation/messages/stream",
        json={
            "content": "Starte Gespraech",
            "provider_id": p.id,
            "model": "m-downgrade",
            "request_id": first_req,
        },
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )
    assert r1.status_code == 200

    # 2. Admin entzieht nun die Modellfreigaben fuer diese Rolle
    set_role_limit(db, role.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(db, role.id, [])  # Keine Provider freigegeben
    db.commit()

    # 3. Benutzer versucht Folge-Nachricht im selben Gespraech zu senden
    second_req = str(uuid4())
    r2 = client.post(
        "/api/ai/conversation/messages/stream",
        json={
            "content": "Zweite Nachricht",
            "provider_id": p.id,
            "model": "m-downgrade",
            "request_id": second_req,
        },
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )

    # Muss sofort mit 403 abgewiesen werden
    assert r2.status_code == 403
    assert r2.json()["detail"] == "AI_PROVIDER_NOT_PERMITTED_FOR_ROLE"
    assert db.query(AiMessage).filter(AiMessage.request_id == second_req).first() is None


def test_ai_role_model_permissions_available_providers_filtering(
    client: TestClient,
    db: Session,
    regular_user: User,
    user_cookies: dict,
) -> None:
    """GET /api/ai/providers/available liefert nur die Provider und Modelle, die der Rolle zustehen."""
    p1 = _create_provider(db, "Avail-P1", "p1-a", ["p1-a", "p1-b"])
    p2 = _create_provider(db, "Avail-P2", "p2-a", ["p2-a"])

    role = _create_role(db, "role-filtering")
    # Nur p1 mit p1-b erlauben
    set_role_limit(db, role.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(
        db,
        role.id,
        [RoleAiModelAccessItem(provider_id=p1.id, allow_all=False, allowed_models=["p1-b"])],
    )
    db.commit()
    set_user_roles(db, regular_user, [role.id])

    for endpoint in ("/api/ai/providers", "/api/ai/providers/available"):
        res = client.get(endpoint, cookies=user_cookies)
        assert res.status_code == 200
        providers = res.json()

        p_ids = [p["id"] for p in providers]
        # P1 ist vorhanden, P2 komplett gefiltert
        assert p1.id in p_ids
        assert p2.id not in p_ids

        p1_data = next(p for p in providers if p["id"] == p1.id)
        # Nur p1-b ist als Modell freigegeben
        assert p1_data["enabled_models"] == ["p1-b"]


def test_ai_role_model_permissions_settings_api(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
) -> None:
    """Settings-API (PUT und GET /api/ai/settings/role-limits) speichert und liefert allow_all_models und model_access."""
    p1 = _create_provider(db, "Settings-P1", "p1-m1", ["p1-m1", "p1-m2"])
    role = _create_role(db, "role-settings-api")

    # 1. Update mit allow_all_models=False und individuellem Modellzugriff
    put_payload = {
        "daily_token_limit": 50000,
        "weekly_token_limit": None,
        "monthly_token_limit": None,
        "allow_all_models": False,
        "model_access": [
            {
                "provider_id": p1.id,
                "allow_all": False,
                "allowed_models": ["p1-m2"],
            }
        ],
    }

    put_res = client.put(
        f"/api/ai/settings/role-limits/{role.id}",
        json=put_payload,
        cookies=owner_cookies,
        headers=_csrf(owner_cookies),
    )
    assert put_res.status_code == 200
    put_data = put_res.json()
    assert put_data["allow_all_models"] is False
    assert len(put_data["model_access"]) == 1
    assert put_data["model_access"][0]["provider_id"] == p1.id
    assert put_data["model_access"][0]["provider_name"] == "Settings-P1"
    assert put_data["model_access"][0]["allow_all"] is False
    assert put_data["model_access"][0]["allowed_models"] == ["p1-m2"]

    # 2. GET verifiziert Bestaendigkeit
    get_res = client.get("/api/ai/settings/role-limits", cookies=owner_cookies)
    assert get_res.status_code == 200
    role_entry = next(r for r in get_res.json() if r["role_id"] == role.id)
    assert role_entry["allow_all_models"] is False
    assert len(role_entry["model_access"]) == 1
    assert role_entry["model_access"][0]["provider_id"] == p1.id
    assert role_entry["model_access"][0]["allowed_models"] == ["p1-m2"]


def test_ai_role_model_permissions_unconfigured_role_does_not_bypass_restrictions(
    client: TestClient,
    db: Session,
    regular_user: User,
    user_cookies: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Sicherheits-Negativtest: Eine unkonfigurierte Zweitrolle darf Einschränkungen konfigurierter Rollen NIEMALS aufheben."""
    p1 = _create_provider(db, "Strict-P1", "p1-m1", ["p1-m1", "p1-m2"])
    p_unauthorized = _create_provider(db, "Strict-P2", "p2-m1")

    # 1. Rolle mit strengen Modellgrenzen
    role_restricted = _create_role(db, "strictly-restricted-role")
    set_role_limit(db, role_restricted.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    set_role_model_access(
        db,
        role_restricted.id,
        [RoleAiModelAccessItem(provider_id=p1.id, allow_all=False, allowed_models=["p1-m1"])],
    )

    # 2. Zweitrolle ohne jede KI-Konfiguration (Normalfall z. B. fuer allgemeine Benutzer- oder Teamrollen)
    role_unconfigured = _create_role(db, "unconfigured-secondary-role")
    db.commit()

    # Benutzer erhaelt BEIDE Rollen
    set_user_roles(db, regular_user, [role_restricted.id, role_unconfigured.id])

    # resolve_effective_allowed_models darf NICHT None liefern, sondern muss weiterhin strikt beschraenken!
    effective = resolve_effective_allowed_models(db, regular_user)
    assert effective is not None
    assert p1.id in effective
    assert effective[p1.id] == {"p1-m1"}
    assert p_unauthorized.id not in effective

    calls = 0

    async def fake_stream(*_args, usage=None, **_kwargs):
        nonlocal calls
        calls += 1
        if usage is not None:
            usage.total_tokens = 5
        yield StreamChunk("content", "Erlaubt")

    monkeypatch.setattr("services.ai_stream_service.stream_chat_completion", fake_stream)

    # 1. Nicht freigegebener Provider -> 403 Forbidden
    r_prov = client.post(
        "/api/ai/conversation/messages/stream",
        json={"content": "Hallo", "provider_id": p_unauthorized.id, "request_id": str(uuid4())},
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )
    assert r_prov.status_code == 403
    assert r_prov.json()["detail"] == "AI_PROVIDER_NOT_PERMITTED_FOR_ROLE"
    assert calls == 0

    # 2. Nicht freigegebenes Modell am erlaubten Provider -> 403 Forbidden
    r_model = client.post(
        "/api/ai/conversation/messages/stream",
        json={"content": "Hallo", "provider_id": p1.id, "model": "p1-m2", "request_id": str(uuid4())},
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )
    assert r_model.status_code == 403
    assert r_model.json()["detail"] == "AI_MODEL_NOT_PERMITTED_FOR_ROLE"
    assert calls == 0

    # 3. Erlaubtes Modell -> 200 OK
    r_ok = client.post(
        "/api/ai/conversation/messages/stream",
        json={"content": "Hallo", "provider_id": p1.id, "model": "p1-m1", "request_id": str(uuid4())},
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )
    assert r_ok.status_code == 200
    assert "Erlaubt" in r_ok.text
    assert calls == 1


def test_ai_role_model_permissions_negative_all_models_globally_disabled_blocks_provider(
    client: TestClient,
    db: Session,
    regular_user: User,
    user_cookies: dict,
) -> None:
    """Wenn alle fuer eine Rolle eingestellten Modelle am Provider global deaktiviert sind, ist der Provider fuer die Rolle gesperrt."""
    p = _create_provider(db, "P-Disabled-Models", "global-model-1", ["global-model-1"])

    role = _create_role(db, "role-with-obsolete-models")
    set_role_limit(db, role.id, {f: None for f in LIMIT_FIELDS}, allow_all_models=False)
    # Rolle listet nur ein Modell, das es am Provider gar nicht gibt:
    set_role_model_access(
        db,
        role.id,
        [RoleAiModelAccessItem(provider_id=p.id, allow_all=False, allowed_models=["retired-model"])],
    )
    db.commit()
    set_user_roles(db, regular_user, [role.id])

    mapping = resolve_effective_allowed_models(db, regular_user)
    assert mapping is not None
    # Provider darf gar nicht erst als verfuegbar im Mapping stehen:
    assert p.id not in mapping

    # Anfrage muss sofort mit 403 AI_PROVIDER_NOT_PERMITTED_FOR_ROLE abgewiesen werden:
    r = client.post(
        "/api/ai/conversation/messages/stream",
        json={"content": "Hallo", "provider_id": p.id, "model": "retired-model", "request_id": str(uuid4())},
        cookies=user_cookies,
        headers=_csrf(user_cookies),
    )
    assert r.status_code == 403
    assert r.json()["detail"] == "AI_PROVIDER_NOT_PERMITTED_FOR_ROLE"

