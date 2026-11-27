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
        headers = {}

        async def aiter_bytes(self, chunk_size=65536):
            yield json.dumps(sample_raw).encode("utf-8")

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url, headers=None):
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


@pytest.mark.asyncio
async def test_mrpack_blocks_zip_slip_in_overrides_and_index(tmp_path: Path, monkeypatch):
    import tempfile
    from games.modrinth_installer import _install_mrpack

    monkeypatch.setattr("games.modrinth_installer._log_console", lambda *a, **kw: None)

    index_payload = {
        "formatVersion": 1,
        "game": "minecraft",
        "versionId": "1.0",
        "name": "MaliciousPack",
        "files": [
            {
                "path": "../escape-index.jar",
                "downloads": ["https://cdn.modrinth.com/data/A/versions/1/a.jar"],
                "hashes": {},
            },
            {
                "path": "/etc/passwd",
                "downloads": ["https://cdn.modrinth.com/data/A/versions/1/b.jar"],
                "hashes": {},
            },
        ],
    }

    with tempfile.SpooledTemporaryFile() as spooled:
        with zipfile.ZipFile(spooled, "w") as zf:
            zf.writestr("modrinth.index.json", json.dumps(index_payload))
            zf.writestr("overrides/../../escape.txt", b"pwned")
            zf.writestr("overrides/mods/safe.txt", b"ok")
            zf.writestr("server-overrides/../outside.cfg", b"pwned2")
        spooled.seek(0)

        server_dir = tmp_path / "srv"
        server_dir.mkdir()
        plugin = SimpleNamespace(_try_chown_install_path=lambda srv, p: None)
        server = SimpleNamespace(id=99, install_dir=str(server_dir))

        installed = await _install_mrpack(plugin, server, spooled, server_dir.resolve(), "MaliciousPack")

    assert installed == ["mods/safe.txt"]
    assert (server_dir / "mods" / "safe.txt").read_bytes() == b"ok"
    assert not (tmp_path / "escape.txt").exists()
    assert not (tmp_path / "escape-index.jar").exists()
    assert not (tmp_path / "outside.cfg").exists()


def test_modrinth_hash_mismatch_and_mrpack_failure_preserve_previous_files(tmp_path: Path, monkeypatch):
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
    server = SimpleNamespace(id=10, install_dir=str(tmp_path))

    # Bestehende funktionierende Mod-Datei + Metadaten hinterlegen
    mods_dir = tmp_path / "mods"
    mods_dir.mkdir(parents=True, exist_ok=True)
    old_jar = mods_dir / "sodium-0.5.7.jar"
    old_jar.write_bytes(b"working-old-version")
    meta_dir = tmp_path / ".msm-modrinth"
    meta_dir.mkdir(parents=True, exist_ok=True)
    (meta_dir / "aanobbmi.json").write_text(
        json.dumps({"project_id": "AANobbMI", "files": ["mods/sodium-0.5.7.jar"]}),
        encoding="utf-8",
    )

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
                    "id": "ver-bad",
                    "version_number": "0.5.9",
                    "files": [
                        {
                            "primary": True,
                            "filename": "sodium-0.5.9.jar",
                            "url": "https://cdn.modrinth.com/data/AANobbMI/versions/ver-bad/sodium-0.5.9.jar",
                            "hashes": {"sha512": "0" * 128},
                        }
                    ],
                }
            ]
        ),
    )

    class _FakeResp:
        headers = {"content-length": "12"}

        def raise_for_status(self):
            return None

        async def aiter_bytes(self, chunk_size=65536):
            yield b"tampered-jar"

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url):
            return _FakeResp()

    monkeypatch.setattr("games.modrinth_installer.get_modrinth_service", AsyncMock(return_value=fake_svc))
    monkeypatch.setattr("games.modrinth_installer.httpx.AsyncClient", _FakeClient)
    monkeypatch.setattr("games.modrinth_installer.set_mod_install_progress", lambda *a, **kw: None)
    monkeypatch.setattr("games.modrinth_installer._log_console", lambda *a, **kw: None)
    monkeypatch.setattr("games.modrinth_installer._update_modrinth_mod_title_in_db", lambda *a, **kw: None)

    res = install_modrinth_mods(plugin, server, ["modrinth:AANobbMI"])
    assert res["ok"] is False
    assert "SHA-512" in res["error"]
    # Vorherige funktionierende Mod-Datei bleibt erhalten
    assert old_jar.read_bytes() == b"working-old-version"
    assert not (mods_dir / "sodium-0.5.9.jar").exists()


