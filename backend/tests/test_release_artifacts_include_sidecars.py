"""Der Panel-Tarball enthaelt jeden Sidecar, den `install.sh` erwartet.

Befund 4: `docs-sidecar` fehlte im `archive_tracked`-Aufruf von
`scripts/build-release-artifacts.sh`, obwohl `install.sh` und `update.sh` ihn
kennen — das Release brachte ein Dokumente-Modul ohne Collab-Server. Der Test
liest beide Skripte und verlangt, dass jeder `*-sidecar`-Ordner aus
`install.sh` im Tar-Befehl steht.
"""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "scripts" / "build-release-artifacts.sh"
INSTALL = ROOT / "install.sh"


def _archivierte_ordner() -> set[str]:
    """Die Ordnerliste des `archive_tracked "$PANEL_ROOT"`-Aufrufs."""
    zeilen = BUILD.read_text(encoding="utf-8").splitlines()
    beginn = next(
        i for i, zeile in enumerate(zeilen) if 'archive_tracked "$PANEL_ROOT"' in zeile
    )
    teile: list[str] = []
    for zeile in zeilen[beginn:]:
        bruch = zeile.rstrip()
        weiter = bruch.endswith("\\")
        teile.append(bruch[:-1] if weiter else bruch)
        if not weiter:
            break
    text = " ".join(teile)
    text = text.split("archive_tracked", 1)[1]
    return {
        wort
        for wort in re.findall(r"[A-Za-z0-9_][A-Za-z0-9_.-]*", text)
        if wort not in {"PANEL_ROOT"}
    }


def _installierte_sidecars() -> set[str]:
    """Die `*-sidecar`-Ordner, die `install.sh` per rsync erwartet."""
    text = INSTALL.read_text(encoding="utf-8")
    return set(re.findall(r'"\$SCRIPT_DIR/([a-z0-9-]+-sidecar)/"', text))


def test_installierte_sidecars_sind_im_tarball():
    archiviert = _archivierte_ordner()
    erwartet = _installierte_sidecars()
    assert erwartet, "kein Sidecar in install.sh gefunden — Parser kaputt?"
    assert "docs-sidecar" in erwartet
    fehlend = erwartet - archiviert
    assert not fehlend, f"im Tar-Befehl fehlend: {sorted(fehlend)}"


def test_docs_sidecar_dateien_fuer_das_release_vorhanden():
    for datei in ("server.mjs", "package.json", "package-lock.json"):
        assert (ROOT / "docs-sidecar" / datei).is_file(), datei
