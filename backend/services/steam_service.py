"""
Steam Web API Service for Mod Search and Details

Uses Steam Web API with optional key. Falls back to community search if no key.
Caches responses to respect rate limits.
"""

import asyncio
import html
import json
import logging
import re
import httpx
from typing import Any, Awaitable, Callable, Dict, List, Optional
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
import os

logger = logging.getLogger(__name__)


class SteamApiUnavailable(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


_STEAM_WORKSHOP_URL_RE = re.compile(
    r"(?:steamcommunity\.com/(?:sharedfiles|workshop)/filedetails/\?[^ \n]*?\bid=|^\s*)(\d{5,20})(?:\s|$|&)"
)


def extract_steam_publishedfileid(query: Optional[str]) -> Optional[str]:
    """Extract a numeric Workshop ID from a raw ID or Steam Workshop URL."""
    if not query:
        return None
    stripped = query.strip()
    if re.fullmatch(r"\d{5,20}", stripped):
        return stripped
    match = _STEAM_WORKSHOP_URL_RE.search(stripped)
    if match:
        return match.group(1)
    return None


@dataclass
class SteamModInfo:
    publishedfileid: str
    title: str
    description: str
    creator: str
    file_size: int
    created: datetime
    updated: datetime
    subscriptions: int
    favorites: int
    tags: List[str]
    preview_url: Optional[str] = None
    direct_url: str = ""
    item_type: str = "mod"
    children_count: int = 0
    consumer_appid: Optional[str] = None
    child_ids: List[str] = field(default_factory=list)


class SteamService:
    """Steam Web API client for workshop operations."""
    
    API_BASE = "https://api.steampowered.com"
    COMMUNITY_BASE = "https://steamcommunity.com"
    
    def __init__(self):
        from services.steam_api_key_service import resolve_key

        self.api_key = resolve_key()
        self.client = httpx.AsyncClient(
            timeout=30.0,
            headers={
                'User-Agent': 'MSM/1.0 (Maunting Service Manager)',
                'Accept': 'application/json',
            }
        )
        self._cache: Dict[str, Dict[str, Any]] = {}
        self._cache_ttl = timedelta(minutes=15)
        self._filters_ttl = timedelta(hours=6)
        self._inflight: Dict[str, asyncio.Task[Any]] = {}
    
    async def close(self):
        """Close HTTP client."""
        for task in list(self._inflight.values()):
            task.cancel()
        self._inflight.clear()
        await self.client.aclose()
    
    def _is_cache_valid(self, key: str) -> bool:
        if key not in self._cache:
            return False
        entry = self._cache[key]
        cached_time = entry['timestamp']
        ttl = entry.get('ttl') or self._cache_ttl
        return datetime.now(timezone.utc) - cached_time < ttl

    def _get_cache(self, key: str) -> Optional[Any]:
        if self._is_cache_valid(key):
            return self._cache[key]['data']
        return None

    def _set_cache(self, key: str, data: Any, ttl: Optional[timedelta] = None):
        self._cache[key] = {
            'data': data,
            'timestamp': datetime.now(timezone.utc),
            'ttl': ttl,
        }

    async def _singleflight(
        self, key: str, factory: Callable[[], Awaitable[Any]]
    ) -> Any:
        """Buendelt gleichzeitige Abfragen mit demselben Cache-Schluessel."""
        task = self._inflight.get(key)
        if task is None:
            async def _run() -> Any:
                try:
                    return await factory()
                finally:
                    self._inflight.pop(key, None)

            task = asyncio.create_task(_run())
            self._inflight[key] = task
        return await asyncio.shield(task)
    
    async def search_workshop_mods(
        self,
        appid: str,
        query: str = "",
        page: int = 1,
        per_page: int = 50,
        required_tags: list[str] | None = None,
        filetype: int = 0,
        sort: str | None = None,
    ) -> List[SteamModInfo]:
        """Search workshop mods or collections via Steam Web API QueryFiles."""
        if not self.api_key:
            raise SteamApiUnavailable("steam_api_key_missing")

        filetype_int = 1 if int(filetype) == 1 else 0
        tag_suffix = "_" + "_".join(required_tags) if (required_tags and filetype_int == 0) else ""
        sort_suffix = f"_s{sort}" if sort else ""
        cache_key = f"search_{appid}_ft{filetype_int}_{query}_{page}_{per_page}{tag_suffix}{sort_suffix}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached

        direct_id = extract_steam_publishedfileid(query)
        if direct_id and page == 1:
            try:
                details_map = await self.get_details_batch([direct_id], appid=appid)
                direct_item = details_map.get(direct_id)
                if direct_item and (
                    not direct_item.consumer_appid or direct_item.consumer_appid == str(appid)
                ):
                    result = [direct_item]
                    self._set_cache(cache_key, result)
                    return result
            except SteamApiUnavailable:
                pass

        try:
            sort_map = {
                "trending": self.SORT_TRENDING,
                "popular": self.SORT_POPULAR,
                "newest": self.SORT_NEWEST,
                "updated": self.SORT_UPDATED,
            }
            query_type = sort_map[sort] if sort in sort_map else (3 if query else 0)
            query_data: Dict[str, Any] = {
                'query_type': query_type,
                'page': page,
                'numperpage': per_page,
                'appid': int(appid),
                'search_text': query,
                'return_short_description': True,
                'return_tags': True,
                'return_previews': True,
                'return_details': True,
                'return_metadata': True,
                'return_children': True,
            }
            if query_type == self.SORT_TRENDING:
                query_data['days'] = 7
            if filetype_int == 1:
                query_data['filetype'] = 1
            elif required_tags:
                query_data['requiredtags'] = ','.join(required_tags)

            params = {
                'key': self.api_key,
                'input_json': json.dumps(query_data, separators=(',', ':')),
            }

            response = await self.client.get(
                f"{self.API_BASE}/IPublishedFileService/QueryFiles/v1/",
                params=params
            )
            response.raise_for_status()

            data = response.json()
            mods = []

            if 'response' in data and 'publishedfiledetails' in data['response']:
                for mod_data in data['response']['publishedfiledetails']:
                    if mod_data.get('result') == 1:
                        mods.append(self._parse_mod_data(mod_data))

            if mods:
                self._set_cache(cache_key, mods)
            return mods

        except Exception as e:
            logger.warning("Steam API search failed: %s", type(e).__name__)
            raise SteamApiUnavailable("steam_api_unavailable") from e

    async def _fetch_remote_storage_details(
        self,
        publishedfileids: List[str],
    ) -> Dict[str, SteamModInfo]:
        """Public keyless Steam fallback via ISteamRemoteStorage/GetPublishedFileDetails/v1."""
        results: Dict[str, SteamModInfo] = {}
        chunk_size = 50
        chunks = [
            publishedfileids[offset:offset + chunk_size]
            for offset in range(0, len(publishedfileids), chunk_size)
        ]

        async def _fetch_chunk(chunk: List[str]) -> List[SteamModInfo]:
            form_data: Dict[str, Any] = {"itemcount": len(chunk)}
            for idx, pid in enumerate(chunk):
                form_data[f"publishedfileids[{idx}]"] = str(pid)
            response = await asyncio.wait_for(
                self.client.post(
                    f"{self.API_BASE}/ISteamRemoteStorage/GetPublishedFileDetails/v1/",
                    data=form_data,
                ),
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            details_list = (data.get("response") or {}).get("publishedfiledetails") or []
            parsed_items: List[SteamModInfo] = []
            for mod_data in details_list:
                if mod_data.get("result") == 1:
                    parsed_items.append(self._parse_mod_data(mod_data))
            return parsed_items

        chunk_results = await asyncio.gather(
            *(_fetch_chunk(chunk) for chunk in chunks),
            return_exceptions=True,
        )
        first_error: Optional[BaseException] = None
        for entry in chunk_results:
            if isinstance(entry, BaseException):
                if first_error is None:
                    first_error = entry
                continue
            for parsed in entry:
                results[parsed.publishedfileid] = parsed
        if not results and first_error is not None:
            raise first_error
        return results

    async def get_details_batch(
        self,
        publishedfileids: List[str],
        appid: Optional[str] = None,
        *,
        allow_public_fallback: bool = False,
        full_description: bool = False,
    ) -> Dict[str, SteamModInfo]:
        """Batch-fetch published file details via IPublishedFileService/GetDetails/v1 with public fallback."""
        if not self.api_key and not allow_public_fallback:
            raise SteamApiUnavailable("steam_api_key_missing")

        unique_ids: List[str] = []
        seen: set[str] = set()
        for raw_id in publishedfileids:
            pid = str(raw_id).strip()
            if pid.isdigit() and pid not in seen:
                seen.add(pid)
                unique_ids.append(pid)

        cache_prefix = "details_full" if full_description else "details"
        results: Dict[str, SteamModInfo] = {}
        missing_ids: List[str] = []
        for pid in unique_ids:
            if appid:
                cached = self._get_cache(f"{cache_prefix}_{appid}_{pid}")
                if cached is not None:
                    results[pid] = cached
                    continue
            missing_ids.append(pid)

        if not missing_ids:
            return results

        if self.api_key:
            chunk_size = 50
            chunks = [
                missing_ids[offset:offset + chunk_size]
                for offset in range(0, len(missing_ids), chunk_size)
            ]

            async def _fetch_primary_chunk(chunk: List[str]) -> List[SteamModInfo]:
                query_data = {
                    "publishedfileids": [int(pid) for pid in chunk],
                    "includevotes": True,
                    "short_description": not full_description,
                    "includechildren": True,
                    "includetags": True,
                }
                params = {
                    'key': self.api_key,
                    'input_json': json.dumps(query_data, separators=(',', ':')),
                }
                response = await asyncio.wait_for(
                    self.client.get(
                        f"{self.API_BASE}/IPublishedFileService/GetDetails/v1/",
                        params=params,
                    ),
                    timeout=10.0,
                )
                response.raise_for_status()
                data = response.json()
                details_list = (data.get('response') or {}).get('publishedfiledetails') or []
                return [
                    self._parse_mod_data(mod_data)
                    for mod_data in details_list
                    if mod_data.get('result') == 1
                ]

            try:
                chunk_results = await asyncio.gather(
                    *(_fetch_primary_chunk(chunk) for chunk in chunks),
                    return_exceptions=True,
                )
                first_error: Optional[BaseException] = None
                for entry in chunk_results:
                    if isinstance(entry, BaseException):
                        if first_error is None:
                            first_error = entry
                        continue
                    for parsed in entry:
                        results[parsed.publishedfileid] = parsed
                if first_error is not None and not any(pid in results for pid in missing_ids):
                    raise first_error
            except Exception as e:
                if not allow_public_fallback:
                    logger.warning("Steam API batch details failed: %s", type(e).__name__)
                    raise SteamApiUnavailable("steam_api_unavailable") from e
                logger.debug("Primary Steam GetDetails failed, falling back to public endpoint: %s", type(e).__name__)

        if allow_public_fallback:
            incomplete_ids = [
                pid
                for pid in missing_ids
                if pid not in results
                or not results[pid].preview_url
                or not (results[pid].description or "").strip()
            ]
            if incomplete_ids:
                try:
                    public_map = await self._fetch_remote_storage_details(incomplete_ids)
                    for pid, pub_item in public_map.items():
                        existing = results.get(pid)
                        if existing is None:
                            results[pid] = pub_item
                        else:
                            if not existing.preview_url and pub_item.preview_url:
                                existing.preview_url = pub_item.preview_url
                            if not (existing.description or "").strip() and (pub_item.description or "").strip():
                                existing.description = pub_item.description
                            if existing.file_size <= 0 and pub_item.file_size > 0:
                                existing.file_size = pub_item.file_size
                            if not existing.tags and pub_item.tags:
                                existing.tags = pub_item.tags
                            if (not existing.title or existing.title == "Unknown Mod") and pub_item.title:
                                existing.title = pub_item.title
                except Exception as exc:
                    logger.debug("Public Steam GetPublishedFileDetails fallback failed: %s", type(exc).__name__)
                    if not results and not self.api_key:
                        raise SteamApiUnavailable("steam_api_unavailable") from exc

        for pid, parsed in results.items():
            target_app = appid or parsed.consumer_appid
            if target_app:
                self._set_cache(f"{cache_prefix}_{target_app}_{pid}", parsed)

        return results

    async def get_collection_details(
        self,
        appid: str,
        collection_id: str,
        max_items: int = 500,
    ) -> Optional[Dict[str, Any]]:
        """Resolve a Steam Workshop Collection and flatten nested sub-collections."""
        if not self.api_key:
            raise SteamApiUnavailable("steam_api_key_missing")

        clean_id = str(collection_id).strip()
        if not clean_id.isdigit():
            return None

        cache_key = f"collection_{appid}_{clean_id}_{max_items}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached

        async def _fetch_collection_nodes(ids: List[str]) -> Dict[str, Dict[str, Any]]:
            form_data: Dict[str, Any] = {"collectioncount": len(ids)}
            for idx, cid in enumerate(ids):
                form_data[f"publishedfileids[{idx}]"] = cid
            resp = await self.client.post(
                f"{self.API_BASE}/ISteamRemoteStorage/GetCollectionDetails/v1/",
                data=form_data,
            )
            resp.raise_for_status()
            payload = resp.json()
            node_map: Dict[str, Dict[str, Any]] = {}
            for entry in (payload.get("response") or {}).get("collectiondetails") or []:
                pid = str(entry.get("publishedfileid", "")).strip()
                if pid:
                    node_map[pid] = entry
            return node_map

        try:
            root_details_map = await self.get_details_batch([clean_id], appid=appid)
            collection_info = root_details_map.get(clean_id)

            visited_collections: set[str] = {clean_id}
            ordered_leaf_ids: List[str] = []
            seen_leaf_ids: set[str] = set()

            async def _collect_recursive(batch_ids: List[str], depth: int) -> bool:
                if not batch_ids or depth > 3 or len(ordered_leaf_ids) >= max_items:
                    return False
                node_map = await _fetch_collection_nodes(batch_ids)
                any_ok = False
                sub_collection_ids: List[str] = []
                for cid in batch_ids:
                    entry = node_map.get(cid)
                    if not entry or entry.get("result") != 1:
                        continue
                    any_ok = True
                    children = list(entry.get("children") or [])
                    children.sort(key=lambda ch: int(ch.get("sortorder", 0)))
                    for child in children:
                        child_id = str(child.get("publishedfileid", "")).strip()
                        if not child_id or not child_id.isdigit():
                            continue
                        if int(child.get("filetype", 0)) == 2:
                            if child_id not in visited_collections:
                                visited_collections.add(child_id)
                                sub_collection_ids.append(child_id)
                        elif child_id not in seen_leaf_ids:
                            seen_leaf_ids.add(child_id)
                            ordered_leaf_ids.append(child_id)
                            if len(ordered_leaf_ids) >= max_items:
                                return any_ok
                if sub_collection_ids and len(ordered_leaf_ids) < max_items:
                    await _collect_recursive(sub_collection_ids[:50], depth + 1)
                return any_ok

            root_ok = await _collect_recursive([clean_id], 0)
            if not root_ok:
                if not collection_info or collection_info.item_type != "collection":
                    return None
                return {
                    "collection": collection_info,
                    "items": [],
                    "unavailable_ids": [],
                    "total_children": 0,
                }

            details_map = await self.get_details_batch(ordered_leaf_ids, appid=appid)
            items: List[SteamModInfo] = []
            unavailable_ids: List[str] = []
            for pid in ordered_leaf_ids:
                item = details_map.get(pid)
                if item is not None:
                    items.append(item)
                else:
                    unavailable_ids.append(pid)

            if collection_info is None:
                now = datetime.now(timezone.utc)
                collection_info = SteamModInfo(
                    publishedfileid=clean_id,
                    title=f"Collection #{clean_id}",
                    description="",
                    creator="Unknown",
                    file_size=sum(m.file_size for m in items),
                    created=now,
                    updated=now,
                    subscriptions=0,
                    favorites=0,
                    tags=[],
                    preview_url=items[0].preview_url if items else None,
                    direct_url=f"https://steamcommunity.com/sharedfiles/filedetails/?id={clean_id}",
                    item_type="collection",
                    children_count=len(ordered_leaf_ids),
                    consumer_appid=str(appid),
                )
            else:
                collection_info.item_type = "collection"
                collection_info.children_count = max(
                    collection_info.children_count, len(ordered_leaf_ids)
                )

            result = {
                "collection": collection_info,
                "items": items,
                "unavailable_ids": unavailable_ids,
                "total_children": len(ordered_leaf_ids),
            }
            self._set_cache(cache_key, result)
            return result
        except SteamApiUnavailable:
            raise
        except Exception as e:
            logger.warning("Steam API collection details failed: %s", type(e).__name__)
            raise SteamApiUnavailable("steam_api_unavailable") from e

    async def get_mod_dependencies(
        self,
        appid: str,
        publishedfileid: str,
        max_depth: int = 2,
        max_items: int = 50,
        *,
        full_description: bool = False,
    ) -> Optional[Dict[str, Any]]:
        """Resolve required Workshop dependencies (children) in dependency-first order."""
        if not self.api_key and not full_description:
            raise SteamApiUnavailable("steam_api_key_missing")

        clean_id = str(publishedfileid).strip()
        if not clean_id.isdigit():
            return None

        cache_key = f"deps_{appid}_{clean_id}_{max_depth}_{max_items}_{int(full_description)}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached

        try:
            root_map = await self.get_details_batch(
                [clean_id],
                appid=appid,
                allow_public_fallback=full_description,
                full_description=full_description,
            )
            root_mod = root_map.get(clean_id)
            if not root_mod:
                return None

            details_map: Dict[str, SteamModInfo] = {clean_id: root_mod}
            frontier: List[str] = [
                cid for cid in (root_mod.child_ids or []) if cid != clean_id
            ]
            discovered: set[str] = {clean_id}
            depth = 1

            while frontier and depth <= max_depth and len(details_map) - 1 < max_items:
                to_fetch: List[str] = []
                for dep_id in frontier:
                    if dep_id not in discovered and len(discovered) - 1 + len(to_fetch) < max_items:
                        discovered.add(dep_id)
                        to_fetch.append(dep_id)
                if not to_fetch:
                    break

                batch_map = await self.get_details_batch(
                    to_fetch,
                    appid=appid,
                    allow_public_fallback=full_description,
                )
                details_map.update(batch_map)

                next_frontier: List[str] = []
                if depth < max_depth:
                    for dep_id in to_fetch:
                        dep_mod = batch_map.get(dep_id)
                        if dep_mod:
                            for sub_id in dep_mod.child_ids or []:
                                if sub_id not in discovered:
                                    next_frontier.append(sub_id)
                frontier = next_frontier
                depth += 1

            # Post-order (dependency-first) traversal with cycle guard
            ordered_deps: List[SteamModInfo] = []
            unavailable_ids: List[str] = []
            emitted: set[str] = set()
            visiting: set[str] = {clean_id}

            def _visit(dep_id: str, cur_depth: int) -> None:
                if dep_id in emitted or dep_id in visiting or len(ordered_deps) >= max_items:
                    return
                visiting.add(dep_id)
                dep_mod = details_map.get(dep_id)
                if dep_mod and cur_depth < max_depth:
                    for sub_id in dep_mod.child_ids or []:
                        _visit(sub_id, cur_depth + 1)
                visiting.discard(dep_id)
                emitted.add(dep_id)
                if dep_mod:
                    ordered_deps.append(dep_mod)
                else:
                    unavailable_ids.append(dep_id)

            for direct_id in root_mod.child_ids or []:
                _visit(direct_id, 1)

            result = {
                "mod": root_mod,
                "dependencies": ordered_deps,
                "unavailable_ids": unavailable_ids,
            }
            self._set_cache(cache_key, result)
            return result
        except SteamApiUnavailable:
            raise
        except Exception as e:
            logger.warning("Steam API dependency lookup failed: %s", type(e).__name__)
            raise SteamApiUnavailable("steam_api_unavailable") from e
    
    async def get_mod_details(self, appid: str, publishedfileid: str) -> Optional[SteamModInfo]:
        """Get detailed information for a specific mod."""
        if not self.api_key:
            raise SteamApiUnavailable("steam_api_key_missing")
        
        cache_key = f"details_{appid}_{publishedfileid}"
        cached = self._get_cache(cache_key)
        if cached:
            return cached
        
        try:
            query_data = {
                "publishedfileids": [int(publishedfileid)],
                "includevotes": True,
                "short_description": True,
                "includechildren": True,
                "includetags": True,
            }

            params = {
                'key': self.api_key,
                'input_json': json.dumps(query_data, separators=(',', ':')),
            }

            response = await self.client.get(
                f"{self.API_BASE}/IPublishedFileService/GetDetails/v1/",
                params=params
            )
            response.raise_for_status()
            
            data = response.json()
            
            if 'response' in data and 'publishedfiledetails' in data['response']:
                mod_data = data['response']['publishedfiledetails'][0]
                if mod_data.get('result') == 1:
                    mod = self._parse_mod_data(mod_data)
                    self._set_cache(cache_key, mod)
                    return mod
            
            return None
            
        except Exception as e:
            logger.warning("Steam API details failed: %s", type(e).__name__)
            raise SteamApiUnavailable("steam_api_unavailable") from e

    async def get_mod_comments(
        self,
        publishedfileid: str,
        limit: int = 12,
    ) -> List[Dict[str, str]]:
        """Liest die neuesten oeffentlichen Nutzerkommentare einer Steam-Workshop-Seite."""
        clean_id = str(publishedfileid or "").strip()
        if not clean_id.isdigit():
            return []

        capped_limit = max(1, min(int(limit), 25))
        cache_key = f"comments_{clean_id}_{capped_limit}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached

        try:
            resp = await self.client.get(
                f"{self.COMMUNITY_BASE}/sharedfiles/filedetails/",
                params={"id": clean_id},
                headers={
                    "Accept": "text/html,application/xhtml+xml",
                    "Accept-Language": "de,en-US;q=0.9,en;q=0.8",
                },
                timeout=6.0,
            )
            if resp.status_code != 200 or not resp.text:
                return []

            blocks = re.split(
                r'<div\b[^>]*class=["\'][^"\']*\bcommentthread_comment\b[^"\']*["\'][^>]*>',
                resp.text,
                flags=re.IGNORECASE,
            )[1:]
            comments: List[Dict[str, str]] = []
            for block in blocks:
                text_m = re.search(
                    r'<div[^>]*class=["\'][^"\']*\bcommentthread_comment_text\b[^"\']*["\'][^>]*>(.*?)</div>',
                    block,
                    flags=re.DOTALL | re.IGNORECASE,
                )
                if not text_m:
                    continue
                raw_text = re.sub(r"<br\s*/?>", "\n", text_m.group(1), flags=re.IGNORECASE)
                raw_text = re.sub(r"<[^>]+>", " ", raw_text)
                raw_text = html.unescape(raw_text)
                lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in raw_text.splitlines()]
                clean_text = "\n".join(ln for ln in lines if ln).strip()[:500]
                if not clean_text:
                    continue

                author_m = re.search(
                    r'<a[^>]*class=["\'][^"\']*\bcommentthread_author_link\b[^"\']*["\'][^>]*>(.*?)</a>',
                    block,
                    flags=re.DOTALL | re.IGNORECASE,
                )
                author = ""
                if author_m:
                    author = html.unescape(re.sub(r"<[^>]+>", " ", author_m.group(1)))
                    author = re.sub(r"\s+", " ", author).strip()[:64]

                ts_m = re.search(
                    r'<span[^>]*class=["\'][^"\']*\bcommentthread_comment_timestamp\b[^"\']*["\']([^>]*)>(.*?)</span>',
                    block,
                    flags=re.DOTALL | re.IGNORECASE,
                )
                timestamp = ""
                if ts_m:
                    attrs, inner_ts = ts_m.group(1), ts_m.group(2)
                    title_m = re.search(r'\btitle=["\']([^"\']+)["\']', attrs, flags=re.IGNORECASE)
                    raw_ts = title_m.group(1) if title_m else inner_ts
                    raw_ts = html.unescape(re.sub(r"<[^>]+>", " ", raw_ts))
                    timestamp = re.sub(r"\s+", " ", raw_ts).strip()[:64]

                comments.append(
                    {
                        "author": author or "Steam User",
                        "timestamp": timestamp,
                        "text": clean_text,
                    }
                )
                if len(comments) >= capped_limit:
                    break

            self._set_cache(cache_key, comments)
            return comments
        except Exception as exc:
            logger.debug("Steam Workshop comments fetch skipped for %s: %s", clean_id, type(exc).__name__)
            return []
    
    def _parse_mod_data(self, mod_data: Dict[str, Any]) -> SteamModInfo:
        """Parse Steam API response into SteamModInfo."""
        tags = []
        for tag in mod_data.get('tags', []):
            if isinstance(tag, dict):
                tags.append(tag.get('tag', ''))
            elif isinstance(tag, str):
                tags.append(tag)
        
        # Bevorzugt das top-level preview_url Feld der QueryFiles-Antwort
        # (kommt mit return_previews=true zuverlaessig zurueck). Fallback auf
        # das erste Bild im previews-Array; YouTube-Vorschauen werden
        # uebersprungen (keine gueltige <img>-URL).
        preview_url = mod_data.get('preview_url') or None
        if not preview_url:
            for preview in mod_data.get('previews') or []:
                if not isinstance(preview, dict):
                    continue
                url = preview.get('url')
                if url:
                    preview_url = url
                    break
        
        file_type = mod_data.get('file_type')
        raw_children = mod_data.get('children') or []
        child_ids: List[str] = []
        if isinstance(raw_children, list):
            dict_children = [ch for ch in raw_children if isinstance(ch, dict)]
            dict_children.sort(key=lambda ch: int(ch.get('sortorder') or 0))
            seen_children: set[str] = set()
            self_id = str(mod_data.get('publishedfileid', '')).strip()
            for ch in dict_children:
                cid = str(ch.get('publishedfileid', '')).strip()
                if cid and cid.isdigit() and cid != self_id and cid not in seen_children:
                    seen_children.add(cid)
                    child_ids.append(cid)
        item_type = "collection" if file_type == 2 else "mod"
        consumer_appid = mod_data.get('consumer_appid') or mod_data.get('consumer_app_id')
        try:
            declared_children = int(mod_data.get('num_children') or 0)
        except (TypeError, ValueError):
            declared_children = 0

        candidates = [
            str(mod_data.get("file_description") or "").strip(),
            str(mod_data.get("description") or "").strip(),
            str(mod_data.get("short_description") or "").strip(),
        ]
        raw_desc = max(candidates, key=len) if any(candidates) else ""
        clean_desc = re.sub(
            r'\[/?(?:b|i|u|h[1-6]|url(?:=[^\]]*)?|list|quote(?:=[^\]]*)?|code|spoiler|strike|table|tr|th|td|\*|img|previewyoutube|noparse)\]',
            '',
            str(raw_desc),
            flags=re.IGNORECASE,
        ).strip()

        return SteamModInfo(
            publishedfileid=str(mod_data.get('publishedfileid', '')),
            title=mod_data.get('title', 'Unknown Mod'),
            description=clean_desc,
            creator=mod_data.get('creator', 'Unknown'),
            file_size=int(mod_data.get('file_size') or 0),
            created=datetime.fromtimestamp(int(mod_data.get('time_created') or 0)),
            updated=datetime.fromtimestamp(int(mod_data.get('time_updated') or 0)),
            subscriptions=int(mod_data.get('subscriptions') or 0),
            favorites=int(mod_data.get('favorited') or 0),
            tags=tags,
            preview_url=preview_url,
            direct_url=f"https://steamcommunity.com/sharedfiles/filedetails/?id={mod_data.get('publishedfileid', '')}",
            item_type=item_type,
            children_count=max(len(child_ids), declared_children),
            consumer_appid=str(consumer_appid) if consumer_appid is not None else None,
            child_ids=child_ids,
        )
    
    # query_type constants for Steam QueryFiles
    SORT_TRENDING = 3     # RankedByTrend (last N days)
    SORT_POPULAR = 0      # RankedByVote (all-time most subscribed)
    SORT_NEWEST = 1       # RankedByPublicationDate
    SORT_UPDATED = 12     # RankedByLastUpdatedDate

    async def get_popular_mods(
        self,
        appid: str,
        limit: int = 20,
        required_tags: list[str] | None = None,
        sort: str = "trending",
        page: int = 1,
        filetype: int = 0,
    ) -> List[SteamModInfo]:
        """Get mods or collections for an app sorted by the given criteria.

        sort: 'trending' | 'popular' | 'newest' | 'updated'
        page: 1-basierte Seitennummer fuer Pagination ("Mehr anzeigen").
        filetype: 0 = Workshop items/mods, 1 = Collections
        """
        if not self.api_key:
            raise SteamApiUnavailable("steam_api_key_missing")

        sort_map = {
            "trending": self.SORT_TRENDING,
            "popular": self.SORT_POPULAR,
            "newest": self.SORT_NEWEST,
            "updated": self.SORT_UPDATED,
        }
        query_type = sort_map.get(sort, self.SORT_TRENDING)
        page = max(1, page)
        filetype_int = 1 if int(filetype) == 1 else 0

        cache_key = f"popular_{appid}_ft{filetype_int}_{limit}_{sort}_p{page}"
        if required_tags and filetype_int == 0:
            cache_key += "_" + "_".join(required_tags)
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached

        async def _fetch_popular() -> List[SteamModInfo]:
            cached_inner = self._get_cache(cache_key)
            if cached_inner is not None:
                return cached_inner
            try:
                query_data: dict = {
                    'query_type': query_type,
                    'page': page,
                    'numperpage': limit,
                    'appid': int(appid),
                    'return_short_description': True,
                    'return_tags': True,
                    'return_previews': True,
                    'return_children': True,
                }
                if sort == "trending":
                    query_data['days'] = 7
                if filetype_int == 1:
                    query_data['filetype'] = 1
                elif required_tags:
                    query_data['requiredtags'] = ','.join(required_tags)

                params = {
                    'key': self.api_key,
                    'input_json': json.dumps(query_data, separators=(',', ':')),
                }

                response = await asyncio.wait_for(
                    self.client.get(
                        f"{self.API_BASE}/IPublishedFileService/QueryFiles/v1/",
                        params=params,
                    ),
                    timeout=12.0,
                )
                response.raise_for_status()

                data = response.json()
                mods: List[SteamModInfo] = []

                if 'response' in data and 'publishedfiledetails' in data['response']:
                    for mod_data in data['response']['publishedfiledetails']:
                        if mod_data.get('result') == 1:
                            parsed = self._parse_mod_data(mod_data)
                            mods.append(parsed)
                            if parsed.publishedfileid:
                                self._set_cache(f"details_{appid}_{parsed.publishedfileid}", parsed)

                # Leere Antworten von Steam nie 15 Min. cachen, damit ein fluechtiger
                # Upstream-Aussetzer die Startansicht nicht dauerhaft blockiert.
                if mods:
                    self._set_cache(cache_key, mods)
                return mods

            except Exception as e:
                logger.warning("Steam API popular mods failed: %s", type(e).__name__)
                raise SteamApiUnavailable("steam_api_unavailable") from e

        return await self._singleflight(cache_key, _fetch_popular)

    async def get_workshop_filters(self, appid: str) -> Dict[str, Any]:
        """Fetch game-specific Steam Workshop filter tags (Community browse HTML + API tag fallback)."""
        clean_appid = str(appid or "").strip()
        if not clean_appid.isdigit():
            return {"appid": clean_appid, "tags": [], "source": "none"}

        cache_key = f"workshop_filters_{clean_appid}"
        cached = self._get_cache(cache_key)
        if cached is not None:
            return cached

        async def _fetch_filters() -> Dict[str, Any]:
            cached_inner = self._get_cache(cache_key)
            if cached_inner is not None:
                return cached_inner

            tags_map: Dict[str, str] = {}
            source = "none"

            # 1. Primär: Offizielle Steam Community Workshop-Filterseite parsen (liefert exakte Spiel-Tags)
            try:
                resp = await self.client.get(
                    f"{self.COMMUNITY_BASE}/workshop/browse/",
                    params={"appid": clean_appid, "browsesort": "trend"},
                    headers={"Accept": "text/html,application/xhtml+xml"},
                    timeout=4.0,
                )
                if resp.status_code == 200 and resp.text:
                    body = resp.text
                    label_matches = re.findall(
                        r'<label[^>]*>\s*<input[^>]*name=["\']requiredtags\[\]["\'][^>]*value=["\']([^"\']+)["\'][^>]*>\s*([^<]+)',
                        body,
                        flags=re.IGNORECASE,
                    )
                    for raw_val, raw_label in label_matches:
                        val = html.unescape(raw_val).strip()
                        label = re.sub(r"\s*\(\d[\d.,]*\)\s*$", "", html.unescape(raw_label)).strip()
                        if val and len(val) <= 64 and val not in tags_map:
                            tags_map[val] = label or val

                    if not tags_map:
                        attr_matches = re.findall(
                            r'''name=["']requiredtags\[\]["'][^>]*value=["']([^"']+)["']|value=["']([^"']+)["'][^>]*name=["']requiredtags\[\]["']''',
                            body,
                            flags=re.IGNORECASE,
                        )
                        for g1, g2 in attr_matches:
                            val = html.unescape(g1 or g2).strip()
                            if val and len(val) <= 64 and val not in tags_map:
                                tags_map[val] = val

                    if tags_map:
                        source = "steam_community"
            except Exception as exc:
                logger.debug("Steam Community tag HTML fetch skipped for %s: %s", clean_appid, type(exc).__name__)

            # 2. Fallback: Tags aus den beliebtesten QueryFiles-Antworten sammeln
            if not tags_map and self.api_key:
                try:
                    sample_mods = await self.get_popular_mods(
                        appid=clean_appid,
                        limit=30,
                        sort="popular",
                        page=1,
                        filetype=0,
                    )
                    for item in sample_mods:
                        for raw_tag in item.tags or []:
                            t = str(raw_tag).strip()
                            if t and len(t) <= 64 and t not in tags_map:
                                tags_map[t] = t
                    if tags_map:
                        source = "query_files"
                except Exception as exc:
                    logger.debug("Steam QueryFiles tag fallback skipped for %s: %s", clean_appid, type(exc).__name__)

            tag_items = [
                {"id": tag_id, "name": label}
                for tag_id, label in list(tags_map.items())[:40]
            ]
            result = {"appid": clean_appid, "tags": tag_items, "source": source}
            if tag_items:
                self._set_cache(cache_key, result, ttl=self._filters_ttl)
            return result

        return await self._singleflight(cache_key, _fetch_filters)


# Global instance
_steam_service: Optional[SteamService] = None


async def get_steam_service() -> SteamService:
    """Get or create Steam service instance. Recreates if API key changed."""
    global _steam_service
    from services.steam_api_key_service import resolve_key

    current_key = resolve_key()
    if _steam_service is None or _steam_service.api_key != current_key:
        if _steam_service:
            await _steam_service.close()
        _steam_service = SteamService()
    return _steam_service


async def close_steam_service():
    """Close Steam service instance."""
    global _steam_service
    if _steam_service:
        await _steam_service.close()
        _steam_service = None
