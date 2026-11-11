"""End-to-End- und Unit-Tests fuer Custom / Self-Hosted KI-Provider (`provider_kind="custom"`)."""

from __future__ import annotations

import json
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from config import settings
from models import AiProvider, Role, RolePermission, User
from services import (
    ai_context_window,
    ai_model_catalog,
    ai_model_price_service,
    ai_provider_registry,
    ai_provider_service,
    ai_reasoning,
    ai_stt_endpunkt,
)
from services.ai_limit_service import LIMIT_FIELDS, set_role_limit
from services.ai_provider_errors import AiProviderConfigurationError
from services.anthropic_messages_adapter import spricht_messages, stream_messages
from services.openai_compatible_adapter import (
    StreamUsage,
    _ThinkTagSplitter,
    stream_chat_completion,
)
from services.openai_responses_adapter import spricht_responses, stream_responses_http
from services.role_service import set_user_roles


@pytest.fixture(autouse=True)
def _clean_catalog_cache() -> None:
    ai_model_catalog.cache_leeren_fuer_tests()
    yield
    ai_model_catalog.cache_leeren_fuer_tests()


def _csrf(cookies: dict) -> dict[str, str]:
    return {"X-CSRF-Token": cookies.get("__Secure-csrf_token", "")}


def _enable_chat(db: Session, user: User) -> None:
    role = Role(name=f"ai-chat-custom-{user.id}-{uuid4().hex[:6]}", description=None, is_system=False)
    db.add(role)
    db.flush()
    db.add(RolePermission(role_id=role.id, permission_key="ai.chat.use"))
    set_role_limit(db, role.id, {field: None for field in LIMIT_FIELDS})
    db.commit()
    set_user_roles(db, user, [role.id])


def _custom_provider_row(
    *,
    pid: int = 101,
    url: str = "https://gpu-a.example.com/v1",
    model: str | None = "qwen3-32b",
    requires_api_key: bool = False,
    protocol: str = "chat_completions",
    dialect: str = "none",
    context_tokens: int | None = None,
    max_output_tokens: int | None = None,
    supports_vision: bool | None = None,
    transcription_model: str | None = None,
) -> AiProvider:
    return AiProvider(
        id=pid,
        name=f"Custom-{pid}",
        provider_kind="custom",
        default_model=model,
        enabled=True,
        requires_api_key=requires_api_key,
        custom_base_url=url,
        custom_chat_protocol=protocol,
        custom_reasoning_dialect=dialect,
        custom_context_tokens=context_tokens,
        custom_max_output_tokens=max_output_tokens,
        custom_supports_vision=supports_vision,
        transcription_model=transcription_model,
    )


# ── Service-Validierung, effective_spec & Key-Wipe ────────────────────────


