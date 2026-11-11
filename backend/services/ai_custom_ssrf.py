"""SSRF-Schutz, URL-Normalisierung und IP-Pinning fuer Custom-Provider.

Alle frei eingetragenen Adressen (`provider_kind="custom"`) laufen zwingend
durch dieses Modul:

1. **Syntaktische Pruefung & Normalisierung (`validate_custom_base_url`)**:
   Erlaubt nur ``http`` und ``https``, weist Benutzerangaben (``@``),
   Query-Strings (``?``), Fragmente (``#``), Zone-IDs (``%``) sowie Steuer-
   und Leerzeichen ab und prueft Literal-IPs sowie lokale Hostnamen gegen die
   Betreiber-Konfiguration.
2. **Zweistufige Ziel-Policy (Fail-Closed)**:
   * Unbedingt blockiert (auch bei ``ai_custom_allow_private_endpoints=True``):
     Link-Local und Cloud-Metadata (``169.254.0.0/16``, ``fe80::/10``,
     ``fd00:ec2::/112``), Unspecified/This-Network (``0.0.0.0/8``, ``::/128``),
     Multicast (``224.0.0.0/4``, ``ff00::/8``), Reserved/Broadcast sowie
     nicht-globale Tunnel-/Dokumentationsnetze.
   * Opt-in (``ai_custom_allow_private_endpoints=True``): Loopback
     (``127.0.0.0/8``, ``::1/128``), RFC 1918 (``10/8``, ``172.16/12``,
     ``192.168/16``), IPv6 ULA (``fc00::/7``) und CGNAT/Tailscale
     (``100.64.0.0/10``).
3. **DNS-Aufloesung & IP-Pinning gegen DNS-Rebinding (`PinnedAsyncTransport`)**:
   Loest den Host direkt vor dem Request auf, prueft **jede** zurueckgegebene
   IP gegen die Policy und verbindet anschliessend ueber `PinnedAsyncTransport`
   direkt zur gepinnten IP (mit unveraendertem ``Host``-Header und TLS-SNI),
   sodass `httpx` keine zweite DNS-Aufloesung durchfuehrt. ``follow_redirects``
   bleibt ausgeschaltet.
"""

from __future__ import annotations

import asyncio
import ipaddress
import socket
from typing import Final
from urllib.parse import urlsplit

import httpx

from config import settings
from services.ai_provider_errors import AiProviderConfigurationError

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address

#: Netze, die unter KEINEN Umstaenden erreicht werden duerfen — auch nicht bei
#: gesetztem ``ai_custom_allow_private_endpoints=True``.
_UNCONDITIONAL_BLOCKED_NETS: Final[tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]] = (
    ipaddress.ip_network("0.0.0.0/8"),         # Unspecified / "this network"
    ipaddress.ip_network("169.254.0.0/16"),    # IPv4 Link-Local & Cloud Metadata (IMDS)
    ipaddress.ip_network("192.0.0.0/24"),      # IETF Protocol Assignments
    ipaddress.ip_network("224.0.0.0/4"),       # IPv4 Multicast
    ipaddress.ip_network("240.0.0.0/4"),       # Reserved & Broadcast (255.255.255.255)
    ipaddress.ip_network("::/128"),            # IPv6 Unspecified
    ipaddress.ip_network("fe80::/10"),         # IPv6 Link-Local
    ipaddress.ip_network("ff00::/8"),          # IPv6 Multicast
    ipaddress.ip_network("fd00:ec2::/112"),    # AWS IPv6 EC2 Metadata/NTP/DNS (fd00:ec2::254)
)

#: Private/lokale Netze, die der Betreiber gezielt ueber
#: ``MSM_AI_CUSTOM_ALLOW_PRIVATE_ENDPOINTS=true`` freischalten kann.
_PRIVATE_ALLOWABLE_NETS: Final[tuple[ipaddress.IPv4Network | ipaddress.IPv6Network, ...]] = (
    ipaddress.ip_network("127.0.0.0/8"),       # IPv4 Loopback
    ipaddress.ip_network("10.0.0.0/8"),        # RFC 1918
    ipaddress.ip_network("172.16.0.0/12"),     # RFC 1918
    ipaddress.ip_network("192.168.0.0/16"),    # RFC 1918
    ipaddress.ip_network("100.64.0.0/10"),     # RFC 6598 CGNAT / Tailscale
    ipaddress.ip_network("::1/128"),           # IPv6 Loopback
    ipaddress.ip_network("fc00::/7"),          # IPv6 Unique Local (ULA)
)

_LOCAL_HOSTNAMES: Final[frozenset[str]] = frozenset({
    "localhost",
    "localhost.localdomain",
    "host.docker.internal",
    "gateway.docker.internal",
})

