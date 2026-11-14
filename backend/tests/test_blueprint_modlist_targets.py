"""Tests für generische Mod-Manager Targets, Mod-ID-Resolver und deklaratives Conan-Template."""
from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from blueprints.registry import load_blueprint_file
from blueprints.schema import (
    BlueprintModIdResolver,
    BlueprintModIdResolverFallback,
    BlueprintModIdResolverFormat,
    BlueprintModListTarget,
    BlueprintMods,
    BlueprintWorkshopFileAction,
    BlueprintWorkshopFileOperation,
)
from games.base import write_workshop_modlist_targets
from games.blueprint_plugin import (
    _purge_before_paths,
    _resolve_mod_ids,
)


@dataclass
class _ServerStub:
    id: int
    name: str
    install_dir: str
    game_type: str = ""


@dataclass
class _ModStub:
    workshop_id: str
    id: int = 1
    enabled: bool = True
    load_order: int = 0
    resolved_ids_json: str | None = None
    resolved_at: datetime | None = None
    resolve_error: str | None = None
    last_updated: datetime | None = None


def test_schema_mod_id_resolver_and_targets() -> None:
    """Prüft, dass ModIdResolver und ModListTarget Pydantic-validiert werden."""
    resolver = BlueprintModIdResolver(
        name="zomboid_mod_info",
        fileGlob="steamapps/workshop/content/{WORKSHOP_APP_ID}/{WORKSHOP_ID}/mods/*/mod.info",
        format=BlueprintModIdResolverFormat.INI_KEY,
        key="id",
        maxMatches=32,
        fallback=BlueprintModIdResolverFallback.SKIP,
    )
    assert resolver.name == "zomboid_mod_info"
    assert resolver.key == "id"

    target = BlueprintModListTarget(
        file="Zomboid/Server/{SERVER_NAME}.ini",
        key="Mods",
        valueSource="resolvedIds:zomboid_mod_info",
        separator=";",
        entryTemplate=None,
    )
    assert target.valueSource == "resolvedIds:zomboid_mod_info"

    action = BlueprintWorkshopFileAction(
        operation=BlueprintWorkshopFileOperation.COPY,
        source="steamapps/workshop/content/{WORKSHOP_APP_ID}/{WORKSHOP_ID}/**/*.pak",
        target="ConanSandbox/Mods/{BASENAME}",
        purgeBefore=[
            "ConanSandbox/Saved/ExtractedMods/{STEM}-LinuxServer.pak",
            "ConanSandbox/Saved/ExtractedMods/{STEM}-LinuxServer.utoc",
            "ConanSandbox/Saved/ExtractedMods/{STEM}-LinuxServer.ucas",
        ],
        required=True,
    )
    assert len(action.purgeBefore) == 3


def test_effective_mod_list_targets_backward_compat() -> None:
    """Alte Blueprints ohne modListTargets synthetisieren genau ein Target."""
    mods = BlueprintMods(
        supportsMods=True,
        supportsSteamWorkshop=True,
        workshopAppId="108600",
        modInjection="file",
        modListFilePath="Zomboid/Server/{SERVER_NAME}.ini",
        modListContent="iniKey",
        modListKey="WorkshopItems",
        modListSeparator=";",
    )
    targets = mods.effective_mod_list_targets()
    assert len(targets) == 1
    assert targets[0].file == "Zomboid/Server/{SERVER_NAME}.ini"
    assert targets[0].key == "WorkshopItems"
    assert targets[0].valueSource == "workshopIds"
    assert targets[0].separator == ";"


def test_resolve_mod_ids_from_mod_info(tmp_path: Path) -> None:
    """Liest mod.info-Dateien aus und extrahiert Mod-IDs deterministisch."""
    server = _ServerStub(id=1, name="Survival", install_dir=str(tmp_path))
    mod_dir_1 = tmp_path / "steamapps" / "workshop" / "content" / "108600" / "2282429356" / "mods" / "AutotsarTrailers"
    mod_dir_2 = tmp_path / "steamapps" / "workshop" / "content" / "108600" / "2282429356" / "mods" / "AutotsarTrailers_Spawn_Default"
    mod_dir_1.mkdir(parents=True)
    mod_dir_2.mkdir(parents=True)

    (mod_dir_1 / "mod.info").write_text("name=Autotsar Trailers\nid=AutotsarTrailers\ndescription=Trailers\n", encoding="utf-8")
    (mod_dir_2 / "mod.info").write_text("name=Default Spawn\r\nid = AutotsarTrailers_Spawn_Default\r\n", encoding="utf-8")

    resolver = BlueprintModIdResolver(
        name="zomboid_mod_info",
        fileGlob="steamapps/workshop/content/{WORKSHOP_APP_ID}/{WORKSHOP_ID}/mods/*/mod.info",
        format=BlueprintModIdResolverFormat.INI_KEY,
        key="id",
        maxMatches=16,
        fallback=BlueprintModIdResolverFallback.SKIP,
    )

    ids, error = _resolve_mod_ids(server, workshop_app_id="108600", workshop_id="2282429356", resolver=resolver)
    assert error is None
    assert ids == ["AutotsarTrailers", "AutotsarTrailers_Spawn_Default"]


