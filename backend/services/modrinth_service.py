"""Modrinth Labrinth v2 API Client.

Funktioniert ohne API-Key (oeffentliche Modrinth-API, 300 req/min).
Ein optionaler Personal Access Token aus den Panel-Einstellungen wird als
Authorization-Header mitgesendet.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlparse

import httpx

from services.modrinth_api_key_service import resolve_key as resolve_modrinth_key

logger = logging.getLogger(__name__)

MODRINTH_API_BASE = "https://api.modrinth.com/v2"
MODRINTH_USER_AGENT = "MauntingStudios/MSM (https://mauntingstudios.de)"
MODRINTH_CACHE_TTL_SECONDS = 120
_MODRINTH_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_MODRINTH_URL_RE = re.compile(
    r"https?://(?:www\.)?modrinth\.com/(?:mod|modpack|plugin|datapack|shader|resourcepack|project)/([A-Za-z0-9_-]{1,64})",
    re.IGNORECASE,
)


class ModrinthApiUnavailable(RuntimeError):
    """Wird geworfen, wenn Modrinth nicht erreichbar ist oder ein Rate-Limit greift."""

    def __init__(self, code: str = "modrinth_api_unavailable", detail: str = "") -> None:
        self.code = code
        self.detail = detail
        super().__init__(detail or code)


@dataclass
class ModrinthModInfo:
    project_id: str
    slug: str
    title: str
    description: str
    creator: str
    project_type: str
    downloads: int
    followers: int
    created: datetime
    updated: datetime
    categories: list[str] = field(default_factory=list)
    loaders: list[str] = field(default_factory=list)
    game_versions: list[str] = field(default_factory=list)
    icon_url: Optional[str] = None
    direct_url: str = ""
    server_side: str = "unknown"
    client_side: str = "unknown"

    @property
    def publishedfileid(self) -> str:
        return f"modrinth:{self.project_id}"


def strip_modrinth_prefix(raw_id: str) -> str:
    val = str(raw_id or "").strip()
    if val.lower().startswith("modrinth:"):
        val = val.split(":", 1)[1].strip()
    return val


def is_valid_modrinth_id(project_id: str) -> bool:
    return bool(_MODRINTH_ID_RE.fullmatch(project_id or ""))


def extract_modrinth_url_query(query: str) -> str:
    """Extrahiert bei einer eingefuegten Modrinth-URL den Projekt-Slug/ID."""
    q = (query or "").strip()
    m = _MODRINTH_URL_RE.search(q)
    if m:
        return m.group(1)
    return q


def _parse_iso_dt(value: Any) -> datetime:
    if isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    return datetime.now(timezone.utc)


def _project_url(project_type: str, slug_or_id: str) -> str:
    ptype = project_type if project_type in ("mod", "modpack", "plugin", "datapack", "shader", "resourcepack") else "project"
    return f"https://modrinth.com/{ptype}/{slug_or_id}"


def _parse_search_hit(hit: dict[str, Any]) -> ModrinthModInfo:
    pid = str(hit.get("project_id") or "").strip()
    slug = str(hit.get("slug") or pid).strip()
    ptype = str(hit.get("project_type") or "mod").strip().lower()
    cats = [str(c) for c in (hit.get("display_categories") or hit.get("categories") or []) if c]
    return ModrinthModInfo(
        project_id=pid,
        slug=slug,
        title=str(hit.get("title") or slug or pid),
        description=str(hit.get("description") or ""),
        creator=str(hit.get("author") or "Unknown"),
        project_type=ptype,
        downloads=int(hit.get("downloads") or 0),
        followers=int(hit.get("follows") or 0),
        created=_parse_iso_dt(hit.get("date_created")),
        updated=_parse_iso_dt(hit.get("date_modified")),
        categories=cats[:10],
        loaders=[],
        game_versions=[str(v) for v in (hit.get("versions") or [])[-5:]],
        icon_url=hit.get("icon_url") or None,
        direct_url=_project_url(ptype, slug),
        server_side=str(hit.get("server_side") or "unknown"),
        client_side=str(hit.get("client_side") or "unknown"),
    )


def _parse_project_detail(data: dict[str, Any]) -> ModrinthModInfo:
    pid = str(data.get("id") or "").strip()
    slug = str(data.get("slug") or pid).strip()
    ptype = str(data.get("project_type") or "mod").strip().lower()
    cats = [str(c) for c in (data.get("categories") or []) if c]
    loaders = [str(l) for l in (data.get("loaders") or []) if l]
    return ModrinthModInfo(
        project_id=pid,
        slug=slug,
        title=str(data.get("title") or slug or pid),
        description=str(data.get("description") or ""),
        creator=str(data.get("team") or "Modrinth"),
        project_type=ptype,
        downloads=int(data.get("downloads") or 0),
        followers=int(data.get("followers") or 0),
        created=_parse_iso_dt(data.get("published")),
        updated=_parse_iso_dt(data.get("updated")),
        categories=cats[:10],
        loaders=loaders,
        game_versions=[str(v) for v in (data.get("game_versions") or [])[-5:]],
        icon_url=data.get("icon_url") or None,
        direct_url=_project_url(ptype, slug),
        server_side=str(data.get("server_side") or "unknown"),
        client_side=str(data.get("client_side") or "unknown"),
    )


class ModrinthService:
    """Asynchroner Client fuer Modrinth Labrinth v2 mit In-Memory TTL-Cache."""

    def __init__(self) -> None:
        self._cache: dict[str, tuple[float, Any]] = {}
        self._cache_lock = threading.Lock()

    def _headers(self) -> dict[str, str]:
        headers = {
            "User-Agent": MODRINTH_USER_AGENT,
            "Accept": "application/json",
        }
        token = resolve_modrinth_key()
        if token:
            headers["Authorization"] = token
        return headers

    def _cache_get(self, key: str) -> Any | None:
        with self._cache_lock:
            entry = self._cache.get(key)
            if not entry:
                return None
            ts, value = entry
            if time.monotonic() - ts > MODRINTH_CACHE_TTL_SECONDS:
                self._cache.pop(key, None)
                return None
            return value

    def _cache_set(self, key: str, value: Any) -> None:
        with self._cache_lock:
            if len(self._cache) > 256:
                oldest_key = min(self._cache.items(), key=lambda item: item[1][0])[0]
                self._cache.pop(oldest_key, None)
            self._cache[key] = (time.monotonic(), value)

    def clear_cache(self) -> None:
        with self._cache_lock:
            self._cache.clear()

    async def _request(
        self,
        method: str,
        path: str,
        *,
        params: dict[str, Any] | None = None,
        json_body: Any | None = None,
    ) -> Any:
        url = f"{MODRINTH_API_BASE}{path}"
        try:
            async with httpx.AsyncClient(timeout=15.0, follow_redirects=False) as client:
                resp = await client.request(
                    method,
                    url,
                    params=params,
                    json=json_body,
                    headers=self._headers(),
                )
        except httpx.HTTPError as exc:
            logger.warning("Modrinth API Netzwerkfehler (%s): %s", path, type(exc).__name__)
            raise ModrinthApiUnavailable("modrinth_api_unavailable", str(type(exc).__name__)) from exc

        if resp.status_code == 404:
            return None
        if resp.status_code == 429:
            raise ModrinthApiUnavailable("modrinth_rate_limited", "Rate limit exceeded")
        if resp.status_code in (401, 403):
            raise ModrinthApiUnavailable("modrinth_auth_failed", f"HTTP {resp.status_code}")
        if resp.status_code >= 400:
            raise ModrinthApiUnavailable("modrinth_api_unavailable", f"HTTP {resp.status_code}")
        return resp.json()

    async def test_connection(self) -> dict[str, Any]:
        """Prueft Erreichbarkeit (und optional die Gueltigkeit des hinterlegten Tokens)."""
        token = resolve_modrinth_key()
        try:
            if token:
                data = await self._request("GET", "/user")
                if isinstance(data, dict) and data.get("username"):
                    return {"ok": True, "username": str(data["username"]), "authenticated": True}
                return {"ok": False, "error": "Ungueltiger Modrinth API-Token"}
            data = await self._request("GET", "/search", params={"limit": 1})
            return {"ok": isinstance(data, dict) and "hits" in data, "authenticated": False}
        except ModrinthApiUnavailable as exc:
            return {"ok": False, "error": exc.detail or exc.code}

    async def search_projects(
        self,
        *,
        query: str = "",
        project_types: list[str] | None = None,
        loaders: list[str] | None = None,
        game_version: str | None = None,
        sort: str = "relevance",
        page: int = 1,
        per_page: int = 20,
    ) -> tuple[list[ModrinthModInfo], int]:
        limit = max(1, min(int(per_page), 50))
        offset = max(0, (max(1, int(page)) - 1) * limit)
        index = sort if sort in ("relevance", "downloads", "follows", "newest", "updated") else "relevance"
        if not query and index == "relevance":
            index = "downloads"

        facets: list[list[str]] = []
        if project_types:
            facets.append([f"project_type:{pt}" for pt in project_types])
        if loaders:
            # Modpacks koennen eigene Loader-Tags haben; wenn nur mod/plugin gesucht wird, nach Loader filtern
            if not project_types or any(pt in ("mod", "plugin", "modpack") for pt in project_types):
                facets.append([f"categories:{ldr}" for ldr in loaders])
        if game_version:
            facets.append([f"versions:{game_version}"])

        params: dict[str, Any] = {
            "index": index,
            "offset": offset,
            "limit": limit,
        }
        if query:
            params["query"] = query
        if facets:
            params["facets"] = json.dumps(facets, separators=(",", ":"))

        cache_key = f"search:{json.dumps(params, sort_keys=True)}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached

        data = await self._request("GET", "/search", params=params)
        if not isinstance(data, dict):
            return [], 0
        hits = [_parse_search_hit(h) for h in (data.get("hits") or []) if isinstance(h, dict) and h.get("project_id")]
        total = int(data.get("total_hits") or len(hits))
        result = (hits, total)
        self._cache_set(cache_key, result)
        return result

    async def get_project(self, project_id_or_slug: str) -> ModrinthModInfo | None:
        clean = strip_modrinth_prefix(project_id_or_slug)
        if not is_valid_modrinth_id(clean):
            return None
        cache_key = f"project:{clean}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached
        data = await self._request("GET", f"/project/{clean}")
        if not isinstance(data, dict) or not data.get("id"):
            return None
        info = _parse_project_detail(data)
        self._cache_set(cache_key, info)
        return info

    async def get_projects(self, project_ids: list[str]) -> list[ModrinthModInfo]:
        cleaned = [strip_modrinth_prefix(pid) for pid in project_ids]
        cleaned = [pid for pid in dict.fromkeys(cleaned) if is_valid_modrinth_id(pid)]
        if not cleaned:
            return []
        data = await self._request(
            "GET",
            "/projects",
            params={"ids": json.dumps(cleaned, separators=(",", ":"))},
        )
        if not isinstance(data, list):
            return []
        return [_parse_project_detail(item) for item in data if isinstance(item, dict) and item.get("id")]

    async def get_project_versions(
        self,
        project_id_or_slug: str,
        *,
        loaders: list[str] | None = None,
        game_versions: list[str] | None = None,
    ) -> list[dict[str, Any]]:
        clean = strip_modrinth_prefix(project_id_or_slug)
        if not is_valid_modrinth_id(clean):
            return []
        params: dict[str, Any] = {}
        if loaders:
            params["loaders"] = json.dumps(loaders, separators=(",", ":"))
        if game_versions:
            params["game_versions"] = json.dumps(game_versions, separators=(",", ":"))
        data = await self._request("GET", f"/project/{clean}/version", params=params or None)
        if not isinstance(data, list):
            return []
        return [v for v in data if isinstance(v, dict)]

    async def resolve_dependencies(
        self,
        project_id_or_slug: str,
        *,
        loaders: list[str] | None = None,
        game_versions: list[str] | None = None,
    ) -> list[ModrinthModInfo]:
        versions = await self.get_project_versions(
            project_id_or_slug,
            loaders=loaders,
            game_versions=game_versions,
        )
        if not versions and (loaders or game_versions):
            versions = await self.get_project_versions(project_id_or_slug)
        if not versions:
            return []
        latest = versions[0]
        dep_ids: list[str] = []
        seen: set[str] = set()
        self_id = strip_modrinth_prefix(project_id_or_slug)
        for dep in latest.get("dependencies") or []:
            if not isinstance(dep, dict):
                continue
            if dep.get("dependency_type") != "required":
                continue
            dep_pid = str(dep.get("project_id") or "").strip()
            if dep_pid and dep_pid != self_id and dep_pid not in seen and is_valid_modrinth_id(dep_pid):
                seen.add(dep_pid)
                dep_ids.append(dep_pid)
        if not dep_ids:
            return []
        return await self.get_projects(dep_ids[:20])


_modrinth_service = ModrinthService()


async def get_modrinth_service() -> ModrinthService:
    return _modrinth_service


def is_allowed_modrinth_download_url(url: str) -> bool:
    """Prueft, ob eine Download-URL auf die offizielle Modrinth-CDN-Domain zeigt."""
    try:
        parsed = urlparse(url)
    except Exception:
        return False
    if parsed.scheme != "https":
        return False
    host = (parsed.hostname or "").lower()
    return host == "cdn.modrinth.com" or host.endswith(".modrinth.com")
