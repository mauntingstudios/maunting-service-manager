"""Tests for Steam Workshop Collections, CurseForge generic bundles/manifests, and batch mod installation."""
from __future__ import annotations

import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from models import Mod, Server, User
from services.curseforge_service import CurseForgeModInfo, CurseForgeService, extract_curseforge_url_query
from services.steam_service import SteamModInfo, SteamService, extract_steam_publishedfileid


def _make_steam_mod_payload(pid: str, title: str, file_type: int = 0, children: list | None = None, appid: int = 440900) -> dict:
    item = {
        "result": 1,
        "publishedfileid": pid,
        "title": title,
        "short_description": f"Desc {title}",
        "creator": "76561198000000000",
        "file_size": 1024 * 1024,
        "time_created": 1700000000,
        "time_updated": 1700000100,
        "subscriptions": 100,
        "favorited": 20,
        "tags": [{"tag": "Mod"}],
        "preview_url": f"https://steam.example/{pid}.jpg",
        "file_type": file_type,
        "consumer_appid": appid,
    }
    if children is not None:
        item["children"] = children
    return item


class TestSteamCollectionsServiceAndRouter:
    def test_extract_steam_publishedfileid(self):
        assert extract_steam_publishedfileid("2875848298") == "2875848298"
        assert (
            extract_steam_publishedfileid("https://steamcommunity.com/sharedfiles/filedetails/?id=3012345678&searchtext=abc")
            == "3012345678"
        )
        assert (
            extract_steam_publishedfileid("https://steamcommunity.com/workshop/filedetails/?id=99887766")
            == "99887766"
        )
        assert extract_steam_publishedfileid("building overhaul") is None

    @pytest.mark.asyncio
    async def test_search_collections_skips_required_tags_and_sets_filetype(self):
        resp_json = {
            "response": {
                "publishedfiledetails": [
                    _make_steam_mod_payload(
                        "555000111",
                        "My RP Collection",
                        file_type=2,
                        children=[{"publishedfileid": "111"}, {"publishedfileid": "222"}],
                    )
                ]
            }
        }
        mock_get = AsyncMock(
            return_value=httpx.Response(
                200,
                json=resp_json,
                request=httpx.Request("GET", "https://api.steampowered.com/IPublishedFileService/QueryFiles/v1/"),
            )
        )
        with patch("services.steam_api_key_service.resolve_key", return_value="STEAM_TEST_KEY"):
            svc = SteamService()
            with patch.object(svc.client, "get", mock_get):
                results = await svc.search_workshop_mods(
                    appid="440900",
                    query="RP",
                    required_tags=["Enhanced"],
                    filetype=1,
                )
            await svc.close()

        assert len(results) == 1
        assert results[0].item_type == "collection"
        assert results[0].children_count == 2
        sent_input = json.loads(mock_get.call_args.kwargs["params"]["input_json"])
        assert sent_input["filetype"] == 1
        assert sent_input["return_children"] is True
        assert "requiredtags" not in sent_input

    @pytest.mark.asyncio
    async def test_get_collection_details_flattens_nested_collections_and_chunks_details(self):
        # Root collection 9001 -> mod 101 (sortorder 1), subcollection 9002 (filetype=2, sortorder 0), missing mod 404
        # Subcollection 9002 -> mod 202 (sortorder 0), duplicate mod 101 (sortorder 1)
        root_collection_resp = httpx.Response(
            200,
            json={
                "response": {
                    "collectiondetails": [
                        {
                            "publishedfileid": "9001",
                            "result": 1,
                            "children": [
                                {"publishedfileid": "101", "sortorder": 1, "filetype": 0},
                                {"publishedfileid": "9002", "sortorder": 0, "filetype": 2},
                                {"publishedfileid": "404999", "sortorder": 2, "filetype": 0},
                            ],
                        }
                    ]
                }
            },
            request=httpx.Request("POST", "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/"),
        )
        sub_collection_resp = httpx.Response(
            200,
            json={
                "response": {
                    "collectiondetails": [
                        {
                            "publishedfileid": "9002",
                            "result": 1,
                            "children": [
                                {"publishedfileid": "202", "sortorder": 0, "filetype": 0},
                                {"publishedfileid": "101", "sortorder": 1, "filetype": 0},
                            ],
                        }
                    ]
                }
            },
            request=httpx.Request("POST", "https://api.steampowered.com/ISteamRemoteStorage/GetCollectionDetails/v1/"),
        )
        root_meta_resp = httpx.Response(
            200,
            json={
                "response": {
                    "publishedfiledetails": [
                        _make_steam_mod_payload("9001", "Mega Pack", file_type=2),
                    ]
                }
            },
            request=httpx.Request("GET", "https://api.steampowered.com/IPublishedFileService/GetDetails/v1/"),
        )
        items_meta_resp = httpx.Response(
            200,
            json={
                "response": {
                    "publishedfiledetails": [
                        _make_steam_mod_payload("101", "First Mod"),
                        _make_steam_mod_payload("202", "Sub Mod"),
                        {"result": 9, "publishedfileid": "404999"},
                    ]
                }
            },
            request=httpx.Request("GET", "https://api.steampowered.com/IPublishedFileService/GetDetails/v1/"),
        )

        with patch("services.steam_api_key_service.resolve_key", return_value="STEAM_TEST_KEY"):
            svc = SteamService()
            with patch.object(svc.client, "post", AsyncMock(side_effect=[root_collection_resp, sub_collection_resp])), \
                 patch.object(svc.client, "get", AsyncMock(side_effect=[root_meta_resp, items_meta_resp])):
                resolved = await svc.get_collection_details("440900", "9001")
            await svc.close()

        assert resolved is not None
        assert resolved["collection"].title == "Mega Pack"
        assert [m.publishedfileid for m in resolved["items"]] == ["101", "202"]
        assert resolved["unavailable_ids"] == ["404999"]
        assert resolved["total_children"] == 3

    def test_steam_collection_endpoints(
        self, client: TestClient, owner_cookies: dict, test_server: Server
    ):
        col = SteamModInfo(
            publishedfileid="777888999",
            title="Server Collection",
            description="250 mods",
            creator="Admin",
            file_size=0,
            created=datetime.now(timezone.utc),
            updated=datetime.now(timezone.utc),
            subscriptions=50,
            favorites=10,
            tags=["Collection"],
            preview_url=None,
            direct_url="https://steamcommunity.com/sharedfiles/filedetails/?id=777888999",
            item_type="collection",
            children_count=2,
        )
        child1 = SteamModInfo(
            publishedfileid="111222",
            title="Child One",
            description="desc",
            creator="Modder",
            file_size=2048,
            created=datetime.now(timezone.utc),
            updated=datetime.now(timezone.utc),
            subscriptions=10,
            favorites=2,
            tags=[],
            direct_url="https://steamcommunity.com/sharedfiles/filedetails/?id=111222",
        )
        mock_svc = MagicMock()
        mock_svc.search_workshop_mods = AsyncMock(return_value=[col])
        mock_svc.get_collection_details = AsyncMock(
            return_value={
                "collection": col,
                "items": [child1],
                "unavailable_ids": ["999999"],
                "total_children": 2,
            }
        )
        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True
        mock_plugin.get_mod_support.return_value = {"workshop_id": "440900", "required_tags": []}

        with patch("routers.steam.get_plugin", return_value=mock_plugin), \
             patch("routers.steam.get_steam_service", return_value=mock_svc):
            r_search = client.get(
                f"/api/steam/workshop/search?server_id={test_server.id}&query=Server&content_type=collections",
                cookies=owner_cookies,
            )
            assert r_search.status_code == 200
            assert r_search.json()[0]["item_type"] == "collection"
            assert mock_svc.search_workshop_mods.call_args.kwargs["filetype"] == 1

            r_col = client.get(
                f"/api/steam/workshop/collection/777888999?server_id={test_server.id}",
                cookies=owner_cookies,
            )
            assert r_col.status_code == 200
            payload = r_col.json()
            assert payload["collection"]["publishedfileid"] == "777888999"
            assert payload["items"][0]["publishedfileid"] == "111222"
            assert payload["unavailable_ids"] == ["999999"]
            assert payload["item_count"] == 1

            r_bad = client.get(
                f"/api/steam/workshop/collection/not-numeric?server_id={test_server.id}",
                cookies=owner_cookies,
            )
            assert r_bad.status_code == 400