def test_resolve_mod_ids_missing_mod_info(tmp_path: Path) -> None:
    """Wenn mod.info fehlt und fallback=skip, liefert der Resolver leere Liste und Fehler."""
    server = _ServerStub(id=1, name="Survival", install_dir=str(tmp_path))
    resolver = BlueprintModIdResolver(
        name="zomboid_mod_info",
        fileGlob="steamapps/workshop/content/{WORKSHOP_APP_ID}/{WORKSHOP_ID}/mods/*/mod.info",
        format=BlueprintModIdResolverFormat.INI_KEY,
        key="id",
        maxMatches=16,
        fallback=BlueprintModIdResolverFallback.SKIP,
    )
    ids, error = _resolve_mod_ids(server, workshop_app_id="108600", workshop_id="999999", resolver=resolver)
    assert ids == []
    assert error == "mod_info_missing"


def test_write_workshop_modlist_targets_single_file_batch(tmp_path: Path) -> None:
    """Mehrere Targets auf dieselbe INI-Datei werden in einem Durchlauf aktualisiert."""
    server = _ServerStub(id=1, name="pz_server", install_dir=str(tmp_path))
    ini_file = tmp_path / "Zomboid" / "Server" / "pz_server.ini"
    ini_file.parent.mkdir(parents=True)
    ini_file.write_text("PublicName=Test\nWorkshopItems=old\nMods=old\n", encoding="utf-8")

    targets = [
        BlueprintModListTarget(
            file="Zomboid/Server/{SERVER_NAME}.ini",
            key="WorkshopItems",
            valueSource="workshopIds",
            separator=";",
        ),
        BlueprintModListTarget(
            file="Zomboid/Server/{SERVER_NAME}.ini",
            key="Mods",
            valueSource="resolvedIds:zomboid_mod_info",
            separator=";",
        ),
    ]

    target_values = {
        "WorkshopItems": ["1001", "2002"],
        "Mods": ["modA", "modB_1", "modB_2"],
    }

    write_workshop_modlist_targets(server, targets, target_values)

    content = ini_file.read_text(encoding="utf-8")
    assert "WorkshopItems=1001;2002\n" in content
    assert "Mods=modA;modB_1;modB_2\n" in content
    assert "PublicName=Test\n" in content


def test_generic_conan_entry_template_replaces_hardcoded_check(tmp_path: Path) -> None:
    """Das Sternchen-Präfix wird rein deklarativ über entryTemplate erzeugt."""
    server = _ServerStub(id=2, name="conan_srv", install_dir=str(tmp_path), game_type="custom_ue5")
    target = BlueprintModListTarget(
        file="ConanSandbox/Mods/modlist.txt",
        key=None,
        valueSource="postInstallTargetBasenames",
        separator="\n",
        entryTemplate="*{VALUE}",
    )
    target_values = {
        None: ["MyMod.pak", "*AlreadyStarred.pak", "MyMod.pak"],
    }
    write_workshop_modlist_targets(server, [target], target_values)

    out = (tmp_path / "ConanSandbox" / "Mods" / "modlist.txt").read_text(encoding="utf-8")
    assert out == "*MyMod.pak\n*AlreadyStarred.pak\n"


def test_generic_purge_before_paths(tmp_path: Path) -> None:
    """Generischer Purge vor dem Kopieren löscht gecachte Dateien deklarativ."""
    extracted = tmp_path / "ConanSandbox" / "Saved" / "ExtractedMods"
    extracted.mkdir(parents=True)
    (extracted / "CoolMod-LinuxServer.pak").write_bytes(b"old")
    (extracted / "CoolMod-LinuxServer.utoc").write_bytes(b"old")
    (extracted / "OtherMod-LinuxServer.pak").write_bytes(b"keep")

    purged = _purge_before_paths(
        install_base=tmp_path,
        purge_templates=[
            "ConanSandbox/Saved/ExtractedMods/{STEM}-LinuxServer.pak",
            "ConanSandbox/Saved/ExtractedMods/{STEM}-LinuxServer.utoc",
        ],
        source_name="CoolMod.pak",
    )

    assert len(purged) == 2
    assert not (extracted / "CoolMod-LinuxServer.pak").exists()
    assert not (extracted / "CoolMod-LinuxServer.utoc").exists()
    assert (extracted / "OtherMod-LinuxServer.pak").exists()


