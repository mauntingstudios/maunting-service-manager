"""Tests fuer den eingebauten Singra KI-Router (Smart Model Routing)."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import (
    AiConversation,
    AiMessage,
    AiProvider,
    AiRun,
    AiUsageEvent,
    Role,
    RolePermission,
    User,
)
from services import ai_provider_service, ai_router_service, ai_usage_service
from services.ai_limit_service import LIMIT_FIELDS, set_role_context_ceiling, set_role_limit
from services.ai_stream import engine as stream_engine
from services.openai_compatible_adapter import StreamUsage
from services.role_service import set_user_roles


def _make_chat_user(
    db: Session,
    user: User,
    *,
    router_only: bool = False,
    soft_cap_downgrade: bool = False,
    five_hour_limit: int | None = None,
    daily_limit: int | None = None,
    max_context_tokens: int | None = None,
) -> Role:
    role = Role(name=f"router-role-{uuid4().hex[:6]}", description=None, is_system=False)
    db.add(role)
    db.flush()
    db.add(RolePermission(role_id=role.id, permission_key="ai.chat.use"))
    vals = {field: None for field in LIMIT_FIELDS}
    vals["five_hour_token_limit"] = five_hour_limit
    vals["daily_token_limit"] = daily_limit
    if "max_context_tokens" in vals:
        vals["max_context_tokens"] = max_context_tokens
    set_role_limit(
        db,
        role.id,
        vals,
        allow_all_models=True,
        router_only=router_only,
        soft_cap_downgrade=soft_cap_downgrade,
    )
    if max_context_tokens is not None:
        set_role_context_ceiling(db, role.id, max_context_tokens)
    db.commit()
    set_user_roles(db, user, [role.id])
    return role


def _create_chat_provider(
    db: Session,
    *,
    name: str,
    kind: str = "openrouter",
    default_model: str = "google/gemini-2.5-flash",
    enabled_models: list[str] | None = None,
    enabled: bool = True,
    **extra,
) -> AiProvider:
    provider = ai_provider_service.create_provider(
        db,
        name=f"{name}-{uuid4().hex[:5]}",
        provider_kind=kind,
        default_model=default_model,
        enabled_models=enabled_models or [default_model],
        enabled=enabled,
        requires_api_key=True,
        operator_api_key="sk-or-v1-test-router-key-1234",
        **extra,
    )
    db.commit()
    db.refresh(provider)
    return provider


def test_classify_request_no_wordlists_and_math_fallback(monkeypatch: pytest.MonkeyPatch) -> None:
    """Router enthaelt keine Regex-/Wortlisten; Fallback ohne Embedding schuetzt Qualitaet (nie blind eco)."""
    assert not hasattr(ai_router_service, "_CODE_SIGNAL_RE")
    assert not hasattr(ai_router_service, "_COMPLEX_KEYWORDS")
    assert not hasattr(ai_router_service, "_SIMPLE_GREETING_RE")

    monkeypatch.setattr(ai_router_service.ai_embedding_service, "encode", lambda texts, db=None, nur_lokal=False: None)

    # Kurze komplexe Anfrage darf ohne Embedding niemals auf eco abrutschen
    tier_short_app, _, reason_short_app = ai_router_service.classify_request(
        text="Baue mir eine App für meine Steuererklärung"
    )
    assert tier_short_app == "standard"
    assert reason_short_app == "math_fallback"

    # Auch ohne Embedding wird nie blind eco geraten (konservativ standard)
    tier_hi, _, reason_hi = ai_router_service.classify_request(text="Hallo!")
    assert tier_hi == "standard"
    assert reason_hi == "math_fallback"

    dense_code = "def f(x):\n    if x == {1: 2}:\n        return x;\n" * 45
    tier_dense, _, reason_dense = ai_router_service.classify_request(text=dense_code)
    assert tier_dense == "flagship"
    assert reason_dense == "math_fallback"

    tier_img, _, _ = ai_router_service.classify_request(text="Hallo!", has_images=True)
    assert tier_img in ("standard", "flagship")


def test_classify_request_semantic_local_and_remote_fallback(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Semantische Klassifikation nutzt Kodierung vom lokalen Modell oder Remote-Rueckfall und sichert Qualitaet."""
    from services.ai_embedding_service import Kodierung, MODEL_TAG

    ai_router_service._PROTO_CACHE.clear()
    active_model = MODEL_TAG

    def fake_encode(texts: list[str], db=None, nur_lokal=False):
        vecs = []
        for t in texts:
            low = t.lower()
            if (
                "kurze begrüßung" in low
                or "triviale einzelne" in low
                or t.startswith("Hallo")
                or "wie spät" in low
            ):
                vecs.append([1.0, 0.0, 0.0, 0.0])
            elif (
                "vollständige app" in low
                or "komplexe softwarearchitektur" in low
                or "root-cause" in low
                or "sicherheitsaudit" in low
                or "steuererklärung" in low
                or "wetter-app" in low
                or "auth-architektur" in low
            ):
                vecs.append([0.0, 0.0, 1.0, 0.0])
            elif "knappe mehrdeutigkeit" in low:
                # eco leicht vorn, aber Margin < 0.04 -> muss auf standard landen
                vecs.append([0.714, 0.700, 0.0, 0.0])
            elif "schwache aehnlichkeit" in low:
                # eco vorn gegenueber std/flag, aber Cosine < 0.35 -> muss auf standard landen
                vecs.append([0.30, 0.0, 0.0, 0.95])
            else:
                vecs.append([0.0, 1.0, 0.0, 0.0])
        return Kodierung(vektoren=vecs, modell=active_model)

    monkeypatch.setattr(ai_router_service.ai_embedding_service, "encode", fake_encode)

    # Klare triviale Begruessung -> eco (auch bei Projektkontext)
    tier_eco, _, reason_eco = ai_router_service.classify_request(
        text="Hallo!", project_id="proj-123", db=db
    )
    assert tier_eco == "eco"
    assert reason_eco == "semantic_local"

    # Kurze App-Bau-Anfrage -> flagship
    tier_app, _, reason_app = ai_router_service.classify_request(
        text="Baue mir eine App für meine Steuererklärung", project_id="proj-123", db=db
    )
    assert tier_app == "flagship"
    assert reason_app == "semantic_local"

    # Alltaegliche Server-/Config-Aufgabe -> standard
    tier_std, _, reason_std = ai_router_service.classify_request(
        text="Prüfe bitte die Nginx-Logs", db=db
    )
    assert tier_std == "standard"
    assert reason_std == "semantic_local"

    # Knappe Marge (< 0.04) oder schwache Aehnlichkeit (< 0.35) -> nie eco, sondern standard
    tier_tight, _, reason_tight = ai_router_service.classify_request(
        text="Knappe Mehrdeutigkeit", db=db
    )
    assert tier_tight == "standard"
    assert reason_tight == "math_tiebreaker"

    tier_weak, _, reason_weak = ai_router_service.classify_request(
        text="Schwache Aehnlichkeit", db=db
    )
    assert tier_weak == "standard"
    assert reason_weak == "math_tiebreaker"

    # Remote-Rueckfall (z. B. Google AI Studio) cached unter eigenem Modellraum
    active_model = "google:text-embedding-004"
    tier_rem, _, reason_rem = ai_router_service.classify_request(
        text="Wie spät ist es in Tokio?", project_id="proj-123", reasoning=True, db=db
    )
    assert tier_rem == "eco"
    assert reason_rem == "semantic_remote"
    assert MODEL_TAG in ai_router_service._PROTO_CACHE
    assert "google:text-embedding-004" in ai_router_service._PROTO_CACHE
    ai_router_service._PROTO_CACHE.clear()