@pytest.mark.asyncio
async def test_mrpack_requires_hashes_and_enforces_limits(tmp_path: Path, monkeypatch):
    import tempfile
    from games import modrinth_installer

    monkeypatch.setattr("games.modrinth_installer._log_console", lambda *a, **kw: None)
    plugin = SimpleNamespace(_try_chown_install_path=lambda srv, p: None)
    server = SimpleNamespace(id=77, install_dir=str(tmp_path))

    # 1. Datei ohne Pruefsumme muss abgewiesen werden (kein stilles Ueberspringen)
    no_hash_index = {
        "formatVersion": 1,
        "files": [
            {
                "path": "mods/nohash.jar",
                "downloads": ["https://cdn.modrinth.com/data/A/versions/1/nohash.jar"],
                "hashes": {},
            }
        ],
    }
    with tempfile.SpooledTemporaryFile() as spooled:
        with zipfile.ZipFile(spooled, "w") as zf:
            zf.writestr("modrinth.index.json", json.dumps(no_hash_index))
        spooled.seek(0)
        with pytest.raises(ValueError, match="keine Pruefsumme"):
            await modrinth_installer._install_mrpack(plugin, server, spooled, tmp_path.resolve(), "NoHashPack")

    # 2. Ueberlange files-Liste wird abgelehnt
    monkeypatch.setattr(modrinth_installer, "MAX_MODRINTH_EXTRACT_FILES", 1)
    too_many_index = {
        "formatVersion": 1,
        "files": [
            {"path": "mods/1.jar", "downloads": ["https://cdn.modrinth.com/1.jar"], "hashes": {"sha1": "a" * 40}},
            {"path": "mods/2.jar", "downloads": ["https://cdn.modrinth.com/2.jar"], "hashes": {"sha1": "b" * 40}},
        ],
    }
    with tempfile.SpooledTemporaryFile() as spooled:
        with zipfile.ZipFile(spooled, "w") as zf:
            zf.writestr("modrinth.index.json", json.dumps(too_many_index))
        spooled.seek(0)
        with pytest.raises(ValueError, match="maximale Dateianzahl"):
            await modrinth_installer._install_mrpack(plugin, server, spooled, tmp_path.resolve(), "TooManyPack")


@pytest.mark.asyncio
async def test_thunderstore_blocks_redirect_invalid_content_length_and_symlinks(tmp_path: Path, monkeypatch):
    from games import mod_archive_utils, thunderstore_installer
    from services.thunderstore_service import is_allowed_thunderstore_download_url

    # 1. Redirect zu fremder Domain wird blockiert
    class _FakeRedirectResp:
        status_code = 302
        headers = {"location": "http://169.254.169.254/latest/meta-data/"}

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

    class _FakeRedirectClient:
        def __init__(self, *args, **kwargs):
            assert kwargs.get("follow_redirects") is False

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        def stream(self, method, url):
            return _FakeRedirectResp()

    with pytest.raises(ValueError, match="Redirect-Ziel"):
        await mod_archive_utils.stream_verified_download(
            "https://gcdn.thunderstore.io/pkg.zip",
            user_agent="Test",
            url_validator=is_allowed_thunderstore_download_url,
            max_bytes=1024 * 1024,
            domain_label="Thunderstore",
            client_factory=_FakeRedirectClient,
        )

    # 2. Ungueltiger Content-Length-Header loest keinen ungefangenen ValueError aus
    assert mod_archive_utils.parse_content_length("not-a-number", fallback=42) == 42

    # 3. ZIP-Symlinks werden beim Entpacken uebersprungen und Entpack-Byte-Limit greift
    import stat as _stat
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        sym = zipfile.ZipInfo("plugins/evil_link")
        sym.external_attr = (_stat.S_IFLNK | 0o777) << 16
        zf.writestr(sym, "/etc/passwd")
        zf.writestr("plugins/big.dll", b"A" * 200)

    import tempfile
    plugin = SimpleNamespace(_try_chown_install_path=lambda srv, p: None)
    server = SimpleNamespace(id=3, install_dir=str(tmp_path))
    monkeypatch.setattr(thunderstore_installer, "MAX_THUNDERSTORE_EXTRACT_BYTES", 50)
    with tempfile.SpooledTemporaryFile() as spooled:
        spooled.write(buf.getvalue())
        spooled.seek(0)
        with pytest.raises(ValueError, match="Entpack-Limit"):
            thunderstore_installer._extract_thunderstore_zip(
                plugin, server, spooled, tmp_path.resolve(), tmp_path / "BepInEx" / "plugins", "Auth-Mod"
            )
    assert not (tmp_path / "BepInEx" / "plugins" / "Auth-Mod" / "evil_link").exists()


