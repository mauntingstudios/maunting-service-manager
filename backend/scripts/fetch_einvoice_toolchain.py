"""Laedt die gepinnte E-Rechnungs-Toolchain (KoSIT-Validator und veraPDF).

Wird waehrend `install.sh` und `update.sh` aufgerufen. Das Panel laedt zur
Laufzeit **nie** Binaries oder Archive aus dem Internet nach. Jedes Artefakt
ist auf eine feste Version gepinnt und wird vor dem Entpacken beziehungsweise
Ausfuehren per SHA-256 geprueft.

Ein Fehlschlag (z. B. Offline-Umgebung oder fehlende JVM) bricht die
Panel-Installation nicht ab: `main()` meldet den Zustand auf `stderr` und
endet mit 0. Das Backend behauptet ohne installierte und gepruefte Toolchain
ausdruecklich keine PDF/A-3-Konformitaet.
"""

from __future__ import annotations

import hashlib
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

KOSIT_VALIDATOR_VERSION = "1.6.3"
KOSIT_VALIDATOR_FILENAME = f"validator-{KOSIT_VALIDATOR_VERSION}-standalone.jar"
KOSIT_VALIDATOR_URL = (
    f"https://github.com/itplr-kosit/validator/releases/download/"
    f"v{KOSIT_VALIDATOR_VERSION}/{KOSIT_VALIDATOR_FILENAME}"
)
KOSIT_VALIDATOR_SHA256 = (
    "799e64befca97d4080e03608c80b85dd5a5ecc5f4ae4f35d1116ec2855b9a7c9"
)

KOSIT_XRECHNUNG_TAG = "v2026-08-31"
KOSIT_XRECHNUNG_VERSION = "3.0.2-2026-08-31"
KOSIT_XRECHNUNG_URL = (
    "https://github.com/itplr-kosit/validator-configuration-xrechnung/"
    "releases/download/v2026-08-31/"
    "xrechnung-3.0.2-validator-configuration-2026-08-31.zip"
)
KOSIT_XRECHNUNG_SHA256 = (
    "2530cd107c414511c5d0462ec10f886910395abfca820db82e83d70bf01221a8"
)

VERAPDF_VERSION = "1.30.4"
VERAPDF_URL = (
    "https://software.verapdf.org/rel/1.30/"
    "verapdf-greenfield-1.30.4-installer.zip"
)
VERAPDF_SHA256 = (
    "04415ef3f149526a3048b9889723e81320ddf013bd891bcc7f0f297f3eadcc23"
)

TARGET_MARKER = (
    f"kosit={KOSIT_VALIDATOR_VERSION};"
    f"xrechnung={KOSIT_XRECHNUNG_VERSION};"
    f"verapdf={VERAPDF_VERSION}"
)


def target_dir() -> Path:
    """Gibt das Zielverzeichnis fuer die E-Rechnungs-Toolchain zurueck."""
    override = os.environ.get("MSM_EINVOICE_TOOLS_DIR", "").strip()
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent / "tools" / "einvoice"


