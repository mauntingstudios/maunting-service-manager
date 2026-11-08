"""Materialisierung, Ephemerer Build und Release-Manifest-Erstellung für Singra."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from services import docker_service
from services.docker_service import VolumeBind
from services.singra.start_sh import generate_start_sh

logger = logging.getLogger(__name__)


class SingraBuildError(Exception):
    """Fehler während der Build- oder Release-Phase."""

    def __init__(self, message: str, phase: str = "build", detail: str = ""):
        super().__init__(message)
        self.phase = phase
        self.detail = detail


def calculate_file_hash(path: Path) -> str:
    """Berechnet den SHA-256 Hash einer Datei."""
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def materialize_files(
    files: list[Any] | dict[str, str],
    target_dir: Path,
) -> dict[str, str]:
    """Schreibt Projektdateien in das Zielverzeichnis und liefert Pfad -> SHA-256."""
    target_dir.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, str] = {}

    file_items: list[tuple[str, str]] = []
    if isinstance(files, dict):
        file_items = list(files.items())
    else:
        for f in files:
            p = getattr(f, "path", None) or getattr(f, "file_path", None)
            c = getattr(f, "content", "")
            if p:
                file_items.append((p, c or ""))

    for rel_path, content in file_items:
        clean_rel = rel_path.strip().lstrip("/").replace("\\", "/")
        out_file = target_dir / clean_rel
        out_file.parent.mkdir(parents=True, exist_ok=True)
        out_file.write_text(content, encoding="utf-8")
        manifest[clean_rel] = hashlib.sha256(content.encode("utf-8")).hexdigest()

    return manifest


def build_release(
    *,
    project: Any,
    files: list[Any] | dict[str, str],
    workspace_dir: Path,
    environment: str = "prod",
    node: Any | None = None,
    log_callback: Callable[[str], None] | None = None,
) -> Path:
    """Führt einen deterministischen Build aus und materialisiert das finale Release-Verzeichnis.

    Schritte:
    1. Materialisiert Dateien nach ws/_release_build/
    2. Erkennt Frontend und führt npm ci / npm run build in Wegwerf-Container aus
    3. Prüft Existenz von dist/index.html (Abbruch bei Fehlen)
    4. Erkennt Python Backend und installiert requirements.txt
    5. Erzeugt start.sh (chmod 0755)
    6. Erzeugt release.json Manifest mit Checksummen
    7. Führt atomaren Swap nach _prod_release/ bzw. _dev_release/ durch
    """
    def log(msg: str):
        if log_callback:
            try:
                log_callback(msg)
            except Exception:
                pass
        logger.info("[Singra Release %s] %s", getattr(project, "id", "unbekannt"), msg)

    build_dir = workspace_dir / "_release_build"
    if build_dir.exists():
        shutil.rmtree(build_dir, ignore_errors=True)
    build_dir.mkdir(parents=True, exist_ok=True)

    log(f"1. Materialisiere Projektdateien nach {build_dir.name}...")
    file_manifest = materialize_files(files, build_dir)

    # Prüfen, ob Frontend vorhanden ist
    is_frontend = (
        (build_dir / "package.json").exists()
        and any(
            (build_dir / marker).exists()
            for marker in ("index.html", "vite.config.ts", "vite.config.js", "vite.config.mjs", "vite.config.cjs")
        )
    ) or (
        (build_dir / "frontend" / "package.json").exists()
        and (build_dir / "frontend" / "index.html").exists()
    )

    if is_frontend:
        log("2. Baue Frontend in ephemerem Container...")
        target_fe_dir = (build_dir / "frontend") if (build_dir / "frontend" / "package.json").exists() else build_dir
        has_lock = (target_fe_dir / "package-lock.json").exists()
        npm_install_cmd = "npm ci" if has_lock else "npm install"

        # Ephemerer Docker-Build falls Docker verfuegbar
        docker_avail = docker_service.is_docker_available(node=node)
        build_succeeded = False
        build_output = ""

        if docker_avail:
            cmd = ["sh", "-c", f"{npm_install_cmd} && npm run build"]
            volumes = [
                VolumeBind(
                    host_path=str(target_fe_dir.resolve()),
                    container_path="/app",
                    read_only=False,
                )
            ]
            res = docker_service.run_ephemeral(
                image="node:22-bookworm-slim",
                command=cmd,
                workdir="/app",
                volumes=volumes,
                timeout=600,
                node=node,
                log_callback=log_callback,
            )
            build_succeeded = bool(res.get("ok"))
            build_output = (res.get("stdout") or "") + "\n" + (res.get("stderr") or "")
        else:
            # Lokaler Fallback fuer Umgebungen ohne Docker
            log("Docker nicht verfügbar; verwende lokalen Node-Prozess fuer Build...")
            try:
                npm_bin = shutil.which("npm.cmd") or shutil.which("npm")
                if npm_bin:
                    p1 = subprocess.run(
                        [npm_bin, "ci" if has_lock else "install"],
                        cwd=str(target_fe_dir),
                        capture_output=True,
                        text=True,
                        timeout=300,
                    )
                    p2 = subprocess.run(
                        [npm_bin, "run", "build"],
                        cwd=str(target_fe_dir),
                        capture_output=True,
                        text=True,
                        timeout=300,
                    )
                    build_output = p1.stdout + p1.stderr + "\n" + p2.stdout + p2.stderr
                    build_succeeded = (p1.returncode == 0 and p2.returncode == 0)
                else:
                    build_output = "Kein npm auf dem Host gefunden."
            except Exception as exc:
                build_output = f"Lokaler Build-Fehler: {exc}"

        # Pruefe Artefakt dist/index.html
        dist_index = target_fe_dir / "dist" / "index.html"
        if not dist_index.exists() and (build_dir / "dist" / "index.html").exists():
            dist_index = build_dir / "dist" / "index.html"
        if not dist_index.exists():
            tail = build_output.strip()[-500:] if build_output else "Keine Build-Ausgabe vorhanden."
            raise SingraBuildError(
                f"Frontend-Build erzeugte kein dist/index.html:\n{tail}",
                phase="build_frontend",
                detail=tail,
            )
        log("Frontend-Build erfolgreich (dist/index.html vorhanden).")

    # Pruefen, ob Node.js Backend vorhanden ist
    be_node_dir = (build_dir / "backend") if (build_dir / "backend" / "package.json").exists() else (build_dir if (not is_frontend and (build_dir / "package.json").exists()) else None)
    if be_node_dir is not None:
        log("3. Installiere Node.js Backend-Abhängigkeiten...")
        has_lock = (be_node_dir / "package-lock.json").exists()
        npm_install_cmd = "npm ci" if has_lock else "npm install"
        docker_avail = docker_service.is_docker_available(node=node)
        if docker_avail:
            cmd = ["sh", "-c", npm_install_cmd]
            volumes = [
                VolumeBind(
                    host_path=str(be_node_dir.resolve()),
                    container_path="/app",
                    read_only=False,
                )
            ]
            docker_service.run_ephemeral(
                image="node:22-bookworm-slim",
                command=cmd,
                workdir="/app",
                volumes=volumes,
                timeout=600,
                node=node,
                log_callback=log_callback,
            )
        else:
            npm_bin = shutil.which("npm.cmd") or shutil.which("npm")
            if npm_bin:
                try:
                    subprocess.run(
                        [npm_bin, "ci" if has_lock else "install"],
                        cwd=str(be_node_dir),
                        capture_output=True,
                        text=True,
                        timeout=300,
                    )
                except Exception as exc:
                    logger.warning("Lokaler Backend npm install Fehler: %s", exc)

    # Pruefen, ob Python Backend vorhanden ist
    req_file = build_dir / "requirements.txt"
    if not req_file.exists() and (build_dir / "backend" / "requirements.txt").exists():
        req_file = build_dir / "backend" / "requirements.txt"
    if req_file.exists():
        log("4. Bereite Python Backend vor...")
        py_dir = req_file.parent
        # Venv und pip install
        if shutil.which("python3") or shutil.which("python"):
            py_bin = shutil.which("python3") or shutil.which("python")
            try:
                subprocess.run(
                    [py_bin, "-m", "venv", str(py_dir / ".venv")],
                    check=False,
                    capture_output=True,
                    timeout=60,
                )
                pip_bin = py_dir / ".venv" / ("bin" if os.name == "posix" else "Scripts") / "pip"
                if pip_bin.exists():
                    subprocess.run(
                        [str(pip_bin), "install", "-r", str(req_file.name)],
                        cwd=str(py_dir),
                        check=False,
                        capture_output=True,
                        timeout=300,
                    )
            except Exception as exc:
                logger.warning("Venv/pip Vorbereitung mit Warnung beendet: %s", exc)

    # 4. start.sh generieren
    log("4. Generiere ausführbare start.sh...")
    start_sh_content = generate_start_sh(build_dir)
    start_sh_path = build_dir / "start.sh"
    start_sh_path.write_text(start_sh_content, encoding="utf-8")
    try:
        start_sh_path.chmod(0o755)
    except Exception:
        pass

    # 5. release.json Manifest erzeugen
    log("5. Erzeuge Release-Manifest release.json...")
    release_manifest = {
        "project_id": getattr(project, "id", None),
        "environment": environment,
        "built_at": datetime.now(timezone.utc).isoformat(),
        "has_frontend": is_frontend,
        "has_dist": (build_dir / "dist").is_dir(),
        "files_count": len(file_manifest),
        "checksums": file_manifest,
    }
    (build_dir / "release.json").write_text(
        json.dumps(release_manifest, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )

    # 6. Atomarer Swap nach finalem Release-Verzeichnis
    final_rel_name = "_dev_release" if environment.lower() == "dev" else "_prod_release"
    target_release_dir = workspace_dir / final_rel_name
    temp_old_dir = workspace_dir / f"{final_rel_name}_old_{int(time.time())}"

    log(f"6. Führe atomaren Release-Swap nach {final_rel_name} durch...")
    if target_release_dir.exists():
        try:
            target_release_dir.rename(temp_old_dir)
        except Exception:
            shutil.rmtree(temp_old_dir, ignore_errors=True)
            target_release_dir.rename(temp_old_dir)

    build_dir.rename(target_release_dir)

    if temp_old_dir.exists():
        shutil.rmtree(temp_old_dir, ignore_errors=True)

    log(f"Release erfolgreich in {target_release_dir.name} bereitgestellt.")
    return target_release_dir