def test_native_blueprints_validate_new_features() -> None:
    """Stellt sicher, dass zomboid und conan native Blueprints das neue Schema nutzen."""
    repo_root = Path(__file__).resolve().parents[1]
    zomboid = load_blueprint_file(repo_root / "blueprints" / "native" / "project_zomboid.blueprint.json")
    assert len(zomboid.mods.modIdResolvers) >= 1
    assert zomboid.mods.modIdResolvers[0].name == "zomboid_mod_info"
    assert len(zomboid.mods.modListTargets) == 2

    conan = load_blueprint_file(repo_root / "blueprints" / "native" / "conan_exiles_ue5.blueprint.json")
    targets = conan.mods.effective_mod_list_targets()
    assert len(targets) == 1
    assert targets[0].entryTemplate == "*{VALUE}"
    assert len(conan.mods.postInstall[0].purgeBefore) == 3


def _zomboid_b42_resolver() -> BlueprintModIdResolver:
    return BlueprintModIdResolver(
        name="zomboid_mod_info",
        fileGlob="steamapps/workshop/content/{WORKSHOP_APP_ID}/{WORKSHOP_ID}/mods/*/*/mod.info",
        format=BlueprintModIdResolverFormat.INI_KEY,
        key="id",
        maxMatches=32,
        fallback=BlueprintModIdResolverFallback.SKIP,
    )


def test_resolve_mod_ids_b42_ignores_root_b41_and_finds_versioned_and_common(tmp_path: Path) -> None:
    """Build-42-Layout: Wurzel-mod.info wird ignoriert, 42/, 42.20.1/ und common/ werden gefunden."""
    server = _ServerStub(id=1, name="pz_b42", install_dir=str(tmp_path))
    base = tmp_path / "steamapps" / "workshop" / "content" / "108600" / "3809306528" / "mods"

    # Build 41 root entry (must be ignored)
    (base / "Viewpoint").mkdir(parents=True)
    (base / "Viewpoint" / "mod.info").write_text("id=ViewpointB41\n", encoding="utf-8")
    # Build 42 entry
    (base / "Viewpoint" / "42").mkdir(parents=True)
    (base / "Viewpoint" / "42" / "mod.info").write_text("id=Viewpoint\n", encoding="utf-8")
    # Versioned subfolder (e.g. 42.20.1)
    (base / "Foo" / "42.20.1").mkdir(parents=True)
    (base / "Foo" / "42.20.1" / "mod.info").write_text("id=FooMod\n", encoding="utf-8")
    # Common-only subfolder
    (base / "Bar" / "common").mkdir(parents=True)
    (base / "Bar" / "common" / "mod.info").write_text("id=BarCommon\n", encoding="utf-8")

    ids, error = _resolve_mod_ids(
        server,
        workshop_app_id="108600",
        workshop_id="3809306528",
        resolver=_zomboid_b42_resolver(),
    )
    assert error is None
    assert "ViewpointB41" not in ids
    assert set(ids) == {"Viewpoint", "FooMod", "BarCommon"}


def test_resolve_mod_ids_accepts_valid_special_chars_and_rejects_semicolon_or_newline(tmp_path: Path) -> None:
    """Mod-IDs mit Leerzeichen, &, (), +, ' sind erlaubt; ; und Steuerzeichen werden verworfen."""
    server = _ServerStub(id=1, name="pz_chars", install_dir=str(tmp_path))
    base = tmp_path / "steamapps" / "workshop" / "content" / "108600" / "111222333" / "mods"

    for folder, mod_id in [
        ("m1", "Authentic Z - Current"),
        ("m2", "Rock&Roll (B42)"),
        ("m3", "AuthenticZBackpacks+"),
        ("m4", "Bob's Mod"),
        ("bad_semi", "Bad;Id"),
    ]:
        p = base / folder / "42"
        p.mkdir(parents=True)
        (p / "mod.info").write_text(f"id={mod_id}\n", encoding="utf-8")

    ids, error = _resolve_mod_ids(
        server,
        workshop_app_id="108600",
        workshop_id="111222333",
        resolver=_zomboid_b42_resolver(),
    )
    assert error is None
    assert ids == [
        "Authentic Z - Current",
        "Rock&Roll (B42)",
        "AuthenticZBackpacks+",
        "Bob's Mod",
    ]

    # Newline injection via regex format must also be rejected
    regex_dir = tmp_path / "steamapps" / "workshop" / "content" / "108600" / "444555666" / "mods" / "nl" / "42"
    regex_dir.mkdir(parents=True)
    (regex_dir / "mod.info").write_text("id=Line1\nLine2", encoding="utf-8")
    regex_resolver = BlueprintModIdResolver(
        name="zomboid_regex",
        fileGlob="steamapps/workshop/content/{WORKSHOP_APP_ID}/{WORKSHOP_ID}/mods/*/*/mod.info",
        format=BlueprintModIdResolverFormat.REGEX,
        regex=r"id=(Line1\nLine2)",
        maxMatches=32,
        fallback=BlueprintModIdResolverFallback.SKIP,
    )
    nl_ids, nl_err = _resolve_mod_ids(
        server,
        workshop_app_id="108600",
        workshop_id="444555666",
        resolver=regex_resolver,
    )
    assert nl_ids == []
    assert nl_err == "mod_info_missing"