def verify_sha256(path: Path, expected_hex: str) -> None:
    """Prueft den SHA-256-Hash einer Datei und wirft ValueError bei Abweichung."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1048576), b""):
            digest.update(chunk)
    actual = digest.hexdigest().lower()
    expected = expected_hex.strip().lower()
    if actual != expected:
        raise ValueError(
            f"SHA-256-Abweichung fuer {path.name}: erwartet {expected}, erhalten {actual}"
        )


_MAX_DOWNLOAD_BYTES = 150 * 1024 * 1024
_MAX_ZIP_FILES = 1000
_MAX_ZIP_UNCOMPRESSED_BYTES = 512 * 1024 * 1024


class _HttpsOnlyRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        if not str(newurl).lower().startswith("https://"):
            raise ValueError(f"Unsicherer Redirect auf Nicht-HTTPS-URL abgelehnt: {newurl}")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def safe_extract_zip(zip_path: Path, dest_dir: Path) -> None:
    """Entpackt ein ZIP-Archiv mit striktem Zip-Slip- und Symlink-Schutz."""
    dest_resolved = dest_dir.resolve()
    dest_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, "r") as zf:
        infos = zf.infolist()
        if len(infos) > _MAX_ZIP_FILES:
            raise ValueError("ZIP-Archiv enthaelt zu viele Eintraege")
        total_uncompressed = 0
        for info in infos:
            total_uncompressed += max(0, info.file_size)
            if total_uncompressed > _MAX_ZIP_UNCOMPRESSED_BYTES:
                raise ValueError("ZIP-Archiv ueberschreitet die zulaessige Entpackgroesse")
            member_name = info.filename.replace("\\", "/")
            if not member_name or member_name.startswith("/"):
                raise ValueError(f"Unsicherer ZIP-Pfad abgelehnt: {info.filename}")
            if len(member_name) >= 2 and member_name[1] == ":":
                raise ValueError(f"Unsicherer Laufwerkspfad abgelehnt: {info.filename}")
            parts = [p for p in member_name.split("/") if p]
            if any(p in (".", "..") for p in parts):
                raise ValueError(f"Path-Traversal im ZIP abgelehnt: {info.filename}")

            unix_mode = info.external_attr >> 16
            if stat.S_ISLNK(unix_mode):
                raise ValueError(f"Symlink im ZIP abgelehnt: {info.filename}")

            target_path = (dest_resolved / Path(*parts)).resolve()
            if dest_resolved not in target_path.parents and target_path != dest_resolved:
                raise ValueError(f"ZIP-Ziel ausserhalb des Basisordners: {info.filename}")

            if info.is_dir():
                target_path.mkdir(parents=True, exist_ok=True)
                continue

            target_path.parent.mkdir(parents=True, exist_ok=True)
            with zf.open(info, "r") as src, target_path.open("wb") as dst:
                shutil.copyfileobj(src, dst)


def is_complete(base_dir: Path) -> bool:
    """Prueft, ob alle gepinnten Toolchain-Bestandteile vollstaendig vorliegen."""
    marker = base_dir / ".toolchain-version"
    if not marker.is_file():
        return False
    try:
        if marker.read_text(encoding="utf-8").strip() != TARGET_MARKER:
            return False
    except OSError:
        return False

    required = (
        base_dir / "kosit" / KOSIT_VALIDATOR_FILENAME,
        base_dir / "kosit" / "config" / "scenarios.xml",
        base_dir / "verapdf" / "verapdf",
    )
    return all(item.is_file() for item in required)


def _download_file(url: str, dest: Path, expected_sha256: str) -> None:
    """Laedt eine Datei mit User-Agent herunter und prueft sofort SHA-256."""
    if not url.lower().startswith("https://"):
        raise ValueError(f"Nur HTTPS-URLs erlaubt: {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dest.with_suffix(dest.suffix + ".part")
    opener = urllib.request.build_opener(_HttpsOnlyRedirectHandler)
    req = urllib.request.Request(url, headers={"User-Agent": "msm-einvoice-toolchain/1.0"})
    try:
        total = 0
        with opener.open(req, timeout=120) as resp, tmp_path.open("wb") as out:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                total += len(chunk)
                if total > _MAX_DOWNLOAD_BYTES:
                    raise ValueError("Toolchain-Download ueberschreitet 150 MiB Limit")
                out.write(chunk)
        verify_sha256(tmp_path, expected_sha256)
        tmp_path.replace(dest)
    except Exception:
        tmp_path.unlink(missing_ok=True)
        raise


def _build_verapdf_auto_install_xml(install_path: Path) -> str:
    """Erzeugt die IzPack-Steuerdatei fuer eine unbeaufsichtigte CLI-Installation."""
    escaped_path = xml_escape(str(install_path))
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n'
        '<AutomatedInstallation langpack="eng">\n'
        '    <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>\n'
        '    <com.izforge.izpack.panels.target.TargetPanel id="install_dir">\n'
        f"        <installpath>{escaped_path}</installpath>\n"
        "    </com.izforge.izpack.panels.target.TargetPanel>\n"
        '    <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">\n'
        '        <pack index="0" name="veraPDF GUI" selected="false"/>\n'
        '        <pack index="1" name="veraPDF CLI" selected="true"/>\n'
        '        <pack index="2" name="veraPDF Documentation" selected="false"/>\n'
        '        <pack index="3" name="veraPDF Sample Plugins" selected="false"/>\n'
        "    </com.izforge.izpack.panels.packs.PacksPanel>\n"
        '    <com.izforge.izpack.panels.install.InstallPanel id="install"/>\n'
        '    <com.izforge.izpack.panels.finish.FinishPanel id="finish"/>\n'
        "</AutomatedInstallation>\n"
    )


def _install_verapdf(zip_path: Path, verapdf_dir: Path, work_dir: Path) -> None:
    """Installiert veraPDF CLI ueber den verifizierten IzPack-Installer."""
    java_bin = shutil.which("java")
    if not java_bin:
        raise RuntimeError("java ist nicht verfuegbar (benoetigt Java 11+)")

    extract_dir = work_dir / "verapdf-installer"
    safe_extract_zip(zip_path, extract_dir)
    installers = list(extract_dir.rglob("verapdf-izpack-installer-*.jar"))
    if not installers:
        raise RuntimeError("veraPDF-IzPack-Installer-JAR nicht im Archiv gefunden")

    if verapdf_dir.exists():
        shutil.rmtree(verapdf_dir)
    verapdf_dir.mkdir(parents=True, exist_ok=True)

    auto_xml = work_dir / "auto-install.xml"
    auto_xml.write_text(_build_verapdf_auto_install_xml(verapdf_dir), encoding="utf-8")

    result = subprocess.run(
        [java_bin, "-jar", str(installers[0]), str(auto_xml)],
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()[:300]
        raise RuntimeError(f"veraPDF-Installer fehlgeschlagen (Exit {result.returncode}): {detail}")

    cli_bin = verapdf_dir / "verapdf"
    if not cli_bin.is_file():
        raise RuntimeError("veraPDF CLI nach Installation nicht gefunden")
    cli_bin.chmod(cli_bin.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def sync_toolchain(destination: Path | None = None) -> bool:
    """Installiert die gepinnte E-Rechnungs-Toolchain idempotent und atomar.

    Gibt True zurueck, wenn die Toolchain bereits vollstaendig war oder
    erfolgreich bereitgestellt wurde.
    """
    base_dir = destination or target_dir()
    if is_complete(base_dir):
        print(f"[einvoice] Toolchain bereits vollstaendig: {base_dir}")
        return True

    if not shutil.which("java"):
        raise RuntimeError("java nicht gefunden; KoSIT-Validator und veraPDF uebersprungen")

    base_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="msm-einvoice-") as tmp_name:
        tmp_dir = Path(tmp_name)
        downloads = tmp_dir / "downloads"
        staging = tmp_dir / "staging"
        downloads.mkdir(parents=True, exist_ok=True)
        staging.mkdir(parents=True, exist_ok=True)

        kosit_jar = staging / "kosit" / KOSIT_VALIDATOR_FILENAME
        kosit_cfg_zip = downloads / "xrechnung-config.zip"
        kosit_cfg_dir = staging / "kosit" / "config"
        verapdf_zip = downloads / "verapdf-installer.zip"
        verapdf_dir = staging / "verapdf"

        print(f"[einvoice] Lade KoSIT-Validator {KOSIT_VALIDATOR_VERSION} ...")
        _download_file(KOSIT_VALIDATOR_URL, kosit_jar, KOSIT_VALIDATOR_SHA256)

        print(f"[einvoice] Lade XRechnung-Konfiguration {KOSIT_XRECHNUNG_VERSION} ...")
        _download_file(KOSIT_XRECHNUNG_URL, kosit_cfg_zip, KOSIT_XRECHNUNG_SHA256)
        safe_extract_zip(kosit_cfg_zip, kosit_cfg_dir)
        if not (kosit_cfg_dir / "scenarios.xml").is_file():
            raise RuntimeError("scenarios.xml fehlt in der XRechnung-Konfiguration")

        print(f"[einvoice] Lade veraPDF CLI {VERAPDF_VERSION} ...")
        _download_file(VERAPDF_URL, verapdf_zip, VERAPDF_SHA256)
        _install_verapdf(verapdf_zip, verapdf_dir, tmp_dir)

        (staging / ".toolchain-version").write_text(TARGET_MARKER + "\n", encoding="utf-8")

        backup_dir = tmp_dir / "backup"
        if base_dir.exists():
            shutil.move(str(base_dir), str(backup_dir))
        try:
            shutil.move(str(staging), str(base_dir))
        except Exception:
            if backup_dir.exists() and not base_dir.exists():
                shutil.move(str(backup_dir), str(base_dir))
            raise

    print(f"[einvoice] Toolchain bereit: {base_dir}")
    return True


def main() -> int:
    try:
        sync_toolchain()
    except Exception as exc:  # noqa: BLE001 - Offline-/Install-Fallback wie fetch_embedding_model
        print(
            f"[einvoice] Toolchain-Bereitstellung uebersprungen ({exc}). "
            "PDF/A-3-Konformitaet und KoSIT-Pruefung bleiben deaktiviert.",
            file=sys.stderr,
        )
        return 0
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
