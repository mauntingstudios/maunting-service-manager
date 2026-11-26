"""Tests fuer Modrinth- und Thunderstore-Integration sowie Multi-Source-Blueprints."""

from __future__ import annotations

import hashlib
import io
import json
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from blueprints import get_registry
from blueprints.schema import BlueprintMods
from games import list_game_info
from games.modrinth_installer import (
    cleanup_modrinth_mod,
    install_modrinth_mods,
    read_modrinth_metadata,
    sync_modrinth_enabled_state,
)
from games.thunderstore_installer import (
    cleanup_thunderstore_mod,
    install_thunderstore_mods,
    read_thunderstore_metadata,
    sync_thunderstore_enabled_state,
)
from routers.mods import _validate_workshop_id
from services.modrinth_service import (
    ModrinthModInfo,
    ModrinthService,
    extract_modrinth_url_query,
    is_allowed_modrinth_download_url,
)
from services.thunderstore_service import (
    ThunderstorePackageInfo,
    ThunderstoreService,
    extract_thunderstore_url_query,
    is_allowed_thunderstore_download_url,
)


def test_blueprint_mods_multi_source_schema_validation():
    mods = BlueprintMods(
        supportsMods=True,
        supportsCurseForge=True,
        curseforgeGameId="432",
        supportsModrinth=True,
        modrinthProjectTypes=["mod", "modpack"],
        modrinthLoaders=["fabric"],
        modrinthInstallPath="mods",
        supportsThunderstore=True,
        thunderstoreCommunity="valheim",
        thunderstoreInstallPath="BepInEx/plugins",
    )
    assert mods.available_providers() == ["curseforge", "modrinth", "thunderstore"]

    with pytest.raises(ValidationError):
        BlueprintMods(supportsMods=True, supportsThunderstore=True, thunderstoreCommunity=None)

    with pytest.raises(ValidationError):
        BlueprintMods(supportsMods=True, supportsModrinth=True, modrinthProjectTypes=["invalid_type"])

    with pytest.raises(ValidationError):
        BlueprintMods(supportsMods=True, supportsModrinth=True, modrinthInstallPath="../escape")


def test_native_blueprints_expose_multi_source_providers():
    reg = get_registry()
    fabric = reg.get("minecraft_fabric")
    assert fabric is not None
    assert fabric.blueprint.effective_mods().available_providers() == ["curseforge", "modrinth"]

    paper = reg.get("minecraft_paper")
    assert paper is not None
    assert paper.blueprint.effective_mods().available_providers() == ["curseforge", "modrinth"]
    assert paper.blueprint.effective_mods().modrinthInstallPath == "plugins"

    valheim = reg.get("valheim")
    assert valheim is not None
    assert valheim.blueprint.effective_mods().available_providers() == ["thunderstore"]

    palworld = reg.get("palworld")
    assert palworld is not None
    assert palworld.blueprint.effective_mods().available_providers() == ["steam", "thunderstore"]

    games = {g["id"]: g for g in list_game_info()}
    assert games["minecraft_fabric"]["mod_providers"] == ["curseforge", "modrinth"]
    assert games["minecraft_fabric"]["mod_provider"] == "curseforge"
    assert games["valheim"]["mod_providers"] == ["thunderstore"]
    assert games["palworld"]["mod_providers"] == ["steam", "thunderstore"]


def test_validate_workshop_id_accepts_prefixed_and_rejects_traversal():
    assert _validate_workshop_id("123456789") == "123456789"
    assert _validate_workshop_id("modrinth:AANobbMI") == "modrinth:AANobbMI"
    assert _validate_workshop_id("thunderstore:denikson-BepInExPack_Valheim") == "thunderstore:denikson-BepInExPack_Valheim"

    for bad in ("", "abc", "modrinth:../etc", "thunderstore:foo..bar", "modrinth:a/b"):
        with pytest.raises(HTTPException):
            _validate_workshop_id(bad)


def test_url_extractors_and_allowlists():
    assert extract_modrinth_url_query("https://modrinth.com/mod/sodium") == "sodium"
    assert extract_modrinth_url_query("https://modrinth.com/plugin/luckperms/versions") == "luckperms"
    assert is_allowed_modrinth_download_url("https://cdn.modrinth.com/data/AANobbMI/versions/1/sodium.jar")
    assert not is_allowed_modrinth_download_url("https://evil.example.com/sodium.jar")
    assert not is_allowed_modrinth_download_url("http://cdn.modrinth.com/sodium.jar")

    assert extract_thunderstore_url_query("https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/") == "denikson-BepInExPack_Valheim"
    assert is_allowed_thunderstore_download_url("https://gcdn.thunderstore.io/live/repository/packages/denikson-BepInExPack_Valheim-5.4.2202.zip")
    assert not is_allowed_thunderstore_download_url("https://evil.example.com/pkg.zip")