_LOCAL_HOSTNAME_SUFFIXES: Final[tuple[str, ...]] = (
    ".localhost",
    ".local",
    ".internal",
    ".home.arpa",
    ".lan",
)

_MAX_CUSTOM_URL_LEN: Final[int] = 512


def _unwrap_ip(ip: IPAddress) -> IPAddress:
    """Entpackt IPv4-mapped IPv6-Adressen (z. B. ``::ffff:127.0.0.1``)."""
    current: IPAddress = ip
    while isinstance(current, ipaddress.IPv6Address) and current.ipv4_mapped is not None:
        current = current.ipv4_mapped
    return current


def _parse_ip_literal(host: str) -> IPAddress | None:
    cleaned = host.strip()
    if cleaned.startswith("[") and cleaned.endswith("]"):
        cleaned = cleaned[1:-1]
    try:
        return ipaddress.ip_address(cleaned)
    except ValueError:
        # Faengt nicht-kanonische IPv4-Formen (z. B. 2130706433 oder 0177.0.0.1) ab.
        try:
            packed = socket.inet_aton(cleaned)
            return ipaddress.IPv4Address(packed)
        except OSError:
            return None


def _is_local_hostname(host: str) -> bool:
    normalized = host.rstrip(".").lower()
    if not normalized:
        return True
    if normalized in _LOCAL_HOSTNAMES:
        return True
    if any(normalized.endswith(suffix) for suffix in _LOCAL_HOSTNAME_SUFFIXES):
        return True
    # Einzelne Host-Labels ohne Punkt (z. B. Docker-Servicenamen ``ollama``, ``vllm``)
    if "." not in normalized:
        return True
    return False


def _classify_ip(ip: IPAddress) -> bool:
    """Prueft eine Ziel-IP gegen die Policy und gibt ``is_private`` zurueck."""
    if isinstance(ip, ipaddress.IPv6Address) and (ip.sixtofour is not None or ip.teredo is not None):
        raise AiProviderConfigurationError("Uebergangsadressen (6to4/Teredo) sind nicht zulaessig")
    unwrapped = _unwrap_ip(ip)

    if (
        unwrapped.is_multicast
        or unwrapped.is_link_local
        or unwrapped.is_unspecified
        or any(unwrapped in net for net in _UNCONDITIONAL_BLOCKED_NETS)
    ):
        raise AiProviderConfigurationError(
            "Link-Local-, Metadata-, Multicast- oder Broadcast-Adressen sind immer gesperrt"
        )

    if unwrapped.is_loopback or any(unwrapped in net for net in _PRIVATE_ALLOWABLE_NETS):
        if not settings.ai_custom_allow_private_endpoints:
            raise AiProviderConfigurationError(
                "Lokale oder private Endpunkte sind deaktiviert "
                "(MSM_AI_CUSTOM_ALLOW_PRIVATE_ENDPOINTS=false)"
            )
        return True

    if not unwrapped.is_global:
        raise AiProviderConfigurationError(
            "Diese IP-Adresse ist nicht oeffentlich routbar und unzulaessig"
        )
    return False


def _assert_scheme_allowed(scheme: str, *, is_private_target: bool) -> None:
    if scheme == "https":
        return
    if scheme != "http":
        raise AiProviderConfigurationError(
            "Nur die Protokolle http:// und https:// sind zulaessig"
        )
    if settings.ai_custom_require_https and not is_private_target:
        raise AiProviderConfigurationError(
            "Externe Custom-Provider-Endpunkte erfordern HTTPS (https://)"
        )