def test_zomboid_update_modlist_real_pair_and_cache_invalidation(tmp_path: Path) -> None:
    """Prüft reales Zomboid-Paar (WorkshopItems vs. Mods) und alle Cache-Invalidierungsfälle."""
    from games.base import _resolver_fingerprint
    from games.blueprint_plugin import BlueprintPlugin

    repo_root = Path(__file__).resolve().parents[1]
    bp = load_blueprint_file(repo_root / "blueprints" / "native" / "project_zomboid.blueprint.json")
    plugin = BlueprintPlugin(bp)
    resolver = bp.effective_mods().modIdResolvers[0]
    fp = _resolver_fingerprint(resolver)

    server = _ServerStub(id=7, name="pz_live", install_dir=str(tmp_path), game_type="project_zomboid")
    ini_file = tmp_path / "Server" / "pz_live.ini"
    ini_file.parent.mkdir(parents=True)
    ini_file.write_text("PublicName=Test\nWorkshopItems=\nMods=\n", encoding="utf-8")

    mod_dir = tmp_path / "steamapps" / "workshop" / "content" / "108600" / "3809306528" / "mods" / "Viewpoint" / "42"
    mod_dir.mkdir(parents=True)
    (mod_dir / "mod.info").write_text("id=Viewpoint\n", encoding="utf-8")

    # 1. Alter Listen-Cache → wird neu aufgelöst
    old_list_mod = _ModStub(id=1, workshop_id="3809306528", resolved_ids_json=json.dumps(["ViewpointB41"]))
    with patch("games.base._query_active_mods", return_value=[old_list_mod]):
        plugin.update_modlist(server)

    content = ini_file.read_text(encoding="utf-8")
    assert "WorkshopItems=3809306528\n" in content
    assert "Mods=Viewpoint\n" in content

    # 2. Passender Fingerabdruck, kein Fehler, resolved_at neuer als last_updated → kein Dateizugriff
    now = datetime.now(timezone.utc)
    valid_cached_mod = _ModStub(
        id=2,
        workshop_id="3809306528",
        resolved_ids_json=json.dumps({"f": fp, "ids": ["CachedViewpoint"]}),
        resolved_at=now,
        last_updated=now - timedelta(minutes=5),
        resolve_error=None,
    )
    with patch("games.base._query_active_mods", return_value=[valid_cached_mod]), \
         patch("games.blueprint_plugin._resolve_mod_ids") as mock_resolve:
        plugin.update_modlist(server)
        mock_resolve.assert_not_called()
    assert "Mods=CachedViewpoint\n" in ini_file.read_text(encoding="utf-8")

    # 3. resolve_error gesetzt → erneut auflösen und Datei-ID übernehmen
    err_mod = _ModStub(
        id=3,
        workshop_id="3809306528",
        resolved_ids_json=json.dumps({"f": fp, "ids": []}),
        resolved_at=now,
        resolve_error="mod_info_missing",
    )
    with patch("games.base._query_active_mods", return_value=[err_mod]):
        plugin.update_modlist(server)
    assert "Mods=Viewpoint\n" in ini_file.read_text(encoding="utf-8")

    # 4. Mod nach Auflösung aktualisiert (last_updated neuer als resolved_at) → erneut auflösen
    stale_mod = _ModStub(
        id=4,
        workshop_id="3809306528",
        resolved_ids_json=json.dumps({"f": fp, "ids": ["OldViewpoint"]}),
        resolved_at=now - timedelta(hours=1),
        last_updated=now,
        resolve_error=None,
    )
    with patch("games.base._query_active_mods", return_value=[stale_mod]):
        plugin.update_modlist(server)
    assert "Mods=Viewpoint\n" in ini_file.read_text(encoding="utf-8")