@pytest.mark.asyncio
async def test_thunderstore_service_search_sort_and_deps(monkeypatch):
    svc = ThunderstoreService()
    sample_raw = [
        {
            "full_name": "denikson-BepInExPack_Valheim",
            "owner": "denikson",
            "name": "BepInExPack_Valheim",
            "rating_score": 500,
            "date_created": "2024-01-01T00:00:00Z",
            "date_updated": "2026-01-01T00:00:00Z",
            "categories": ["BepInEx"],
            "package_url": "https://thunderstore.io/c/valheim/p/denikson/BepInExPack_Valheim/",
            "is_deprecated": False,
            "versions": [
                {
                    "version_number": "5.4.2202",
                    "description": "BepInEx pack for Valheim",
                    "downloads": 1000000,
                    "download_url": "https://gcdn.thunderstore.io/bep.zip",
                    "file_size": 2048,
                    "dependencies": [],
                }
            ],
        },
        {
            "full_name": "ValheimModding-Jotunn",
            "owner": "ValheimModding",
            "name": "Jotunn",
            "rating_score": 300,
            "date_created": "2024-02-01T00:00:00Z",
            "date_updated": "2026-02-01T00:00:00Z",
            "categories": ["Libraries"],
            "package_url": "https://thunderstore.io/c/valheim/p/ValheimModding/Jotunn/",
            "is_deprecated": False,
            "versions": [
                {
                    "version_number": "2.20.0",
                    "description": "Valheim Library",
                    "downloads": 500000,
                    "download_url": "https://gcdn.thunderstore.io/jotunn.zip",
                    "file_size": 1024,
                    "dependencies": ["denikson-BepInExPack_Valheim-5.4.2202"],
                }
            ],
        },
    ]

    class _FakeResp:
        status_code = 200

        def json(self):
            return sample_raw

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url, headers=None):
            return _FakeResp()

    monkeypatch.setattr("services.thunderstore_service.httpx.AsyncClient", _FakeClient)

    items, total = await svc.search_packages("valheim", query="jotunn")
    assert total == 1
    assert items[0].publishedfileid == "thunderstore:ValheimModding-Jotunn"

    deps = await svc.resolve_dependencies("valheim", "thunderstore:ValheimModding-Jotunn")
    assert len(deps) == 1
    assert deps[0].full_name == "denikson-BepInExPack_Valheim"