def test_updater_recognizes_disabled_modrinth_and_thunderstore_mods_as_installed(
    db: Session, tmp_path: Path, monkeypatch
):
    from games import updater
    from models import Mod, Server

    srv = Server(name="DisabledModSrv", game_type="minecraft_fabric", install_dir=str(tmp_path), status="stopped")
    db.add(srv)
    db.flush()
    old_dt = datetime(2024, 1, 1, tzinfo=timezone.utc)
    db.add(Mod(server_id=srv.id, workshop_id="modrinth:AANobbMI", name="Sodium", enabled=True, auto_update=True, last_updated=old_dt))
    db.add(Mod(server_id=srv.id, workshop_id="thunderstore:Author-Pkg", name="Pkg", enabled=True, auto_update=True, last_updated=old_dt))
    db.commit()

    (tmp_path / "mods").mkdir(parents=True, exist_ok=True)
    (tmp_path / "mods" / "sodium.jar.disabled").write_bytes(b"jar")
    (tmp_path / ".msm-modrinth").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".msm-modrinth" / "aanobbmi.json").write_text(
        json.dumps({"project_id": "AANobbMI", "files": ["mods/sodium.jar"]}),
        encoding="utf-8",
    )

    (tmp_path / "BepInEx" / "plugins" / "Author-Pkg").mkdir(parents=True, exist_ok=True)
    (tmp_path / "BepInEx" / "plugins" / "Author-Pkg" / "Pkg.dll.disabled").write_bytes(b"dll")
    (tmp_path / ".msm-thunderstore").mkdir(parents=True, exist_ok=True)
    (tmp_path / ".msm-thunderstore" / "author-pkg.json").write_text(
        json.dumps({"full_name": "Author-Pkg", "files": ["BepInEx/plugins/Author-Pkg/Pkg.dll"]}),
        encoding="utf-8",
    )

    bp_mods = BlueprintMods(
        supportsMods=True,
        supportsModrinth=True,
        modrinthInstallPath="mods",
        supportsThunderstore=True,
        thunderstoreCommunity="valheim",
        thunderstoreInstallPath="BepInEx/plugins",
    )
    bp = SimpleNamespace(effective_mods=lambda: bp_mods)
    now_dt = datetime.now(timezone.utc)
    monkeypatch.setattr(updater, "_query_active_mods", lambda _sid: db.query(Mod).filter(Mod.server_id == _sid).all())
    monkeypatch.setattr(updater, "_fetch_modrinth_mods_updated", lambda _ids: {"modrinth:AANobbMI": now_dt})
    monkeypatch.setattr(updater, "_fetch_thunderstore_mods_updated", lambda _c, _ids: {"thunderstore:Author-Pkg": now_dt})

    rows = updater.check_workshop_mod_updates(srv, bp)
    by_id = {r["workshop_id"]: r for r in rows}
    assert by_id["modrinth:AANobbMI"]["installed"] is True
    assert by_id["thunderstore:Author-Pkg"]["installed"] is True


def test_modrinth_thunderstore_and_settings_routes_enforce_auth_and_rbac(
    client, db: Session, tmp_path: Path
):
    from models import Role, Server, User
    from services import role_service
    from services.auth_service import AuthService

    srv = Server(name="RbacModSrv", game_type="minecraft_fabric", install_dir=str(tmp_path), status="stopped")
    db.add(srv)
    db.flush()

    uname = f"noperm-mod-{datetime.now(timezone.utc).timestamp()}"
    user = AuthService.create_user(db, uname, f"{uname}@test.de", "ModPass123!")
    user.email_verified = True
    empty_role = Role(name=f"NoModRole-{srv.id}", is_system=False)
    db.add(empty_role)
    db.flush()
    role_service.set_user_roles(db, user, [empty_role.id])
    db.commit()

    # Unauthentifiziert -> 401
    assert client.get(f"/api/modrinth/servers/{srv.id}/search?q=sodium").status_code == 401
    assert client.get("/api/modrinth/mods/metadata?ids=AANobbMI").status_code == 401
    assert client.get(f"/api/thunderstore/servers/{srv.id}/search?q=bepinex").status_code == 401
    assert client.post("/api/settings/modrinth-api-key", json={"modrinth_api_key": "mrp_test"}).status_code == 401

    login = client.post("/api/auth/login", json={"username": uname, "password": "ModPass123!", "otp_code": None})
    assert login.status_code == 200
    cookies = dict(login.cookies)
    csrf = cookies.get("__Secure-csrf_token") or ""

    # Nutzer ohne server.mods.read / panel.settings.write -> 403 bzw. 404 (Existenzschutz)
    assert client.get(f"/api/modrinth/servers/{srv.id}/search?q=sodium", cookies=cookies).status_code in (403, 404)
    assert client.get("/api/modrinth/mods/metadata?ids=AANobbMI", cookies=cookies).status_code == 403
    assert client.get(f"/api/thunderstore/servers/{srv.id}/search?q=bepinex", cookies=cookies).status_code in (403, 404)
    assert (
        client.post(
            "/api/settings/modrinth-api-key",
            json={"modrinth_api_key": "mrp_test"},
            cookies=cookies,
            headers={"X-CSRF-Token": csrf},
        ).status_code
        == 403
    )

