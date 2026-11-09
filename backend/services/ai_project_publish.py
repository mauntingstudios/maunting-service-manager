"""Veroeffentlichen von KI-Projekten und projektuebergreifende Suche.

Herausgezogen aus `ai_project_service`: der Produktions-Publish samt Git-Weg,
die Dateiliste der Produktion und die Suche nach Komponenten in anderen
Projekten. Dienstfunktionen werden beim Aufruf geholt.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from models import AiProject, AiProjectFile, TeamMember, User
from models.dis_text import vorab_entschluesselt
from services.ai_project_errors import AiProjectError
from services.ai_project_git import (
    _clean_git_remote_url,
    _prepare_git_askpass_env,
    git_commit_and_push,
    merge_to_main,
    resolve_git_token_for_user,
)

logger = logging.getLogger(__name__)

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
    bind_ip: str | None = None,
    merge_to_main: bool = False,
) -> dict[str, object]:
    """Veröffentlicht das Projekt auf Produktion mit Blueprint-Zuordnung, Caddy-VHost und optionaler PostgreSQL-Datenbank."""
    from services.ai_project_service import _ensure_env_metadata, _save_env_metadata, ensure_project_workspace, get_project, get_project_environment, list_project_files
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

    # Bind-IP ermitteln (behebt unvollstaendige Bind-IPs fuer den Server-Lifecycle)
    effective_bind_ip: str | None = None
    if bind_ip and bind_ip.strip():
        effective_bind_ip = bind_ip.strip()
    elif chosen_node is not None:
        effective_bind_ip = getattr(chosen_node, "public_bind_ip", None)

    if not effective_bind_ip:
        from services.network_interfaces_service import default_bind_ip
        effective_bind_ip = default_bind_ip() or "127.0.0.1"

    now = datetime.now(timezone.utc)
    next_version = int(meta.get("prod_version") or 0) + 1

    # Git commit / push vor dem Deployment falls Git-Repo angebunden
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

    if merge_to_main and project.git_repo_url:
        try:
            effective_token = resolve_git_token_for_user(db, user, project.git_provider)
            clean_auth_url = _clean_git_remote_url(project.git_repo_url, project.git_provider) if effective_token else project.git_repo_url
            base_env = {
                **os.environ,
                "GIT_TERMINAL_PROMPT": "0",
                "GIT_AUTHOR_NAME": user.username or "Singra AI",
                "GIT_AUTHOR_EMAIL": user.email or "singra@mauntingstudios.de",
                "GIT_COMMITTER_NAME": user.username or "Singra AI",
                "GIT_COMMITTER_EMAIL": user.email or "singra@mauntingstudios.de",
            }
            env, _ = _prepare_git_askpass_env(base_env, effective_token)
            subprocess.run(
                ["git", "push", clean_auth_url, "HEAD:main"],
                cwd=str(ws),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                timeout=45,
            )
        except Exception as merge_err:
            logger.warning("Git-Push nach main fuer Projekt %s fehlgeschlagen: %s", project.id, merge_err)

    # Ports ermitteln / vorallozieren
    be_port: int | None = None
    if effective_mode in ("backend", "fullstack_split"):
        be_port = meta.get("prod_backend_port")
        if not be_port:
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

    fe_port: int | None = None
    if effective_mode in ("frontend", "fullstack_split"):
        fe_port = meta.get("prod_frontend_port")
        if not fe_port:
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

    # Metadaten fuer naechstes Release vorbereiten (prod_published wird erst nach Bestehen der Verifikation True)
    meta["prod_version"] = next_version
    meta["prod_node_id"] = effective_node_id
    meta["prod_node_name"] = effective_node_name
    meta["prod_mode"] = effective_mode
    meta["prod_bind_ip"] = effective_bind_ip
    if be_port:
        meta["prod_backend_port"] = be_port
    if fe_port:
        meta["prod_frontend_port"] = fe_port
    _save_env_metadata(ws, meta)

    project.updated_at = now
    db.commit()

    from services.actor_context import ActorContext
    from services.singra import runner

    actor = ActorContext(user=user, origin="ai", correlation_id=str(uuid4()))
    deployment, task = runner.start_deployment(
        db,
        actor=actor,
        project_id=project.id,
        environment="prod",
        options={
            "node_id": effective_node_id,
            "mode": effective_mode,
            "domain": domain,
            "enable_database": enable_database,
            "backend_proxy_url": backend_proxy_url,
            "api_path": api_path,
            "bind_ip": effective_bind_ip,
            "release_notes": release_notes,
            "version": next_version,
            "frontend_port": fe_port,
            "backend_port": be_port,
        },
    )

    return {
        "ok": True,
        "deployment_id": deployment.id,
        "task_id": task.id,
        "status": "running",
        "phase": "snapshot",
        "project_id": project.id,
        "version": next_version,
        "node_id": effective_node_id,
        "node_name": effective_node_name,
        "mode": effective_mode,
        "frontend_port": fe_port,
        "backend_port": be_port,
        "environment": get_project_environment(db, user, project.id),
    }


def list_production_files(
    db: Session,
    user: User,
    project_id: str,
) -> list[dict[str, object]]:
    """Liest den veröffentlichten Dateistand der Produktions-Umgebung für die Live-Vorschau."""
    from services.ai_project_service import ensure_project_workspace, get_project
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


