"""SSRF-Schutz, URL-Normalisierung und DNS-Rebinding-Abwehr fuer Custom-Provider."""

from __future__ import annotations

import socket

import httpx
import pytest

from config import settings
from services import ai_custom_ssrf
from services.ai_provider_errors import AiProviderConfigurationError


# ── URL-Syntax & Normalisierung ───────────────────────────────────────────


@pytest.mark.parametrize(
    "bad_url",
    [
        None,
        "",
        "   ",
        "https://" + ("a" * 510) + ".example.com",
        "https://api.example.com/v1\nfoo",
        "https://api.example.com/v 1",
        "https://api.example.com/v1\tbar",
        "https://api.example.com/v1\rfoo",
        "https://api.example.com/v1\x00",
        "https://api.example.com/v1?token=secret",
        "https://api.example.com/v1#fragment",
        "https://user:pass@api.example.com/v1",
        "https://user@api.example.com/v1",
        "http://[fe80::1%eth0]:8080/v1",
        "https://127.0.0.1%25/v1",
        "ftp://api.example.com/v1",
        "file:///etc/passwd",
        "ws://api.example.com/v1",
        "api.example.com/v1",
        "https:///v1",
        "https://api.example.com:0/v1",
        "https://api.example.com:65536/v1",
        "https://api.example.com:abc/v1",
    ],
)
def test_validate_custom_base_url_rejects_malformed_or_disallowed_syntax(
    bad_url: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(settings, "ai_custom_require_https", False)
    with pytest.raises(AiProviderConfigurationError):
        ai_custom_ssrf.validate_custom_base_url(bad_url)


def test_validate_custom_base_url_normalizes_scheme_host_slashes_and_ipv6(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(settings, "ai_custom_require_https", True)

    assert (
        ai_custom_ssrf.validate_custom_base_url("\t  HTTPS://Api.Example.COM.:8443/v1/// \n")
        == "https://api.example.com:8443/v1"
    )
    assert (
        ai_custom_ssrf.validate_custom_base_url("https://[2606:4700:4700:0:0:0:0:1111]/v1/")
        == "https://[2606:4700:4700::1111]/v1"
    )
    assert (
        ai_custom_ssrf.validate_custom_base_url("http://[::ffff:127.0.0.1]:8000/v1/")
        == "http://[::ffff:127.0.0.1]:8000/v1"
    )


# ── Ziel-IP-Policy (unbedingt vs. opt-in) ─────────────────────────────────


@pytest.mark.parametrize(
    "blocked_url",
    [
        "http://169.254.169.254/latest/meta-data",
        "https://169.254.169.254/v1",
        "http://0.0.0.0:8080/v1",
        "http://0.1.2.3/v1",
        "http://192.0.0.1/v1",
        "http://224.0.0.1/v1",
        "http://255.255.255.255/v1",
        "http://240.0.0.1/v1",
        "http://[::]/v1",
        "http://[fe80::1]/v1",
        "http://[ff02::1]/v1",
        "http://[fd00:ec2::254]/latest/meta-data",
        "https://[2002:c000:0201::1]/v1",  # 6to4
        "https://[2001:0000:4136:e378:8000:63bf:3fff:fdd2]/v1",  # Teredo
        "http://[::ffff:169.254.169.254]/latest/meta-data",
        "https://192.0.2.1/v1",  # TEST-NET-1 (nicht global)
        "https://[2001:db8::1]/v1",  # IPv6 Dokumentation (nicht global)
        "http://2852039166/v1",  # 169.254.169.254 dezimal
    ],
)
def test_unconditional_blocked_ips_stay_blocked_even_when_private_enabled(
    blocked_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(settings, "ai_custom_require_https", False)
    with pytest.raises(AiProviderConfigurationError):
        ai_custom_ssrf.validate_custom_base_url(blocked_url)


@pytest.mark.parametrize(
    "private_url",
    [
        "http://127.0.0.1:11434/v1",
        "http://2130706433:11434/v1",  # 127.0.0.1 dezimal
        "http://0177.0.0.1:11434/v1",  # 127.0.0.1 oktal
        "http://[::1]:11434/v1",
        "http://[::ffff:127.0.0.1]:11434/v1",
        "http://10.0.0.5:8000/v1",
        "http://172.16.0.10:8000/v1",
        "http://192.168.1.50:1234/v1",
        "http://100.64.0.1:8080/v1",  # Tailscale / CGNAT
        "http://[fc00::1]:8080/v1",
        "http://localhost:11434/v1",
        "http://localhost.localdomain:11434/v1",
        "http://host.docker.internal:11434/v1",
        "http://gateway.docker.internal:11434/v1",
        "http://gpu.localhost:8000/v1",
        "http://macmini.local:1234/v1",
        "http://vllm.internal:8000/v1",
        "http://nas.home.arpa:8080/v1",
        "http://worker.lan:8080/v1",
        "http://ollama:11434/v1",
        "http://vllm:8000/v1",
    ],
)
def test_private_and_local_targets_respect_allow_private_endpoints_flag(
    private_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "ai_custom_require_https", True)

    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", False)
    with pytest.raises(AiProviderConfigurationError):
        ai_custom_ssrf.validate_custom_base_url(private_url)

    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    normalized = ai_custom_ssrf.validate_custom_base_url(private_url)
    assert normalized.startswith("http://")


def test_https_policy_rejects_plain_http_on_public_targets_unless_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(settings, "ai_custom_require_https", True)

    with pytest.raises(AiProviderConfigurationError):
        ai_custom_ssrf.validate_custom_base_url("http://api.example.com/v1")
    with pytest.raises(AiProviderConfigurationError):
        ai_custom_ssrf.validate_custom_base_url("http://93.184.216.34/v1")

    assert (
        ai_custom_ssrf.validate_custom_base_url("https://api.example.com/v1")
        == "https://api.example.com/v1"
    )
    # Lokales Ziel darf trotz ai_custom_require_https=True ueber http:// laufen.
    assert (
        ai_custom_ssrf.validate_custom_base_url("http://127.0.0.1:11434/v1")
        == "http://127.0.0.1:11434/v1"
    )

    monkeypatch.setattr(settings, "ai_custom_require_https", False)
    assert (
        ai_custom_ssrf.validate_custom_base_url("http://api.example.com/v1")
        == "http://api.example.com/v1"
    )


# ── Ziel-URL-Helfer ───────────────────────────────────────────────────────


def test_target_url_helpers_avoid_v1_doubling() -> None:
    assert (
        ai_custom_ssrf.anthropic_messages_target("https://proxy.example.com")
        == "https://proxy.example.com/v1/messages"
    )
    assert (
        ai_custom_ssrf.anthropic_messages_target("https://proxy.example.com/v1/")
        == "https://proxy.example.com/v1/messages"
    )
    assert (
        ai_custom_ssrf.anthropic_messages_target("https://proxy.example.com/v1/messages")
        == "https://proxy.example.com/v1/messages"
    )

    assert (
        ai_custom_ssrf.custom_catalog_target("https://proxy.example.com", "anthropic_messages")
        == "https://proxy.example.com/v1/models"
    )
    assert (
        ai_custom_ssrf.custom_catalog_target("https://proxy.example.com/v1", "anthropic_messages")
        == "https://proxy.example.com/v1/models"
    )
    assert (
        ai_custom_ssrf.custom_catalog_target("https://ollama.example.com/v1", "chat_completions")
        == "https://ollama.example.com/v1/models"
    )


# ── DNS-Aufloesung & Rebinding-Schutz ─────────────────────────────────────


def _fake_addrinfo(*ips: str):
    def _resolver(host: str, port: int, family: int = 0, type: int = 0):
        out = []
        for ip in ips:
            af = socket.AF_INET6 if ":" in ip else socket.AF_INET
            sockaddr = (ip, port, 0, 0) if af == socket.AF_INET6 else (ip, port)
            out.append((af, type, 0, "", sockaddr))
        return out

    return _resolver


def test_resolve_and_validate_host_checks_all_returned_dns_ips(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_require_https", True)
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", False)

    # Gemischte Antwort (oeffentlich + 127.0.0.1) darf niemals passieren.
    monkeypatch.setattr(socket, "getaddrinfo", _fake_addrinfo("93.184.216.34", "127.0.0.1"))
    with pytest.raises(AiProviderConfigurationError):
        ai_custom_ssrf.resolve_and_validate_host("https://rebind.example.com/v1")

    # Auch mit erlaubten privaten Zielen bleibt Link-Local / IMDS in Zweitantwort gesperrt.
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(socket, "getaddrinfo", _fake_addrinfo("93.184.216.34", "169.254.169.254"))
    with pytest.raises(AiProviderConfigurationError):
        ai_custom_ssrf.resolve_and_validate_host("https://rebind.example.com/v1")

    # Reine oeffentliche Antworten passieren und liefern die erste IP zum Pinning.
    monkeypatch.setattr(socket, "getaddrinfo", _fake_addrinfo("93.184.216.34", "93.184.216.35"))
    pinned_ip, port, original_host, is_https = ai_custom_ssrf.resolve_and_validate_host(
        "https://api.example.com:8443/v1"
    )
    assert (pinned_ip, port, original_host, is_https) == (
        "93.184.216.34",
        8443,
        "api.example.com",
        True,
    )

    # Leere DNS-Antwort oder OSError werden als Konfigurationsfehler abgefangen.
    monkeypatch.setattr(socket, "getaddrinfo", _fake_addrinfo())
    with pytest.raises(AiProviderConfigurationError):
        ai_custom_ssrf.resolve_and_validate_host("https://empty.example.com/v1")

    def _fail_dns(*_args, **_kwargs):
        raise OSError("dns down")

    monkeypatch.setattr(socket, "getaddrinfo", _fail_dns)
    with pytest.raises(AiProviderConfigurationError):
        ai_custom_ssrf.resolve_and_validate_host("https://missing.example.com/v1")


def test_resolve_and_validate_host_skips_dns_for_ip_literals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", True)
    monkeypatch.setattr(settings, "ai_custom_require_https", False)
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *_a, **_kw: (_ for _ in ()).throw(AssertionError("DNS darf bei IP nicht laufen")),
    )
    assert ai_custom_ssrf.resolve_and_validate_host("http://127.0.0.1:11434/v1") == (
        "127.0.0.1",
        11434,
        "127.0.0.1",
        False,
    )


# ── PinnedAsyncTransport & Client-Fabrik ──────────────────────────────────


@pytest.mark.asyncio
async def test_pinned_transport_rewrites_url_sets_host_and_sni_and_blocks_target_escape(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[httpx.Request] = []

    async def fake_super_handle(self, request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, request=request, json={"ok": True})

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", fake_super_handle)

    transport = ai_custom_ssrf.PinnedAsyncTransport(
        pinned_ip="93.184.216.34",
        original_host="api.example.com",
        port=443,
        is_https=True,
    )
    try:
        req = httpx.Request("POST", "https://api.example.com/v1/chat/completions")
        resp = await transport.handle_async_request(req)
        assert resp.status_code == 200
    finally:
        await transport.aclose()

    assert len(captured) == 1
    pinned_req = captured[0]
    assert pinned_req.url.host == "93.184.216.34"
    assert pinned_req.url.path == "/v1/chat/completions"
    assert pinned_req.headers["host"] == "api.example.com"
    assert pinned_req.extensions.get("sni_hostname") == "api.example.com"

    # Sonderport bleibt im Host-Header; IPv6-Ziel wird geklammert; IP-Literal erhaelt kein SNI.
    captured.clear()
    v6_transport = ai_custom_ssrf.PinnedAsyncTransport(
        pinned_ip="2606:4700:4700::1111",
        original_host="2606:4700:4700::1111",
        port=8443,
        is_https=True,
    )
    try:
        req_v6 = httpx.Request("GET", "https://[2606:4700:4700::1111]:8443/v1/models")
        await v6_transport.handle_async_request(req_v6)
    finally:
        await v6_transport.aclose()

    assert len(captured) == 1
    assert "[2606:4700:4700::1111]" in str(captured[0].url)
    assert captured[0].headers["host"] == "[2606:4700:4700::1111]:8443"
    assert "sni_hostname" not in captured[0].extensions

    # Ausbrechen auf fremden Host, fremden Port oder anderes Schema scheitert.
    guarded = ai_custom_ssrf.PinnedAsyncTransport(
        pinned_ip="93.184.216.34",
        original_host="api.example.com",
        port=443,
        is_https=True,
    )
    try:
        for bad_target in (
            "https://other.example.com/v1/models",
            "https://api.example.com:8443/v1/models",
            "http://api.example.com/v1/models",
        ):
            with pytest.raises(AiProviderConfigurationError):
                await guarded.handle_async_request(httpx.Request("GET", bad_target))
    finally:
        await guarded.aclose()


@pytest.mark.asyncio
async def test_pinned_http_client_factories_wrap_real_transports_and_validate_mocks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "ai_custom_allow_private_endpoints", False)
    monkeypatch.setattr(settings, "ai_custom_require_https", True)

    mock_client = httpx.AsyncClient(
        transport=httpx.MockTransport(lambda req: httpx.Response(200))
    )
    try:
        with pytest.raises(AiProviderConfigurationError):
            ai_custom_ssrf.pinned_http_client(mock_client, "http://127.0.0.1:11434/v1")
        with pytest.raises(AiProviderConfigurationError):
            await ai_custom_ssrf.pinned_http_client_async(
                mock_client, "http://169.254.169.254/latest/meta-data"
            )

        returned, owned = await ai_custom_ssrf.pinned_http_client_async(
            mock_client, "https://api.example.com/v1"
        )
        assert returned is mock_client
        assert owned is False
    finally:
        await mock_client.aclose()

    # Echter Transport wird gewrappt, pinnt IP, deaktiviert Redirects und trust_env.
    monkeypatch.setattr(socket, "getaddrinfo", _fake_addrinfo("93.184.216.34"))
    real_base = httpx.AsyncClient(timeout=httpx.Timeout(12.0))
    sync_client, sync_owned = ai_custom_ssrf.pinned_http_client(
        real_base, "https://api.example.com/v1"
    )
    async_client, async_owned = await ai_custom_ssrf.pinned_http_client_async(
        real_base, "https://api.example.com/v1"
    )
    try:
        for created, is_owned in ((sync_client, sync_owned), (async_client, async_owned)):
            assert is_owned is True
            assert isinstance(created._transport, ai_custom_ssrf.PinnedAsyncTransport)
            assert created._transport.pinned_ip == "93.184.216.34"
            assert created.follow_redirects is False
            assert created.trust_env is False
            assert created.timeout == real_base.timeout
    finally:
        await sync_client.aclose()
        await async_client.aclose()
        await real_base.aclose()
