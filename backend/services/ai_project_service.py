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
    """Stellt sicher, dass das Arbeitsverzeichnis fuer das Projekt existiert.

    Aus Sicherheitsgruenden verbleibt das serverseitige Arbeitsverzeichnis
    ausnahmslos innerhalb des dedizierten Sandbox-Basisordners. Beliebige
    Host-Pfade koennen die Server-Sandbox nicht verschieben.
    """
    base = _sandbox_base_dir().resolve()
    ws = (base / f"proj_{project.id}").resolve()
    if not ws.is_relative_to(base):
        raise AiProjectError("Ungültiger Sandbox-Pfad für dieses Projekt")
    ws.mkdir(parents=True, exist_ok=True)
    if project.sandbox_path != str(ws):
        project.sandbox_path = str(ws)
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


def default_project_system_prompt(
    name: str,
    description: str | None = None,
    project_kind: str = "coding",
) -> str:
    """Erzeugt eine fundierte Systemanweisung passend zur Projektart (Code vs. Wissen/Recherche).

    Prinzipien fuer Code-Projekte:
    - Strikter Anti-AI-Slop-Vertrag & KISS-Prinzip (Keep It Simple, Stupid)
    - Wiederverwendbare, modulare Komponenten statt Copy-Paste
    - Zwingende modulare Ordnerstruktur (keine flachen Dateien im Root)
    - Wahrhaftige Code-Kommentare, laufende AGENTS.md / README.md Pflege
    - Pflicht-Testlauf in der Dev-Sandbox vor Abschluss einer Aufgabe
    - Dev- vs. Produktions-Trennung (inkl. PostgreSQL Branching)
    """
    clean_name = (name or "Projekt").strip()
    clean_desc = (description or "").strip()

    if project_kind in ("docs", "general"):
        ziel_text = clean_desc if clean_desc else "Strukturierte Ausarbeitung von Texten, Geschichten, Konzepten oder Recherchen."
        return f"""\
# Projektanweisung: {clean_name}

## 1. Projektziel & Arbeitsweise
Ziel: {ziel_text}
Du begleitest dieses Projekt als aufmerksamer Sparringspartner, Autor und Strukturgeber.
- Halte Dokumente klar gegliedert, natürlich formuliert und frei von künstlichen KI-Floskeln.
- Lege Kapitel, Notizen, Entwürfe und Quellen übersichtlich in eigenen Dateien an, damit das Projekt jederzeit nachvollziehbar bleibt.
- Pflege eine kurze Übersicht (`README.md`), die den aktuellen Stand und die wichtigsten Dateien zusammenfasst."""

    ziel_text = clean_desc if clean_desc else "Entwicklung einer modularen, sicheren und wartbaren Anwendung."

    return f"""\
# Systemanweisung & Qualitätsvertrag: {clean_name}

## 1. Rolle & Projektziel
Ziel: {ziel_text}
Du arbeitest als verantwortlicher Software-Architekt und Entwickler in einer vollwertigen Entwicklungsumgebung (Dev-Sandbox + PostgreSQL-Datenbank + Produktions-Pipeline).

## 2. Anti-AI-Slop & KISS-Prinzip (Verbindlich)
- **Kein AI-Slop:** Generiere niemals austauschbare, unwartbare Einmal-Seiten oder monolithische Riesendateien. Jede Anwendung muss so gebaut sein, dass ein menschlicher Entwickler sofort sauber daran weiterarbeiten kann.
- **KISS-Prinzip (Keep It Simple, Stupid):** Halte Lösungen klar, fokussiert und leicht verständlich. Vermeide unnötige Komplexität oder aufgeblähte Abstraktionen.
- **Wiederverwendbare Bausteine:** Wenn ein UI-Element oder eine Logik (z. B. `InputBar`, `Modal`, `Button`, `DataTable`, API-Client) gebraucht wird, baue es als sauberes, wiederverwendbares Modul unter `src/components/` bzw. `src/lib/`. Prüfe zudem projektübergreifend, ob in bestehenden Projekten des Nutzers bereits passende Bausteine existieren, die wiederverwendet werden können.

## 3. Zwingende Ordnerstruktur & Datei-Organisation
- Niemals alle Dateien flach im Stammverzeichnis ablegen.
- Verwende immer eine saubere, modulare Verzeichnishierarchie (z. B. `src/components/`, `src/pages/`, `src/lib/`, `src/styles/`, `backend/`, `migrations/`, `docs/`, `tests/`).
- Tech-Stack: Unterstütze moderne Stacks (React, TypeScript, Tailwind CSS, Vite, Python/Node-Backends sowie PostgreSQL als Datenbank). HTML dient der Strukturierung, nicht als Ersatz für eine saubere Komponentenarchitektur.

## 4. Umgebung (Dev vs. Produktion), Vorschau-Einrichtung & Datenbank-Branching
- Alle Änderungen finden zunächst sicher in der **Dev-Umgebung** (inkl. isoliertem PostgreSQL-Dev-Branch) statt.
- **Vorschau-Pflicht (`configure_preview`):** Jedes Web-/UI-Projekt MUSS ohne manuelle Nutzereingriffe direkt im Reiter **Vorschau** sichtbar und interaktiv bedienbar sein. Lege immer einen funktionierenden Vorschau-Einstiegspunkt an (z. B. `index.html` mit eingebundenen Komponenten aus `src/components/` und `src/lib/` sowie lokalem Demo-/Fallback-State, falls das Backend noch getrennt läuft) und registriere ihn per `project_workspace` (`action="configure_preview"`, `entry_file="index.html"`, `framework="react"` oder `"html"`).
- **Wichtig für die Live-Vorschau:** Trenne Frontend-Dateien (`index.html`, `src/components/`, `src/lib/`) sauber von Server-/Backend-Dateien (`backend/`, `migrations/`, `tests/`), damit keine Node-/Python-Serverbefehle (`require('express')`, `process.env`) ungeschützt im Browser-Kontext ausgeführt werden.

## 5. Pflicht-Verifikation (Happy-Path + Negativ-Tests + Vorschau-Beweis)
- **Erst testen & beweisen, dann melden:** Du bist mit einer Aufgabe erst fertig, wenn du bewiesen hast, dass die Anwendung **sowohl in den Tests als auch in der Live-Vorschau fehlerfrei funktioniert**.
- **Happy-Path UND Negativ-Tests:** Schreibe und führe bei jedem Feature nicht nur Gutfall-Tests (Happy Path), sondern zwingend auch **Negativ-Tests** (ungültige Eingaben, leere Pflichtfelder, Grenzwerte, doppelte Einträge, Fehlerbehandlung) aus. Nutze dafür `project_workspace` mit `action="test_project"` sowie `action="run_command"`.
- **Online-Schalten & Domain-Begleitung (Hand-in-Hand):** Wenn das Projekt auf Produktion veröffentlicht wird (`action="publish_production"`), nimm den Nutzer verständlich und ohne Fachchinesisch an die Hand: Prüfe zuerst Tests & Erreichbarkeit, richte bei konfiguriertem Cloudflare die gewünschte Domain/Subdomain ein oder erkläre Schritt für Schritt (mit exakter IP-Adresse, Port und A-Record), wie man die eigene Domain verbindet.
- **Wahrhaftige Dokumentation:** Halte `AGENTS.md` (Architekturregeln & Komponentenverzeichnis) sowie `README.md` (Setup, Stand & Struktur) bei strukturellen Änderungen automatisch aktuell.
- **Autonomes Lernen:** Wenn du im Projekt ein wiederverwendbares Architekturmuster löst, halte es als Skill fest."""


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
    project_kind: str | None = None,
    sandbox_enabled: bool | None = None,
    local_path: str | None = None,
    local_directory: str | None = None,
    git_provider: str | None = None,
    git_repo_url: str | None = None,
    git_branch: str | None = "main",
    git_token: str | None = None,
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

    effective_kind = (project_kind or "").strip().lower()
    if effective_kind == "docs" or sandbox_enabled is False or sandbox_mode == "none":
        ws_mode = "docs"
        effective_kind = "docs"
    elif sandbox_mode == "local":
        ws_mode = "desktop"
        effective_kind = "coding"
    else:
        ws_mode = "sandbox"
        if effective_kind not in ("coding", "general", "docs"):
            effective_kind = "coding"

    from uuid import uuid4

    instructions_text = (system_prompt or "").strip()
    if not instructions_text:
        instructions_text = default_project_system_prompt(clean_name, description, project_kind=effective_kind)

    eff_local = (local_path or local_directory or "").strip() or None

    project = AiProject(
        id=str(uuid4()),
        user_id=user.id,
        team_id=team_id,
        name=clean_name[:160],
        description=(description or "").strip() or None,
        instructions=instructions_text,
        icon=(icon or ("file-text" if ws_mode == "docs" else "folder-code")).strip()[:32],
        color=(color or "emerald").strip()[:32],
        workspace_mode=ws_mode,
        local_path=eff_local,
        git_provider=git_provider if git_provider in ("github", "gitlab", "custom", None) else None,
        git_repo_url=(git_repo_url or "").strip() or None,
        git_branch=(git_branch or "main").strip()[:120] or "main",
    )
    db.add(project)
    db.flush()
    ws = ensure_project_workspace(project)
    _ensure_env_metadata(project, ws, project_kind=effective_kind)
    if effective_kind == "coding":
        _seed_initial_agents_md_if_missing(db, user, project, ws)
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
    team_id: int | None = None,
    clear_team: bool = False,
    project_kind: str | None = None,
    sandbox_enabled: bool | None = None,
    sandbox_mode: str | None = None,
    local_path: str | None = None,
    local_directory: str | None = None,
    git_provider: str | None = None,
    git_repo_url: str | None = None,
    git_branch: str | None = None,
    git_token: str | None = None,
    clear_git_token: bool = False,
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
    if clear_team:
        project.team_id = None
    elif team_id is not None:
        if team_id <= 0:
            project.team_id = None
        else:
            member = (
                db.query(TeamMember)
                .filter(TeamMember.team_id == team_id, TeamMember.user_id == user.id)
                .first()
            )
            if member is None:
                raise AiProjectError("Kein Zugriff auf dieses Team")
            project.team_id = team_id
    if project_kind is not None:
        project.workspace_mode = "docs" if project_kind == "docs" else "sandbox"
    elif sandbox_enabled is not None:
        project.workspace_mode = "sandbox" if sandbox_enabled else "docs"
    elif sandbox_mode is not None and sandbox_mode in ("server", "local", "none"):
        project.workspace_mode = (
            "sandbox" if sandbox_mode == "server" else ("desktop" if sandbox_mode == "local" else "docs")
        )
    if local_path is not None or local_directory is not None:
        val = local_path if local_path is not None else local_directory
        project.local_path = (val or "").strip() or None
    if git_provider is not None:
        project.git_provider = git_provider if git_provider in ("github", "gitlab", "custom") else None
    if git_repo_url is not None:
        project.git_repo_url = git_repo_url.strip() or None
    if git_branch is not None:
        project.git_branch = git_branch.strip()[:120] or "main"
    if git_token and git_token.strip():
        try:
            from models.credential import KIND_GITHUB_TOKEN
            from services import credential_service

            cred = credential_service.create_user_credential(
                db,
                user.id,
                kind=KIND_GITHUB_TOKEN,
                label=f"Git-Token ({project.name[:40]})",
                secret=git_token.strip(),
            )
            project.git_credential_id = cred.id
        except Exception as exc:
            logger.debug("Konnte Projekt-Git-Token nicht speichern: %s", exc)
    elif clear_git_token:
        project.git_credential_id = None
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
            if d not in {".git", ".singra", "_prod_release", "node_modules", "__pycache__", ".venv", "venv", "dist", "build", "target"}
        ]
        for fname in files:
            if fname == ".singra-env.json":
                continue
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
    if disk_file.is_relative_to(ws.resolve()) and disk_file.is_file():
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


