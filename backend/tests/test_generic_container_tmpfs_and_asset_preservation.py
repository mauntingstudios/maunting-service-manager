"""Tests zur Absicherung der generischen tmpfs-Ausfuehrung (exec) und Asset-Filterung.

Beweist, dass:
1. Container-tmpfs (z. B. /tmp) die Option 'exec' enthaelt (verhindert NativeLibraryNotFoundException
   in Java SQLite/JNI, Python CFFI, Node Addons) sowie 'nosuid,nodev' fuer Sicherheits-Haertung.
2. Spiele-Assets und Skripte (z. B. media/, scripts/, assets/, localization/) beim Reinstall
   nicht faelschlicherweise als 'manuelle Configs' gesichert und ueberschrieben werden.
"""

from __future__ import annotations

from pathlib import Path
import pytest

from services import docker_service
from games.updater import should_preserve_file


class TestGenericContainerTmpfsHardening:
    """Prueft Default-noexec-Haertung und explizite Opt-in-exec-Option fuer /tmp."""

    def test_backend_docker_service_tmpfs_options(self):
        """_tmpfs_dict erzwingt per Default noexec und erlaubt exec nur per Opt-in."""
        default_result = docker_service._tmpfs_dict(["/tmp"])
        assert default_result is not None, "tmpfs_dict darf fuer ['/tmp'] nicht None sein"
        assert "/tmp" in default_result
        default_options = default_result["/tmp"].split(",")

        # Default-Haertung (Milestone 1): /tmp ist noexec, nosuid, nodev
        assert "noexec" in default_options
        assert "nosuid" in default_options
        assert "nodev" in default_options
        assert "rw" in default_options
        assert default_result["/tmp"] == "rw,noexec,nosuid,nodev,size=128m,mode=1777"

        # Opt-in fuer Workloads mit JNI/CFFI/nativen Addons in /tmp
        opt_in_result = docker_service._tmpfs_dict(["/tmp"], allow_exec=True)
        assert opt_in_result is not None
        assert opt_in_result["/tmp"] == "rw,exec,nosuid,nodev,size=128m,mode=1777"


class TestAssetAndScriptPreservationFilter:
    """Prueft, dass Spieldaten/Skripte nicht als manuelle User-Configs gesichert werden."""

    @pytest.mark.parametrize(
        "rel_path",
        [
            "media/scripts/items.txt",
            "media/scripts/clothing.txt",
            "scripts/recipes.txt",
            "assets/definitions.json",
            "localization/de.txt",
            "translations/en.txt",
            "server/media/scripts/items.txt",
            "game/assets/ui.json",
        ],
    )
    def test_game_assets_and_scripts_are_excluded(self, tmp_path: Path, rel_path: str):
        """Statische Spieldaten (media, scripts, assets etc.) duerfen NIE gesichert werden."""
        p = tmp_path / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("item TestItem { Type = Normal }")
        assert should_preserve_file(p) is False, f"Datei {rel_path} haette ausgeschlossen werden muessen!"

    @pytest.mark.parametrize(
        "rel_path",
        [
            "server.cfg",
            "GameUserSettings.ini",
            "Zomboid/Server/servertest.ini",
            "my_config/server.json",
        ],
    )
    def test_legitimate_user_configs_are_preserved(self, tmp_path: Path, rel_path: str):
        """Echte Nutzer-Configs (außerhalb der Asset-Verzeichnisse) muessen erhalten bleiben."""
        p = tmp_path / rel_path
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text("ServerName=MyServer")
        assert should_preserve_file(p) is True, f"Legitime Config {rel_path} muss gesichert werden!"
