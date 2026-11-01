"""Prüft Version gegen Tag (Hardening WP0.3).

Läuft nur, wenn GITHUB_REF_TYPE=tag gesetzt ist.
Führt den Sync aus und stellt sicher, dass git diff --exit-code sauber ist.
"""

import os
import subprocess
import sys
from pathlib import Path
import pytest

ROOT = Path(__file__).resolve().parents[2]


def test_version_stimmt_mit_tag_ueberein() -> None:
    if os.environ.get("GITHUB_REF_TYPE") != "tag":
        pytest.skip("Test läuft nur, wenn GITHUB_REF_TYPE=tag gesetzt ist.")

    tag = os.environ.get("GITHUB_REF_NAME", "").lstrip("v")
    if not tag:
        pytest.fail("GITHUB_REF_TYPE=tag, aber GITHUB_REF_NAME ist leer.")

    # Sync-Skript ausführen
    sync_script = ROOT / "scripts" / "sync-tauri-version.py"
    subprocess.run([sys.executable, str(sync_script), tag], check=True, cwd=str(ROOT))

    # git diff auf den Versionsdateien prüfen
    version_files = [
        "frontend/package.json",
        "smart-system/package.json",
        "smart-system/src-tauri/tauri.conf.json",
        "smart-system/src-tauri/Cargo.toml",
        "recovery/src-tauri/tauri.conf.json",
        "recovery/src-tauri/Cargo.toml",
        "browser/package.json",
        "browser/src-tauri/tauri.conf.json",
        "browser/src-tauri/Cargo.toml",
        "backend/main.py",
    ]
    diff = subprocess.run(["git", "diff", "--exit-code", "--", *version_files], cwd=str(ROOT), capture_output=True, text=True)
    assert diff.returncode == 0, f"Repository weicht vom Tag {tag} ab:\n{diff.stdout}"
