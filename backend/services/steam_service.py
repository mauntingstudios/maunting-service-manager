"""
Steam Web API Service for Mod Search and Details

Uses Steam Web API with optional key. Falls back to community search if no key.
Caches responses to respect rate limits.
"""

import json
import logging
import re
import httpx
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
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
    
    async def close(self):
        """Close HTTP client."""
        await self.client.aclose()
    
    def _is_cache_valid(self, key: str) -> bool:
        if key not in self._cache:
            return False
        cached_time = self._cache[key]['timestamp']
        return datetime.now(timezone.utc) - cached_time < self._cache_ttl

    def _get_cache(self, key: str) -> Optional[Any]:
        if self._is_cache_valid(key):
            return self._cache[key]['data']
        return None

    def _set_cache(self, key: str, data: Any):
        self._cache[key] = {
            'data': data,
            'timestamp': datetime.now(timezone.utc)
        }
    
    async def search_workshop_mods(
        self,
        appid: str,
        query: str = "",
        page: int = 1,
        per_page: int = 50,
        required_tags: list[str] | None = None,
        filetype: int = 0,
    ) -> List[SteamModInfo]:
        """Search workshop mods or collections via Steam Web API QueryFiles."""
        if not self.api_key:
            raise SteamApiUnavailable("steam_api_key_missing")

        filetype_int = 1 if int(filetype) == 1 else 0
        tag_suffix = "_" + "_".join(required_tags) if (required_tags and filetype_int == 0) else ""
        cache_key = f"search_{appid}_ft{filetype_int}_{query}_{page}_{per_page}{tag_suffix}"
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
            query_data: Dict[str, Any] = {
                'query_type': 3 if query else 0,
                'page': page,
                'numperpage': per_page,
                'appid': int(appid),
                'search_text': query,
                'return_short_description': True,
                'return_tags': True,
                'return_previews': True,
                'return_details': True,
                'return_metadata': True,
            }
            if filetype_int == 1:
                query_data['filetype'] = 1
                query_data['return_children'] = True
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

            self._set_cache(cache_key, mods)
            return mods

        except Exception as e:
            logger.warning("Steam API search failed: %s", type(e).__name__)
            raise SteamApiUnavailable("steam_api_unavailable") from e

    async def get_details_batch(
        self,
        publishedfileids: List[str],
        appid: Optional[str] = None,
    ) -> Dict[str, SteamModInfo]:
        """Batch-fetch published file details via IPublishedFileService/GetDetails/v1."""
        if not self.api_key:
            raise SteamApiUnavailable("steam_api_key_missing")

        unique_ids: List[str] = []
        seen: set[str] = set()
        for raw_id in publishedfileids:
            pid = str(raw_id).strip()
            if pid.isdigit() and pid not in seen:
                seen.add(pid)
                unique_ids.append(pid)

        results: Dict[str, SteamModInfo] = {}
        missing_ids: List[str] = []
        for pid in unique_ids:
            if appid:
                cached = self._get_cache(f"details_{appid}_{pid}")
                if cached is not None:
                    results[pid] = cached
                    continue
            missing_ids.append(pid)

        if not missing_ids:
            return results

        chunk_size = 50
        try:
            for offset in range(0, len(missing_ids), chunk_size):
                chunk = missing_ids[offset:offset + chunk_size]
                query_data = {
                    "publishedfileids": [int(pid) for pid in chunk],
                    "includevotes": True,
                    "short_description": True,
                    "return_children": True,
                }
                params = {
                    'key': self.api_key,
                    'input_json': json.dumps(query_data, separators=(',', ':')),
                }
                response = await self.client.get(
                    f"{self.API_BASE}/IPublishedFileService/GetDetails/v1/",
                    params=params,
                )
                response.raise_for_status()
                data = response.json()
                details_list = (data.get('response') or {}).get('publishedfiledetails') or []
                for mod_data in details_list:
                    if mod_data.get('result') == 1:
                        parsed = self._parse_mod_data(mod_data)
                        results[parsed.publishedfileid] = parsed
                        target_app = appid or parsed.consumer_appid
                        if target_app:
                            self._set_cache(f"details_{target_app}_{parsed.publishedfileid}", parsed)
            return results
        except Exception as e:
            logger.warning("Steam API batch details failed: %s", type(e).__name__)
            raise SteamApiUnavailable("steam_api_unavailable") from e

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
        children = mod_data.get('children') or []
        item_type = "collection" if file_type == 2 else "mod"
        consumer_appid = mod_data.get('consumer_appid') or mod_data.get('consumer_app_id')

        return SteamModInfo(
            publishedfileid=str(mod_data.get('publishedfileid', '')),
            title=mod_data.get('title', 'Unknown Mod'),
            description=mod_data.get('short_description', mod_data.get('description', '')),
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
            children_count=len(children) if isinstance(children, list) else 0,
            consumer_appid=str(consumer_appid) if consumer_appid is not None else None,
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

        try:
            query_data: dict = {
                'query_type': query_type,
                'page': page,
                'numperpage': limit,
                'appid': int(appid),
                'return_short_description': True,
                'return_tags': True,
                'return_previews': True,
            }
            if sort == "trending":
                query_data['days'] = 7
            if filetype_int == 1:
                query_data['filetype'] = 1
                query_data['return_children'] = True
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
            
            self._set_cache(cache_key, mods)
            return mods
            
        except Exception as e:
            logger.warning("Steam API popular mods failed: %s", type(e).__name__)
            raise SteamApiUnavailable("steam_api_unavailable") from e


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