class TestCurseForgeGenericBundlesAndManifest:
    def test_extract_curseforge_url_query(self):
        assert extract_curseforge_url_query("https://www.curseforge.com/minecraft/modpacks/all-the-mods-9") == (
            "all-the-mods-9",
            "modpacks",
        )
        assert extract_curseforge_url_query("https://www.curseforge.com/ark-survival-ascended/mods/automated-ark/files") == (
            "automated-ark",
            "mods",
        )
        assert extract_curseforge_url_query("https://www.curseforge.com/projects/927142") == ("927142", None)
        assert extract_curseforge_url_query("automated ark") == (None, None)

    @pytest.mark.asyncio
    async def test_get_game_classes_and_batch_mods(self):
        classes_resp = httpx.Response(
            200,
            json={
                "data": [
                    {"id": 4471, "name": "Modpacks", "slug": "modpacks", "isClass": True},
                    {"id": 6, "name": "Mods", "slug": "mc-mods", "isClass": True},
                    {"id": 12, "name": "Resource Packs", "slug": "texture-packs", "isClass": True},
                ]
            },
            request=httpx.Request("GET", "https://api.curseforge.com/v1/categories"),
        )
        batch_resp = httpx.Response(
            200,
            json={
                "data": [
                    {"id": 1001, "name": "Mod A", "gameId": 432, "classId": 6},
                    {"id": 1002, "name": "Mod B", "gameId": 432, "classId": 4471},
                ]
            },
            request=httpx.Request("POST", "https://api.curseforge.com/v1/mods"),
        )
        with patch("services.curseforge_api_key_service.resolve_key", return_value="CF_TEST_KEY"):
            svc = CurseForgeService()
            with patch.object(svc.client, "get", AsyncMock(return_value=classes_resp)), \
                 patch.object(svc.client, "post", AsyncMock(return_value=batch_resp)):
                classes = await svc.get_game_classes(432)
                mods = await svc.get_mods_by_ids([1001, 1002, 1001])
            await svc.close()

        assert [c["kind"] for c in classes] == ["mods", "modpacks", "resourcepacks"]
        assert len(mods) == 2
        assert mods[1].class_id == 4471

    def test_curseforge_classes_strict_modpacks_bundle_and_manifest(
        self, client: TestClient, owner_cookies: dict, csrf_token: str, test_server: Server
    ):
        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True
        mock_plugin.get_mod_support.return_value = {
            "supports_curseforge": True,
            "curseforge_game_id": "83374",
            "curseforge_class_id": "6807",
        }
        mock_svc = MagicMock()
        mock_svc.get_game_classes = AsyncMock(
            return_value=[{"id": 6807, "name": "Mods", "slug": "mods", "icon_url": None, "kind": "mods"}]
        )
        # Keine Modpacks-Klasse fuer dieses Spiel -> strikt leere Liste statt Mods-Fallback!
        mock_svc.find_class_id = AsyncMock(return_value=None)
        mock_svc.search_mods = AsyncMock(return_value=[])

        mod_a = CurseForgeModInfo(
            publishedfileid="927142",
            title="Automated Ark",
            description="Automation",
            creator="Author",
            file_size=1024,
            created=datetime.now(timezone.utc),
            updated=datetime.now(timezone.utc),
            subscriptions=1000,
            favorites=50,
            tags=["Utility"],
            direct_url="https://www.curseforge.com/ark-survival-ascended/mods/automated-ark",
            game_id="83374",
            class_id=6807,
        )
        other_game_mod = CurseForgeModInfo(
            publishedfileid="55555",
            title="Minecraft Only Mod",
            description="Wrong game",
            creator="Author",
            file_size=500,
            created=datetime.now(timezone.utc),
            updated=datetime.now(timezone.utc),
            subscriptions=10,
            favorites=1,
            tags=[],
            direct_url="https://www.curseforge.com/minecraft/mc-mods/wrong",
            game_id="432",
            class_id=6,
        )
        mock_svc.get_mods_by_ids = AsyncMock(return_value=[mod_a, other_game_mod])
        mock_svc.get_mod_details = AsyncMock(return_value=mod_a)
        mock_svc.get_mod_files = AsyncMock(return_value=[{"id": 11, "fileName": "aa.zip", "dependencies": []}])

        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            zf.writestr(
                "manifest.json",
                json.dumps(
                    {
                        "name": "ASA Cluster Export",
                        "version": "1.2",
                        "author": "Admin",
                        "files": [
                            {"projectID": 927142, "fileID": 11},
                            {"projectID": 55555, "fileID": 22},
                            {"projectID": 999999, "fileID": 33},
                        ],
                    }
                ),
            )

        with patch("routers.curseforge.get_plugin", return_value=mock_plugin), \
             patch("routers.curseforge.get_curseforge_service", return_value=mock_svc):
            r_classes = client.get(f"/api/curseforge/classes?server_id={test_server.id}", cookies=owner_cookies)
            assert r_classes.status_code == 200
            assert r_classes.json()[0]["name"] == "Mods"

            r_modpacks = client.get(
                f"/api/curseforge/search?server_id={test_server.id}&query=test&class_id=modpacks",
                cookies=owner_cookies,
            )
            assert r_modpacks.status_code == 200
            assert r_modpacks.json() == []
            mock_svc.search_mods.assert_not_called()

            r_bundle = client.get(
                f"/api/curseforge/mod/927142/bundle?server_id={test_server.id}",
                cookies=owner_cookies,
            )
            assert r_bundle.status_code == 200
            assert r_bundle.json()["mod"]["publishedfileid"] == "927142"

            r_manifest = client.post(
                f"/api/curseforge/parse-manifest?server_id={test_server.id}",
                files={"file": ("profile.zip", buf.getvalue(), "application/zip")},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
            assert r_manifest.status_code == 200
            manifest_data = r_manifest.json()
            assert manifest_data["pack_name"] == "ASA Cluster Export"
            assert [m["publishedfileid"] for m in manifest_data["items"]] == ["927142"]
            assert manifest_data["wrong_game_ids"] == ["55555"]
            assert "999999" in manifest_data["unavailable_ids"]

    @pytest.mark.asyncio
    async def test_curseforge_installer_server_pack_fallback(self, tmp_path: Path):
        from games.curseforge_installer import _download_single_curseforge_mod

        mod_info = CurseForgeModInfo(
            publishedfileid="5001",
            title="Test Modpack",
            description="",
            creator="Packer",
            file_size=100,
            created=datetime.now(timezone.utc),
            updated=datetime.now(timezone.utc),
            subscriptions=10,
            favorites=1,
            tags=[],
            latest_files=[{"id": 100, "fileName": "client.zip", "downloadUrl": "https://cdn.example/client.zip"}],
            has_server_pack=True,
            server_pack_file_id=200,
        )
        svc = MagicMock()
        svc.get_mod_details = AsyncMock(return_value=mod_info)
        svc.get_mod_files = AsyncMock(return_value=[])
        svc.get_file_download_url = AsyncMock(return_value="https://cdn.example/serverpack-200.jar")

        fake_resp = MagicMock()
        fake_resp.content = b"jarbytes"
        fake_resp.raise_for_status = MagicMock()
        fake_client_inst = MagicMock()
        fake_client_inst.__aenter__ = AsyncMock(return_value=fake_client_inst)
        fake_client_inst.__aexit__ = AsyncMock(return_value=None)
        fake_client_inst.get = AsyncMock(return_value=fake_resp)

        plugin = MagicMock()
        server = MagicMock()
        server.id = 1
        target_dir = tmp_path / "mods"
        target_dir.mkdir(parents=True)

        with patch("games.curseforge_installer.httpx.AsyncClient", return_value=fake_client_inst):
            ok, err, _detail = await _download_single_curseforge_mod(
                plugin, server, svc, "KEY", "5001", tmp_path, target_dir, "mods"
            )

        assert ok is True
        assert err is None
        svc.get_file_download_url.assert_awaited_once_with("5001", 200)
        assert (target_dir / "cf_5001_serverpack-200.jar").exists()


class TestBatchModInstallEndpoint:
    def test_batch_install_queues_missing_skips_installed_and_triggers_worker(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        test_server: Server,
        db: Session,
    ):
        existing_ok = Mod(
            server_id=test_server.id,
            workshop_id="1001",
            name="Already There",
            load_order=0,
            install_status="installed",
        )
        existing_err = Mod(
            server_id=test_server.id,
            workshop_id="1002",
            name="Retry Me",
            load_order=1,
            install_status="error",
        )
        db.add_all([existing_ok, existing_err])
        db.commit()

        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True

        with patch("routers.mods.get_plugin", return_value=mock_plugin), \
             patch("routers.mods.install_mods_batch_bg") as mock_bg:
            response = client.post(
                f"/api/mods/{test_server.id}/batch",
                json={
                    "items": [
                        {"workshop_id": "1001", "name": "Already There"},
                        {"workshop_id": "1002", "name": "Retry Me"},
                        {"workshop_id": "1003", "name": "Brand New"},
                        {"workshop_id": "1003", "name": "Duplicate In Request"},
                    ],
                    "skip_existing": True,
                },
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["queued"] == 2
        assert body["skipped"] == 1
        assert body["queued_ids"] == ["1002", "1003"]
        assert body["skipped_ids"] == ["1001"]
        mock_bg.assert_called_once_with(test_server.id, ["1002", "1003"])

        db.expire_all()
        rows = db.query(Mod).filter(Mod.server_id == test_server.id).order_by(Mod.load_order.asc()).all()
        by_wid = {m.workshop_id: m for m in rows}
        assert by_wid["1001"].install_status == "installed"
        assert by_wid["1002"].install_status == "pending"
        assert by_wid["1003"].install_status == "pending"
        assert by_wid["1003"].name == "Brand New"
        assert by_wid["1003"].load_order == 2

    def test_batch_install_worker_chunks_and_respects_abort(
        self, test_server: Server, db: Session
    ):
        from routers.mods import install_mods_batch_bg

        mods = [
            Mod(
                server_id=test_server.id,
                workshop_id=wid,
                name=f"Mod {wid}",
                load_order=idx,
                install_status="pending",
                install_action="install",
            )
            for idx, wid in enumerate(["2001", "2002", "2003"])
        ]
        db.add_all(mods)
        db.commit()

        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True
        calls: list[list[str]] = []

        def fake_install_mods(_srv, chunk_ids):
            calls.append(list(chunk_ids))
            return {"ok": True, "items": {wid: {"ok": True} for wid in chunk_ids}}

        mock_plugin.install_mods.side_effect = fake_install_mods

        with patch("routers.mods._BATCH_CHUNK_SIZE", 2), \
             patch("routers.mods.acquire_install_update_lock_blocking", return_value=True), \
             patch("routers.mods.release_install_update_lock") as mock_release, \
             patch("routers.mods.get_plugin", return_value=mock_plugin), \
             patch("routers.mods.updater.update_mod_metadata_after_success"):
            install_mods_batch_bg(test_server.id, ["2001", "2002", "2003"])

        assert calls == [["2001", "2002"], ["2003"]]
        mock_plugin.update_modlist.assert_called()
        mock_release.assert_called_once_with(test_server.id)

        db.expire_all()
        for wid in ("2001", "2002", "2003"):
            row = db.query(Mod).filter(Mod.server_id == test_server.id, Mod.workshop_id == wid).first()
            assert row is not None
            assert row.install_status == "installed"

    def test_batch_background_worker_uses_real_blocking_lock_and_detached_server_node(
        self, test_server, db
    ):
        """Regression: real acquire_install_update_lock_blocking must not return falsy None
        and cause every mod to fail with 'Eine andere Installation oder ein Update läuft bereits'
        while leaking the lock, and detached Server.node must remain accessible."""
        from routers.mods import install_mods_batch_bg
        from services.install_update_lock_service import (
            active_install_update_lock,
            reset_install_update_lock_for_tests,
        )

        reset_install_update_lock_for_tests()
        mods = [
            Mod(
                server_id=test_server.id,
                workshop_id=wid,
                name=f"Mod {wid}",
                load_order=idx,
                install_status="pending",
                install_action="install",
            )
            for idx, wid in enumerate(["3001", "3002"])
        ]
        db.add_all(mods)
        db.commit()

        observed_nodes: list[object] = []
        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True

        def fake_install_mods(srv, chunk_ids):
            observed_nodes.append(getattr(srv, "node", None))
            return {"ok": True, "items": {wid: {"ok": True} for wid in chunk_ids}}

        mock_plugin.install_mods.side_effect = fake_install_mods

        with patch("routers.mods.get_plugin", return_value=mock_plugin), \
             patch("routers.mods.updater.update_mod_metadata_after_success"):
            install_mods_batch_bg(test_server.id, ["3001", "3002"])

        assert len(observed_nodes) == 1
        assert active_install_update_lock() is None

        db.expire_all()
        for wid in ("3001", "3002"):
            row = db.query(Mod).filter(Mod.server_id == test_server.id, Mod.workshop_id == wid).first()
            assert row is not None
            assert row.install_status == "installed"
            assert row.install_error is None


class TestBulkModActionsAndDelete:
    def test_bulk_action_update_queues_selected_mods_only(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        test_server: Server,
        db: Session,
    ):
        m1 = Mod(server_id=test_server.id, workshop_id="4001", name="Mod One", load_order=0, install_status="installed")
        m2 = Mod(server_id=test_server.id, workshop_id="4002", name="Mod Two", load_order=1, install_status="installed")
        m3 = Mod(server_id=test_server.id, workshop_id="4003", name="Mod Three", load_order=2, install_status="installed")
        db.add_all([m1, m2, m3])
        db.commit()
        db.refresh(m1)
        db.refresh(m2)
        db.refresh(m3)

        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True

        with patch("routers.mods.get_plugin", return_value=mock_plugin), \
             patch("routers.mods._refresh_mod_update_availability", return_value=[{"workshop_id": "4002", "remote_updated": "2026-10-01T12:00:00+00:00"}]), \
             patch("routers.mods.bulk_mod_action_bg") as mock_bg:
            response = client.post(
                f"/api/mods/{test_server.id}/bulk-action",
                json={"mod_ids": [m1.id, m2.id], "action": "update"},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )

        assert response.status_code == 200
        mock_bg.assert_called_once_with(
            test_server.id,
            ["4001", "4002"],
            "update",
            {"4002": "2026-10-01T12:00:00+00:00"},
        )

        db.expire_all()
        r1 = db.query(Mod).filter(Mod.id == m1.id).first()
        r2 = db.query(Mod).filter(Mod.id == m2.id).first()
        r3 = db.query(Mod).filter(Mod.id == m3.id).first()
        assert r1 is not None and r1.install_status == "pending" and r1.install_action == "update"
        assert r2 is not None and r2.install_status == "pending" and r2.install_action == "update"
        assert r3 is not None and r3.install_status == "installed" and r3.install_action is None

    def test_bulk_action_bg_reinstall_cleans_disk_and_releases_lock(
        self, test_server: Server, db: Session
    ):
        from routers.mods import bulk_mod_action_bg
        from services.install_update_lock_service import (
            active_install_update_lock,
            reset_install_update_lock_for_tests,
        )

        reset_install_update_lock_for_tests()
        mods = [
            Mod(
                server_id=test_server.id,
                workshop_id=wid,
                name=f"Mod {wid}",
                load_order=idx,
                install_status="pending",
                install_action="reinstall",
            )
            for idx, wid in enumerate(["5001", "5002"])
        ]
        db.add_all(mods)
        db.commit()

        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True
        mock_plugin.cleanup_mod.return_value = {"ok": True}
        mock_plugin.install_mods.return_value = {
            "ok": True,
            "items": {"5001": {"ok": True}, "5002": {"ok": True}},
        }

        with patch("routers.mods.get_plugin", return_value=mock_plugin), \
             patch("routers.mods.updater.update_mod_metadata_after_success"):
            bulk_mod_action_bg(test_server.id, ["5001", "5002"], "reinstall")

        assert mock_plugin.cleanup_mod.call_count == 2
        mock_plugin.install_mods.assert_called_once()
        mock_plugin.update_modlist.assert_called()
        assert active_install_update_lock() is None

        db.expire_all()
        for wid in ("5001", "5002"):
            row = db.query(Mod).filter(Mod.server_id == test_server.id, Mod.workshop_id == wid).first()
            assert row is not None and row.install_status == "installed"

    def test_bulk_delete_selected_removes_disk_files_and_db_records(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        test_server: Server,
        db: Session,
        tmp_path: Path,
    ):
        mod1_dir = tmp_path / "mods" / "6001"
        mod2_dir = tmp_path / "mods" / "6002"
        mod3_dir = tmp_path / "mods" / "6003"
        for d in (mod1_dir, mod2_dir, mod3_dir):
            d.mkdir(parents=True, exist_ok=True)
            (d / "mod.pak").write_bytes(b"pak-data")

        m1 = Mod(server_id=test_server.id, workshop_id="6001", name="Delete One", load_order=0, install_status="installed")
        m2 = Mod(server_id=test_server.id, workshop_id="6002", name="Delete Two", load_order=1, install_status="installed")
        m3 = Mod(server_id=test_server.id, workshop_id="6003", name="Keep Three", load_order=2, install_status="installed")
        db.add_all([m1, m2, m3])
        db.commit()
        db.refresh(m1)
        db.refresh(m2)
        db.refresh(m3)

        import shutil

        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True
        mock_plugin.cleanup_mod.side_effect = lambda _srv, wid: shutil.rmtree(tmp_path / "mods" / wid, ignore_errors=False) or {"ok": True}

        with patch("routers.mods.get_plugin", return_value=mock_plugin):
            response = client.post(
                f"/api/mods/{test_server.id}/bulk-delete",
                json={"mod_ids": [m1.id, m2.id], "delete_all": False},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["deleted_count"] == 2
        assert [m["workshop_id"] for m in body["mods"]] == ["6003"]
        assert not mod1_dir.exists()
        assert not mod2_dir.exists()
        assert mod3_dir.exists()
        mock_plugin.update_modlist.assert_called_once()

        db.expire_all()
        remaining = db.query(Mod).filter(Mod.server_id == test_server.id).all()
        assert [m.workshop_id for m in remaining] == ["6003"]

    def test_bulk_delete_all_removes_all_mods_and_files(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        test_server: Server,
        db: Session,
        tmp_path: Path,
    ):
        for wid in ("7001", "7002"):
            d = tmp_path / "allmods" / wid
            d.mkdir(parents=True, exist_ok=True)
            (d / "data.bin").write_bytes(b"abc")

        m1 = Mod(server_id=test_server.id, workshop_id="7001", name="One", load_order=0, install_status="installed")
        m2 = Mod(server_id=test_server.id, workshop_id="7002", name="Two", load_order=1, install_status="installed")
        db.add_all([m1, m2])
        db.commit()

        import shutil

        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True
        mock_plugin.cleanup_mod.side_effect = lambda _srv, wid: shutil.rmtree(tmp_path / "allmods" / wid, ignore_errors=False) or {"ok": True}

        with patch("routers.mods.get_plugin", return_value=mock_plugin):
            response = client.post(
                f"/api/mods/{test_server.id}/bulk-delete",
                json={"mod_ids": [], "delete_all": True},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )

        assert response.status_code == 200
        body = response.json()
        assert body["deleted_count"] == 2
        assert body["mods"] == []
        assert not (tmp_path / "allmods" / "7001").exists()
        assert not (tmp_path / "allmods" / "7002").exists()
        mock_plugin.update_modlist.assert_called_once()

    def test_bulk_delete_rejects_running_mod_and_reports_cleanup_error(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        test_server: Server,
        db: Session,
    ):
        running_mod = Mod(server_id=test_server.id, workshop_id="8001", name="Busy Mod", load_order=0, install_status="installing")
        idle_mod = Mod(server_id=test_server.id, workshop_id="8002", name="Idle Mod", load_order=1, install_status="installed")
        db.add_all([running_mod, idle_mod])
        db.commit()
        db.refresh(running_mod)
        db.refresh(idle_mod)

        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True

        with patch("routers.mods.get_plugin", return_value=mock_plugin):
            res_busy = client.post(
                f"/api/mods/{test_server.id}/bulk-delete",
                json={"mod_ids": [running_mod.id], "delete_all": False},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
            assert res_busy.status_code == 409

            mock_plugin.cleanup_mod.return_value = {"ok": False}
            res_fail = client.post(
                f"/api/mods/{test_server.id}/bulk-delete",
                json={"mod_ids": [idle_mod.id], "delete_all": False},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
            assert res_fail.status_code == 502

    def test_installed_mods_metadata_endpoint_returns_enriched_details_and_graceful_fallback(
        self,
        client: TestClient,
        owner_cookies: dict,
        test_server: Server,
        db: Session,
    ):
        from datetime import datetime, timezone
        from services.steam_service import SteamApiUnavailable, SteamModInfo

        m1 = Mod(server_id=test_server.id, workshop_id="9001", name="Meta Mod", load_order=0, install_status="installed")
        db.add(m1)
        db.commit()

        mock_plugin = MagicMock()
        mock_plugin.supports_mods = True
        mock_plugin.get_mod_support.return_value = {
            "provider": "steam",
            "workshop_id": "440900",
        }

        now = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)
        steam_item = SteamModInfo(
            publishedfileid="9001",
            title="Meta Mod Full",
            description="Detailed description",
            creator="Author",
            file_size=5 * 1024 * 1024,
            created=now,
            updated=now,
            subscriptions=1200,
            favorites=50,
            tags=["Vehicles", "QoL"],
            preview_url="https://steam.example/9001.jpg",
            direct_url="https://steamcommunity.com/sharedfiles/filedetails/?id=9001",
        )
        mock_steam_service = AsyncMock()
        mock_steam_service.get_details_batch = AsyncMock(return_value={"9001": steam_item})

        with patch("routers.mods.get_plugin", return_value=mock_plugin), \
             patch("services.steam_service.get_steam_service", new=AsyncMock(return_value=mock_steam_service)):
            ok_res = client.get(f"/api/mods/{test_server.id}/metadata", cookies=owner_cookies)

        assert ok_res.status_code == 200
        payload = ok_res.json()
        assert payload["9001"]["preview_url"] == "https://steam.example/9001.jpg"
        assert payload["9001"]["file_size_mb"] == 5.0
        assert payload["9001"]["tags"] == ["Vehicles", "QoL"]

        with patch("routers.mods.get_plugin", return_value=mock_plugin), \
             patch("services.steam_service.get_steam_service", new=AsyncMock(side_effect=SteamApiUnavailable("steam_api_key_missing"))):
            fallback_res = client.get(f"/api/mods/{test_server.id}/metadata", cookies=owner_cookies)

        assert fallback_res.status_code == 200
        assert fallback_res.json() == {}

    @pytest.mark.asyncio
    async def test_steam_get_details_batch_public_fallback_resolves_without_api_key(self):
        from services.steam_service import SteamService

        service = SteamService()
        service.api_key = None

        fake_resp = MagicMock()
        fake_resp.raise_for_status = MagicMock()
        fake_resp.json.return_value = {
            "response": {
                "publishedfiledetails": [
                    {
                        "publishedfileid": "777001",
                        "result": 1,
                        "title": "Public Mod",
                        "file_description": "[h1]Feature[/h1] Adds cool backpacks",
                        "preview_url": "https://cdn.example/777001.jpg",
                        "file_size": 2097152,
                        "tags": [{"tag": "QoL"}],
                    }
                ]
            }
        }
        service.client = MagicMock()
        service.client.post = AsyncMock(return_value=fake_resp)

        try:
            details = await service.get_details_batch(["777001"], appid="108600", allow_public_fallback=True)
        finally:
            service.client = AsyncMock()
            service.client.aclose = AsyncMock()

        assert "777001" in details
        assert details["777001"].preview_url == "https://cdn.example/777001.jpg"
        assert details["777001"].description == "Feature Adds cool backpacks"
        assert details["777001"].file_size == 2097152