def compute_file_diff(old_content: str | None, new_content: str, path: str, branch: str = "main") -> dict[str, object]:
    """Berechnet einen kompakten Unified-Diff sowie Zeilenstatistiken fuer die Chat- und Editor-Anzeige."""
    import difflib

    is_new = old_content is None
    old_lines = [] if is_new else (old_content or "").splitlines()
    new_lines = (new_content or "").splitlines()

    diff_gen = list(
        difflib.unified_diff(
            old_lines,
            new_lines,
            fromfile=f"a/{path}",
            tofile=f"b/{path}",
            lineterm="",
            n=2,
        )
    )
    added = sum(1 for line in diff_gen if line.startswith("+") and not line.startswith("+++"))
    removed = sum(1 for line in diff_gen if line.startswith("-") and not line.startswith("---"))
    preview_lines = diff_gen[:80]
    return {
        "path": path,
        "branch": branch or "main",
        "is_new_file": is_new,
        "added_lines": added,
        "removed_lines": removed,
        "diff": "\n".join(preview_lines),
        "truncated": len(diff_gen) > 80,
    }


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
    if not disk_file.is_relative_to(ws.resolve()):
        raise AiProjectError("Ungültiger Dateipfad außerhalb des Projektordners")

    row = (
        db.query(AiProjectFile)
        .filter(AiProjectFile.project_id == project.id, AiProjectFile.path == norm)
        .first()
    )
    old_content: str | None = None
    if row is not None:
        old_content = row.content
    elif disk_file.is_file():
        try:
            old_content = disk_file.read_text(encoding="utf-8", errors="replace")
        except OSError:
            old_content = None

    try:
        disk_file.parent.mkdir(parents=True, exist_ok=True)
        disk_file.write_text(content or "", encoding="utf-8")
    except OSError as exc:
        logger.warning("Konnte Projektdatei nicht auf Disk schreiben: %s", exc)

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
    row._last_diff = compute_file_diff(old_content, content or "", norm, branch=project.git_branch or "main")  # type: ignore[attr-defined]
    return row


def patch_project_file(
    db: Session,
    user: User,
    project_id: str,
    rel_path: str,
    edits: list[dict[str, str]],
    *,
    mime_type: str = "text/plain",
) -> tuple[AiProjectFile, int]:
    """Ersetzt gezielt eine oder mehrere Textstellen in einer bestehenden Projektdatei ohne Vollersetzung."""
    if not edits:
        raise AiProjectError("Es wurden keine Ersetzungen angegeben")

    current_file = read_project_file(db, user, project_id, rel_path)
    old_content = current_file.content or ""
    new_content = old_content

    applied_count = 0
    for idx, edit in enumerate(edits, 1):
        find_text = edit.get("find")
        replace_text = edit.get("replace")
        if find_text is None or replace_text is None:
            raise AiProjectError(f"Ersetzung #{idx} muss 'find' und 'replace' enthalten")
        if not find_text:
            raise AiProjectError(f"Suchtext in Ersetzung #{idx} darf nicht leer sein")

        count = new_content.count(find_text)
        if count == 0:
            find_norm = find_text.replace("\r\n", "\n")
            content_norm = new_content.replace("\r\n", "\n")
            if find_norm in content_norm:
                count_norm = content_norm.count(find_norm)
                if count_norm == 1:
                    new_content = content_norm.replace(find_norm, (replace_text or "").replace("\r\n", "\n"), 1)
                    applied_count += 1
                    continue
                elif count_norm > 1:
                    raise AiProjectError(
                        f"Der Suchtext in '{rel_path}' kommt {count_norm}-mal vor. "
                        "Bitte mehr Zeilen Kontext angeben, damit die Stelle eindeutig ist."
                    )
            raise AiProjectError(
                f"Der Suchtext in '{rel_path}' wurde nicht gefunden. "
                "Bitte den exakten Codeausschnitt inklusive Einrückung und Zeilenumbrüchen angeben."
            )
        if count > 1:
            raise AiProjectError(
                f"Der Suchtext in '{rel_path}' kommt {count}-mal vor. "
                "Bitte mehr Zeilen Kontext angeben, damit die Stelle eindeutig ist."
            )

        new_content = new_content.replace(find_text, replace_text, 1)
        applied_count += 1

    updated_file = write_project_file(
        db,
        user,
        project_id,
        rel_path,
        new_content,
        mime_type=mime_type or current_file.mime_type or "text/plain",
    )
    return updated_file, applied_count


def delete_project_file(db: Session, user: User, project_id: str, rel_path: str) -> None:
    project = get_project(db, user, project_id)
    norm = normalize_rel_path(rel_path)
    ws = ensure_project_workspace(project)
    disk_file = (ws / norm).resolve()
    if disk_file.is_relative_to(ws.resolve()) and disk_file.is_file():
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


_ALLOWED_DEV_BINARIES = frozenset({
    "npm", "npx", "yarn", "pnpm", "node", "python", "python3",
    "pip", "pip3", "pytest", "tsc", "vite", "git", "cargo",
    "rustc", "go", "deno", "bun", "make", "gcc", "g++", "clang",
    "echo", "ls", "dir", "cat", "type", "find", "grep", "mkdir",
    "cp", "mv", "rm", "touch", "head", "tail", "wc", "sed", "awk", "diff",
})

