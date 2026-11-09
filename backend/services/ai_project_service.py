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
from services.ai_project_errors import AiProjectError
from services.ai_project_publish import (
    list_production_files,
    publish_project_to_production,
    search_cross_project_components,
)
from services.ai_project_git import (
    _clean_git_remote_url,
    _prepare_git_askpass_env,
    git_branch,
    git_clone_or_pull,
    git_commit_and_push,
    git_create_remote_repository,
    git_open_pr,
    git_status,
    merge_to_main,
    resolve_git_token_for_user,
)
from services.ai_project_command import (
    _ALLOWED_DEV_BINARIES,
    _DANGEROUS_PATTERNS,
    _MAX_CMD_OUTPUT_CHARS,
    _split_unquoted_command_segments,
    _validate_project_command,
    run_project_command,
    verify_project_sandbox,
)

logger = logging.getLogger(__name__)

_MAX_FILE_BYTES = 512 * 1024  # 512 KB pro Datei in der DB/Sandbox
_SAFE_REL_PATH_RE = re.compile(r"^[A-Za-z0-9._/\- ]{1,240}$")



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

    # Regelwerke gehören ausschließlich in das Stammverzeichnis
    basename = posixpath.basename(norm).lower()
    if basename in ("agents.md", "gemini.md") and "/" in norm:
        return "AGENTS.md" if basename == "agents.md" else "GEMINI.md"

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

    # 1. Dev-Sandbox sauber stoppen
    try:
        from services.singra import dev_env
        dev_env.stop_dev_environment(db, user, project.id)
    except Exception as exc:
        logger.debug("Konnte Dev-Umgebung bei Projektloeschung nicht stoppen: %s", exc)

    # 2. Caddy-VHost fuer ggf. registrierte Server des Projekts deregistrieren
    try:
        from services import caddy_service
        meta = project.meta or {}
        for server_key in (
            "dev_frontend_server_id",
            "dev_backend_server_id",
            "production_server_id",
            "production_frontend_server_id",
        ):
            sid = meta.get(server_key)
            if sid and str(sid).isdigit():
                caddy_service.remove_vhost(int(sid))
    except Exception as exc:
        logger.debug("Konnte Caddy-VHost bei Projektloeschung nicht entfernen: %s", exc)

    # 3. Kaskadierendes Loeschen aller zugehoerigen Projekt-Chats
    try:
        from models.ai_conversation import AiConversation
        from services import ai_chat_service
        project_convs = (
            db.query(AiConversation)
            .filter(AiConversation.project_id == project.id)
            .all()
        )
        for conv in project_convs:
            ai_chat_service.delete_user_conversation(db, conv)
    except Exception as exc:
        logger.debug("Konnte zugehoerige Projekt-Chats bei Projektloeschung nicht loeschen: %s", exc)

    # 4. Autonomie-Grants bereinigen
    try:
        from models.ai_autonomy_grant import AiAutonomyGrant
        db.query(AiAutonomyGrant).filter(
            AiAutonomyGrant.project_id == project.id
        ).delete(synchronize_session=False)
    except Exception as exc:
        logger.debug("Konnte Autonomie-Grants bei Projektloeschung nicht bereinigen: %s", exc)

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

    # Veraltete/fehlerhafte Unterordner-AGENTS.md in DB und Cache bereinigen
    for p, row in list(existing.items()):
        if "/" in p and posixpath.basename(p).lower() in ("agents.md", "gemini.md"):
            db.delete(row)
            existing.pop(p, None)
            changed = True

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
            # Regelwerke gehören ausschließlich in das Root-Verzeichnis; Duplikate entfernen
            if fname.lower() in ("agents.md", "gemini.md") and fpath.parent != ws:
                try:
                    fpath.unlink(missing_ok=True)
                except OSError:
                    pass
                continue
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


def _load_env_metadata(ws: Path) -> dict[str, object]:
    import json as _json

    meta_file = _env_meta_path(ws)
    if meta_file.is_file():
        try:
            loaded = _json.loads(meta_file.read_text(encoding="utf-8", errors="replace"))
            if isinstance(loaded, dict):
                return loaded
        except Exception:
            pass
    return {}


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