def validate_custom_base_url(raw_url: str | None) -> str:
    """Validiert und normalisiert eine frei eingetragene Custom-Basis-URL."""
    if raw_url is None:
        raise AiProviderConfigurationError("Basis-URL fuer den Custom-Provider fehlt")
    candidate = str(raw_url).strip()
    if not candidate:
        raise AiProviderConfigurationError("Basis-URL fuer den Custom-Provider darf nicht leer sein")
    if len(candidate) > _MAX_CUSTOM_URL_LEN:
        raise AiProviderConfigurationError(
            f"Basis-URL darf hoechstens {_MAX_CUSTOM_URL_LEN} Zeichen lang sein"
        )
    if any(ord(ch) < 32 or ord(ch) == 127 or ch in (" ", "\t", "\r", "\n") for ch in candidate):
        raise AiProviderConfigurationError("Basis-URL enthaelt unzulaessige Steuer- oder Leerzeichen")
    if "?" in candidate or "#" in candidate:
        raise AiProviderConfigurationError(
            "Query-Parameter (?) und Fragmente (#) sind in der Basis-URL nicht zulaessig"
        )

    parsed = urlsplit(candidate)
    scheme = (parsed.scheme or "").lower()
    if scheme not in {"http", "https"}:
        raise AiProviderConfigurationError(
            "Basis-URL muss mit https:// oder http:// beginnen"
        )
    if parsed.username is not None or parsed.password is not None or "@" in (parsed.netloc or ""):
        raise AiProviderConfigurationError(
            "Benutzerangaben (@) sind in der Basis-URL nicht zulaessig"
        )
    if parsed.query or parsed.fragment:
        raise AiProviderConfigurationError(
            "Query-Parameter und Fragmente sind in der Basis-URL nicht zulaessig"
        )

    host = parsed.hostname
    if not host:
        raise AiProviderConfigurationError("Basis-URL enthaelt keinen gueltigen Hostnamen")
    if "%" in host or "%" in (parsed.netloc or ""):
        raise AiProviderConfigurationError("Zone-IDs (%) sind in der Basis-URL nicht zulaessig")

    try:
        port = parsed.port
    except ValueError as exc:
        raise AiProviderConfigurationError("Ungueltiger Port in der Basis-URL") from exc
    if port is not None and (port < 1 or port > 65535):
        raise AiProviderConfigurationError("Port muss zwischen 1 und 65535 liegen")

    ip_literal = _parse_ip_literal(host)
    if ip_literal is not None:
        is_private = _classify_ip(ip_literal)
        _assert_scheme_allowed(scheme, is_private_target=is_private)
        canonical_ip = str(ip_literal)
        host_repr = f"[{canonical_ip}]" if isinstance(ip_literal, ipaddress.IPv6Address) else canonical_ip
    else:
        normalized_host = host.rstrip(".").lower()
        is_local_name = _is_local_hostname(normalized_host)
        if is_local_name and not settings.ai_custom_allow_private_endpoints:
            raise AiProviderConfigurationError(
                "Lokale Hostnamen sind deaktiviert (MSM_AI_CUSTOM_ALLOW_PRIVATE_ENDPOINTS=false)"
            )
        _assert_scheme_allowed(scheme, is_private_target=is_local_name)
        host_repr = normalized_host

    netloc = f"{host_repr}:{port}" if port is not None else host_repr
    path = parsed.path.rstrip("/")
    return f"{scheme}://{netloc}{path}"


def anthropic_messages_target(base_url: str) -> str:
    """Leitet die vollstaendige Anthropic-Messages-URL ab, ohne ``/v1`` zu doppeln."""
    cleaned = base_url.rstrip("/")
    if cleaned.endswith("/v1/messages"):
        return cleaned
    if cleaned.endswith("/v1"):
        return f"{cleaned}/messages"
    return f"{cleaned}/v1/messages"


def custom_catalog_target(base_url: str, chat_protocol: str) -> str:
    """Leitet die ``/models``-Adresse aus der Basis-URL und dem Protokoll ab."""
    cleaned = base_url.rstrip("/")
    if chat_protocol == "anthropic_messages" and not cleaned.endswith("/v1"):
        return f"{cleaned}/v1/models"
    return f"{cleaned}/models"


def resolve_and_validate_host(url: str) -> tuple[str, int, str, bool]:
    """Loest den Host einer validierten Custom-URL auf und prueft **alle** Ziel-IPs.

    Rueckgabe: ``(pinned_ip, port, original_host, is_https)``.
    """
    canonical = validate_custom_base_url(url)
    parsed = urlsplit(canonical)
    scheme = parsed.scheme.lower()
    is_https = scheme == "https"
    original_host = parsed.hostname or ""
    port = parsed.port or (443 if is_https else 80)

    ip_literal = _parse_ip_literal(original_host)
    if ip_literal is not None:
        is_private = _classify_ip(ip_literal)
        _assert_scheme_allowed(scheme, is_private_target=is_private)
        return str(ip_literal), port, original_host, is_https

    try:
        infos = socket.getaddrinfo(
            original_host,
            port,
            family=socket.AF_UNSPEC,
            type=socket.SOCK_STREAM,
        )
    except OSError as exc:
        raise AiProviderConfigurationError(
            f"Host „{original_host}“ konnte nicht aufgeloest werden"
        ) from exc

    resolved_ips: list[IPAddress] = []
    seen: set[str] = set()
    for _family, _socktype, _proto, _canonname, sockaddr in infos:
        raw_ip = sockaddr[0].split("%", 1)[0]
        if raw_ip in seen:
            continue
        seen.add(raw_ip)
        resolved_ips.append(ipaddress.ip_address(raw_ip))

    if not resolved_ips:
        raise AiProviderConfigurationError(
            f"Keine gueltige IP-Adresse fuer „{original_host}“ gefunden"
        )

    for resolved_ip in resolved_ips:
        is_private = _classify_ip(resolved_ip)
        _assert_scheme_allowed(scheme, is_private_target=is_private)

    return str(resolved_ips[0]), port, original_host, is_https