def test_modrinth_installer_jar_verify_disable_and_cleanup(tmp_path: Path, monkeypatch):
    jar_bytes = b"PK\x03\x04fake-jar-content"
    sha512 = hashlib.sha512(jar_bytes).hexdigest()

    fake_project = ModrinthModInfo(
        project_id="AANobbMI",
        slug="sodium",
        title="Sodium",
        description="Fast renderer",
        creator="jellysquid3",
        project_type="mod",
        downloads=100,
        followers=50,
        created=datetime.now(timezone.utc),
        updated=datetime.now(timezone.utc),
        direct_url="https://modrinth.com/mod/sodium",
    )

    fake_svc = SimpleNamespace(
        get_project=AsyncMock(return_value=fake_project),
        get_project_versions=AsyncMock(
            return_value=[
                {
                    "id": "ver123",
                    "version_number": "0.5.8",
                    "files": [
                        {
                            "primary": True,
                            "filename": "sodium-0.5.8.jar",
                            "url": "https://cdn.modrinth.com/data/AANobbMI/versions/ver123/sodium-0.5.8.jar",
                            "hashes": {"sha512": sha512},
                        }
                    ],
                }
            ]
        ),
    )

    class _FakeStreamResp:
        headers = {"content-length": str(len(jar_bytes))}

        def raise_for_status(self):
            return None

        async def aiter_bytes(self, chunk_size=65536):
            yield jar_bytes

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url):
            return _FakeStreamResp()

    monkeypatch.setattr("games.modrinth_installer.get_modrinth_service", AsyncMock(return_value=fake_svc))
    monkeypatch.setattr("games.modrinth_installer.httpx.AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr("games.modrinth_installer.set_mod_install_progress", lambda *a, **kw: None)
    monkeypatch.setattr("games.modrinth_installer._log_console", lambda *a, **kw: None)
    monkeypatch.setattr("games.modrinth_installer._update_modrinth_mod_title_in_db", lambda *a, **kw: None)

    bp_mods = BlueprintMods(
        supportsMods=True,
        supportsModrinth=True,
        modrinthProjectTypes=["mod"],
        modrinthLoaders=["fabric"],
        modrinthInstallPath="mods",
    )
    plugin = SimpleNamespace(
        _blueprint=SimpleNamespace(effective_mods=lambda: bp_mods, runtime=SimpleNamespace(env={})),
        _try_chown_install_path=lambda srv, p: None,
    )
    server = SimpleNamespace(id=1, install_dir=str(tmp_path))

    res = install_modrinth_mods(plugin, server, ["modrinth:AANobbMI"])
    assert res["ok"] is True
    assert (tmp_path / "mods" / "sodium-0.5.8.jar").read_bytes() == jar_bytes
    meta = read_modrinth_metadata(tmp_path, "modrinth:AANobbMI")
    assert meta is not None and meta["sha512"] == sha512

    sync_modrinth_enabled_state(tmp_path, "modrinth:AANobbMI", False)
    assert (tmp_path / "mods" / "sodium-0.5.8.jar.disabled").is_file()
    sync_modrinth_enabled_state(tmp_path, "modrinth:AANobbMI", True)
    assert (tmp_path / "mods" / "sodium-0.5.8.jar").is_file()

    clean_res = cleanup_modrinth_mod(server, "modrinth:AANobbMI")
    assert clean_res["ok"] is True
    assert not (tmp_path / "mods" / "sodium-0.5.8.jar").exists()


def test_thunderstore_installer_plugin_and_zip_slip_protection(tmp_path: Path, monkeypatch):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        zf.writestr("plugins/MyPlugin.dll", b"dll-binary")
        zf.writestr("../../evil.txt", b"escape")
    zip_bytes = buf.getvalue()

    fake_pkg = ThunderstorePackageInfo(
        full_name="Author-MyPlugin",
        owner="Author",
        name="MyPlugin",
        description="Test plugin",
        downloads=10,
        rating_score=5,
        created=datetime.now(timezone.utc),
        updated=datetime.now(timezone.utc),
        latest_version="1.0.0",
        download_url="https://gcdn.thunderstore.io/live/repository/packages/Author-MyPlugin-1.0.0.zip",
        file_size=len(zip_bytes),
    )
    fake_svc = SimpleNamespace(get_package=AsyncMock(return_value=fake_pkg))

    class _FakeStreamResp:
        headers = {"content-length": str(len(zip_bytes))}

        def raise_for_status(self):
            return None

        async def aiter_bytes(self, chunk_size=65536):
            yield zip_bytes

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class _FakeAsyncClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url):
            return _FakeStreamResp()

    monkeypatch.setattr("games.thunderstore_installer.get_thunderstore_service", AsyncMock(return_value=fake_svc))
    monkeypatch.setattr("games.thunderstore_installer.httpx.AsyncClient", _FakeAsyncClient)
    monkeypatch.setattr("games.thunderstore_installer.set_mod_install_progress", lambda *a, **kw: None)
    monkeypatch.setattr("games.thunderstore_installer._log_console", lambda *a, **kw: None)
    monkeypatch.setattr("games.thunderstore_installer._update_thunderstore_mod_title_in_db", lambda *a, **kw: None)

    bp_mods = BlueprintMods(
        supportsMods=True,
        supportsThunderstore=True,
        thunderstoreCommunity="valheim",
        thunderstoreInstallPath="BepInEx/plugins",
    )
    plugin = SimpleNamespace(
        _blueprint=SimpleNamespace(effective_mods=lambda: bp_mods),
        _try_chown_install_path=lambda srv, p: None,
    )
    server = SimpleNamespace(id=2, install_dir=str(tmp_path))

    res = install_thunderstore_mods(plugin, server, ["thunderstore:Author-MyPlugin"])
    assert res["ok"] is True
    dll_path = tmp_path / "BepInEx" / "plugins" / "Author-MyPlugin" / "MyPlugin.dll"
    assert dll_path.read_bytes() == b"dll-binary"
    assert not (tmp_path.parent / "evil.txt").exists()

    meta = read_thunderstore_metadata(tmp_path, "thunderstore:Author-MyPlugin")
    assert meta is not None and meta["version"] == "1.0.0"

    sync_thunderstore_enabled_state(tmp_path, "thunderstore:Author-MyPlugin", False)
    assert (tmp_path / "BepInEx" / "plugins" / "Author-MyPlugin" / "MyPlugin.dll.disabled").is_file()
    sync_thunderstore_enabled_state(tmp_path, "thunderstore:Author-MyPlugin", True)
    assert dll_path.is_file()

    clean_res = cleanup_thunderstore_mod(server, "thunderstore:Author-MyPlugin")
    assert clean_res["ok"] is True
    assert not dll_path.exists()


@pytest.mark.asyncio
async def test_modrinth_download_blocks_disallowed_redirect(monkeypatch):
    from games.modrinth_installer import _download_verified_file

    class _FakeRedirectResp:
        status_code = 302
        headers = {"location": "http://127.0.0.1:8080/internal"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            assert kwargs.get("follow_redirects") is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url):
            return _FakeRedirectResp()

    monkeypatch.setattr("games.modrinth_installer.httpx.AsyncClient", _FakeClient)

    with pytest.raises(ValueError, match="Redirect-Ziel"):
        await _download_verified_file("https://cdn.modrinth.com/data/AANobbMI/versions/1/sodium.jar")
