"""Tests für generische Mod-Manager Targets, Mod-ID-Resolver und deklaratives Conan-Template."""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

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
    enabled: bool = True
    load_order: int = 0
    resolved_ids_json: str | None = None
    resolve_error: str | None = None


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