def ensure_dev_database(
    db: Session,
    user: User,
    project_id: str,
) -> dict[str, Any] | None:
    """Stellt sicher, dass das Projekt eine funktionierende PostgreSQL-Dev-Datenbank besitzt."""
    from models import Node, Server, ServerPermission, PostgresDatabase
    from services import postgres_service, ai_db_migration_service
    from services.node_service import get_local_node

    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    meta = _ensure_env_metadata(project, ws)
    files = list_project_files(db, user, project.id)

    db_keywords = ("postgresql", "postgres", "psycopg", "prisma", "database_url", "schema.sql")
    has_db = any(
        f.path.lower().endswith(".sql")
        or f.path.lower().startswith("migrations/")
        or (f.content and any(kw in f.content.lower() for kw in db_keywords))
        for f in files
    )
    if not has_db:
        return None

    local_node = get_local_node(db)
    if local_node is None:
        local_node = db.query(Node).filter(Node.is_local == True).first()  # noqa: E712
    if local_node is None:
        local_node = db.query(Node).first()

    node_id = local_node.id if local_node else None

    dev_server_id = meta.get("dev_server_id")
    dev_server: Server | None = None
    if isinstance(dev_server_id, int) and dev_server_id > 0:
        dev_server = db.get(Server, dev_server_id)

    if dev_server is None:
        dev_server = Server(
            name=f"{project.name} (Dev)"[:120],
            game_type="node_backend",
            install_dir=str(ws),
            node_id=node_id,
            status="stopped",
            status_message=f"Singra Dev Environment ({local_node.name if local_node else 'Local'})",
            desired_power_state="stopped",
            public_bind_ip="127.0.0.1",
        )
        db.add(dev_server)
        db.flush()
        db.add(
            ServerPermission(
                user_id=user.id,
                server_id=dev_server.id,
                permission_key="*",
            )
        )
        meta["dev_server_id"] = dev_server.id

    pg_db = (
        db.query(PostgresDatabase)
        .filter(PostgresDatabase.server_id == dev_server.id)
        .first()
    )
    if pg_db is None:
        try:
            creds = postgres_service.provision_server_databases(db, dev_server, 1)
            if creds:
                pg_db = (
                    db.query(PostgresDatabase)
                    .filter(PostgresDatabase.server_id == dev_server.id)
                    .first()
                )
        except Exception as exc:
            logger.warning("Konnte Dev-Datenbank fuer Projekt %s nicht anlegen: %s", project.id, exc)
            return None

    if pg_db is None:
        return None

    meta["dev_database_id"] = pg_db.id
    meta["dev_database_name"] = pg_db.name
    _save_env_metadata(ws, meta)

    migration_result = None
    try:
        migration_result = ai_db_migration_service.run_migrations_for_database(
            db, dev_server.id, pg_db.id, files
        )
    except Exception as exc:
        logger.warning("Migrationen fuer Dev-Datenbank %s fehlgeschlagen: %s", pg_db.id, exc)

    owner_pw = ""
    try:
        owner_pw = postgres_service._owner_password(pg_db)
    except Exception:
        pass
    conn_str = f"postgresql://{pg_db.owner_role}:{owner_pw}@127.0.0.1:5432/{pg_db.name}"
    env_content = f"DATABASE_URL={conn_str}\nPGHOST=127.0.0.1\nPGPORT=5432\nPGDATABASE={pg_db.name}\nPGUSER={pg_db.owner_role}\nPGPASSWORD={owner_pw}\n"
    try:
        (ws / ".env").write_text(env_content, encoding="utf-8")
    except OSError:
        pass

    return {
        "dev_server_id": dev_server.id,
        "dev_database_id": pg_db.id,
        "dev_database_name": pg_db.name,
        "migrations": migration_result,
        "connection_string": conn_str,
    }


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

    # Sicherstellen, dass bei DB-Bedarf die Dev-Datenbank angelegt ist
    if not meta.get("dev_database_id"):
        try:
            ensure_dev_database(db, user, project.id)
            meta = _ensure_env_metadata(project, ws)
        except Exception as exc:
            logger.debug("Dev-Datenbank konnte beim Abrufen nicht angelegt werden: %s", exc)

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
            "dev_server_id": meta.get("dev_server_id"),
            "dev_database_id": meta.get("dev_database_id"),
            "dev_database_name": meta.get("dev_database_name"),
            "dev_has_db": bool(meta.get("dev_database_id")),
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








