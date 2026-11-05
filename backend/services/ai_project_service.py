"""Universal AI Projects Service: Wissen, Dokumente, Coding-Sandbox & Git (GitHub/GitLab)."""

from __future__ import annotations

import logging
import os
import posixpath
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse
from uuid import uuid4

from sqlalchemy.orm import Session

from config import settings
from models import AiProject, AiProjectFile, TeamMember, User
from models.dis_text import vorab_entschluesselt

logger = logging.getLogger(__name__)

_MAX_FILE_BYTES = 512 * 1024  # 512 KB pro Datei in der DB/Sandbox
_MAX_CMD_OUTPUT_CHARS = 16_000
_SAFE_REL_PATH_RE = re.compile(r"^[A-Za-z0-9._/\- ]{1,240}$")


class AiProjectError(ValueError):
    """Fachlicher Fehler im Projekt- oder Sandbox-Dienst."""


def _sandbox_base_dir() -> Path:
    base = Path(settings.servers_dir or tempfile.gettempdir()) / "_ai_projects"
    try:
        base.mkdir(parents=True, exist_ok=True)
        return base
    except OSError:
        fallback = Path(tempfile.gettempdir()) / "msm_ai_projects"
        fallback.mkdir(parents=True, exist_ok=True)
        return fallback


def ensure_project_workspace(project: AiProject) -> Path:
    """Stellt sicher, dass das Arbeitsverzeichnis fuer das Projekt existiert."""
    if project.workspace_mode == "desktop" and project.local_path:
        local = Path(project.local_path).expanduser().resolve()
        if local.exists() and local.is_dir():
            return local
    if project.sandbox_path:
        p = Path(project.sandbox_path)
        try:
            p.mkdir(parents=True, exist_ok=True)
            return p
        except OSError:
            pass
    ws = _sandbox_base_dir() / f"proj_{project.id}"
    ws.mkdir(parents=True, exist_ok=True)
    return ws


def normalize_rel_path(rel_path: str) -> str:
    cleaned = (rel_path or "").replace("\\", "/").strip().lstrip("/")
    if not cleaned:
        raise AiProjectError("Dateipfad darf nicht leer sein")
    norm = posixpath.normpath(cleaned)
    if norm in (".", "..") or norm.startswith("../") or "/../" in f"/{norm}/":
        raise AiProjectError("Ungültiger Dateipfad außerhalb des Projektordners")
    if not _SAFE_REL_PATH_RE.match(norm):
        raise AiProjectError("Dateipfad enthält nicht unterstützte Sonderzeichen")
    return norm


def _can_access_project(db: Session, user: User, project: AiProject) -> bool:
    if project.user_id == user.id:
        return True
    if project.team_id is not None:
        member = (
            db.query(TeamMember)
            .filter(TeamMember.team_id == project.team_id, TeamMember.user_id == user.id)
            .first()
        )
        return member is not None
    return False


def get_project(db: Session, user: User, project_id: str | int) -> AiProject:
    project = db.get(AiProject, str(project_id))
    if project is None or not _can_access_project(db, user, project):
        raise AiProjectError("Projekt nicht gefunden oder kein Zugriff")
    return project