def test_router_settings_api_rbac_csrf_and_pools(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
    csrf_token: str | None,
    regular_user: User,
    user_cookies: dict,
    user_csrf_token: str | None,
) -> None:
    """Betreiber konfiguriert Pools; Benutzer ohne Recht erhalten 403; virtueller Provider wird synchronisiert."""
    ai_router_service.clear_cooldowns()
    p1 = _create_chat_provider(
        db,
        name="OR-Main",
        default_model="google/gemini-2.5-flash",
        enabled_models=["google/gemini-2.5-flash", "anthropic/claude-sonnet-4"],
    )

    # Regular user darf nicht lesen oder schreiben
    assert client.get("/api/ai/settings/router", cookies=user_cookies).status_code == 403
    assert (
        client.put(
            "/api/ai/settings/router",
            json={"enabled": True},
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token or ""},
        ).status_code
        == 403
    )

    # Owner liest Konfiguration und sieht bereits eingerichtete Provider automatisch
    res_get = client.get("/api/ai/settings/router", cookies=owner_cookies)
    assert res_get.status_code == 200
    body_get = res_get.json()
    assert body_get["router_provider_id"] is not None
    assert any(p["provider_id"] == p1.id for p in body_get["available_providers"])

    # Ohne CSRF -> 403
    assert (
        client.put("/api/ai/settings/router", json={"enabled": True}, cookies=owner_cookies).status_code
        == 403
    )

    # Selbstreferenz im Pool ablehnen
    bad = client.put(
        "/api/ai/settings/router",
        json={
            "enabled": True,
            "eco_models": [{"provider_id": body_get["router_provider_id"], "model": "auto"}],
        },
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert bad.status_code == 400

    # Manuelles Anlegen ueber /settings/providers fuer singra_router blockiert
    manual = client.post(
        "/api/ai/settings/providers",
        json={
            "name": "Fake Router",
            "provider_kind": "singra_router",
            "default_model": "auto",
            "enabled": True,
            "requires_api_key": False,
        },
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert manual.status_code == 400

    # Pool speichern -> aktiviert virtuellen Provider
    res_put = client.put(
        "/api/ai/settings/router",
        json={
            "enabled": True,
            "eco_models": [{"provider_id": p1.id, "model": "google/gemini-2.5-flash"}],
            "standard_models": [{"provider_id": p1.id, "model": "anthropic/claude-sonnet-4"}],
            "eco_weight": 0.5,
            "flagship_weight": 1.5,
        },
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert res_put.status_code == 200
    saved = res_put.json()
    assert saved["enabled"] is True
    assert saved["ready"] is True
    assert saved["eco_weight"] == 0.5
    assert saved["flagship_weight"] == 1.5
    assert saved["eco_models"][0]["model"] == "google/gemini-2.5-flash"


def test_router_only_role_enforcement_and_available_list(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
    csrf_token: str | None,
    regular_user: User,
    user_cookies: dict,
    user_csrf_token: str | None,
) -> None:
    """Eine Rolle mit router_only=True sieht nur den Singra Router und wird beim direkten Provider abgewiesen."""
    direct = _create_chat_provider(db, name="Direct-OR", default_model="google/gemini-2.5-flash")
    _make_chat_user(db, regular_user, router_only=True)

    # Router konfigurieren und aktivieren
    res_put = client.put(
        "/api/ai/settings/router",
        json={
            "enabled": True,
            "eco_models": [{"provider_id": direct.id, "model": "google/gemini-2.5-flash"}],
        },
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert res_put.status_code == 200
    router_provider_id = res_put.json()["router_provider_id"]

    # /api/ai/providers/available liefert ausschliesslich singra_router
    avail = client.get("/api/ai/providers/available", cookies=user_cookies)
    assert avail.status_code == 200
    items = avail.json()
    assert len(items) == 1
    assert items[0]["id"] == router_provider_id
    assert items[0]["provider_kind"] == "singra_router"
    assert items[0]["available"] is True

    # Direktes Senden auf `direct.id` wird mit 403 blockiert
    blocked = client.post(
        "/api/ai/conversation/messages/stream",
        json={
            "content": "Hallo!",
            "provider_id": direct.id,
            "request_id": str(uuid4()),
        },
        cookies=user_cookies,
        headers={"X-CSRF-Token": user_csrf_token or ""},
    )
    assert blocked.status_code == 403
    assert blocked.json()["detail"] == "AI_ROUTER_ONLY_REQUIRED"


def test_soft_cap_downgrade_and_compute_weight(db: Session, regular_user: User) -> None:
    """5h-Soft-Cap laesst Fallback-Reservierung zu (bei hartem Tageslimit) und Gewichtung skaliert Tokens."""
    provider = _create_chat_provider(db, name="Cost-Prov", default_model="google/gemini-2.5-flash")
    _make_chat_user(
        db,
        regular_user,
        soft_cap_downgrade=True,
        five_hour_limit=100,
        daily_limit=1_000,
    )

    now = datetime.now(timezone.utc)
    # 120 Tokens bereits in den letzten 5h verbraucht (> 100 5h-Limit, aber < 1000 Tageslimit)
    seed_ev = AiUsageEvent(
        request_id=str(uuid4()),
        user_id=regular_user.id,
        provider_id=provider.id,
        model="google/gemini-2.5-flash",
        status="completed",
        reserved_tokens=120,
        reserved_cost_microunits=0,
        accounted_tokens=120,
        accounted_cost_microunits=0,
        created_at=now,
        completed_at=now,
    )
    db.add(seed_ev)
    db.commit()

    assert ai_usage_service.is_five_hour_limit_exceeded(db, regular_user, 50, now=now) is True

    # Ohne Soft-Cap -> blockiert
    with pytest.raises(ai_usage_service.AiQuotaExceeded, match="five_hour_token_limit"):
        ai_usage_service.reserve_ai_usage(
            db,
            regular_user,
            request_id=uuid4(),
            estimated_tokens=50,
            provider_id=provider.id,
            model="google/gemini-2.5-flash",
            now=now,
            allow_five_hour_soft_cap=False,
        )

    # Mit Soft-Cap -> erlaubt innerhalb des Tageslimits und skaliert Tokens ueber weight=0.5 bei exakten Kosten
    ev = ai_usage_service.reserve_ai_usage(
        db,
        regular_user,
        request_id=uuid4(),
        estimated_tokens=50,
        provider_id=provider.id,
        model="google/gemini-2.5-flash",
        now=now,
        allow_five_hour_soft_cap=True,
    )
    ai_usage_service.complete_ai_usage(
        db,
        ev,
        actual_tokens=100,
        actual_cost_microunits=2500,
        aufschluesselung=StreamUsage(prompt_tokens=60, completion_tokens=40, total_tokens=100),
        cost_source="provider",
        token_weight=0.5,
    )
    db.commit()
    db.refresh(ev)
    assert ev.accounted_tokens == 50
    assert ev.accounted_cost_microunits == 2500


def test_pre_first_token_failover_and_cooldown(db: Session, regular_user: User) -> None:
    """Ein 429/5xx-Ausfall vor dem ersten Token setzt Cooldown und schaltet auf Kandidat 2 um."""
    ai_router_service.clear_cooldowns()
    p1 = _create_chat_provider(db, name="Primary-P1", default_model="model-a")
    p2 = _create_chat_provider(db, name="Backup-P2", default_model="model-b")

    conv = AiConversation(
        id=str(uuid4()),
        user_id=regular_user.id,
        kind="primary",
        title="Router Failover Test",
    )
    db.add(conv)
    db.flush()

    msg_id = str(uuid4())
    req_id = str(uuid4())
    db.add(
        AiMessage(
            id=msg_id,
            conversation_id=conv.id,
            role="assistant",
            content="",
            status="streaming",
            provider_id=p1.id,
            model="model-a",
            routed_tier="standard",
            routed_model="model-a",
            routed_provider_name=p1.name,
            routed_reason="grey_zone_default",
            request_id=req_id,
        )
    )
    ev = AiUsageEvent(
        request_id=req_id,
        user_id=regular_user.id,
        provider_id=p1.id,
        model="model-a",
        status="reserved",
        reserved_tokens=50,
        reserved_cost_microunits=0,
        accounted_tokens=50,
        accounted_cost_microunits=0,
    )
    db.add(ev)
    db.flush()

    zustand = {
        "routing": {
            "tier": "standard",
            "model": "model-a",
            "provider_id": p1.id,
            "provider_name": p1.name,
            "weight": 1.0,
            "candidate_index": 0,
            "candidates": [
                {"provider_id": p1.id, "provider_name": p1.name, "model": "model-a", "tier": "standard", "weight": 1.0},
                {"provider_id": p2.id, "provider_name": p2.name, "model": "model-b", "tier": "standard", "weight": 0.5},
            ],
        }
    }
    run = AiRun(
        id=str(uuid4()),
        conversation_id=conv.id,
        user_id=regular_user.id,
        provider_id=p1.id,
        message_id=msg_id,
        status="running",
        state_json="{}",
    )
    db.add(run)
    db.commit()

    switched = stream_engine._router_failover_schritt(
        run_id=run.id,
        user_id=regular_user.id,
        message_id=msg_id,
        usage_event_id=ev.id,
        failed_provider_id=p1.id,
        failed_model="model-a",
        zustand=zustand,
    )
    assert switched is not None
    next_prov, _, next_routing = switched
    assert next_prov.id == p2.id
    assert next_routing["model"] == "model-b"
    assert next_routing["candidate_index"] == 1
    assert ai_router_service.is_in_cooldown(p1.id, "model-a") is True

    db.expire_all()
    msg_db = db.get(AiMessage, msg_id)
    assert msg_db is not None
    assert msg_db.provider_id == p2.id
    assert msg_db.model == "model-b"
    assert msg_db.routed_model == "model-b"
    ai_router_service.clear_cooldowns()


def test_virtual_router_isolated_from_background_and_admin_crud(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
    csrf_token: str | None,
    regular_user: User,
) -> None:
    """Virtueller singra_router blockiert update/delete und stoert Hintergrund-Fallback nicht."""
    real = _create_chat_provider(db, name="OnlyReal", default_model="google/gemini-2.5-flash")
    router_prov = ai_router_service.ensure_router_provider(db, enabled=True)
    db.commit()

    # Mit 1 echtem Provider + aktivem virtuellem Router bleibt `anbieter_ohne_auswahl` beim echten
    chosen = ai_provider_service.anbieter_ohne_auswahl(db, regular_user)
    assert chosen is not None
    assert chosen.id == real.id

    # Admin kann virtuellen Router weder per PATCH aendern noch per DELETE loeschen
    res_patch = client.patch(
        f"/api/ai/settings/providers/{router_prov.id}",
        json={"name": "Gehackt"},
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert res_patch.status_code == 400

    res_del = client.delete(
        f"/api/ai/settings/providers/{router_prov.id}",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token or ""},
    )
    assert res_del.status_code == 400


@pytest.mark.asyncio
async def test_segment_ausfuehren_failover_with_frozen_vorbereitung(
    db: Session,
    regular_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Echter Failover in segment_ausfuehren nutzt replace() auf frozen _Vorbereitung ohne Crash."""
    from types import SimpleNamespace
    import httpx
    import services.ai_stream as ai_stream
    from services.ai_stream.types import _Anlauf, _Vorbereitung
    from services.openai_compatible_adapter import AiProviderRequestError, StreamChunk

    ai_router_service.clear_cooldowns()
    p1 = _create_chat_provider(db, name="Fail-P1", default_model="model-a")
    p2 = _create_chat_provider(db, name="Ok-P2", default_model="model-b")

    conv = AiConversation(
        id=str(uuid4()),
        user_id=regular_user.id,
        kind="primary",
        title="Live Failover Test",
    )
    db.add(conv)
    db.flush()

    msg_id = str(uuid4())
    req_id = str(uuid4())
    db.add(
        AiMessage(
            id=msg_id,
            conversation_id=conv.id,
            role="assistant",
            content="",
            status="streaming",
            provider_id=p1.id,
            model="model-a",
            routed_tier="standard",
            routed_model="model-a",
            routed_provider_name=p1.name,
            routed_reason="grey_zone_default",
            request_id=req_id,
        )
    )
    ev = AiUsageEvent(
        request_id=req_id,
        user_id=regular_user.id,
        provider_id=p1.id,
        model="model-a",
        status="reserved",
        reserved_tokens=50,
        reserved_cost_microunits=0,
        accounted_tokens=50,
        accounted_cost_microunits=0,
    )
    db.add(ev)
    db.flush()

    zustand = {
        "requested_model": "model-a",
        "routing": {
            "tier": "standard",
            "model": "model-a",
            "provider_id": p1.id,
            "provider_name": p1.name,
            "reason": "grey_zone_default",
            "weight": 0.5,
            "candidate_index": 0,
            "candidates": [
                {"provider_id": p1.id, "provider_name": p1.name, "model": "model-a", "tier": "standard", "weight": 0.5},
                {"provider_id": p2.id, "provider_name": p2.name, "model": "model-b", "tier": "standard", "weight": 2.0},
            ],
        },
    }
    run = AiRun(
        id=str(uuid4()),
        conversation_id=conv.id,
        user_id=regular_user.id,
        provider_id=p1.id,
        message_id=msg_id,
        status="running",
        state_json="{}",
    )
    db.add(run)
    db.commit()
    db.refresh(p1)
    p1_id, p2_id = p1.id, p2.id
    db.expunge(p1)
    vorbereitung = _Vorbereitung(
        run_id=run.id,
        user_id=regular_user.id,
        conversation_id=conv.id,
        provider=p1,
        api_key="sk-or-v1-test",
        message_id=msg_id,
        usage_event_id=ev.id,
        request_id=req_id,
        reasoning=False,
        reasoning_effort=None,
        token_price_micro_usd_per_million=None,
        zustand=zustand,
        angebotene_werkzeuge=frozenset(),
    )
    async_client = httpx.AsyncClient()
    anlauf = _Anlauf(
        vorbereitung=vorbereitung,
        client=async_client,
        zustand=zustand,
        provider_messages=[{"role": "system", "content": "System"}, {"role": "user", "content": "Hi"}],
        conversation_id=conv.id,
        user_id=regular_user.id,
        message_id=msg_id,
        guardian=None,
        aufgabe=None,
        rolle="voll",
        herkunft="panel",
        worker=None,
        unbeaufsichtigt=False,
    )

    async def fake_segment_anlaufen(_run_id, _client):
        return anlauf

    async def fake_werkzeuge_und_grenze(**_kw):
        return [], False, 100_000, False, None

    calls: list[int] = []

    async def fake_stream_chat_completion(_client, *, provider, usage, model=None, **_kw):
        calls.append(provider.id)
        if provider.id == p1_id:
            raise AiProviderRequestError("AI_PROVIDER_RATE_LIMITED", "429")
        usage.prompt_tokens = 20
        usage.completion_tokens = 10
        usage.total_tokens = 30
        usage.anfragen = 1
        yield StreamChunk("content", "Antwort von P2")

    monkeypatch.setattr(ai_stream, "_segment_anlaufen", fake_segment_anlaufen)
    monkeypatch.setattr(ai_stream, "_werkzeuge_und_grenze", fake_werkzeuge_und_grenze)
    monkeypatch.setattr(ai_stream, "stream_chat_completion", fake_stream_chat_completion)
    monkeypatch.setattr(stream_engine, "_gedaechtnis_vormerken", lambda _cid: _noop_async())

    try:
        await stream_engine.segment_ausfuehren(run.id, client=async_client)
    finally:
        await async_client.aclose()

    assert calls == [p1_id, p2_id]
    db.expire_all()
    msg_after = db.get(AiMessage, msg_id)
    assert msg_after is not None
    assert msg_after.status == "complete"
    assert msg_after.content == "Antwort von P2"
    assert msg_after.provider_id == p2_id
    assert msg_after.routed_model == "model-b"
    ev_after = db.get(AiUsageEvent, ev.id)
    assert ev_after is not None
    assert ev_after.accounted_tokens == 60  # 30 tokens * weight 2.0
    ai_router_service.clear_cooldowns()


def test_worker_start_routes_via_singra_router(
    db: Session,
    regular_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Ein über den Router gestarteter Worker klassifiziert seinen Auftrag über dieselbe Pipeline."""
    from services import ai_run_service, ai_worker_service
    from services.ai_embedding_service import Kodierung, MODEL_TAG

    ai_router_service._PROTO_CACHE.clear()
    ai_router_service.clear_cooldowns()

    role = _make_chat_user(db, regular_user, router_only=True)
    db.add(RolePermission(role_id=role.id, permission_key="ai.background.use"))
    db.commit()

    prov_eco = _create_chat_provider(db, name="Eco-Worker-Prov", default_model="eco-fast")
    prov_std = _create_chat_provider(
        db,
        name="Std-Worker-Prov",
        default_model="std-main",
        worker_enabled=True,
        worker_model="teures-worker-modell",
    )

    ai_router_service.update_router_config(
        db,
        {
            "enabled": True,
            "eco_models": [{"provider_id": prov_eco.id, "model": "eco-fast"}],
            "standard_models": [{"provider_id": prov_std.id, "model": "std-main"}],
        },
    )
    db.commit()

    def fake_encode(texts: list[str], db=None, nur_lokal=False):
        vecs = []
        for t in texts:
            low = t.lower()
            if (
                "kurze begrüßung" in low
                or "triviale einzelne" in low
                or "sag kurz hallo" in low
            ):
                vecs.append([1.0, 0.0, 0.0])
            elif "komplexe softwarearchitektur" in low or "vollständige app" in low:
                vecs.append([0.0, 0.0, 1.0])
            else:
                vecs.append([0.0, 1.0, 0.0])
        return Kodierung(vektoren=vecs, modell=MODEL_TAG)

    monkeypatch.setattr(ai_router_service.ai_embedding_service, "encode", fake_encode)
    monkeypatch.setattr(ai_run_service, "anlauf", lambda _db, _run: True)

    parent_conv = AiConversation(
        id=str(uuid4()),
        user_id=regular_user.id,
        kind="primary",
        title="Router Gehirn",
    )
    db.add(parent_conv)
    db.flush()
    parent_run = AiRun(
        id=str(uuid4()),
        conversation_id=parent_conv.id,
        user_id=regular_user.id,
        provider_id=prov_std.id,
        status="running",
        state_json='{"routing":{"tier":"standard","model":"std-main"}}',
    )
    db.add(parent_run)
    db.commit()

    res = ai_worker_service.worker_start(
        db,
        user=regular_user,
        arguments={"auftrag": "Sag kurz Hallo zur Begrüßung im Team", "titel": "Hallo"},
        conversation_id=parent_conv.id,
    )
    assert res["started"] is True

    worker_conv_id = res["worker_id"]
    worker_run = (
        db.query(AiRun)
        .filter(AiRun.conversation_id == worker_conv_id)
        .order_by(AiRun.created_at.desc())
        .first()
    )
    assert worker_run is not None
    assert worker_run.provider_id == prov_eco.id
    worker_state = ai_run_service.zustand_lesen(worker_run)
    assert worker_state["requested_model"] == "eco-fast"
    assert worker_state["routing"]["tier"] == "eco"
    assert worker_state["routing"]["reason"] == "semantic_local"

    worker_msg = (
        db.query(AiMessage)
        .filter(AiMessage.conversation_id == worker_conv_id, AiMessage.role == "assistant")
        .first()
    )
    assert worker_msg is not None
    assert worker_msg.model == "eco-fast"
    assert worker_msg.routed_model == "eco-fast"
    ai_router_service._PROTO_CACHE.clear()


def test_failover_handles_auth_payment_and_rejects_with_long_cooldown(
    db: Session,
    regular_user: User,
) -> None:
    """Auth-/Zahlungs-/Ablehnungsfehler triggern Failover + laengeren Cooldown; Safety-Stopp nicht."""
    import time

    for code in (
        "AI_PROVIDER_AUTH_FAILED",
        "AI_PROVIDER_KEY_MISSING",
        "AI_PROVIDER_PAYMENT_REQUIRED",
        "AI_PROVIDER_REQUEST_REJECTED",
        "AI_PROVIDER_PROTOCOL_ERROR",
    ):
        assert code in stream_engine._RETRYABLE_ROUTER_ERROR_CODES
    assert "AI_PROVIDER_SAFETY_STOPPED" not in stream_engine._RETRYABLE_ROUTER_ERROR_CODES

    ai_router_service.clear_cooldowns()
    p1 = _create_chat_provider(db, name="BadKey-P1", default_model="model-a")
    p2 = _create_chat_provider(db, name="Healthy-P2", default_model="model-b")

    conv = AiConversation(
        id=str(uuid4()),
        user_id=regular_user.id,
        kind="primary",
        title="Auth Failover Test",
    )
    db.add(conv)
    db.flush()

    msg_id = str(uuid4())
    req_id = str(uuid4())
    db.add(
        AiMessage(
            id=msg_id,
            conversation_id=conv.id,
            role="assistant",
            content="",
            status="streaming",
            provider_id=p1.id,
            model="model-a",
            routed_tier="standard",
            routed_model="model-a",
            routed_provider_name=p1.name,
            routed_reason="semantic_local",
            request_id=req_id,
        )
    )
    ev = AiUsageEvent(
        request_id=req_id,
        user_id=regular_user.id,
        provider_id=p1.id,
        model="model-a",
        status="reserved",
        reserved_tokens=50,
        reserved_cost_microunits=0,
        accounted_tokens=50,
        accounted_cost_microunits=0,
    )
    db.add(ev)
    db.flush()

    zustand = {
        "routing": {
            "tier": "standard",
            "model": "model-a",
            "provider_id": p1.id,
            "provider_name": p1.name,
            "weight": 1.0,
            "candidate_index": 0,
            "candidates": [
                {"provider_id": p1.id, "provider_name": p1.name, "model": "model-a", "tier": "standard", "weight": 1.0},
                {"provider_id": p2.id, "provider_name": p2.name, "model": "model-b", "tier": "standard", "weight": 1.0},
            ],
        }
    }
    run = AiRun(
        id=str(uuid4()),
        conversation_id=conv.id,
        user_id=regular_user.id,
        provider_id=p1.id,
        message_id=msg_id,
        status="running",
        state_json="{}",
    )
    db.add(run)
    db.commit()

    # Zweites Modell desselben kaputten Providers wird bei Auth-Fehler ebenfalls uebersprungen
    zustand_multi = {
        "routing": {
            "tier": "standard",
            "model": "model-a",
            "provider_id": p1.id,
            "provider_name": p1.name,
            "weight": 1.0,
            "candidate_index": 0,
            "candidates": [
                {"provider_id": p1.id, "provider_name": p1.name, "model": "model-a", "tier": "standard", "weight": 1.0},
                {"provider_id": p1.id, "provider_name": p1.name, "model": "model-a2", "tier": "standard", "weight": 1.0},
                {"provider_id": p2.id, "provider_name": p2.name, "model": "model-b", "tier": "standard", "weight": 1.0},
            ],
        }
    }
    switched = stream_engine._router_failover_schritt(
        run_id=run.id,
        user_id=regular_user.id,
        message_id=msg_id,
        usage_event_id=ev.id,
        failed_provider_id=p1.id,
        failed_model="model-a",
        zustand=zustand_multi,
        error_code="AI_PROVIDER_AUTH_FAILED",
    )
    assert switched is not None
    next_prov, _, next_routing = switched
    assert next_prov.id == p2.id
    assert next_routing["model"] == "model-b"

    assert ai_router_service.is_in_cooldown(p1.id, "model-a") is True
    assert ai_router_service.is_in_cooldown(p1.id, "model-a2") is True
    remaining = ai_router_service._COOLDOWNS[(p1.id, "*")] - time.monotonic()
    assert remaining > 120
    ai_router_service.clear_cooldowns()


def test_project_workspace_configure_preview_schema_accepts_port_and_healthcheck(
    db: Session,
    regular_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """configure_preview-Schema deckt port und healthcheck_path wie im Prompt versprochen ab."""
    from services.ai_action_errors import AiActionValidationError
    from services.ai_tools import project_tools

    props = project_tools._WORKSPACE["function"]["parameters"]["properties"]
    assert "port" in props
    assert props["port"]["type"] == "integer"
    assert "healthcheck_path" in props
    assert props["healthcheck_path"]["type"] == "string"

    monkeypatch.setattr(project_tools, "_pruefe_projekt_sperre", lambda *a, **kw: None)
    for bad_port in ("abc", True, 0, 70000):
        with pytest.raises(AiActionValidationError):
            project_tools.projekt_werkzeug(
                db,
                user=regular_user,
                arguments={"action": "configure_preview", "project_id": "p", "port": bad_port},
            )


def test_router_context_window_dynamic_for_pool_and_routed_message(
    client: TestClient,
    db: Session,
    regular_user: User,
    user_cookies: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Kontextmeter kennt das Fenster des Routers (Pool-Minimum vor erster Nachricht, dann konkretes Modell)."""
    from services import ai_model_catalog
    from services.ai_provider_registry import Modell

    _make_chat_user(db, regular_user, router_only=True, max_context_tokens=120_000)
    prov = _create_chat_provider(
        db,
        name="Ctx-Prov",
        default_model="model-200k",
        enabled_models=["model-200k", "gpt-6-luna"],
    )
    cfg = ai_router_service.update_router_config(
        db,
        {
            "enabled": True,
            "standard_models": [{"provider_id": prov.id, "model": "model-200k"}],
            "flagship_models": [{"provider_id": prov.id, "model": "gpt-6-luna"}],
        },
    )
    router_provider_id = cfg["router_provider_id"]
    db.commit()

    catalog = {
        "model-200k": Modell(model_id="model-200k", name="Model 200k", denkt=True, kontext_tokens=200_000, max_ausgabe_tokens=8_192, sieht=True),
        "gpt-6-luna": Modell(model_id="gpt-6-luna", name="GPT-6 Luna", denkt=True, kontext_tokens=1_000_000, max_ausgabe_tokens=16_384, sieht=True),
    }

    async def fake_fuer_provider(_client, _db, _provider, *, user_id=None, model_id=None):
        return catalog.get(model_id or _provider.default_model)

    monkeypatch.setattr(ai_model_catalog, "fuer_provider", fake_fuer_provider)

    conv = AiConversation(
        id=str(uuid4()),
        user_id=regular_user.id,
        kind="primary",
        title="Router Context Test",
    )
    db.add(conv)
    db.commit()

    # 1. Neue Unterhaltung ohne Nachricht -> Pool-Fenster (konservatives Minimum 200k), gedeckelt durch Rolle (120k)
    res1 = client.get(
        "/api/ai/conversation/context",
        params={"provider_id": router_provider_id, "conversation_id": conv.id},
        cookies=user_cookies,
    )
    assert res1.status_code == 200
    body1 = res1.json()
    assert body1["known"] is True
    assert body1["window_tokens"] == 200_000
    assert body1["usable_tokens"] == 120_000

    # 2. Nach einer gerouteten Nachricht (gpt-6-luna, 1M) -> dynamisch 1M-Fenster der laufenden Unterhaltung
    db.add(
        AiMessage(
            id=str(uuid4()),
            conversation_id=conv.id,
            role="assistant",
            content="Fertig.",
            status="complete",
            provider_id=prov.id,
            model="gpt-6-luna",
            routed_tier="flagship",
            routed_model="gpt-6-luna",
            routed_provider_name=prov.name,
            routed_reason="semantic_local",
        )
    )
    db.commit()

    res2 = client.get(
        "/api/ai/conversation/context",
        params={"provider_id": router_provider_id, "conversation_id": conv.id},
        cookies=user_cookies,
    )
    assert res2.status_code == 200
    body2 = res2.json()
    assert body2["known"] is True
    assert body2["window_tokens"] == 1_000_000
    assert body2["usable_tokens"] == 120_000


async def _noop_async() -> None:
    return None