_DANGEROUS_PATTERNS = [
    re.compile(r"\b(sudo|su|doas|pkexec|useradd|userdel|usermod|passwd|groupadd)\b", re.I),
    re.compile(r"\b(chmod|chown|chgrp)\b", re.I),
    re.compile(r"\b(shutdown|reboot|poweroff|halt|systemctl|service)\b", re.I),
    re.compile(r"\b(mkfs|fdisk|parted|dd)\b", re.I),
    re.compile(r"\b(nc|netcat|ncat|socat)\b", re.I),
    re.compile(r"\|\s*(ba|z)?sh", re.I),
    re.compile(r"\|\s*(cmd|powershell)", re.I),
    re.compile(r"\b(curl|wget)\b.*\|", re.I),
    re.compile(r"(/etc/|/root/|/proc/|/sys/|/dev/|/boot/|/var/run|C:\\Windows|C:\\Program Files)", re.I),
    re.compile(r"\.\./\.\.", re.I),
    re.compile(r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+/\s*$", re.I),
]


def _split_unquoted_command_segments(cmd: str) -> list[str]:
    """Teilt eine Befehlszeile nur an unquotierten Verkettungsoperatoren (;, &, |)."""
    segments: list[str] = []
    current: list[str] = []
    in_single = False
    in_double = False
    escape = False
    for ch in cmd:
        if escape:
            current.append(ch)
            escape = False
            continue
        if ch == "\\":
            escape = True
            current.append(ch)
            continue
        if ch == "'" and not in_double:
            in_single = not in_single
            current.append(ch)
            continue
        if ch == '"' and not in_single:
            in_double = not in_double
            current.append(ch)
            continue
        if not in_single and not in_double and ch in (";", "&", "|"):
            seg = "".join(current).strip()
            if seg:
                segments.append(seg)
            current = []
        else:
            current.append(ch)
    tail = "".join(current).strip()
    if tail:
        segments.append(tail)
    return segments


def _validate_project_command(cmd: str, ws: Path) -> None:
    trimmed = (cmd or "").strip()
    if not trimmed:
        raise AiProjectError("Befehl darf nicht leer sein")
    for pattern in _DANGEROUS_PATTERNS:
        if pattern.search(trimmed):
            raise AiProjectError("Befehl enthält nicht zugelassene System-Operationen oder Pfade")

    segments = _split_unquoted_command_segments(trimmed)
    for seg in segments:
        seg_clean = seg.strip()
        if not seg_clean:
            continue
        first_token = seg_clean.split()[0].lower()
        binary_name = Path(first_token).name.replace(".exe", "").replace(".cmd", "").replace(".bat", "")
        if binary_name not in _ALLOWED_DEV_BINARIES:
            raise AiProjectError(f"Das Programm '{binary_name}' ist in der Projekt-Sandbox nicht zugelassen")


def _clean_git_remote_url(repo_url: str, provider: str | None) -> str:
    """Erzeugt eine sichere HTTPS-URL mit Benutzer-Präfix aber ohne Passwort/Token."""
    parsed = urlparse(repo_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return repo_url
    user_part = "oauth2" if provider == "gitlab" else "x-access-token"
    netloc = f"{user_part}@{parsed.hostname}"
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


def _prepare_git_askpass_env(env: dict[str, str], token: str | None) -> tuple[dict[str, str], Path | None]:
    """Konfiguriert GIT_ASKPASS und MSM_GIT_TOKEN, damit Tokens nie in argv oder procfs auftauchen."""
    if not token or not token.strip():
        return env, None
    clean_token = token.strip()
    is_windows = os.name == "nt"
    tmp_dir = Path(tempfile.gettempdir())
    if is_windows:
        helper = tmp_dir / "msm_git_askpass.cmd"
        if not helper.exists():
            helper.write_text("@echo %MSM_GIT_TOKEN%\n", encoding="utf-8")
    else:
        helper = tmp_dir / "msm_git_askpass.sh"
        if not helper.exists():
            helper.write_text("#!/bin/sh\necho \"$MSM_GIT_TOKEN\"\n", encoding="utf-8")
            try:
                helper.chmod(0o700)
            except OSError:
                pass

    new_env = dict(env)
    new_env["GIT_ASKPASS"] = str(helper)
    new_env["MSM_GIT_TOKEN"] = clean_token
    new_env["GIT_TERMINAL_PROMPT"] = "0"
    return new_env, helper


def resolve_git_token_for_user(db: Session, user: User, provider: str | None = "github") -> str | None:
    """Ermittelt das persönliche Git-Token des Benutzers sicher aus dem Tresor."""
    try:
        from services import credential_service
        from services.auth_service import AuthService
        from models.credential import KIND_GITHUB_TOKEN

        creds = credential_service.list_user_credentials(db, user.id, kind=KIND_GITHUB_TOKEN)
        for cred in creds:
            try:
                secret = AuthService.decrypt_secret(db, cred.encrypted_secret, aad=credential_service._aad(cred.id))
                if secret and secret.strip():
                    return secret.strip()
            except Exception:
                continue

        try:
            resolved = credential_service.resolve_panel_default(KIND_GITHUB_TOKEN)
            if resolved and resolved.secret and resolved.secret.strip():
                return resolved.secret.strip()
        except Exception:
            pass
    except Exception as exc:
        logger.debug("Konnte Git-Token für Benutzer %s nicht auflösen: %s", user.id, exc)

    return None


def run_project_command(
    db: Session,
    user: User,
    project_id: str,
    command: str,
    *,
    timeout_seconds: int = 25,
) -> dict[str, object]:
    """Fuehrt einen Shell-Befehl isoliert und geprueft im Projekt-Arbeitsverzeichnis aus."""
    project = get_project(db, user, project_id)
    cmd = (command or "").strip()
    if not cmd:
        raise AiProjectError("Befehl darf nicht leer sein")
    ws = ensure_project_workspace(project)
    _validate_project_command(cmd, ws)
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


def verify_project_sandbox(
    db: Session,
    user: User,
    project_id: str,
) -> dict[str, object]:
    """Fuehrt einen mehrstufigen automatischen Selbsttest (inkl. Vorschau-, Happy-Path- und Negativ-Prüfung) aus."""
    import ast
    import json as _json

    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    _materialize_db_files_to_workspace(db, project, ws)
    meta = _ensure_env_metadata(project, ws)
    files = list_project_files(db, user, project.id)

    checks: list[dict[str, object]] = []
    errors: list[str] = []
    warnings: list[str] = []
    existing_paths = {f.path for f in files}
    lower_to_actual = {f.path.lower(): f.path for f in files}

    has_html_entry = False
    has_jsx_entry = False
    test_files_found: list[str] = []
    has_negative_tests = False

    for f in files:
        path = f.path
        lower = path.lower()
        content = f.content or ""

        if "test" in lower or "spec" in lower:
            test_files_found.append(path)
            if re.search(
                r"(invalid|error|fail|empty|missing|unauthorized|forbidden|negativ|ungueltig|ungültig|fehler|throws|raises|reject)",
                content,
                re.I,
            ):
                has_negative_tests = True

        if lower.endswith(".json"):
            try:
                _json.loads(content)
                checks.append({"file": path, "kind": "json", "ok": True})
            except Exception as exc:
                msg = f"{path}: Ungültiges JSON ({exc})"
                errors.append(msg)
                checks.append({"file": path, "kind": "json", "ok": False, "error": str(exc)})

        elif lower.endswith(".py"):
            try:
                ast.parse(content, filename=path)
                checks.append({"file": path, "kind": "python_ast", "ok": True})
            except SyntaxError as exc:
                msg = f"{path}:{exc.lineno}: Python-Syntaxfehler ({exc.msg})"
                errors.append(msg)
                checks.append({"file": path, "kind": "python_ast", "ok": False, "error": msg})

        elif lower.endswith((".js", ".mjs", ".cjs")):
            full_path = ws / path
            is_es_module = bool(re.search(r"^\s*(import|export)\s+", content, re.M))
            if full_path.is_file() and not is_es_module:
                try:
                    proc = subprocess.run(
                        ["node", "--check", str(full_path)],
                        cwd=str(ws),
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=8,
                    )
                    if proc.returncode == 0:
                        checks.append({"file": path, "kind": "node_syntax", "ok": True})
                    else:
                        err_detail = (proc.stderr or proc.stdout or "JS-Syntaxfehler").strip()
                        errors.append(f"{path}: {err_detail[:240]}")
                        checks.append({"file": path, "kind": "node_syntax", "ok": False, "error": err_detail[:240]})
                except Exception:
                    checks.append({"file": path, "kind": "node_syntax", "ok": True, "note": "node --check übersprungen"})
            else:
                checks.append({"file": path, "kind": "es_module_js", "ok": True})

        elif lower.endswith((".jsx", ".tsx", ".ts")):
            has_jsx_entry = True
            open_braces = content.count("{") - content.count("}")
            if abs(open_braces) > 2:
                msg = f"{path}: Unausgeglichene geschweifte Klammern (Differenz: {open_braces})."
                errors.append(msg)
                checks.append({"file": path, "kind": "jsx_structure", "ok": False, "error": msg})
            else:
                checks.append({"file": path, "kind": "jsx_structure", "ok": True})

        elif lower.endswith((".html", ".htm")):
            has_html_entry = True
            if "<html" not in content.lower() and "<!doctype" not in content.lower() and "<body" not in content.lower():
                warnings.append(f"{path}: Enthält kein vollständiges HTML-Grundgerüst (<html>/<body>).")
            for ref_match in re.finditer(r'(?:src|href)=["\'](?![a-z]+://|/|#|data:|mailto:)([^"\'?#]+)', content, re.I):
                rel_ref = ref_match.group(1).strip().lstrip("./")
                if rel_ref and rel_ref not in existing_paths and not rel_ref.lower().endswith((".tsx", ".jsx", ".ts")):
                    warnings.append(f"{path}: Referenziert '{rel_ref}', diese Datei existiert im Projekt noch nicht.")
            checks.append({"file": path, "kind": "html_structure", "ok": True})

        elif lower.endswith(".sql"):
            if not re.search(r"\b(CREATE|ALTER|INSERT|SELECT|UPDATE|DELETE|DROP)\b", content, re.I):
                warnings.append(f"{path}: Keine erkennbaren SQL-Anweisungen gefunden.")
            checks.append({"file": path, "kind": "sql_check", "ok": True})

    # Vorschau-Einstiegspunkt prüfen und ggf. automatisch konfigurieren
    configured_entry = str(meta.get("preview_entry") or "").strip()
    preview_ready = False
    preview_entry_resolved: str | None = None

    if configured_entry and configured_entry.lower() in lower_to_actual:
        preview_entry_resolved = lower_to_actual[configured_entry.lower()]
        preview_ready = True
    else:
        for candidate in ("index.html", "public/index.html", "frontend/index.html", "src/index.html", "src/app.tsx", "src/app.jsx", "app.tsx", "app.jsx"):
            if candidate in lower_to_actual:
                preview_entry_resolved = lower_to_actual[candidate]
                preview_ready = True
                meta["preview_entry"] = preview_entry_resolved
                meta["preview_configured"] = True
                _save_env_metadata(ws, meta)
                break
        if not preview_ready and (has_html_entry or has_jsx_entry):
            first_ui = next(
                (f.path for f in files if f.path.lower().endswith((".html", ".htm", ".tsx", ".jsx"))),
                None,
            )
            if first_ui:
                preview_entry_resolved = first_ui
                preview_ready = True
                meta["preview_entry"] = first_ui
                meta["preview_configured"] = True
                _save_env_metadata(ws, meta)

    if project.project_kind == "coding" and not preview_ready:
        errors.append(
            "Vorschau ist noch nicht lauffähig: Es fehlt eine index.html oder React-Einstiegsdatei (App.jsx / App.tsx). "
            "Bitte lege eine index.html an und konfiguriere die Vorschau mit action='configure_preview'."
        )

    if project.project_kind == "coding":
        if not test_files_found:
            warnings.append(
                "Es wurden noch keine dedizierten Testdateien (tests/) gefunden. "
                "Bitte lege Tests für Happy-Path (Gutfall) und Negative-Path (Fehleingaben/Grenzwerte) an."
            )
        elif not has_negative_tests:
            warnings.append(
                "In den Testdateien fehlen erkennbare Negativ-Tests (ungültige Eingaben, leere Felder, Fehlerfälle). "
                "Bitte ergänze Negativ-Testfälle."
            )

    return {
        "ok": len(errors) == 0 and (preview_ready or project.project_kind != "coding"),
        "project_id": project.id,
        "preview_ready": preview_ready,
        "preview_entry": preview_entry_resolved,
        "happy_path_and_negative_tests_checked": bool(test_files_found and has_negative_tests),
        "test_files": test_files_found,
        "checked_files": len(checks),
        "errors_count": len(errors),
        "warnings_count": len(warnings),
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
    }


def git_status(db: Session, user: User, project_id: str) -> dict[str, object]:
    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    git_dir = ws / ".git"
    if not git_dir.exists():
        return {
            "initialized": False,
            "branch": project.git_branch or "main",
            "repo_url": project.git_repo_url,
            "remote_url": project.git_repo_url,
            "provider": project.git_provider,
            "clean": True,
            "changed_files": [],
            "ahead": 0,
            "behind": 0,
            "last_commit": None,
            "status_short": "",
            "diff_stat": "",
        }
    try:
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
        log_res = subprocess.run(
            ["git", "log", "-1", "--format=%h %s (%cr)"],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        changed_files = [line.strip() for line in (status_res.stdout or "").splitlines() if line.strip()]
        return {
            "initialized": True,
            "branch": (branch_res.stdout or "").strip() or project.git_branch or "main",
            "repo_url": project.git_repo_url,
            "remote_url": project.git_repo_url,
            "provider": project.git_provider,
            "clean": len(changed_files) == 0,
            "changed_files": changed_files,
            "ahead": 0,
            "behind": 0,
            "last_commit": (log_res.stdout or "").strip() or None,
            "status_short": (status_res.stdout or "")[:8000],
            "diff_stat": (diff_res.stdout or "")[:8000],
        }
    except OSError as exc:
        raise AiProjectError(f"Git-Befehl fehlgeschlagen: {exc}") from exc


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

    effective_token = token or resolve_git_token_for_user(db, user, project.git_provider)
    clean_auth_url = _clean_git_remote_url(target_url, project.git_provider) if effective_token else target_url
    ws = ensure_project_workspace(project)
    git_dir = ws / ".git"
    base_env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
    }
    env, _ = _prepare_git_askpass_env(base_env, effective_token)
    target_branch = project.git_branch or "main"
    if not git_dir.exists():
        # Klonen in ein temporäres Unterverzeichnis und Inhalt verschieben, falls ws bereits existiert
        tmp_clone = ws.parent / f"clone_{project.id}_{int(datetime.now(timezone.utc).timestamp())}"
        try:
            res = subprocess.run(
                ["git", "clone", "--depth", "50", "--branch", target_branch, clean_auth_url, str(tmp_clone)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                timeout=45,
            )
            if res.returncode != 0:
                res = subprocess.run(
                    ["git", "clone", "--depth", "50", clean_auth_url, str(tmp_clone)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=env,
                    timeout=45,
                )
            if res.returncode != 0:
                stderr_clean = (res.stderr or "")
                if effective_token:
                    stderr_clean = stderr_clean.replace(effective_token, "***")
                raise AiProjectError(f"Git-Clone fehlgeschlagen: {stderr_clean[:400]}")
            for item in tmp_clone.iterdir():
                dest = ws / item.name
                if dest.exists():
                    if dest.is_dir():
                        shutil.rmtree(dest, ignore_errors=True)
                    else:
                        dest.unlink(missing_ok=True)
                shutil.move(str(item), str(dest))
            # Remote-URL immer sauber ohne Authentifizierungsteile hinterlegen
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
            ["git", "pull", clean_auth_url, target_branch],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=45,
        )
        if res.returncode != 0:
            stderr_clean = (res.stderr or "")
            if effective_token:
                stderr_clean = stderr_clean.replace(effective_token, "***")
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

    effective_token = token or resolve_git_token_for_user(db, user, project.git_provider)
    base_env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_AUTHOR_NAME": user.username or "Singra AI",
        "GIT_AUTHOR_EMAIL": user.email or "singra@mauntingstudios.de",
        "GIT_COMMITTER_NAME": user.username or "Singra AI",
        "GIT_COMMITTER_EMAIL": user.email or "singra@mauntingstudios.de",
    }
    env, _ = _prepare_git_askpass_env(base_env, effective_token)

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
        clean_auth_url = _clean_git_remote_url(project.git_repo_url, project.git_provider) if effective_token else project.git_repo_url
        target_branch = project.git_branch or "main"
        push_res = subprocess.run(
            ["git", "push", clean_auth_url, f"HEAD:{target_branch}"],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=45,
        )
        push_output = ((push_res.stdout or "") + "\n" + (push_res.stderr or "")).strip()
        if effective_token:
            push_output = push_output.replace(effective_token, "***")
        if push_res.returncode != 0:
            raise AiProjectError(f"Git-Push fehlgeschlagen: {push_output[:400]}")

    status = git_status(db, user, project.id)
    commit_clean = ((commit_res.stdout or "") + "\n" + (commit_res.stderr or "")).strip()[:4000]
    if effective_token:
        commit_clean = commit_clean.replace(effective_token, "***")
    status["commit_output"] = commit_clean
    status["push_output"] = push_output[:4000]
    return status


def git_create_remote_repository(
    db: Session,
    user: User,
    project_id: str,
    *,
    repo_name: str | None = None,
    private: bool = True,
    description: str | None = None,
    provider: str = "github",
    token: str | None = None,
) -> dict[str, object]:
    """Erstellt ein neues GitHub- oder GitLab-Repository und verknüpft es direkt mit dem Projekt."""
    import json as _json
    import urllib.error as _urlerror
    import urllib.request as _urlrequest

    project = get_project(db, user, project_id)
    target_provider = provider if provider in ("github", "gitlab") else (project.git_provider or "github")
    effective_token = (token or "").strip() or resolve_git_token_for_user(db, user, target_provider)
    if not effective_token:
        raise AiProjectError(
            "Kein GitHub/GitLab-Token hinterlegt. Bitte gib ein Personal Access Token an oder speichere es im Schlüsselbund."
        )

    raw_name = (repo_name or project.name or "singra-project").strip()
    clean_repo_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", raw_name).strip("-._") or "singra-project"
    clean_desc = (description if description is not None else (project.description or "")).strip()[:350]

    clone_url = ""
    html_url = ""
    try:
        if target_provider == "gitlab":
            payload_bytes = _json.dumps(
                {
                    "name": clean_repo_name,
                    "visibility": "private" if private else "public",
                    "description": clean_desc,
                }
            ).encode("utf-8")
            req = _urlrequest.Request(
                "https://gitlab.com/api/v4/projects",
                data=payload_bytes,
                headers={
                    "PRIVATE-TOKEN": effective_token,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "MauntingServerManager-Singra",
                },
                method="POST",
            )
            with _urlrequest.urlopen(req, timeout=20) as resp:
                data = _json.loads(resp.read().decode("utf-8", errors="replace"))
                clone_url = str(data.get("http_url_to_repo") or "").strip()
                html_url = str(data.get("web_url") or clone_url).strip()
        else:
            payload_bytes = _json.dumps(
                {
                    "name": clean_repo_name,
                    "private": bool(private),
                    "description": clean_desc,
                    "auto_init": False,
                }
            ).encode("utf-8")
            req = _urlrequest.Request(
                "https://api.github.com/user/repos",
                data=payload_bytes,
                headers={
                    "Authorization": f"Bearer {effective_token}",
                    "Accept": "application/vnd.github+json",
                    "Content-Type": "application/json",
                    "User-Agent": "MauntingServerManager-Singra",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                method="POST",
            )
            with _urlrequest.urlopen(req, timeout=20) as resp:
                data = _json.loads(resp.read().decode("utf-8", errors="replace"))
                clone_url = str(data.get("clone_url") or "").strip()
                html_url = str(data.get("html_url") or clone_url).strip()
    except _urlerror.HTTPError as exc:
        err_body = ""
        try:
            err_body = exc.read().decode("utf-8", errors="replace")
            parsed_err = _json.loads(err_body)
            msg = parsed_err.get("message") or err_body
            errors_list = parsed_err.get("errors")
            if isinstance(errors_list, list) and errors_list:
                details = ", ".join(
                    str(item.get("message") or item) if isinstance(item, dict) else str(item)
                    for item in errors_list
                )
                msg = f"{msg} ({details})"
        except Exception:
            msg = err_body or str(exc)
        if effective_token:
            msg = msg.replace(effective_token, "***")
        raise AiProjectError(f"Repository konnte nicht erstellt werden (HTTP {exc.code}): {msg[:300]}") from exc
    except Exception as exc:
        msg = str(exc)
        if effective_token:
            msg = msg.replace(effective_token, "***")
        raise AiProjectError(f"Repository konnte nicht erstellt werden: {msg[:300]}") from exc

    if not clone_url:
        raise AiProjectError("Vom Git-Anbieter wurde keine gültige Repository-URL zurückgegeben.")

    project.git_provider = target_provider
    project.git_repo_url = clone_url
    project.git_branch = (project.git_branch or "main").strip() or "main"
    project.updated_at = datetime.now(timezone.utc)
    db.commit()

    ws = ensure_project_workspace(project)
    _materialize_db_files_to_workspace(db, project, ws)
    readme_path = ws / "README.md"
    if not any(ws.iterdir()) or (not readme_path.exists() and not (ws / ".git").exists()):
        readme_content = f"# {project.name}\n\n{project.description or 'Erstellt mit Singra.'}\n"
        write_project_file(
            db,
            user,
            project.id,
            rel_path="README.md",
            content=readme_content,
            mime_type="text/markdown",
        )

    git_dir = ws / ".git"
    base_env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_AUTHOR_NAME": user.username or "Singra AI",
        "GIT_AUTHOR_EMAIL": user.email or "singra@mauntingstudios.de",
        "GIT_COMMITTER_NAME": user.username or "Singra AI",
        "GIT_COMMITTER_EMAIL": user.email or "singra@mauntingstudios.de",
    }
    env, _ = _prepare_git_askpass_env(base_env, effective_token)
    target_branch = project.git_branch or "main"

    if not git_dir.exists():
        subprocess.run(["git", "init", "-b", target_branch], cwd=str(ws), capture_output=True, env=env, timeout=10)
    subprocess.run(["git", "remote", "remove", "origin"], cwd=str(ws), capture_output=True, env=env, timeout=10)
    subprocess.run(["git", "remote", "add", "origin", clone_url], cwd=str(ws), capture_output=True, env=env, timeout=10)
    subprocess.run(["git", "add", "-A"], cwd=str(ws), capture_output=True, env=env, timeout=15)
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=str(ws),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=15,
    )
    clean_auth_url = _clean_git_remote_url(clone_url, target_provider)
    subprocess.run(
        ["git", "push", "-u", clean_auth_url, f"HEAD:{target_branch}"],
        cwd=str(ws),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=45,
    )

    status = git_status(db, user, project.id)
    status["repo_url"] = clone_url
    status["remote_url"] = clone_url
    status["html_url"] = html_url
    status["created"] = True
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


def _env_meta_path(ws: Path) -> Path:
    return ws / ".singra-env.json"


def _ensure_env_metadata(
    project: AiProject,
    ws: Path,
    *,
    project_kind: str | None = None,
) -> dict[str, object]:
    """Liest oder initialisiert die Dev-/Produktions-Metadaten (inkl. PostgreSQL-Branching)."""
    import json as _json

    meta_file = _env_meta_path(ws)
    short_id = re.sub(r"[^a-zA-Z0-9]", "", project.id)[:8].lower() or "app"
    kind = project_kind or project.project_kind
    default_meta: dict[str, object] = {
        "active_environment": "dev",
        "project_kind": kind,
        "dev_branch": "dev",
        "prod_branch": project.git_branch or "main",
        "db_engine": "postgresql",
        "dev_db_branch": f"pg_dev_{short_id}",
        "prod_db_branch": f"pg_prod_{short_id}",
        "db_status": "ready" if kind == "coding" else "disabled",
        "db_migrations_pending": 0,
        "db_migrations_applied": 0,
        "prod_published": False,
        "prod_version": 0,
        "prod_server_id": None,
        "prod_node_id": None,
        "prod_node_name": None,
        "prod_published_at": None,
        "prod_release_notes": None,
    }
    if meta_file.is_file():
        try:
            loaded = _json.loads(meta_file.read_text(encoding="utf-8", errors="replace"))
            if isinstance(loaded, dict):
                merged = {**default_meta, **loaded}
                merged["prod_branch"] = project.git_branch or merged.get("prod_branch") or "main"
                return merged
        except Exception:
            pass
    try:
        meta_file.write_text(_json.dumps(default_meta, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass
    return default_meta


def _save_env_metadata(ws: Path, meta: dict[str, object]) -> None:
    import json as _json

    try:
        _env_meta_path(ws).write_text(_json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _seed_initial_agents_md_if_missing(
    db: Session,
    user: User,
    project: AiProject,
    ws: Path,
) -> None:
    """Legt bei neuen Coding-Projekten automatisch eine saubere AGENTS.md und README.md an."""
    existing_count = db.query(AiProjectFile).filter(AiProjectFile.project_id == project.id).count()
    if existing_count > 0:
        return

    agents_content = f"""\
# {project.name} — Architektur- & Qualitätsregeln (AGENTS.md)

## 1. Grundsätze (KISS & Anti-AI-Slop)
- **KISS-Prinzip:** Einfache, klare und nachvollziehbare Architektur ohne unnötige Abstraktionsschichten.
- **Modulare Wiederverwendbarkeit:** UI-Bausteine (`src/components/`), Hilfsfunktionen (`src/lib/`) und Datenmodelle werden modular aufgebaut und projektweit (sowie projektübergreifend) wiederverwendet.
- **Saubere Trennung:** Darstellung, Geschäftslogik und Datenbankzugriffe (PostgreSQL) bleiben strikt getrennt.
- **Pflicht-Tests vor Abschluss:** Jede Änderung wird in der Dev-Umgebung geprüft, bevor sie für die Produktion freigegeben wird.

## 2. Verzeichnisstruktur
- `src/components/` — Wiederverwendbare UI-Komponenten (z. B. Buttons, Eingabeleisten, Karten, Dialoge)
- `src/lib/` — Gemeinsame Logik, API-Helfer und Formatierungen
- `migrations/` — PostgreSQL-Datenbankmigrationen (Dev-Branch → Prod-Branch)
- `docs/` — Weiterführende Dokumentation
"""
    readme_content = f"""\
# {project.name}

{project.description or 'Modulares Entwicklungsprojekt in Singra.'}

## Umgebungen
- **Entwicklung (Dev):** Isolierte Sandbox mit eigenem PostgreSQL-Entwicklungs-Branch (`dev`).
- **Produktion (Live):** Veröffentlichte Instanz auf dem gewählten Server-Node (`{project.git_branch or 'main'}`).
"""
    try:
        write_project_file(db, user, project.id, "AGENTS.md", agents_content, mime_type="text/markdown")
        write_project_file(db, user, project.id, "README.md", readme_content, mime_type="text/markdown")
    except Exception:
        pass


def get_project_environment(
    db: Session,
    user: User,
    project_id: str,
) -> dict[str, object]:
    """Liefert den vollständigen Status von Dev- und Produktions-Umgebung samt PostgreSQL-Branches und Nodes."""
    from models import Node, Server

    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    meta = _ensure_env_metadata(project, ws)

    files = list_project_files(db, user, project.id)
    migration_files = [
        f.path
        for f in files
        if f.path.lower().endswith(".sql") or f.path.lower().startswith("migrations/")
    ]
    applied_count = int(meta.get("db_migrations_applied") or 0)
    pending_migrations = max(len(migration_files) - applied_count, 0)

    # Verfügbare Nodes aus der DB laden
    nodes_rows = db.query(Node).order_by(Node.is_local.desc(), Node.id.asc()).all()
    available_nodes = [
        {
            "id": n.id,
            "name": n.name,
            "host": n.host,
            "is_local": bool(n.is_local),
            "status": n.status or "online",
        }
        for n in nodes_rows
    ]
    if not available_nodes:
        available_nodes = [
            {
                "id": 0,
                "name": "Lokaler Haupt-Node (Standard)",
                "host": "127.0.0.1",
                "is_local": True,
                "status": "online",
            }
        ]

    # Prüfen, ob der Produktions-Server im Dashboard noch existiert
    prod_server_id = meta.get("prod_server_id")
    prod_server_status = None
    if isinstance(prod_server_id, int) and prod_server_id > 0:
        srv = db.get(Server, prod_server_id)
        if srv is not None:
            prod_server_status = srv.status
        else:
            meta["prod_server_id"] = None
            meta["prod_published"] = False
            _save_env_metadata(ws, meta)

    # Geänderte Dateien zwischen Dev und veröffentlichtem Produktions-Snapshot zählen
    prod_dir = ws / "_prod_release"
    unreleased_files: list[str] = []
    if bool(meta.get("prod_published")) and prod_dir.is_dir():
        for f in files:
            p_file = prod_dir / f.path
            if not p_file.is_file():
                unreleased_files.append(f.path)
            else:
                try:
                    if p_file.read_text(encoding="utf-8", errors="replace") != f.content:
                        unreleased_files.append(f.path)
                except OSError:
                    unreleased_files.append(f.path)
    else:
        unreleased_files = [f.path for f in files]

    return {
        "project_id": project.id,
        "active_environment": str(meta.get("active_environment") or "dev"),
        "dev": {
            "status": "running",
            "branch": str(meta.get("dev_branch") or "dev"),
            "db_engine": "PostgreSQL",
            "db_branch": str(meta.get("dev_db_branch") or f"pg_dev_{project.id[:8]}"),
            "file_count": len(files),
            "pending_migrations": pending_migrations,
            "unreleased_changes_count": len(unreleased_files),
            "unreleased_files": unreleased_files[:25],
        },
        "production": {
            "published": bool(meta.get("prod_published")),
            "version": int(meta.get("prod_version") or 0),
            "mode": str(meta.get("prod_mode") or "frontend"),
            "branch": str(project.git_branch or meta.get("prod_branch") or "main"),
            "db_engine": "PostgreSQL",
            "db_branch": str(meta.get("prod_db_branch") or f"pg_prod_{project.id[:8]}"),
            "migrations_applied": applied_count,
            "server_id": meta.get("prod_server_id"),
            "frontend_server_id": meta.get("prod_frontend_server_id"),
            "backend_server_id": meta.get("prod_backend_server_id"),
            "web_url": meta.get("prod_web_url"),
            "api_path": meta.get("prod_api_path") or "/api/*",
            "backend_url": meta.get("prod_backend_url"),
            "frontend_port": meta.get("prod_frontend_port"),
            "backend_port": meta.get("prod_backend_port"),
            "db_configured": bool(meta.get("prod_db_configured")),
            "server_status": prod_server_status or ("running" if meta.get("prod_published") else "not_deployed"),
            "node_id": meta.get("prod_node_id"),
            "node_name": meta.get("prod_node_name"),
            "published_at": meta.get("prod_published_at"),
            "release_notes": meta.get("prod_release_notes"),
        },
        "preview": {
            "configured": bool(meta.get("preview_configured")),
            "entry_file": meta.get("preview_entry"),
            "framework": str(meta.get("preview_framework") or "auto"),
            "port": int(meta.get("preview_port") or 3000),
            "healthcheck_path": str(meta.get("preview_healthcheck") or "/"),
        },
        "available_nodes": available_nodes,
    }


def configure_project_preview(
    db: Session,
    user: User,
    project_id: str,
    *,
    entry_file: str | None = None,
    framework: str | None = None,
    port: int | None = None,
    healthcheck_path: str | None = None,
) -> dict[str, object]:
    """Konfiguriert die Live-Vorschau des Projekts (Einstiegsdatei, Framework, Port, Healthcheck)."""
    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    meta = _ensure_env_metadata(project, ws)
    files = list_project_files(db, user, project.id)
    lower_to_actual = {f.path.lower(): f.path for f in files}

    resolved_entry = (entry_file or "").strip()
    if resolved_entry and resolved_entry.lower() in lower_to_actual:
        resolved_entry = lower_to_actual[resolved_entry.lower()]
    elif not resolved_entry:
        for candidate in ("index.html", "public/index.html", "frontend/index.html", "src/index.html", "src/app.tsx", "src/app.jsx", "app.tsx", "app.jsx"):
            if candidate in lower_to_actual:
                resolved_entry = lower_to_actual[candidate]
                break

    meta["preview_configured"] = True
    if resolved_entry:
        meta["preview_entry"] = resolved_entry
    if framework:
        meta["preview_framework"] = str(framework).strip().lower()
    if port and int(port) > 0:
        meta["preview_port"] = int(port)
    if healthcheck_path:
        meta["preview_healthcheck"] = str(healthcheck_path).strip()
    _save_env_metadata(ws, meta)

    return {
        "ok": True,
        "project_id": project.id,
        "preview": {
            "configured": True,
            "entry_file": meta.get("preview_entry"),
            "framework": str(meta.get("preview_framework") or "auto"),
            "port": int(meta.get("preview_port") or 3000),
            "healthcheck_path": str(meta.get("preview_healthcheck") or "/"),
        },
    }


def inspect_project_preview(
    db: Session,
    user: User,
    project_id: str,
    viewports: list[str] | None = None,
    interactions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Fuehrt eine visuelle Headless-Sichtpruefung der Projekt-Vorschau durch (Mobile & Desktop)."""
    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    meta = _ensure_env_metadata(project, ws)
    files = list_project_files(db, user, project.id)
    file_dicts = [{"path": f.path, "content": f.content} for f in files]

    configured_entry = meta.get("preview_entry")
    from services import ai_preview_inspector

    res = ai_preview_inspector.inspect_project_preview_viewports(
        file_dicts,
        configured_entry=configured_entry,
        viewports=viewports,
        interactions=interactions,
    )
    res["project_id"] = project.id
    res["project_name"] = project.name
    return res


def switch_project_environment(
    db: Session,
    user: User,
    project_id: str,
    environment: str,
) -> dict[str, object]:
    """Schaltet die aktive Arbeits-/Vorschau-Ansicht zwischen 'dev' und 'production' um."""
    if environment not in ("dev", "production"):
        raise AiProjectError("Ungültige Umgebung. Erlaubt sind 'dev' oder 'production'.")
    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    meta = _ensure_env_metadata(project, ws)
    if environment == "production" and not meta.get("prod_published"):
        raise AiProjectError(
            "Dieses Projekt wurde noch nicht auf Produktion veröffentlicht. Schalte es zuerst online."
        )
    meta["active_environment"] = environment
    _save_env_metadata(ws, meta)
    return get_project_environment(db, user, project_id)


def publish_project_to_production(
    db: Session,
    user: User,
    project_id: str,
    *,
    node_id: int | str | None = None,
    release_notes: str | None = None,
    mode: str | None = None,
    domain: str | None = None,
    enable_database: bool | None = None,
    backend_proxy_url: str | None = None,
    api_path: str | None = None,
) -> dict[str, object]:
    """Veröffentlicht das Projekt auf Produktion mit Blueprint-Zuordnung, Caddy-VHost und optionaler PostgreSQL-Datenbank."""
    from models import Node, Server, ServerPermission, PostgresDatabase
    from games.base import container_name_for
    from services.port_allocation_service import allocate_ports
    from services import caddy_service

    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    meta = _ensure_env_metadata(project, ws)
    files = list_project_files(db, user, project.id)
    if not files:
        raise AiProjectError("Das Projekt enthält noch keine Dateien zum Veröffentlichen.")

    # 1. Komponenten- und Architektur-Analyse
    has_frontend = any(
        f.path.lower().endswith((".html", ".jsx", ".tsx", ".vue", ".svelte"))
        or f.path.lower() in ("vite.config.ts", "vite.config.js", "index.html")
        for f in files
    )
    has_backend = any(
        f.path.lower().endswith((".py", ".php", ".rb", ".go", ".rs"))
        or f.path.lower() in ("server.js", "app.js", "main.py", "requirements.txt")
        or f.path.lower().startswith(("api/", "server/", "backend/"))
        for f in files
    )
    for f in files:
        if f.path.lower() == "package.json" and f.content:
            c_low = f.content.lower()
            if any(term in c_low for term in ('"express"', '"fastify"', '"koa"', '"nest"', '"hono"', '"server"', '"pg"', '"prisma"')):
                has_backend = True

    chosen_mode = (mode or "auto").strip().lower()
    if chosen_mode in ("frontend", "backend", "fullstack_split"):
        effective_mode = chosen_mode
    elif has_frontend and has_backend:
        effective_mode = "fullstack_split"
    elif has_backend:
        effective_mode = "backend"
    else:
        effective_mode = "frontend"

    # Datenbank-Bedarf ermitteln
    if enable_database is None:
        db_keywords = ("postgresql", "postgres", "psycopg", "prisma", "database_url")
        has_db_indicators = any(
            f.path.lower().endswith(".sql")
            or f.path.lower().startswith("migrations/")
            or (f.content and any(kw in f.content.lower() for kw in db_keywords))
            for f in files
        )
        enable_database = bool(has_db_indicators and effective_mode in ("backend", "fullstack_split"))

    # 2. Ziel-Node auflösen
    chosen_node: Node | None = None
    parsed_node_id: int | None = None
    if node_id is not None:
        if isinstance(node_id, int) and node_id > 0:
            parsed_node_id = node_id
        elif isinstance(node_id, str):
            node_str = node_id.strip()
            if node_str and node_str.lower() not in ("__auto__", "auto", "local", "none", "0"):
                if node_str.isdigit():
                    parsed_node_id = int(node_str)
                else:
                    node_by_name = db.query(Node).filter(Node.name.ilike(node_str)).first()
                    if node_by_name is not None:
                        chosen_node = node_by_name

    if chosen_node is None and parsed_node_id is not None and parsed_node_id > 0:
        chosen_node = db.get(Node, parsed_node_id)
        if chosen_node is None:
            raise AiProjectError(f"Der ausgewählte Node #{parsed_node_id} wurde nicht gefunden.")

    if chosen_node is None:
        chosen_node = db.query(Node).order_by(Node.is_local.desc(), Node.id.asc()).first()

    effective_node_id = chosen_node.id if chosen_node is not None else None
    effective_node_name = chosen_node.name if chosen_node is not None else "Lokaler Haupt-Node"

    # 3. Dateien in das Produktions-Release-Verzeichnis spiegeln
    prod_dir = ws / "_prod_release"
    if prod_dir.exists():
        shutil.rmtree(prod_dir, ignore_errors=True)
    prod_dir.mkdir(parents=True, exist_ok=True)

    migration_files: list[str] = []
    for f in files:
        target = (prod_dir / f.path).resolve()
        if not target.is_relative_to(prod_dir.resolve()):
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(f.content or "", encoding="utf-8")
        if f.path.lower().endswith(".sql") or f.path.lower().startswith("migrations/"):
            migration_files.append(f.path)

    fe_sub = prod_dir / "frontend"
    be_sub = prod_dir / "backend"
    if fe_sub.is_dir() and be_sub.is_dir():
        frontend_dir = fe_sub
        backend_dir = be_sub
    else:
        frontend_dir = prod_dir
        backend_dir = prod_dir

    now = datetime.now(timezone.utc)
    next_version = int(meta.get("prod_version") or 0) + 1

    # 4. Backend-Server bereitstellen (bei Backend oder getrenntem Fullstack)
    backend_server: Server | None = None
    be_port: int | None = None
    db_credentials: dict[str, Any] | None = None

    if effective_mode in ("backend", "fullstack_split"):
        is_python = any(
            f.path.lower().endswith(".py") or f.path.lower() == "requirements.txt"
            for f in files
        )
        backend_bp = "python_backend" if is_python else "node_backend"
        existing_be_id = meta.get("prod_backend_server_id") or (
            meta.get("prod_server_id") if effective_mode == "backend" else None
        )
        if isinstance(existing_be_id, int) and existing_be_id > 0:
            backend_server = db.get(Server, existing_be_id)

        be_name = (
            f"{project.name} (Backend)"[:120]
            if effective_mode == "fullstack_split"
            else project.name[:120]
        )
        if backend_server is None:
            try:
                allocated_be = allocate_ports(
                    db,
                    bind_ip="0.0.0.0",
                    port_requirements=[("web", "tcp")],
                    node_id=effective_node_id,
                    check_host=bool(chosen_node is None or chosen_node.is_local),
                )
                be_port = allocated_be[0][1] if allocated_be else 5001
            except Exception:
                be_port = 5001

            backend_server = Server(
                name=be_name,
                game_type=backend_bp,
                install_dir=str(backend_dir),
                node_id=effective_node_id,
                status="running",
                status_message=f"Singra Backend v{next_version} ({effective_node_name})",
                desired_power_state="running",
                guardian_observed_state="healthy",
                last_started_at=now,
            )
            db.add(backend_server)
            db.flush()
            backend_server.container_name = container_name_for(backend_server.id)
            backend_server.set_port("web", be_port, "tcp")
            db.add(
                ServerPermission(
                    user_id=user.id,
                    server_id=backend_server.id,
                    permission_key="*",
                )
            )
        else:
            backend_server.name = be_name
            backend_server.game_type = backend_bp
            backend_server.install_dir = str(backend_dir)
            backend_server.node_id = effective_node_id
            backend_server.status = "running"
            backend_server.status_message = f"Singra Backend v{next_version} ({effective_node_name})"
            backend_server.desired_power_state = "running"
            backend_server.last_started_at = now
            be_ports = [p.port for p in (backend_server.ports or []) if p.role == "web"]
            be_port = be_ports[0] if be_ports else 5001

        # Automatische PostgreSQL-Datenbank provisionieren
        if enable_database:
            from services import postgres_service

            existing_db = (
                db.query(PostgresDatabase)
                .filter(PostgresDatabase.server_id == backend_server.id)
                .first()
            )
            if not existing_db:
                try:
                    new_dbs = postgres_service.provision_server_databases(db, backend_server, 1)
                    if new_dbs:
                        db_credentials = new_dbs[0]
                except Exception as exc:
                    logger.warning(
                        "Postgres-Provisionierung fuer Server %s fehlgeschlagen (Cluster nicht bereit): %s",
                        backend_server.id,
                        exc,
                    )

        # .env-Datei fuer das Backend schreiben
        env_lines = [f"PORT={be_port}"]
        if db_credentials:
            env_lines.extend(
                [
                    f"DATABASE_URL={db_credentials.get('connection_string', '')}",
                    f"PGHOST={db_credentials.get('host', '127.0.0.1')}",
                    f"PGPORT={db_credentials.get('port', 5432)}",
                    f"PGDATABASE={db_credentials.get('database', '')}",
                    f"PGUSER={db_credentials.get('user', '')}",
                    f"PGPASSWORD={db_credentials.get('password', '')}",
                ]
            )
        try:
            (backend_dir / ".env").write_text("\n".join(env_lines) + "\n", encoding="utf-8")
        except OSError:
            pass

    # 5. Frontend-Server bereitstellen (bei Frontend oder getrenntem Fullstack)
    frontend_server: Server | None = None
    fe_port: int | None = None

    if effective_mode in ("frontend", "fullstack_split"):
        existing_fe_id = meta.get("prod_frontend_server_id") or (
            meta.get("prod_server_id") if effective_mode == "frontend" else None
        )
        if isinstance(existing_fe_id, int) and existing_fe_id > 0:
            frontend_server = db.get(Server, existing_fe_id)

        fe_name = (
            f"{project.name} (Frontend)"[:120]
            if effective_mode == "fullstack_split"
            else project.name[:120]
        )
        if frontend_server is None:
            try:
                allocated_fe = allocate_ports(
                    db,
                    bind_ip="0.0.0.0",
                    port_requirements=[("web", "tcp")],
                    node_id=effective_node_id,
                    check_host=bool(chosen_node is None or chosen_node.is_local),
                )
                fe_port = allocated_fe[0][1] if allocated_fe else 8080
            except Exception:
                fe_port = 8080

            frontend_server = Server(
                name=fe_name,
                game_type="web_static",
                install_dir=str(frontend_dir),
                node_id=effective_node_id,
                status="running",
                status_message=f"Singra Frontend v{next_version} ({effective_node_name})",
                desired_power_state="running",
                guardian_observed_state="healthy",
                container_name="caddy-managed",
                last_started_at=now,
            )
            db.add(frontend_server)
            db.flush()
            frontend_server.set_port("web", fe_port, "tcp")
            db.add(
                ServerPermission(
                    user_id=user.id,
                    server_id=frontend_server.id,
                    permission_key="*",
                )
            )
        else:
            frontend_server.name = fe_name
            frontend_server.game_type = "web_static"
            frontend_server.install_dir = str(frontend_dir)
            frontend_server.node_id = effective_node_id
            frontend_server.status = "running"
            frontend_server.status_message = f"Singra Frontend v{next_version} ({effective_node_name})"
            frontend_server.desired_power_state = "running"
            frontend_server.container_name = "caddy-managed"
            frontend_server.last_started_at = now
            fe_ports = [p.port for p in (frontend_server.ports or []) if p.role == "web"]
            fe_port = fe_ports[0] if fe_ports else 8080

        # Caddy VHost konfigurieren
        effective_proxy_url = None
        if effective_mode == "fullstack_split" and be_port:
            effective_proxy_url = f"127.0.0.1:{be_port}"
        elif backend_proxy_url:
            effective_proxy_url = backend_proxy_url

        effective_api_path = api_path or "/api/*"
        web_root = str(frontend_dir / "dist") if (frontend_dir / "dist").is_dir() else str(frontend_dir)

        caddy_cfg = caddy_service.generate_caddy_config(
            frontend_server.id,
            web_root,
            server_name=frontend_server.name,
            domain=domain,
            port=fe_port,
            backend_proxy_url=effective_proxy_url,
            api_path=effective_api_path,
        )
        caddy_service.apply_vhost(frontend_server.id, caddy_cfg, node=chosen_node)

        # Cloudflare DNS automatisieren, falls Domain angegeben und Token konfiguriert
        clean_domain = (domain or "").strip()
        if clean_domain:
            from services import cloudflare_service

            if cloudflare_service.is_configured():
                import asyncio
                public_ip = getattr(chosen_node, "public_bind_ip", None) or "127.0.0.1"
                try:
                    asyncio.run(
                        cloudflare_service.create_dns_record(
                            zone_id=None,
                            name=clean_domain,
                            rtype="A",
                            content=public_ip,
                            proxied=True,
                        )
                    )
                except Exception as cf_err:
                    logger.warning(
                        "Cloudflare DNS-Record fuer %s konnte nicht gesetzt werden: %s",
                        clean_domain,
                        cf_err,
                    )

    # 6. Live-URL ermitteln
    primary_server = frontend_server or backend_server
    assert primary_server is not None
    node_ip = getattr(chosen_node, "public_bind_ip", None) or "127.0.0.1"
    clean_domain = (domain or "").strip()
    if clean_domain:
        live_web_url = f"https://{clean_domain}"
    elif frontend_server and fe_port:
        live_web_url = f"http://{node_ip}:{fe_port}"
    elif backend_server and be_port:
        live_web_url = f"http://{node_ip}:{be_port}"
    else:
        live_web_url = f"http://{node_ip}"

    # 7. Git-Commit & Push falls verknuepft
    try:
        git_commit_and_push(
            db,
            user,
            project.id,
            message=release_notes or f"Release v{next_version} ({effective_mode})",
            push=bool(project.git_repo_url),
        )
    except Exception:
        pass

    # 8. Metadaten sichern
    meta["prod_published"] = True
    meta["prod_version"] = next_version
    meta["prod_mode"] = effective_mode
    meta["prod_server_id"] = primary_server.id
    meta["prod_frontend_server_id"] = frontend_server.id if frontend_server else None
    meta["prod_backend_server_id"] = backend_server.id if backend_server else None
    meta["prod_web_url"] = live_web_url
    meta["prod_frontend_port"] = fe_port if frontend_server else None
    meta["prod_backend_port"] = be_port if backend_server else None
    meta["prod_api_path"] = (api_path or "/api/*") if frontend_server else None
    meta["prod_backend_url"] = (
        f"127.0.0.1:{be_port}" if effective_mode == "fullstack_split" else backend_proxy_url
    )
    meta["prod_db_configured"] = bool(enable_database and db_credentials)
    meta["prod_node_id"] = effective_node_id
    meta["prod_node_name"] = effective_node_name
    meta["prod_published_at"] = now.isoformat()
    meta["prod_release_notes"] = (release_notes or f"Release v{next_version}").strip()
    meta["db_migrations_applied"] = len(migration_files)
    meta["db_migrations_pending"] = 0
    _save_env_metadata(ws, meta)

    project.updated_at = now
    db.commit()

    return {
        "ok": True,
        "project_id": project.id,
        "server_id": primary_server.id,
        "frontend_server_id": frontend_server.id if frontend_server else None,
        "backend_server_id": backend_server.id if backend_server else None,
        "node_id": effective_node_id,
        "node_name": effective_node_name,
        "mode": effective_mode,
        "published_files": len(files),
        "version": next_version,
        "web_url": live_web_url,
        "frontend_port": fe_port,
        "backend_port": be_port,
        "api_path": api_path or "/api/*",
        "database_provisioned": bool(db_credentials),
        "environment": get_project_environment(db, user, project.id),
    }

    project.updated_at = now
    db.commit()
    return get_project_environment(db, user, project.id)


def list_production_files(
    db: Session,
    user: User,
    project_id: str,
) -> list[dict[str, object]]:
    """Liest den veröffentlichten Dateistand der Produktions-Umgebung für die Live-Vorschau."""
    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    prod_dir = ws / "_prod_release"
    if not prod_dir.is_dir():
        return []
    result: list[dict[str, object]] = []
    for root, _dirs, files in os.walk(prod_dir):
        for fname in files:
            fpath = Path(root) / fname
            try:
                rel = fpath.relative_to(prod_dir).as_posix()
                content = fpath.read_text(encoding="utf-8", errors="replace")
                result.append(
                    {
                        "id": f"prod:{rel}",
                        "project_id": project.id,
                        "path": rel,
                        "content": content,
                        "mime_type": "text/plain",
                        "size_bytes": len(content.encode("utf-8")),
                        "updated_at": datetime.fromtimestamp(
                            fpath.stat().st_mtime, tz=timezone.utc
                        ).isoformat(),
                    }
                )
            except OSError:
                continue
    return result


def search_cross_project_components(
    db: Session,
    user: User,
    current_project_id: str | None = None,
    query: str = "",
    limit: int = 12,
) -> list[dict[str, object]]:
    """Durchsucht andere eigene und Team-Projekte nach wiederverwendbaren Modulen, Komponenten und Wissen.

    Datenschutzkonform: Greift ausschliesslich auf Projekte zu, auf die `user`
    expliziten Lesezugriff hat (eigene Projekte + Mitglieds-Teams).
    """
    from sqlalchemy import or_

    team_ids = [
        tm.team_id
        for tm in db.query(TeamMember.team_id).filter(TeamMember.user_id == user.id).all()
    ]
    filters = [AiProject.user_id == user.id]
    if team_ids:
        filters.append(AiProject.team_id.in_(team_ids))

    q_proj = (
        db.query(AiProject)
        .filter(AiProject.archived.is_(False))
        .filter(or_(*filters))
    )
    if current_project_id:
        q_proj = q_proj.filter(AiProject.id != str(current_project_id))
    q_proj = q_proj.order_by(AiProject.updated_at.desc()).limit(15)

    with vorab_entschluesselt(db, q_proj, AiProject.name, AiProject.description):
        other_projects = q_proj.all()

    if not other_projects:
        return []

    proj_map = {p.id: p for p in other_projects}
    q_files = (
        db.query(AiProjectFile)
        .filter(AiProjectFile.project_id.in_(list(proj_map.keys())))
        .order_by(AiProjectFile.updated_at.desc())
        .limit(120)
    )
    with vorab_entschluesselt(db, q_files, AiProjectFile.content):
        all_files = q_files.all()

    terms = [t.lower() for t in re.split(r"\W+", (query or "").strip()) if len(t) >= 2]
    scored: list[tuple[int, dict[str, object]]] = []

    for f in all_files:
        p = proj_map.get(f.project_id)
        if p is None:
            continue
        path_lower = f.path.lower()
        # Bevorzuge wiederverwendbare Bausteine (components, lib, utils, hooks, ui, models, services)
        is_reusable = any(
            seg in path_lower
            for seg in ("component", "lib/", "utils", "hook", "ui/", "widget", "service", "schema", ".tsx", ".ts", ".py", ".css")
        )
        score = 2 if is_reusable else 1
        content_sample = (f.content or "")[:600]
        haystack = f"{p.name} {f.path} {content_sample}".lower()
        for term in terms:
            if term in path_lower:
                score += 5
            elif term in haystack:
                score += 2
        if terms and score <= 2:
            continue
        scored.append(
            (
                score,
                {
                    "project_id": p.id,
                    "project_name": p.name,
                    "path": f.path,
                    "size_bytes": f.size_bytes,
                    "preview": content_sample[:300],
                },
            )
        )

    scored.sort(key=lambda item: item[0], reverse=True)
    return [item[1] for item in scored[:limit]]


