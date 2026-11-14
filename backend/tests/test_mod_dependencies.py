"""Tests for Steam Workshop and CurseForge mod dependency resolution."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import Server, User
from routers.curseforge import _extract_required_dep_ids, _select_primary_curseforge_file
from services.curseforge_service import CurseForgeModInfo
from services.steam_service import SteamModInfo, SteamService


def _steam_payload(
    pid: str,
    title: str,
    children: list[dict] | None = None,
    appid: int = 440900,
) -> dict:
    item: dict = {
        "result": 1,
        "publishedfileid": pid,
        "title": title,
        "short_description": f"Description of {title}",
        "creator": "ModAuthor",
        "file_size": 2 * 1024 * 1024,
        "time_created": 1700000000,
        "time_updated": 1700000500,
        "subscriptions": 500,
        "favorited": 50,
        "tags": [{"tag": "Framework"}],
        "preview_url": f"https://steam.example/{pid}.jpg",
        "file_type": 0,
        "consumer_appid": appid,
    }
    if children is not None:
        item["children"] = children
    return item


def _cf_mod(
    mod_id: str,
    title: str,
    *,
    main_file_id: int | None = None,
    latest_files: list[dict] | None = None,
    class_id: int = 6,
) -> CurseForgeModInfo:
    now = datetime(2026, 1, 1, tzinfo=timezone.utc)
    return CurseForgeModInfo(
        publishedfileid=mod_id,
        title=title,
        description=f"CurseForge {title}",
        creator="CFAuthor",
        file_size=1024 * 512,
        created=now,
        updated=now,
        subscriptions=1000,
        favorites=10,
        tags=["Library"],
        preview_url=f"https://cf.example/{mod_id}.png",
        direct_url=f"https://www.curseforge.com/minecraft/mc-mods/{mod_id}",
        main_file_id=main_file_id,
        latest_files=latest_files or [],
        allow_mod_distribution=True,
        game_id="432",
        class_id=class_id,
    )


class TestSteamModDependenciesService:
    @pytest.mark.asyncio
    async def test_query_and_details_request_children_for_regular_mods(self):
        search_json = {
            "response": {
                "publishedfiledetails": [
                    _steam_payload(
                        "111",
                        "Main Mod",
                        children=[{"publishedfileid": "222", "sortorder": 0}],
                    )
                ]
            }
        }
        popular_json = {
            "response": {
                "publishedfiledetails": [
                    _steam_payload(
                        "333",
                        "Popular Mod",
                        children=[{"publishedfileid": "444", "sortorder": 0}],
                    )
                ]
            }
        }
        mock_get = AsyncMock(
            side_effect=[
                httpx.Response(
                    200,
                    json=search_json,
                    request=httpx.Request("GET", "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/"),
                ),
                httpx.Response(
                    200,
                    json=popular_json,
                    request=httpx.Request("GET", "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/"),
                ),
            ]
        )
        with patch("services.steam_api_key_service.resolve_key", return_value="STEAM_KEY"):
            svc = SteamService()
            with patch.object(svc.client, "get", mock_get):
                searched = await svc.search_workshop_mods(appid="440900", query="Main")
                popular = await svc.get_popular_mods(appid="440900")
            await svc.close()

        assert searched[0].child_ids == ["222"]
        assert searched[0].children_count == 1
        assert popular[0].child_ids == ["444"]
        assert popular[0].children_count == 1

        search_input = json.loads(mock_get.call_args_list[0].kwargs["params"]["input_json"])
        popular_input = json.loads(mock_get.call_args_list[1].kwargs["params"]["input_json"])
        assert search_input["return_children"] is True
        assert popular_input["return_children"] is True

    @pytest.mark.asyncio
    async def test_get_mod_dependencies_transitive_cycle_safe_and_unavailable(self):
        async def _fake_get(_url: str, params: dict | None = None):
            payload = json.loads((params or {})["input_json"])
            assert payload["includechildren"] is True
            assert payload["includetags"] is True
            pids = [str(pid) for pid in payload["publishedfileids"]]
            details = []
            for pid in pids:
                if pid == "100":
                    details.append(
                        _steam_payload(
                            "100",
                            "Main Gameplay Mod",
                            children=[
                                {"publishedfileid": "200", "sortorder": 1},
                                {"publishedfileid": "999", "sortorder": 2},
                            ],
                        )
                    )
                elif pid == "200":
                    # Zirkulaerer Verweis auf 100 plus Sub-Abhaengigkeit 300
                    details.append(
                        _steam_payload(
                            "200",
                            "Mid Library",
                            children=[
                                {"publishedfileid": "300", "sortorder": 0},
                                {"publishedfileid": "100", "sortorder": 1},
                            ],
                        )
                    )
                elif pid == "300":
                    details.append(
                        _steam_payload(
                            "300",
                            "Base Core Lib",
                            children=[{"publishedfileid": "200", "sortorder": 0}],
                        )
                    )
                else:
                    details.append({"result": 9, "publishedfileid": pid})
            return httpx.Response(
                200,
                json={"response": {"publishedfiledetails": details}},
                request=httpx.Request("GET", _url),
            )

        with patch("services.steam_api_key_service.resolve_key", return_value="STEAM_KEY"):
            svc = SteamService()
            with patch.object(svc.client, "get", side_effect=_fake_get):
                result = await svc.get_mod_dependencies(appid="440900", publishedfileid="100")
            await svc.close()

        assert result is not None
        assert result["mod"].publishedfileid == "100"
        # Sub-Abhaengigkeit 300 muss vor 200 kommen
        assert [d.publishedfileid for d in result["dependencies"]] == ["300", "200"]
        assert result["unavailable_ids"] == ["999"]


class TestSteamAndCurseForgeDependenciesRouter:
    def test_steam_dependencies_endpoint_returns_resolved_tree(
        self,
        client: TestClient,
        owner_cookies: dict,
        test_server: Server,
    ):
        fake_plugin = MagicMock()
        fake_plugin.supports_mods = True
        fake_plugin.get_mod_support.return_value = {"workshop_id": "440900", "required_tags": []}

        now = datetime(2026, 1, 1, tzinfo=timezone.utc)
        main_mod = SteamModInfo(
            publishedfileid="1001",
            title="Awesome Mod",
            description="Needs framework",
            creator="CreatorA",
            file_size=4096,
            created=now,
            updated=now,
            subscriptions=100,
            favorites=10,
            tags=["Mod"],
            preview_url="https://steam.example/1001.jpg",
            direct_url="https://steamcommunity.com/sharedfiles/filedetails/?id=1001",
            children_count=1,
            child_ids=["1002"],
        )
        dep_mod = SteamModInfo(
            publishedfileid="1002",
            title="Required Framework",
            description="Core helper",
            creator="CreatorB",
            file_size=2048,
            created=now,
            updated=now,
            subscriptions=5000,
            favorites=200,
            tags=["Library"],
            preview_url="https://steam.example/1002.jpg",
            direct_url="https://steamcommunity.com/sharedfiles/filedetails/?id=1002",
            children_count=0,
            child_ids=[],
        )

        mock_svc = MagicMock()
        mock_svc.get_mod_dependencies = AsyncMock(
            return_value={
                "mod": main_mod,
                "dependencies": [dep_mod],
                "unavailable_ids": [],
            }
        )

        with (
            patch("routers.steam.get_plugin", return_value=fake_plugin),
            patch("routers.steam.get_steam_service", AsyncMock(return_value=mock_svc)),
        ):
            bad = client.get(
                f"/api/steam/workshop/mod/abc/dependencies?server_id={test_server.id}",
                cookies=owner_cookies,
            )
            assert bad.status_code == 400

            resp = client.get(
                f"/api/steam/workshop/mod/1001/dependencies?server_id={test_server.id}",
                cookies=owner_cookies,
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["mod"]["publishedfileid"] == "1001"
        assert body["mod"]["dependencies_count"] == 1
        assert len(body["dependencies"]) == 1
        assert body["dependencies"][0]["publishedfileid"] == "1002"
        assert body["dependencies"][0]["direct_url"] == "https://steamcommunity.com/sharedfiles/filedetails/?id=1002"
        assert body["unavailable_ids"] == []

    def test_curseforge_selects_loader_matching_file_and_resolves_transitive_deps(
        self,
        client: TestClient,
        owner_cookies: dict,
        db: Session,
        test_server: Server,
    ):
        test_server.game_type = "minecraft_fabric"
        db.commit()
        server = test_server

        fake_plugin = MagicMock()
        fake_plugin.supports_mods = True
        fake_plugin.get_mod_support.return_value = {"curseforge_game_id": "432", "curseforge_class_id": "6"}
        fake_plugin.blueprint = None

        # Datei 1 = Forge (soll bei Fabric-Server ignoriert werden), Datei 2 = Fabric
        files = [
            {
                "id": 10,
                "displayName": "Mod Forge",
                "fileName": "mod-forge.jar",
                "gameVersions": ["1.20.1", "Forge"],
                "dependencies": [{"modId": 9001, "relationType": 3}],
            },
            {
                "id": 11,
                "displayName": "Mod Fabric",
                "fileName": "mod-fabric.jar",
                "gameVersions": ["1.20.1", "Fabric"],
                "dependencies": [
                    {"modId": 500, "relationType": 3},  # Required
                    {"modId": 501, "relationType": 2},  # Optional -> ignorieren
                    {"modId": 400, "relationType": 3},  # Self -> ignorieren
                ],
            },
        ]
        selected = _select_primary_curseforge_file(files, main_file_id=10, mod_loader_type=4, is_modpack=False)
        assert selected is not None and selected["id"] == 11
        assert _extract_required_dep_ids(selected, 400) == [500]

        target_mod = _cf_mod("400", "Fancy Fabric Mod", main_file_id=10, latest_files=files)
        fabric_api_dep = _cf_mod(
            "500",
            "Fabric API Wrapper",
            main_file_id=50,
            latest_files=[
                {
                    "id": 50,
                    "gameVersions": ["1.20.1", "Fabric"],
                    "dependencies": [
                        {"modId": 600, "relationType": 3},
                        {"modId": 777, "relationType": 3},  # Nicht abrufbar -> unavailable_ids
                    ],
                }
            ],
        )
        core_dep = _cf_mod("600", "Cloth Config", main_file_id=60, latest_files=[])

        mock_cf = MagicMock()
        mock_cf.get_mod_details = AsyncMock(return_value=target_mod)
        mock_cf.get_mod_files = AsyncMock(return_value=files)
        mock_cf.find_class_id = AsyncMock(return_value=4471)
        mock_cf.get_mods_by_ids = AsyncMock(side_effect=[[fabric_api_dep], [core_dep]])

        with (
            patch("routers.curseforge.get_plugin", return_value=fake_plugin),
            patch("routers.curseforge.get_curseforge_service", AsyncMock(return_value=mock_cf)),
        ):
            resp = client.get(
                f"/api/curseforge/mod/400/dependencies?server_id={server.id}",
                cookies=owner_cookies,
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["mod"]["publishedfileid"] == "400"
        # 600 (transitive Sub-Dep) vor 500 (direkte Dep); 9001 (Forge) & 501 (Optional) fehlen!
        assert [d["publishedfileid"] for d in body["dependencies"]] == ["600", "500"]
        assert body["unavailable_ids"] == ["777"]
