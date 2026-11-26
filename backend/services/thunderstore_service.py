"""Thunderstore Public API v1 Client.

Kein API-Key erforderlich. Laedt den Community-Paketindex einmalig pro
Community in einen In-Memory TTL-Cache (5 Minuten) und filtert/paginiert lokal.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

logger = logging.getLogger(__name__)

THUNDERSTORE_USER_AGENT = "MauntingStudios/MSM (https://mauntingstudios.de)"
THUNDERSTORE_CACHE_TTL_SECONDS = 300
_COMMUNITY_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_PKG_ID_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_THUNDERSTORE_URL_RE = re.compile(
    r"https?://(?:www\.)?thunderstore\.io/c/[a-z0-9-]+/p/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)",
    re.IGNORECASE,
)


class ThunderstoreApiUnavailable(RuntimeError):
    """Wird geworfen, wenn Thunderstore nicht erreichbar ist."""

    def __init__(self, code: str = "thunderstore_api_unavailable", detail: str = "") -> None:
        self.code = code
        self.detail = detail
        super().__init__(detail or code)


@dataclass
class ThunderstorePackageInfo:
    full_name: str  # Owner-Name
    owner: str
    name: str
    description: str
    downloads: int
    rating_score: int
    created: datetime
    updated: datetime
    categories: list[str] = field(default_factory=list)
    icon_url: Optional[str] = None
    package_url: str = ""
    latest_version: str = ""
    download_url: str = ""
    file_size: int = 0
    dependencies: list[str] = field(default_factory=list)
    is_deprecated: bool = False
    is_modpack: bool = False

    @property
    def publishedfileid(self) -> str:
        return f"thunderstore:{self.full_name}"


def strip_thunderstore_prefix(raw_id: str) -> str:
    val = str(raw_id or "").strip()
    if val.lower().startswith("thunderstore:"):
        val = val.split(":", 1)[1].strip()
    return val


def is_valid_thunderstore_id(pkg_id: str) -> bool:
    if not pkg_id or ".." in pkg_id:
        return False
    return bool(_PKG_ID_RE.fullmatch(pkg_id))


def extract_thunderstore_url_query(query: str) -> str:
    """Extrahiert Owner-Name aus einer eingefuegten Thunderstore-URL."""
    q = (query or "").strip()
    m = _THUNDERSTORE_URL_RE.search(q)
    if m:
        return f"{m.group(1)}-{m.group(2)}"
    return q


def _parse_iso_dt(value: Any) -> datetime:
    if isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _parse_package(raw: dict[str, Any]) -> ThunderstorePackageInfo | None:
    full_name = str(raw.get("full_name") or "").strip()
    owner = str(raw.get("owner") or "").strip()
    name = str(raw.get("name") or "").strip()
    if not full_name and owner and name:
        full_name = f"{owner}-{name}"
    if not full_name or not is_valid_thunderstore_id(full_name):
        return None
    versions = raw.get("versions") or []
    latest = versions[0] if isinstance(versions, list) and versions and isinstance(versions[0], dict) else {}
    total_downloads = sum(
        int(v.get("downloads") or 0)
        for v in versions
        if isinstance(v, dict)
    )
    cats = [str(c) for c in (raw.get("categories") or []) if c]
    is_modpack = any(c.lower() == "modpacks" for c in cats)
    return ThunderstorePackageInfo(
        full_name=full_name,
        owner=owner or full_name.split("-", 1)[0],
        name=name or (full_name.split("-", 1)[1] if "-" in full_name else full_name),
        description=str(latest.get("description") or ""),
        downloads=total_downloads,
        rating_score=int(raw.get("rating_score") or 0),
        created=_parse_iso_dt(raw.get("date_created")),
        updated=_parse_iso_dt(raw.get("date_updated") or latest.get("date_created")),
        categories=cats[:10],
        icon_url=latest.get("icon") or None,
        package_url=str(raw.get("package_url") or ""),
        latest_version=str(latest.get("version_number") or ""),
        download_url=str(latest.get("download_url") or ""),
        file_size=int(latest.get("file_size") or 0),
        dependencies=[str(d) for d in (latest.get("dependencies") or []) if isinstance(d, str)],
        is_deprecated=bool(raw.get("is_deprecated", False)),
        is_modpack=is_modpack,
    )


def _dep_string_to_full_name(dep: str) -> str | None:
    """Konvertiert Thunderstore Dependency-String 'Owner-Name-1.2.3' in 'Owner-Name'."""
    parts = [p for p in str(dep or "").strip().split("-") if p]
    if len(parts) < 2:
        return None
    if len(parts) >= 3:
        candidate = "-".join(parts[:-1])
    else:
        candidate = "-".join(parts)
    return candidate if is_valid_thunderstore_id(candidate) else None


class ThunderstoreService:
    """Asynchroner Client fuer den oeffentlichen Thunderstore Community-Index."""

    def __init__(self) -> None:
        self._index_cache: dict[str, tuple[float, list[ThunderstorePackageInfo], dict[str, ThunderstorePackageInfo]]] = {}
        self._cache_lock = threading.Lock()

    def clear_cache(self) -> None:
        with self._cache_lock:
            self._index_cache.clear()

    async def get_community_packages(self, community: str) -> tuple[list[ThunderstorePackageInfo], dict[str, ThunderstorePackageInfo]]:
        slug = str(community or "").strip().lower()
        if not _COMMUNITY_RE.fullmatch(slug):
            raise ThunderstoreApiUnavailable("thunderstore_invalid_community", f"Invalid community: {slug}")

        with self._cache_lock:
            cached = self._index_cache.get(slug)
            if cached and (time.monotonic() - cached[0] < THUNDERSTORE_CACHE_TTL_SECONDS):
                return cached[1], cached[2]

        url = f"https://thunderstore.io/c/{slug}/api/v1/package/"
        try:
            async with httpx.AsyncClient(timeout=25.0, follow_redirects=True) as client:
                resp = await client.get(
                    url,
                    headers={
                        "User-Agent": THUNDERSTORE_USER_AGENT,
                        "Accept": "application/json",
                    },
                )
        except httpx.HTTPError as exc:
            logger.warning("Thunderstore API Netzwerkfehler (%s): %s", slug, type(exc).__name__)
            raise ThunderstoreApiUnavailable("thunderstore_api_unavailable", str(type(exc).__name__)) from exc

        if resp.status_code == 404:
            raise ThunderstoreApiUnavailable("thunderstore_community_not_found", f"Community {slug} not found")
        if resp.status_code == 429:
            raise ThunderstoreApiUnavailable("thunderstore_rate_limited", "Rate limit exceeded")
        if resp.status_code >= 400:
            raise ThunderstoreApiUnavailable("thunderstore_api_unavailable", f"HTTP {resp.status_code}")

        raw_list = resp.json()
        if not isinstance(raw_list, list):
            raise ThunderstoreApiUnavailable("thunderstore_api_unavailable", "Unexpected response format")

        packages: list[ThunderstorePackageInfo] = []
        by_key: dict[str, ThunderstorePackageInfo] = {}
        for item in raw_list:
            if not isinstance(item, dict):
                continue
            parsed = _parse_package(item)
            if parsed is None:
                continue
            packages.append(parsed)
            by_key[parsed.full_name.lower()] = parsed

        with self._cache_lock:
            self._index_cache[slug] = (time.monotonic(), packages, by_key)
        return packages, by_key

    async def search_packages(
        self,
        community: str,
        *,
        query: str = "",
        category: str | None = None,
        sort: str = "downloads",
        page: int = 1,
        per_page: int = 20,
        include_deprecated: bool = False,
    ) -> tuple[list[ThunderstorePackageInfo], int]:
        packages, _ = await self.get_community_packages(community)
        q = extract_thunderstore_url_query(query).lower()
        cat_lower = (category or "").strip().lower()

        filtered: list[ThunderstorePackageInfo] = []
        for pkg in packages:
            if not include_deprecated and pkg.is_deprecated:
                continue
            if cat_lower and cat_lower != "all":
                if not any(c.lower() == cat_lower for c in pkg.categories):
                    continue
            if q:
                haystack = f"{pkg.full_name} {pkg.name} {pkg.owner} {pkg.description} {' '.join(pkg.categories)}".lower()
                if q not in haystack:
                    continue
            filtered.append(pkg)

        if sort == "updated":
            filtered.sort(key=lambda p: p.updated, reverse=True)
        elif sort == "rating":
            filtered.sort(key=lambda p: (p.rating_score, p.downloads), reverse=True)
        elif sort == "newest":
            filtered.sort(key=lambda p: p.created, reverse=True)
        else:
            filtered.sort(key=lambda p: p.downloads, reverse=True)

        total = len(filtered)
        limit = max(1, min(int(per_page), 50))
        start = max(0, (max(1, int(page)) - 1) * limit)
        return filtered[start : start + limit], total

    async def get_package(self, community: str, pkg_id: str) -> ThunderstorePackageInfo | None:
        clean = strip_thunderstore_prefix(pkg_id).lower()
        if not clean:
            return None
        _, by_key = await self.get_community_packages(community)
        return by_key.get(clean)

    async def get_packages(self, community: str, pkg_ids: list[str]) -> list[ThunderstorePackageInfo]:
        _, by_key = await self.get_community_packages(community)
        out: list[ThunderstorePackageInfo] = []
        seen: set[str] = set()
        for raw in pkg_ids:
            clean = strip_thunderstore_prefix(raw).lower()
            if clean and clean not in seen and clean in by_key:
                seen.add(clean)
                out.append(by_key[clean])
        return out

    async def resolve_dependencies(self, community: str, pkg_id: str) -> list[ThunderstorePackageInfo]:
        pkg = await self.get_package(community, pkg_id)
        if not pkg or not pkg.dependencies:
            return []
        _, by_key = await self.get_community_packages(community)
        deps: list[ThunderstorePackageInfo] = []
        seen: set[str] = {pkg.full_name.lower()}
        for dep_str in pkg.dependencies:
            dep_name = _dep_string_to_full_name(dep_str)
            if not dep_name:
                continue
            key = dep_name.lower()
            if key not in seen and key in by_key:
                seen.add(key)
                deps.append(by_key[key])
        return deps


_thunderstore_service = ThunderstoreService()


async def get_thunderstore_service() -> ThunderstoreService:
    return _thunderstore_service


def is_allowed_thunderstore_download_url(url: str) -> bool:
    """Prueft, ob eine Download-URL auf eine offizielle Thunderstore-Domain zeigt."""
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    return host == "thunderstore.io" or host.endswith(".thunderstore.io")