class PinnedAsyncTransport(httpx.AsyncHTTPTransport):
    """HTTP-Transport mit fest gepinnter Ziel-IP gegen DNS-Rebinding."""

    def __init__(
        self,
        *,
        pinned_ip: str,
        original_host: str,
        port: int,
        is_https: bool,
        **kwargs,
    ) -> None:
        super().__init__(**kwargs)
        self.pinned_ip = pinned_ip
        self.original_host = original_host
        self.port = port
        self.scheme = "https" if is_https else "http"

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        req_scheme = (request.url.scheme or "").lower()
        req_host = (request.url.host or "").strip("[]").lower()
        req_port = request.url.port or (443 if req_scheme == "https" else 80)
        if (
            req_scheme != self.scheme
            or req_host != self.original_host.lower()
            or req_port != self.port
        ):
            raise AiProviderConfigurationError(
                "Anfrage verlaesst den gepinnten Zielhost"
            )

        ip_host = f"[{self.pinned_ip}]" if ":" in self.pinned_ip else self.pinned_ip
        pinned_url = request.url.copy_with(host=ip_host)

        default_port = 443 if self.scheme == "https" else 80
        host_header_base = (
            f"[{self.original_host}]" if ":" in self.original_host else self.original_host
        )
        host_header = (
            f"{host_header_base}:{self.port}"
            if self.port != default_port
            else host_header_base
        )

        headers = request.headers.copy()
        headers["host"] = host_header

        extensions = dict(request.extensions)
        if self.scheme == "https" and _parse_ip_literal(self.original_host) is None:
            extensions["sni_hostname"] = self.original_host

        pinned_request = httpx.Request(
            method=request.method,
            url=pinned_url,
            headers=headers,
            stream=request.stream,
            extensions=extensions,
        )
        return await super().handle_async_request(pinned_request)


def pinned_http_client(
    base_client: httpx.AsyncClient | None,
    url: str,
) -> tuple[httpx.AsyncClient, bool]:
    """Erstellt bei Bedarf einen isolierten Client mit gepinnter IP-Verbindung.

    Fuehrt immer `validate_custom_base_url(url)` aus. Ist ``base_client`` ein
    Mock-Transport aus Tests, wird ``(base_client, False)`` zurueckgegeben. Bei
    echten Netzwerk-Transporten (``httpx.AsyncHTTPTransport`` oder ``None``) wird
    der Host einmalig aufgeloest, jede IP geprueft und ein kurzlebiger
    ``httpx.AsyncClient`` mit ``follow_redirects=False``, ``trust_env=False``
    und ``PinnedAsyncTransport`` zurueckgegeben (muss vom Aufrufer geschlossen
    werden, sobald das zweite Tupel-Element ``True`` ist).
    """
    canonical = validate_custom_base_url(url)
    underlying_transport = getattr(base_client, "_transport", None) if base_client is not None else None
    if base_client is not None and not isinstance(underlying_transport, httpx.AsyncHTTPTransport):
        return base_client, False

    pinned_ip, port, original_host, is_https = resolve_and_validate_host(canonical)
    timeout = base_client.timeout if base_client is not None else httpx.Timeout(60.0)
    transport = PinnedAsyncTransport(
        pinned_ip=pinned_ip,
        original_host=original_host,
        port=port,
        is_https=is_https,
    )
    client = httpx.AsyncClient(
        transport=transport,
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
    )
    return client, True


async def pinned_http_client_async(
    base_client: httpx.AsyncClient | None,
    url: str,
) -> tuple[httpx.AsyncClient, bool]:
    """Asynchrone Variante von ``pinned_http_client`` ohne Event-Loop-Blockade.

    Lagert ``socket.getaddrinfo`` ueber ``asyncio.to_thread`` in den Worker-Pool
    aus, damit langsame DNS-Antworten in async-Adaptern und Routen niemals die
    Ereignisschleife anhalten.
    """
    canonical = validate_custom_base_url(url)
    underlying_transport = getattr(base_client, "_transport", None) if base_client is not None else None
    if base_client is not None and not isinstance(underlying_transport, httpx.AsyncHTTPTransport):
        return base_client, False

    pinned_ip, port, original_host, is_https = await asyncio.to_thread(
        resolve_and_validate_host, canonical
    )
    timeout = base_client.timeout if base_client is not None else httpx.Timeout(60.0)
    transport = PinnedAsyncTransport(
        pinned_ip=pinned_ip,
        original_host=original_host,
        port=port,
        is_https=is_https,
    )
    client = httpx.AsyncClient(
        transport=transport,
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
    )
    return client, True