def test_service_validates_custom_fields_and_pricing_skip(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(settings, "ai_custom_require_https", True)
    monkeypatch.setattr(
        ai_model_price_service,
        "_catalog",
        lambda: (_ for _ in ()).throw(AssertionError("OpenRouter-Preiskatalog darf bei custom nicht laufen")),
    )

    provider = ai_provider_service.create_provider(
        db,
        name="Lokales Ollama",
        provider_kind="custom",
        default_model="qwen3:32b",
        enabled=True,
        requires_api_key=False,
        operator_api_key=None,
        custom_base_url="http://127.0.0.1:11434/v1/",
        custom_chat_protocol="chat_completions",
        custom_reasoning_dialect="think_tags",
        custom_context_tokens=65536,
        custom_max_output_tokens=8192,
        custom_supports_vision=False,
    )
    assert provider.custom_base_url == "http://127.0.0.1:11434/v1"
    assert provider.operator_api_key_encrypted is None
    assert provider.custom_chat_protocol == "chat_completions"
    assert provider.custom_reasoning_dialect == "think_tags"
    assert provider.custom_context_tokens == 65536
    assert provider.custom_max_output_tokens == 8192
    assert provider.custom_supports_vision is False

    # Fehlende URL, ungueltiges Protokoll/Dialekt und kaputte Ganzzahlen werden abgewiesen.
    with pytest.raises(AiProviderConfigurationError):
        ai_provider_service.create_provider(
            db,
            name="Ohne URL",
            provider_kind="custom",
            default_model="llama3",
            enabled=True,
            requires_api_key=False,
            operator_api_key=None,
            custom_base_url=None,
        )
    with pytest.raises(AiProviderConfigurationError):
        ai_provider_service.create_provider(
            db,
            name="Bad Proto",
            provider_kind="custom",
            default_model="llama3",
            enabled=True,
            requires_api_key=False,
            operator_api_key=None,
            custom_base_url="http://127.0.0.1:11434/v1",
            custom_chat_protocol="grpc",
        )
    with pytest.raises(AiProviderConfigurationError):
        ai_provider_service.create_provider(
            db,
            name="Bad Dialekt",
            provider_kind="custom",
            default_model="llama3",
            enabled=True,
            requires_api_key=False,
            operator_api_key=None,
            custom_base_url="http://127.0.0.1:11434/v1",
            custom_reasoning_dialect="magic_tokens",
        )
    for bad_int in (True, False, 0, -10, 10_000_001):
        with pytest.raises(AiProviderConfigurationError):
            ai_provider_service.create_provider(
                db,
                name=f"BadCtx-{uuid4().hex[:4]}",
                provider_kind="custom",
                default_model="llama3",
                enabled=True,
                requires_api_key=False,
                operator_api_key=None,
                custom_base_url="http://127.0.0.1:11434/v1",
                custom_context_tokens=bad_int,  # type: ignore[arg-type]
            )
    # Realtime ist fuer Custom bewusst nicht moeglich.
    with pytest.raises(AiProviderConfigurationError):
        ai_provider_service.create_provider(
            db,
            name="Kein Realtime",
            provider_kind="custom",
            default_model="llama3",
            enabled=True,
            requires_api_key=False,
            operator_api_key=None,
            custom_base_url="http://127.0.0.1:11434/v1",
            realtime_default=True,
            realtime_model="gpt-realtime",
        )


def test_effective_spec_reflects_protocol_reasoning_and_auth_headers(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", False)
    monkeypatch.setattr(settings, "ai_custom_require_https", True)

    fixed = AiProvider(
        id=1, name="OR", provider_kind="openrouter", default_model="m", enabled=True, requires_api_key=True
    )
    assert ai_provider_service.effective_spec(fixed) is ai_provider_registry.anbieter("openrouter")

    cc_row = _custom_provider_row(
        url="https://vllm.example.com/v1/",
        protocol="chat_completions",
        dialect="reasoning",
    )
    cc_spec = ai_provider_service.effective_spec(cc_row, mit_adresse=True)
    assert cc_spec.protokoll_chat == "chat_completions"
    assert cc_spec.anfrage_erweiterungen == frozenset({"reasoning"})
    assert cc_spec.schluessel_kopf == "Authorization"
    assert cc_spec.schluessel_praefix == "Bearer "
    assert cc_spec.base_url == "https://vllm.example.com/v1"
    assert cc_spec.catalog_url == "https://vllm.example.com/v1/models"
    assert spricht_responses(cc_row) is False
    assert spricht_messages(cc_row) is False

    resp_row = _custom_provider_row(
        url="https://resp.example.com/v1",
        protocol="responses",
        dialect="reasoning_effort",
    )
    resp_spec = ai_provider_service.effective_spec(resp_row, mit_adresse=False)
    assert resp_spec.anfrage_erweiterungen == frozenset({"reasoning_effort"})
    assert spricht_responses(resp_row) is True
    assert spricht_messages(resp_row) is False

    anth_row = _custom_provider_row(
        url="https://claude-proxy.example.com",
        protocol="anthropic_messages",
        dialect="anthropic_thinking",
    )
    anth_spec = ai_provider_service.effective_spec(anth_row, mit_adresse=True)
    assert anth_spec.schluessel_kopf == "x-api-key"
    assert anth_spec.schluessel_praefix == ""
    assert anth_spec.anfrage_erweiterungen == frozenset()
    assert anth_spec.catalog_url == "https://claude-proxy.example.com/v1/models"
    assert spricht_messages(anth_row) is True
    assert spricht_responses(anth_row) is False

    bad_row = _custom_provider_row(url="http://127.0.0.1:11434/v1")
    with pytest.raises(AiProviderConfigurationError):
        ai_provider_service.effective_spec(bad_row, mit_adresse=True)


def test_update_provider_wipes_key_on_canonical_url_change_and_keeps_on_equivalent_url(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", False)
    monkeypatch.setattr(settings, "ai_custom_require_https", True)

    provider = ai_provider_service.create_provider(
        db,
        name="GPU A",
        provider_kind="custom",
        default_model="qwen3",
        enabled=True,
        requires_api_key=True,
        operator_api_key="secret-gpu-a-9999",
        custom_base_url="https://gpu-a.example.com/v1",
    )
    db.commit()
    original_cipher = provider.operator_api_key_encrypted
    assert original_cipher is not None

    # Kanonisch identische Schreibweise (Grossbuchstaben / Trailing-Slash) behaelt den Key.
    ai_provider_service.update_provider(
        db,
        provider,
        values={"custom_base_url": "HTTPS://GPU-A.example.com/v1/", "custom_context_tokens": 32768},
        operator_api_key=None,
        clear_operator_api_key=False,
    )
    assert provider.custom_base_url == "https://gpu-a.example.com/v1"
    assert provider.operator_api_key_encrypted == original_cipher

    # Zielwechsel ohne neuen Key loescht den gespeicherten Key, damit er nie abfliesst.
    ai_provider_service.update_provider(
        db,
        provider,
        values={"custom_base_url": "https://gpu-b.example.com/v1"},
        operator_api_key=None,
        clear_operator_api_key=False,
    )
    assert provider.custom_base_url == "https://gpu-b.example.com/v1"
    assert provider.operator_api_key_encrypted is None
    assert provider.operator_api_key_hint is None

    # Zielwechsel MIT neuem Key speichert genau den neuen Key.
    ai_provider_service.update_provider(
        db,
        provider,
        values={"custom_base_url": "https://gpu-c.example.com/v1"},
        operator_api_key="secret-gpu-c-4321",
        clear_operator_api_key=False,
    )
    assert provider.operator_api_key_encrypted is not None
    assert provider.operator_api_key_hint == "********4321"
    assert ai_provider_service.resolve_api_key(db, provider, 1) == "secret-gpu-c-4321"

    # Realtime laesst sich nachtraeglich ebenfalls nicht einschalten.
    with pytest.raises(AiProviderConfigurationError):
        ai_provider_service.update_provider(
            db,
            provider,
            values={"realtime_enabled": True},
            operator_api_key=None,
            clear_operator_api_key=False,
        )


# ── Router: CRUD, Preview, Chat-Auswahl & STT-Test ────────────────────────


def test_router_crud_and_available_list_never_leak_custom_url_or_secret(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
    csrf_token: str,
    regular_user: User,
    user_cookies: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(settings, "ai_custom_require_https", True)
    _enable_chat(db, regular_user)

    secret_token = "tok-super-secret-custom-5678"
    custom_url = "http://127.0.0.1:11434/v1"

    created = client.post(
        "/api/ai/settings/providers",
        json={
            "name": "Mein lokales vLLM",
            "provider_kind": "custom",
            "default_model": "Qwen/Qwen3-32B",
            "enabled_models": ["Qwen/Qwen3-32B", "whisper-large-v3"],
            "enabled": True,
            "requires_api_key": True,
            "standard_enabled": True,
            "custom_base_url": f"  {custom_url}/  ",
            "custom_chat_protocol": "chat_completions",
            "custom_reasoning_dialect": "think_tags",
            "custom_context_tokens": 131072,
            "custom_max_output_tokens": 16384,
            "custom_supports_vision": True,
            "operator_api_key": secret_token,
        },
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["provider_kind"] == "custom"
    assert body["custom_base_url"] == custom_url
    assert body["base_url"] == custom_url
    assert body["custom_reasoning_dialect"] == "think_tags"
    assert body["custom_context_tokens"] == 131072
    assert body["custom_max_output_tokens"] == 16384
    assert body["custom_supports_vision"] is True
    assert body["operator_key_configured"] is True
    assert secret_token not in created.text

    # Provider-Kinds melden custom korrekt ohne Realtime, aber mit Katalog & Gehoer.
    kinds_resp = client.get("/api/ai/settings/provider-kinds", cookies=owner_cookies)
    assert kinds_resp.status_code == 200
    custom_kind = next(k for k in kinds_resp.json() if k["kind"] == "custom")
    assert custom_kind["adresse_eintragbar"] is True
    assert custom_kind["realtime_tauglich"] is False
    assert custom_kind["sprachwege"] == []
    assert custom_kind["fuehrt_katalog"] is True
    assert custom_kind["kann_hoeren"] is True

    # Chat-Auswahl fuer normale Nutzer darf weder Ziel-URL noch Secret enthalten,
    # liefert aber Modellfaehigkeiten inkl. manueller Reasoning-Info.
    orig_client = client.app.state.ai_http_client
    client.app.state.ai_http_client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: httpx.Response(404))
    )
    try:
        avail_resp = client.get("/api/ai/providers", cookies=user_cookies)
    finally:
        awaitable = client.app.state.ai_http_client.aclose()
        client.app.state.ai_http_client = orig_client
        # TestClient-Schleife oder sync close vermeiden: asyncio.run auf MockTransport
        import asyncio
        asyncio.run(awaitable)

    assert avail_resp.status_code == 200, avail_resp.text
    assert custom_url not in avail_resp.text
    assert secret_token not in avail_resp.text
    avail_item = next(p for p in avail_resp.json() if p["id"] == body["id"])
    assert "custom_base_url" not in avail_item
    assert "base_url" not in avail_item
    assert avail_item["reasoning"] is True
    assert avail_item["can_disable"] is True

    # Loeschen ueber REST raeumt den Provider und den Cache auf.
    deleted = client.delete(
        f"/api/ai/settings/providers/{body['id']}",
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert deleted.status_code == 204


def test_router_custom_models_preview_reuses_key_only_for_matching_url_and_blocks_ssrf(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
    csrf_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", False)
    monkeypatch.setattr(settings, "ai_custom_require_https", True)

    saved = ai_provider_service.create_provider(
        db,
        name="Remote Preview Server",
        provider_kind="custom",
        default_model="qwen3",
        enabled=True,
        requires_api_key=True,
        operator_api_key="stored-preview-secret-1111",
        custom_base_url="https://preview-gpu.example.com/v1",
    )
    db.commit()

    # SSRF-Ziel wird sofort mit 400 abgewiesen.
    ssrf_resp = client.post(
        "/api/ai/settings/providers/custom-models-preview",
        json={"custom_base_url": "http://169.254.169.254/latest/meta-data"},
        cookies=owner_cookies,
        headers={"X-CSRF-Token": csrf_token},
    )
    assert ssrf_resp.status_code == 400

    observed_headers: list[dict[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        observed_headers.append({k.lower(): v for k, v in request.headers.items()})
        return httpx.Response(
            200,
            json={
                "data": [
                    {
                        "id": "qwen3-coder",
                        "max_model_len": 131072,
                        "capabilities": ["vision", "thinking"],
                    }
                ]
            },
        )

    orig_client = client.app.state.ai_http_client
    mock_http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client.app.state.ai_http_client = mock_http
    try:
        # 1. Gleiche kanonische URL + provider_id -> gespeicherter DB-Key geht mit.
        same_resp = client.post(
            "/api/ai/settings/providers/custom-models-preview",
            json={
                "custom_base_url": "HTTPS://preview-gpu.example.com/v1/",
                "custom_chat_protocol": "chat_completions",
                "provider_id": saved.id,
            },
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert same_resp.status_code == 200, same_resp.text
        models = same_resp.json()
        assert len(models) == 1
        assert models[0]["model_id"] == "qwen3-coder"
        assert models[0]["context_tokens"] == 131072
        assert models[0]["vision"] is True
        assert models[0]["reasoning"] is True
        assert observed_headers[-1].get("authorization") == "Bearer stored-preview-secret-1111"

        # 2. Geaenderte URL mit alter provider_id -> gespeicherter DB-Key darf NICHT mitgehen.
        changed_resp = client.post(
            "/api/ai/settings/providers/custom-models-preview",
            json={
                "custom_base_url": "https://other-gpu.example.com/v1",
                "custom_chat_protocol": "chat_completions",
                "provider_id": saved.id,
            },
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert changed_resp.status_code == 200
        assert "authorization" not in observed_headers[-1]

        # 3. Expliziter Header X-Provider-Api-Key hat Vorrang vor DB-Key.
        override_resp = client.post(
            "/api/ai/settings/providers/custom-models-preview",
            json={
                "custom_base_url": "https://other-gpu.example.com/v1",
                "custom_chat_protocol": "anthropic_messages",
                "provider_id": saved.id,
            },
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token, "X-Provider-Api-Key": "ephemeral-anth-key"},
        )
        assert override_resp.status_code == 200
        assert observed_headers[-1].get("x-api-key") == "ephemeral-anth-key"
    finally:
        import asyncio
        client.app.state.ai_http_client = orig_client
        asyncio.run(mock_http.aclose())


def test_router_test_endpoint_supports_stt_only_custom_provider(
    client: TestClient,
    db: Session,
    owner_cookies: dict,
    csrf_token: str,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(settings, "ai_custom_require_https", False)

    stt_provider = ai_provider_service.create_provider(
        db,
        name="Lokales Whisper",
        provider_kind="custom",
        default_model=None,
        transcription_model="whisper-1",
        enabled=True,
        requires_api_key=False,
        operator_api_key=None,
        custom_base_url="http://127.0.0.1:9000/v1",
    )
    db.commit()

    seen: list[tuple[str, str, bytes]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = request.read()
        seen.append((request.method, str(request.url), body))
        assert request.url.path == "/v1/audio/transcriptions"
        assert "multipart/form-data" in request.headers.get("content-type", "")
        assert b"aeusserung.wav" in body
        assert b"whisper-1" in body
        return httpx.Response(200, json={"text": ""})

    orig_client = client.app.state.ai_http_client
    mock_http = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    client.app.state.ai_http_client = mock_http
    try:
        resp = client.post(
            f"/api/ai/settings/providers/{stt_provider.id}/test",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
    finally:
        import asyncio
        client.app.state.ai_http_client = orig_client
        asyncio.run(mock_http.aclose())

    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ok": True, "code": None, "detail": None}
    assert len(seen) == 1


# ── _ThinkTagSplitter & Protokoll-Adapter ─────────────────────────────────


def test_think_tag_splitter_handles_split_tags_and_flush() -> None:
    splitter = _ThinkTagSplitter()
    pieces: list[tuple[str, str]] = []
    # Absichtlich mitten in "<think>" und "</think>" zerschnitten.
    for delta in ("Vorwort ", "<th", "ink>Schritt 1", "\nSchritt 2</th", "ink>Antwort", "<thi"):
        pieces.extend(splitter.process(delta))
    pieces.extend(splitter.flush())

    merged_reasoning = "".join(text for kind, text in pieces if kind == "reasoning")
    merged_content = "".join(text for kind, text in pieces if kind == "content")
    assert merged_reasoning == "Schritt 1\nSchritt 2"
    assert merged_content == "Vorwort Antwort<thi"

    # Unclosed <think> flusht den Rest sauber als reasoning.
    unclosed = _ThinkTagSplitter()
    out = unclosed.process("<think>Offener Gedanke") + unclosed.flush()
    assert out == [("reasoning", "Offener Gedanke")]


@pytest.mark.asyncio
async def test_chat_completions_adapter_custom_optional_key_and_think_tags_with_tools(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    provider = _custom_provider_row(
        url="http://127.0.0.1:11434/v1",
        requires_api_key=False,
        protocol="chat_completions",
        dialect="think_tags",
    )

    sent_headers: dict[str, str] = {}
    sent_body: dict = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent_headers.update({k.lower(): v for k, v in request.headers.items()})
        sent_body.update(json.loads(request.content))
        assert str(request.url) == "http://127.0.0.1:11434/v1/chat/completions"
        frames = (
            'data: {"choices":[{"delta":{"content":"<th"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":"ink>Pruefe Status.</thi"}}]}\n\n'
            'data: {"choices":[{"delta":{"content":"nk>Starte Werkzeug."}}]}\n\n'
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tc_1","function":{"name":"ping_node","arguments":"{\\"node\\":\\"a"}}]}}]}\n\n'
            'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"lpha\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx.Response(200, text=frames)

    usage = StreamUsage()
    chunks = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        async for ch in stream_chat_completion(
            client,
            provider=provider,
            api_key=None,
            messages=[{"role": "user", "content": "Check"}],
            usage=usage,
            tools=[{"type": "function", "function": {"name": "ping_node", "parameters": {"type": "object", "properties": {}}}}],
        ):
            chunks.append(ch)

    assert "authorization" not in sent_headers
    assert sent_body["model"] == "qwen3-32b"
    assert [(c.kind, c.text) for c in chunks if c.kind != "tool_ready"] == [
        ("reasoning", "Pruefe Status."),
        ("content", "Starte Werkzeug."),
        ("tool_start", "ping_node"),
    ]
    ready = [c for c in chunks if c.kind == "tool_ready"]
    assert len(ready) == 1 and ready[0].tool_call is not None
    assert ready[0].tool_call.name == "ping_node"
    assert ready[0].tool_call.arguments == {"node": "alpha"}


@pytest.mark.asyncio
async def test_responses_and_anthropic_adapters_route_custom_protocols_correctly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", False)
    monkeypatch.setattr(settings, "ai_custom_require_https", True)

    # 1. OpenAI Responses API Dialekt ueber Custom Provider
    resp_provider = _custom_provider_row(
        url="https://resp-custom.example.com/v1",
        requires_api_key=False,
        protocol="responses",
        dialect="reasoning_effort",
    )
    resp_calls: list[tuple[str, dict[str, str], dict]] = []

    def resp_handler(request: httpx.Request) -> httpx.Response:
        resp_calls.append(
            (str(request.url), {k.lower(): v for k, v in request.headers.items()}, json.loads(request.content))
        )
        sse = (
            'data: {"type":"response.created","response":{"id":"resp_99"}}\n\n'
            'data: {"type":"response.reasoning_summary_text.delta","delta":"Denke."}\n\n'
            'data: {"type":"response.output_text.delta","delta":"Erledigt."}\n\n'
            'data: {"type":"response.completed","response":{"id":"resp_99","usage":{"input_tokens":5,"output_tokens":3,"total_tokens":8}}}\n\n'
        )
        return httpx.Response(200, text=sse)

    resp_usage = StreamUsage()
    resp_out: list[tuple[str, str]] = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(resp_handler)) as client:
        async for ch in stream_chat_completion(
            client,
            provider=resp_provider,
            api_key=None,
            messages=[{"role": "user", "content": "Hi"}],
            usage=resp_usage,
            reasoning=True,
            reasoning_effort="high",
            use_websocket=False,
        ):
            resp_out.append((ch.kind, ch.text))

    assert resp_calls[0][0] == "https://resp-custom.example.com/v1/responses"
    assert resp_calls[0][1].get("openai-beta") == "responses=v1"
    assert resp_calls[0][2]["reasoning"] == {"effort": "high", "summary": "auto"}
    assert resp_out == [("reasoning", "Denke."), ("content", "Erledigt.")]

    # 2. Anthropic Messages API Dialekt ohne /v1-Dopplung & mit x-api-key + adaptive thinking
    anth_provider = _custom_provider_row(
        url="https://anth-custom.example.com/v1/",
        requires_api_key=True,
        protocol="anthropic_messages",
        dialect="anthropic_thinking",
    )
    anth_calls: list[tuple[str, dict[str, str], dict]] = []

    def anth_handler(request: httpx.Request) -> httpx.Response:
        anth_calls.append(
            (str(request.url), {k.lower(): v for k, v in request.headers.items()}, json.loads(request.content))
        )
        sse = (
            'data: {"type":"message_start","message":{"usage":{"input_tokens":7}}}\n\n'
            'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Ueberlege"}}\n\n'
            'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hallo!"}}\n\n'
            'data: {"type":"message_delta","usage":{"output_tokens":4}}\n\n'
            'data: {"type":"message_stop"}\n\n'
        )
        return httpx.Response(200, text=sse)

    anth_usage = StreamUsage()
    anth_out: list[tuple[str, str]] = []
    async with httpx.AsyncClient(transport=httpx.MockTransport(anth_handler)) as client:
        async for ch in stream_chat_completion(
            client,
            provider=anth_provider,
            api_key="anth-secret-key",
            messages=[{"role": "user", "content": "Hi"}],
            usage=anth_usage,
            reasoning=True,
            reasoning_effort=None,
        ):
            anth_out.append((ch.kind, ch.text))

    assert anth_calls[0][0] == "https://anth-custom.example.com/v1/messages"
    assert anth_calls[0][1].get("x-api-key") == "anth-secret-key"
    assert "authorization" not in anth_calls[0][1]
    assert anth_calls[0][2]["thinking"] == {"type": "adaptive"}
    assert anth_out == [("reasoning", "Ueberlege"), ("content", "Hallo!")]


# ── Katalog-Isolation, Overrides, Kontextfenster, Reasoning & STT ─────────


@pytest.mark.asyncio
async def test_catalog_cache_is_isolated_per_provider_id_and_applies_manual_overrides(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(settings, "ai_custom_require_https", False)

    p1 = _custom_provider_row(
        pid=201,
        url="http://127.0.0.1:11434/v1",
        model="custom-llm",
        context_tokens=98304,
        max_output_tokens=4096,
        supports_vision=True,
        dialect="think_tags",
    )
    p2 = _custom_provider_row(
        pid=202,
        url="http://127.0.0.1:8000/v1",
        model="vllm-other",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.port == 11434:
            # Ollama / OpenAI-Stil: Listenfeld fehlt im Modell -> Override fuellt auf.
            return httpx.Response(200, json={"data": [{"id": "custom-llm"}]})
        if request.url.port == 8000:
            return httpx.Response(
                200,
                json={"data": [{"id": "vllm-other", "max_model_len": 32768}]},
            )
        return httpx.Response(404)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        m1 = await ai_model_catalog.modelle(client, "custom", provider=p1)
        m2 = await ai_model_catalog.modelle(client, "custom", provider=p2)

    assert [m.model_id for m in m1] == ["custom-llm"]
    assert m1[0].kontext_tokens == 98304
    assert m1[0].max_ausgabe_tokens == 4096
    assert m1[0].sieht is True
    assert m1[0].denkt is True

    assert [m.model_id for m in m2] == ["vllm-other"]
    assert m2[0].kontext_tokens == 32768

    # Offline-Fallback in `finde()`: Wenn /models fehlschlaegt (500), liefern aktive Overrides trotzdem ein Modell.
    ai_model_catalog.cache_leeren_fuer_tests()
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: httpx.Response(500))
    ) as offline_client:
        found = await ai_model_catalog.finde(
            offline_client, "custom", "offline-model", provider=p1
        )
        assert found is not None
        assert found.model_id == "offline-model"
        assert found.kontext_tokens == 98304
        assert found.max_ausgabe_tokens == 4096
        assert found.sieht is True
        assert found.denkt is True

        # Kontextfenster- und Reasoning-Aufloesung ohne DB nutzen den Fallback mit Override.
        fenster = await ai_context_window.ermitteln(offline_client, p1)
        assert fenster.bekannt is True
        assert fenster.fenster_tokens == 98304
        assert fenster.sieht is True

        # Dialekt mit Stufen (`reasoning_effort`) ergaenzt Default-Stufen im Offline-Fallback.
        p_effort = _custom_provider_row(
            pid=203,
            url="http://127.0.0.1:9090/v1",
            model="effort-model",
            dialect="reasoning_effort",
        )
        aus = await ai_reasoning.aus_fuer(offline_client, p_effort)
        assert aus == (False, None)
        found_effort = await ai_model_catalog.finde(
            offline_client, "custom", "effort-model", provider=p_effort
        )
        assert found_effort is not None
        assert found_effort.denkt is True
        assert found_effort.stufen == ("low", "medium", "high")


@pytest.mark.asyncio
async def test_stt_endpunkt_works_for_custom_provider_without_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(settings, "ai_custom_require_https", False)

    provider = _custom_provider_row(
        pid=301,
        url="http://127.0.0.1:9001/v1/",
        model=None,
        requires_api_key=False,
        transcription_model="Systran/faster-whisper-large-v3",
    )

    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "http://127.0.0.1:9001/v1/audio/transcriptions"
        assert "authorization" not in {k.lower() for k in request.headers}
        return httpx.Response(200, json={"text": "Server Status"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        text = await ai_stt_endpunkt.abschrift(
            client,
            provider=provider,
            api_key=None,
            modell="Systran/faster-whisper-large-v3",
            wav=b"RIFF\x00\x00\x00\x00WAVE",
        )
    assert text == "Server Status"