def list_projects(db: Session, user: User, *, team_id: int | None = None) -> list[AiProject]:
    q = db.query(AiProject)
    if team_id is not None:
        member = (
            db.query(TeamMember)
            .filter(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
            .first()
        )
        if member is None:
            return []
        q = q.filter(AiProject.team_id == team_id, AiProject.archived.is_(False))
    else:
        q = q.filter(
            AiProject.user_id == user.id,
            AiProject.team_id.is_(None),
            AiProject.archived.is_(False),
        )
    q = q.order_by(AiProject.pinned.desc(), AiProject.updated_at.desc(), AiProject.id.desc())
    with vorab_entschluesselt(db, q, AiProject.name, AiProject.description, AiProject.instructions):
        return q.all()


def default_project_system_prompt(name: str, description: str | None = None) -> str:
    """Erzeugt eine fundierte Systemanweisung nach etabliertem Prompt Engineering.

    Prinzipien:
    - KISS-Prinzip (Keep It Simple, Stupid)
    - Sauberer, wartbarer, skalierbarer und sicherer Code
    - Zwingende modulare Ordnerstruktur (keine flachen Dateien im Root)
    - Wahrhaftige Code-Kommentare, die exakt der Logik entsprechen
    - System- und Architekturdokumentation (README/docs) fuer Weiterarbeit
    """
    clean_name = (name or "Software-Projekt").strip()
    clean_desc = (description or "").strip()
    ziel_text = clean_desc if clean_desc else "Entwicklung einer modularen, sicheren und wartbaren Softwarelösung."

    return f"""\
# Systemanweisung: {clean_name}

## 1. Rolle & Projektziel
Ziel: {ziel_text}
Du agierst als fokussierter Software-Architekt und Entwickler für dieses Projekt. Du setzt Anforderungen zielgerichtet, überlegt und mit hoher technischer Präzision um.

## 2. Architektur & KISS-Prinzip
- KISS-Prinzip (Keep It Simple, Stupid): Halte Lösungen einfach, elegant und leicht nachvollziehbar. Vermeide unnötige Überkomplexität, verfrühte Abstraktionen oder aufgeblähte Hilfsschichten.
- Modulare Trennung: Logik, Datenzugriff, Schnittstellen und Darstellung bleiben klar getrennt.
- Klare Verantwortlichkeiten: Jede Funktion, jedes Modul und jede Komponente erfüllt genau eine klar definierte Aufgabe.

## 3. Zwingende Ordnerstruktur & Datei-Organisation
- Niemals alle Dateien flach im Stammverzeichnis ablegen.
- Verwende immer eine saubere, modulare Verzeichnishierarchie (z. B. `src/`, `components/`, `styles/`, `lib/`, `docs/`, `tests/` oder sprachspezifische Standards).
- Neue Dateien werden von Beginn an im passenden Unterordner platziert.
- Im Stammverzeichnis verbleiben ausschließlich übergeordnete Konfigurationen (z. B. Konfigurationsdateien, `README.md`, `package.json`).

## 4. Code-Qualität, Sicherheit & Robustheit
- Vollständige Typisierung, strenge Validierung und saubere Schnittstellendefinitionen.
- Defensive Programmierung: Fehlerfälle aktiv abfangen, verständliche Fehlermeldungen liefern und fehlschlagende Operationen sicher behandeln.
- Sicherheit: Keine Passwörter, API-Keys, Tokens oder sensiblen Daten im Quellcode hinterlegen; stets Umgebungsvariablen oder sichere Konfigurationen verwenden.
- Skalierbarkeit: Vermeide Flaschenhälse und unbedachte synchrone Blockaden bei I/O- und Netzwerkoperationen.

## 5. Wahrhaftige Kommentare & Dokumentation
- Wahrhaftige Code-Kommentare: Jeder Kommentar im Code muss zwingend exakt der tatsächlichen Funktionsweise entsprechen. Veraltete, irreführende oder falsche Kommentare sind streng verboten.
- Selbsterklärender Code hat Vorrang: Bevorzuge sprechende Variablen- und Funktionsnamen. Kommentare erklären das "Warum" hinter nichttrivialen Architekturentscheidungen, keine offensichtlichen Trivialitäten.
- Systemdokumentation: Halte eine aussagekräftige `README.md` (und bei Bedarf `docs/`) aktuell, die Projektzweck, Architekturübersicht, Ordnerstruktur, Setup-Schritte und Bedienung dokumentiert, damit Entwickler und Agenten jederzeit nahtlos weiterarbeiten können."""


def create_project(
    db: Session,
    user: User,
    *,
    name: str,
    description: str | None = None,
    system_prompt: str | None = None,
    icon: str = "folder-code",
    color: str = "emerald",
    team_id: int | None = None,
    sandbox_mode: str = "server",
    local_path: str | None = None,
    git_provider: str | None = None,
    git_repo_url: str | None = None,
    git_branch: str | None = "main",
) -> AiProject:
    clean_name = (name or "").strip()
    if not clean_name:
        raise AiProjectError("Projektname darf nicht leer sein")
    if team_id is not None:
        member = (
            db.query(TeamMember)
            .filter(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
            .first()
        )
        if member is None:
            raise AiProjectError("Kein Zugriff auf dieses Team")
    ws_mode = "sandbox" if sandbox_mode in ("server", "sandbox", "code") else ("desktop" if sandbox_mode == "local" else "docs")
    from uuid import uuid4

    instructions_text = (system_prompt or "").strip()
    if not instructions_text:
        instructions_text = default_project_system_prompt(clean_name, description)

    project = AiProject(
        id=str(uuid4()),
        user_id=user.id,
        team_id=team_id,
        name=clean_name[:160],
        description=(description or "").strip() or None,
        instructions=instructions_text,
        icon=(icon or "folder-code").strip()[:32],
        color=(color or "emerald").strip()[:32],
        workspace_mode=ws_mode,
        local_path=(local_path or "").strip() or None,
        git_provider=git_provider if git_provider in ("github", "gitlab", None) else None,
        git_repo_url=(git_repo_url or "").strip() or None,
        git_branch=(git_branch or "main").strip()[:120] or "main",
    )
    db.add(project)
    db.flush()
    ensure_project_workspace(project)
    db.commit()
    db.refresh(project)
    return project


def update_project(
    db: Session,
    user: User,
    project_id: str,
    *,
    name: str | None = None,
    description: str | None = None,
    system_prompt: str | None = None,
    icon: str | None = None,
    color: str | None = None,
    pinned: bool | None = None,
    sandbox_mode: str | None = None,
    local_path: str | None = None,
    git_provider: str | None = None,
    git_repo_url: str | None = None,
    git_branch: str | None = None,
) -> AiProject:
    project = get_project(db, user, project_id)
    if name is not None:
        clean_name = name.strip()
        if not clean_name:
            raise AiProjectError("Projektname darf nicht leer sein")
        project.name = clean_name[:160]
    if description is not None:
        project.description = description.strip() or None
    if system_prompt is not None:
        project.instructions = system_prompt.strip() or None
    if icon is not None:
        project.icon = icon.strip()[:48] or "folder-code"
    if color is not None:
        project.color = color.strip()[:32] or "emerald"
    if pinned is not None:
        project.pinned = bool(pinned)
    if sandbox_mode is not None and sandbox_mode in ("server", "local", "none"):
        project.workspace_mode = (
            "sandbox" if sandbox_mode == "server" else ("desktop" if sandbox_mode == "local" else "docs")
        )
    if local_path is not None:
        project.local_path = local_path.strip() or None
    if git_provider is not None:
        project.git_provider = git_provider if git_provider in ("github", "gitlab") else None
    if git_repo_url is not None:
        project.git_repo_url = git_repo_url.strip() or None
    if git_branch is not None:
        project.git_branch = git_branch.strip()[:120] or "main"
    project.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, user: User, project_id: str) -> None:
    project = get_project(db, user, project_id)
    sandbox_dir = _sandbox_base_dir() / f"proj_{project.id}"
    db.delete(project)
    db.commit()
    if sandbox_dir.exists() and sandbox_dir.is_dir():
        shutil.rmtree(sandbox_dir, ignore_errors=True)


def list_project_files(db: Session, user: User, project_id: str) -> list[AiProjectFile]:
    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    _sync_workspace_files_to_db(db, project, ws)
    q = (
        db.query(AiProjectFile)
        .filter(AiProjectFile.project_id == project.id)
        .order_by(AiProjectFile.path.asc())
    )
    with vorab_entschluesselt(db, q, AiProjectFile.content):
        return q.all()


def _sync_workspace_files_to_db(db: Session, project: AiProject, ws: Path) -> None:
    """Synchronisiert Dateien aus dem Sandbox-Verzeichnis in die verschluesselte DB."""
    if not ws.exists() or not ws.is_dir():
        return
    existing = {
        f.path: f
        for f in db.query(AiProjectFile).filter(AiProjectFile.project_id == project.id).all()
    }
    changed = False
    count = 0
    for root, dirs, files in os.walk(ws):
        dirs[:] = [
            d
            for d in dirs
            if d not in {".git", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", "target"}
        ]
        for fname in files:
            if count >= 150:
                break
            fpath = Path(root) / fname
            try:
                rel = fpath.relative_to(ws).as_posix()
                if not _SAFE_REL_PATH_RE.match(rel):
                    continue
                stat = fpath.stat()
                if stat.st_size > _MAX_FILE_BYTES:
                    continue
                if rel not in existing:
                    text = fpath.read_text(encoding="utf-8", errors="replace")
                    row = AiProjectFile(
                        id=str(uuid4()),
                        project_id=project.id,
                        path=rel,
                        content=text,
                        size_bytes=len(text.encode("utf-8")),
                    )
                    db.add(row)
                    changed = True
                count += 1
            except OSError:
                continue
    if changed:
        db.commit()


def read_project_file(db: Session, user: User, project_id: str, rel_path: str) -> AiProjectFile:
    project = get_project(db, user, project_id)
    norm = normalize_rel_path(rel_path)
    ws = ensure_project_workspace(project)
    disk_file = (ws / norm).resolve()
    if str(disk_file).startswith(str(ws.resolve())) and disk_file.is_file():
        try:
            disk_content = disk_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            disk_content = None
    else:
        disk_content = None

    row = (
        db.query(AiProjectFile)
        .filter(AiProjectFile.project_id == project.id, AiProjectFile.path == norm)
        .first()
    )
    if row is None and disk_content is not None:
        row = AiProjectFile(
            id=str(uuid4()),
            project_id=project.id,
            path=norm,
            content=disk_content,
            size_bytes=len(disk_content.encode("utf-8")),
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        return row
    if row is None:
        raise AiProjectError(f"Datei '{norm}' nicht gefunden")
    if disk_content is not None and row.content != disk_content:
        row.content = disk_content
        row.size_bytes = len(disk_content.encode("utf-8"))
        db.commit()
        db.refresh(row)
    return row


def write_project_file(
    db: Session,
    user: User,
    project_id: str,
    rel_path: str,
    content: str,
    mime_type: str = "text/plain",
) -> AiProjectFile:
    project = get_project(db, user, project_id)
    norm = normalize_rel_path(rel_path)
    encoded = (content or "").encode("utf-8")
    if len(encoded) > _MAX_FILE_BYTES:
        raise AiProjectError("Datei überschreitet das Limit von 512 KB")

    ws = ensure_project_workspace(project)
    disk_file = (ws / norm).resolve()
    if not str(disk_file).startswith(str(ws.resolve())):
        raise AiProjectError("Ungültiger Dateipfad außerhalb des Projektordners")
    try:
        disk_file.parent.mkdir(parents=True, exist_ok=True)
        disk_file.write_text(content or "", encoding="utf-8")
    except OSError as exc:
        logger.warning("Konnte Projektdatei nicht auf Disk schreiben: %s", exc)

    row = (
        db.query(AiProjectFile)
        .filter(AiProjectFile.project_id == project.id, AiProjectFile.path == norm)
        .first()
    )
    now = datetime.now(timezone.utc)
    if row is None:
        row = AiProjectFile(
            id=str(uuid4()),
            project_id=project.id,
            path=norm,
            content=content or "",
            mime_type=(mime_type or "text/plain")[:80],
            size_bytes=len(encoded),
        )
        db.add(row)
    else:
        row.content = content or ""
        row.mime_type = (mime_type or row.mime_type or "text/plain")[:80]
        row.size_bytes = len(encoded)
        row.updated_at = now
    project.updated_at = now
    db.commit()
    db.refresh(row)
    return row


def delete_project_file(db: Session, user: User, project_id: str, rel_path: str) -> None:
    project = get_project(db, user, project_id)
    norm = normalize_rel_path(rel_path)
    ws = ensure_project_workspace(project)
    disk_file = (ws / norm).resolve()
    if str(disk_file).startswith(str(ws.resolve())) and disk_file.is_file():
        try:
            disk_file.unlink()
        except OSError:
            pass
    row = (
        db.query(AiProjectFile)
        .filter(AiProjectFile.project_id == project.id, AiProjectFile.path == norm)
        .first()
    )
    if row is not None:
        db.delete(row)
        project.updated_at = datetime.now(timezone.utc)
        db.commit()


def _materialize_db_files_to_workspace(db: Session, project: AiProject, ws: Path) -> None:
    q = db.query(AiProjectFile).filter(AiProjectFile.project_id == project.id)
    with vorab_entschluesselt(db, q, AiProjectFile.content):
        rows = q.all()
    for row in rows:
        try:
            norm = normalize_rel_path(row.path)
            target = (ws / norm).resolve()
            if not str(target).startswith(str(ws.resolve())):
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                target.write_text(row.content or "", encoding="utf-8")
        except Exception:
            continue


def run_project_command(
    db: Session,
    user: User,
    project_id: str,
    command: str,
    *,
    timeout_seconds: int = 25,
) -> dict[str, object]:
    """Fuehrt einen Shell-Befehl isoliert im Projekt-Arbeitsverzeichnis aus."""
    project = get_project(db, user, project_id)
    cmd = (command or "").strip()
    if not cmd:
        raise AiProjectError("Befehl darf nicht leer sein")
    ws = ensure_project_workspace(project)
    _materialize_db_files_to_workspace(db, project, ws)

    safe_env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": str(ws),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "GIT_TERMINAL_PROMPT": "0",
    }
    for key in ("SYSTEMROOT", "COMSPEC", "PATHEXT", "TEMP", "TMP"):
        if key in os.environ:
            safe_env[key] = os.environ[key]

    timeout = max(2, min(int(timeout_seconds or 25), 60))
    try:
        completed = subprocess.run(
            cmd,
            cwd=str(ws),
            env=safe_env,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        stdout = (completed.stdout or "")[:_MAX_CMD_OUTPUT_CHARS]
        stderr = (completed.stderr or "")[:_MAX_CMD_OUTPUT_CHARS]
        _sync_workspace_files_to_db(db, project, ws)
        return {
            "ok": completed.returncode == 0,
            "exit_code": completed.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "workspace": str(ws),
        }
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "exit_code": 124,
            "stdout": "",
            "stderr": f"Zeitüberschreitung nach {timeout} Sekunden.",
            "workspace": str(ws),
        }
    except OSError as exc:
        raise AiProjectError(f"Ausführung fehlgeschlagen: {exc}") from exc


def _inject_git_token(repo_url: str, token: str | None, provider: str | None) -> str:
    if not token or not token.strip():
        return repo_url
    parsed = urlparse(repo_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return repo_url
    user_part = "oauth2" if provider == "gitlab" else "x-access-token"
    netloc = f"{user_part}:{token.strip()}@{parsed.hostname}"
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


def git_status(db: Session, user: User, project_id: str) -> dict[str, object]:
    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    git_dir = ws / ".git"
    if not git_dir.exists():
        return {
            "initialized": False,
            "branch": project.git_branch or "main",
            "repo_url": project.git_repo_url,
            "provider": project.git_provider,
            "status_short": "",
            "diff_stat": "",
        }
    branch_res = subprocess.run(
        ["git", "rev-parse", "--abbrev-ref", "HEAD"],
        cwd=str(ws),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    status_res = subprocess.run(
        ["git", "status", "--short"],
        cwd=str(ws),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    diff_res = subprocess.run(
        ["git", "diff", "--stat"],
        cwd=str(ws),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=10,
    )
    return {
        "initialized": True,
        "branch": (branch_res.stdout or "").strip() or project.git_branch or "main",
        "repo_url": project.git_repo_url,
        "provider": project.git_provider,
        "status_short": (status_res.stdout or "")[:8000],
        "diff_stat": (diff_res.stdout or "")[:8000],
    }


def git_clone_or_pull(
    db: Session,
    user: User,
    project_id: str,
    *,
    repo_url: str | None = None,
    branch: str | None = None,
    provider: str | None = None,
    token: str | None = None,
) -> dict[str, object]:
    project = get_project(db, user, project_id)
    if repo_url is not None:
        project.git_repo_url = repo_url.strip() or None
    if branch is not None:
        project.git_branch = branch.strip()[:120] or "main"
    if provider in ("github", "gitlab"):
        project.git_provider = provider
    db.commit()

    target_url = project.git_repo_url
    if not target_url:
        raise AiProjectError("Keine Git-Repository-URL hinterlegt")
    parsed = urlparse(target_url)
    if parsed.scheme not in ("https", "http") or not parsed.hostname:
        raise AiProjectError("Nur HTTPS/HTTP Git-Repository-URLs werden unterstützt")

    auth_url = _inject_git_token(target_url, token, project.git_provider)
    ws = ensure_project_workspace(project)
    git_dir = ws / ".git"
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
    }
    target_branch = project.git_branch or "main"
    if not git_dir.exists():
        # Klonen in ein temporäres Unterverzeichnis und Inhalt verschieben, falls ws bereits existiert
        tmp_clone = ws.parent / f"clone_{project.id}_{int(datetime.now(timezone.utc).timestamp())}"
        try:
            res = subprocess.run(
                ["git", "clone", "--depth", "50", "--branch", target_branch, auth_url, str(tmp_clone)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                timeout=45,
            )
            if res.returncode != 0:
                res = subprocess.run(
                    ["git", "clone", "--depth", "50", auth_url, str(tmp_clone)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=env,
                    timeout=45,
                )
            if res.returncode != 0:
                stderr_clean = (res.stderr or "").replace(token or "___", "***")
                raise AiProjectError(f"Git-Clone fehlgeschlagen: {stderr_clean[:400]}")
            for item in tmp_clone.iterdir():
                dest = ws / item.name
                if dest.exists():
                    if dest.is_dir():
                        shutil.rmtree(dest, ignore_errors=True)
                    else:
                        dest.unlink(missing_ok=True)
                shutil.move(str(item), str(dest))
            # Token aus .git/config entfernen
            subprocess.run(
                ["git", "remote", "set-url", "origin", target_url],
                cwd=str(ws),
                capture_output=True,
                timeout=10,
            )
        finally:
            if tmp_clone.exists():
                shutil.rmtree(tmp_clone, ignore_errors=True)
    else:
        res = subprocess.run(
            ["git", "pull", auth_url, target_branch],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=45,
        )
        if res.returncode != 0:
            stderr_clean = (res.stderr or "").replace(token or "___", "***")
            raise AiProjectError(f"Git-Pull fehlgeschlagen: {stderr_clean[:400]}")

    _sync_workspace_files_to_db(db, project, ws)
    return git_status(db, user, project.id)


def git_commit_and_push(
    db: Session,
    user: User,
    project_id: str,
    *,
    message: str,
    push: bool = False,
    token: str | None = None,
) -> dict[str, object]:
    project = get_project(db, user, project_id)
    commit_msg = (message or "").strip()
    if not commit_msg:
        raise AiProjectError("Commit-Nachricht darf nicht leer sein")
    ws = ensure_project_workspace(project)
    _materialize_db_files_to_workspace(db, project, ws)
    git_dir = ws / ".git"
    env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_AUTHOR_NAME": user.username or "Singra AI",
        "GIT_AUTHOR_EMAIL": user.email or "singra@mauntingstudios.de",
        "GIT_COMMITTER_NAME": user.username or "Singra AI",
        "GIT_COMMITTER_EMAIL": user.email or "singra@mauntingstudios.de",
    }
    if not git_dir.exists():
        subprocess.run(["git", "init", "-b", project.git_branch or "main"], cwd=str(ws), capture_output=True, env=env, timeout=10)
        if project.git_repo_url:
            subprocess.run(["git", "remote", "add", "origin", project.git_repo_url], cwd=str(ws), capture_output=True, env=env, timeout=10)

    subprocess.run(["git", "add", "-A"], cwd=str(ws), capture_output=True, env=env, timeout=15)
    commit_res = subprocess.run(
        ["git", "commit", "-m", commit_msg],
        cwd=str(ws),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=15,
    )
    push_output = ""
    if push and project.git_repo_url:
        auth_url = _inject_git_token(project.git_repo_url, token, project.git_provider)
        target_branch = project.git_branch or "main"
        push_res = subprocess.run(
            ["git", "push", auth_url, f"HEAD:{target_branch}"],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=45,
        )
        push_output = ((push_res.stdout or "") + "\n" + (push_res.stderr or "")).replace(token or "___", "***").strip()
        if push_res.returncode != 0:
            raise AiProjectError(f"Git-Push fehlgeschlagen: {push_output[:400]}")

    status = git_status(db, user, project.id)
    status["commit_output"] = ((commit_res.stdout or "") + "\n" + (commit_res.stderr or "")).strip()[:4000]
    status["push_output"] = push_output[:4000]
    return status


def get_project_agents_rules(
    db: Session,
    user: User,
    project_id: str | int,
) -> dict[str, object]:
    """Prüft, ob im Projekt eine AGENTS.md, agents.md, GEMINI.md oder CLAUDE.md existiert."""
    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    candidates = ("AGENTS.md", "agents.md", "GEMINI.md", "CLAUDE.md", ".cursorrules")
    for name in candidates:
        target = ws / name
        if target.is_file():
            try:
                content = target.read_text(encoding="utf-8", errors="replace")
                return {
                    "found": True,
                    "filename": name,
                    "content": content,
                    "lines_count": len(content.splitlines()),
                    "size_bytes": len(content.encode("utf-8")),
                }
            except Exception:
                pass
    # Falls physisch noch nicht materialisiert, in der DB nachschauen
    for name in candidates:
        db_file = (
            db.query(AiProjectFile)
            .filter(AiProjectFile.project_id == str(project.id), AiProjectFile.path == name)
            .first()
        )
        if db_file is not None and db_file.content:
            return {
                "found": True,
                "filename": name,
                "content": db_file.content,
                "lines_count": len(db_file.content.splitlines()),
                "size_bytes": db_file.size_bytes,
            }
    return {
        "found": False,
        "filename": None,
        "content": None,
        "lines_count": 0,
        "size_bytes": 0,
    }

