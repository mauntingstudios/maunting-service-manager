"""Build-, Deployment-, Rollback- und Quota-Dienst fuer Frontend-Server."""

from __future__ import annotations

import json
import logging
import os
import secrets
import shutil
import subprocess
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from blueprints.github_source import _build_git_env, _clone_url
from blueprints.registry import get_registry
from blueprints.schema import Blueprint, BlueprintCategory, BlueprintSourceType
from config import settings
from models import (
    KIND_GITHUB_TOKEN,
    FrontendDeployment,
    FrontendSettings,
    RoleFrontendBuildQuota,
    Server,
    ServerPort,
    User,
    UserRole,
)
from services import credential_service, docker_service, port_allocation_service
from services.auth_service import AuthService
from services.dis_client import DisDecryptionError
from services.firewall_service import close_ports, open_ports
from services.frontend_build_runner import run_node_frontend_build
from services.frontend_caddy_config import (
    PreviewRoute,
    generate_container_caddyfile,
    slugify_branch,
)

logger = logging.getLogger(__name__)

MAX_RETAINED_PRODUCTION_BUILDS = 10


@dataclass(frozen=True)
class BuildQuota:
    max_cpu_cores: int = 2
    max_memory_mb: int = 2048
    build_timeout_seconds: int = 900
    max_concurrent_builds: int = 1
    max_previews_per_server: int = 5


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _env_aad(server_id: int, scope: str) -> str:
    return f"msm:frontend:env:{int(server_id)}:{scope}"


def _webhook_aad(server_id: int) -> str:
    return f"msm:frontend:webhook:{int(server_id)}"


def _mask_secret_values(text: str, secrets_to_mask: list[str]) -> str:
    masked = text
    for sec in secrets_to_mask:
        if sec and len(sec) >= 4:
            masked = masked.replace(sec, "***")
    return masked


def resolve_build_quota(db: Session, user_id: int | None) -> BuildQuota:
    """Ermittelt das hoechste Build-Kontingent ueber alle Rollen eines Benutzers."""
    if not user_id:
        return BuildQuota()
    role_ids = list(
        db.scalars(select(UserRole.role_id).where(UserRole.user_id == user_id)).all()
    )
    primary_role_id = db.scalar(select(User.role_id).where(User.id == user_id))
    if primary_role_id is not None and primary_role_id not in role_ids:
        role_ids.append(primary_role_id)
    if not role_ids:
        return BuildQuota()

    rows = db.execute(
        select(
            func.max(RoleFrontendBuildQuota.max_cpu_cores),
            func.max(RoleFrontendBuildQuota.max_memory_mb),
            func.max(RoleFrontendBuildQuota.build_timeout_seconds),
            func.max(RoleFrontendBuildQuota.max_concurrent_builds),
            func.max(RoleFrontendBuildQuota.max_previews_per_server),
        ).where(RoleFrontendBuildQuota.role_id.in_(role_ids))
    ).first()
    if rows is None or rows[0] is None:
        return BuildQuota()
    return BuildQuota(
        max_cpu_cores=int(rows[0] or 2),
        max_memory_mb=int(rows[1] or 2048),
        build_timeout_seconds=int(rows[2] or 900),
        max_concurrent_builds=int(rows[3] or 1),
        max_previews_per_server=int(rows[4] or 5),
    )


def get_or_create_settings(db: Session, server: Server) -> FrontendSettings:
    row = db.get(FrontendSettings, server.id)
    if row is not None:
        return row
    bp = _resolve_frontend_blueprint(server)
    default_branch = (
        bp.source.github.branch
        if bp and bp.source.github and bp.source.github.branch
        else "main"
    )
    previews_allowed = bool(bp and bp.frontend and bp.frontend.previewsAllowed)
    secret_plain = secrets.token_hex(32)
    row = FrontendSettings(
        server_id=server.id,
        production_branch=default_branch,
        auto_deploy=True,
        previews_enabled=previews_allowed,
        online=True,
        webhook_url_token=secrets.token_urlsafe(24),
        webhook_secret_enc=AuthService.encrypt_secret(
            secret_plain, aad=_webhook_aad(server.id)
        ),
    )
    db.add(row)
    db.flush()
    return row


def decrypt_webhook_secret(settings_row: FrontendSettings) -> str | None:
    if not settings_row.webhook_secret_enc:
        return None
    try:
        return AuthService.decrypt_secret(
            settings_row.webhook_secret_enc, aad=_webhook_aad(settings_row.server_id)
        )
    except DisDecryptionError:
        return None


def get_env_vars(db: Session, server_id: int, scope: str) -> dict[str, str]:
    if scope not in ("production", "preview"):
        raise ValueError("scope muss 'production' oder 'preview' sein")
    row = db.get(FrontendSettings, server_id)
    if row is None:
        return {}
    enc = row.env_production_enc if scope == "production" else row.env_preview_enc
    if not enc:
        return {}
    try:
        raw = AuthService.decrypt_secret(enc, aad=_env_aad(server_id, scope))
        data = json.loads(raw)
        if isinstance(data, dict):
            return {str(k): str(v) for k, v in data.items()}
    except (DisDecryptionError, json.JSONDecodeError):
        return {}
    return {}


def set_env_vars(
    db: Session, server: Server, scope: str, values: dict[str, str]
) -> dict[str, str]:
    if scope not in ("production", "preview"):
        raise HTTPException(status_code=400, detail="Ungueltiger Env-Bereich")
    from blueprints.schema import _ENV_KEY_RE, _FORBIDDEN_ENV_KEYS

    cleaned: dict[str, str] = {}
    for k, v in values.items():
        key = str(k).strip()
        if not _ENV_KEY_RE.match(key) or key in _FORBIDDEN_ENV_KEYS:
            raise HTTPException(
                status_code=400, detail=f"Ungueltiger Variablenname: {key}"
            )
        val = str(v)
        if "\x00" in val or "\n" in val or "\r" in val:
            raise HTTPException(
                status_code=400, detail=f"Ungueltiges Zeichen im Wert von {key}"
            )
        cleaned[key] = val

    settings_row = get_or_create_settings(db, server)
    payload = AuthService.encrypt_secret(
        json.dumps(cleaned), aad=_env_aad(server.id, scope)
    )
    if scope == "production":
        settings_row.env_production_enc = payload
    else:
        settings_row.env_preview_enc = payload
    db.flush()
    return cleaned


def _resolve_frontend_blueprint(server: Server) -> Blueprint | None:
    entry = get_registry().get(server.game_type)
    if entry is None:
        return None
    if entry.blueprint.meta.category != BlueprintCategory.FRONTEND:
        return None
    return entry.blueprint


def _atomic_symlink(target: Path, link_path: Path) -> None:
    link_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_link = link_path.parent / f".tmp-{link_path.name}-{secrets.token_hex(4)}"
    if tmp_link.exists() or tmp_link.is_symlink():
        tmp_link.unlink()
    try:
        os.symlink(str(target), str(tmp_link), target_is_directory=True)
        os.replace(str(tmp_link), str(link_path))
    except OSError:
        if tmp_link.exists() or tmp_link.is_symlink():
            tmp_link.unlink(missing_ok=True)
        if link_path.is_symlink():
            link_path.unlink()
        elif link_path.exists():
            shutil.rmtree(link_path, ignore_errors=True)
        shutil.copytree(target, link_path)


def _server_web_port(server: Server) -> int:
    for p in server.ports or []:
        if p.role == "web":
            return int(p.port)
    return int(server.game_port or 8080)


def rewrite_caddyfile(db: Session, server: Server, bp: Blueprint | None) -> Path:
    install_dir = Path(server.install_dir)
    install_dir.mkdir(parents=True, exist_ok=True)

    spa_fallback = bp.frontend.spaFallback if bp and bp.frontend else True
    root_dir = (
        "/data/current"
        if bp and bp.source.type == BlueprintSourceType.GITHUB
        else "/data"
    )
    previews_rows = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server.id,
            FrontendDeployment.kind == "preview",
            FrontendDeployment.is_live.is_(True),
            FrontendDeployment.port.isnot(None),
        )
        .all()
    )
    panel_auth_url = (getattr(settings, "panel_url", "") or "").strip().rstrip("/") or None
    preview_routes = [
        PreviewRoute(
            branch_slug=row.branch_slug,
            port=int(row.port),
            root_dir=f"/data/previews/{row.branch_slug}",
            forward_auth_url=panel_auth_url,
        )
        for row in previews_rows
        if row.port is not None
    ]
    caddyfile_text = generate_container_caddyfile(
        port=_server_web_port(server),
        root_dir=root_dir,
        spa_fallback=spa_fallback,
        previews=preview_routes,
        server_id=server.id,
    )
    caddyfile_path = install_dir / "Caddyfile"
    caddyfile_path.write_text(caddyfile_text, encoding="utf-8")
    return caddyfile_path


def _reload_caddy_container(server: Server) -> None:
    if not server.container_name or server.container_name == "caddy-managed":
        return
    try:
        if not docker_service.is_docker_available(node=server.node):
            return
        docker_service.exec_in_container(
            server.container_name,
            ["caddy", "reload", "--config", "/data/Caddyfile", "--adapter", "caddyfile"],
            node=server.node,
        )
    except Exception as exc:
        logger.debug("Caddy reload fuer Server %s uebersprungen: %s", server.id, exc)


def _ensure_preview_port(
    db: Session,
    server: Server,
    slug: str,
    *,
    actor_user_id: int | None = None,
) -> int:
    existing_live = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server.id,
            FrontendDeployment.kind == "preview",
            FrontendDeployment.branch_slug == slug,
            FrontendDeployment.port.isnot(None),
        )
        .order_by(FrontendDeployment.created_at.desc())
        .first()
    )
    if existing_live is not None and existing_live.port is not None:
        return int(existing_live.port)

    bp = _resolve_frontend_blueprint(server)
    bp_limit = bp.frontend.maxPreviews if bp and bp.frontend else 5
    role_limit = resolve_build_quota(db, actor_user_id).max_previews_per_server
    max_previews = min(bp_limit, role_limit)
    if max_previews <= 0:
        raise HTTPException(status_code=403, detail="Previews sind fuer dieses Frontend deaktiviert.")

    active_previews = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server.id,
            FrontendDeployment.kind == "preview",
            FrontendDeployment.is_live.is_(True),
        )
        .order_by(FrontendDeployment.created_at.asc())
        .all()
    )
    distinct_branches: list[str] = []
    for row in active_previews:
        if row.branch_slug != slug and row.branch not in distinct_branches:
            distinct_branches.append(row.branch)
    while len(distinct_branches) >= max_previews:
        oldest_branch = distinct_branches.pop(0)
        delete_preview(db, server, oldest_branch)

    allocated = port_allocation_service.allocate_ports(
        db,
        port_requirements=[("preview", "tcp")],
        node_id=server.node_id,
        check_host=server.node_id is None,
    )
    port = int(allocated[0][1])
    db.add(ServerPort(server_id=server.id, role="preview", port=port, protocol="tcp"))
    db.flush()
    return port


def enqueue(
    db: Session,
    server: Server,
    *,
    branch: str,
    commit_sha: str | None = None,
    commit_message: str | None = None,
    commit_author: str | None = None,
    source: str = "manual",
    preview_port: int | None = None,
    actor_user_id: int | None = None,
) -> FrontendDeployment:
    settings_row = get_or_create_settings(db, server)
    clean_branch = (branch or settings_row.production_branch).strip()
    kind = "production" if clean_branch == settings_row.production_branch else "preview"
    slug = slugify_branch(clean_branch)

    if kind == "preview" and preview_port is None:
        preview_port = _ensure_preview_port(db, server, slug, actor_user_id=actor_user_id)

    # Warte-Builds auf demselben Branch verdichten (neuester Commit gewinnt).
    queued_old = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server.id,
            FrontendDeployment.branch_slug == slug,
            FrontendDeployment.status == "queued",
        )
        .all()
    )
    for old in queued_old:
        old.status = "superseded"
        old.finished_at = _now()

    dep = FrontendDeployment(
        server_id=server.id,
        kind=kind,
        branch=clean_branch,
        branch_slug=slug,
        commit_sha=commit_sha[:64] if commit_sha else None,
        commit_message=commit_message[:255] if commit_message else None,
        commit_author=commit_author[:128] if commit_author else None,
        source=source,
        status="queued",
        is_live=False,
        port=preview_port if kind == "preview" else _server_web_port(server),
    )
    db.add(dep)
    db.flush()
    return dep


def _clone_repo(
    *,
    repo: str,
    branch: str,
    dest: Path,
    token: str | None,
) -> tuple[str | None, str]:
    if dest.exists():
        shutil.rmtree(dest, ignore_errors=True)
    dest.parent.mkdir(parents=True, exist_ok=True)
    env, _masked = _build_git_env(token)
    url = _clone_url(repo, token=None)
    cmd = [
        "git",
        "clone",
        "--depth",
        "1",
        "--branch",
        branch,
        "--single-branch",
        url,
        str(dest),
    ]
    res = subprocess.run(
        cmd,
        env=env,
        capture_output=True,
        text=True,
        timeout=300,
    )
    if res.returncode != 0:
        raise RuntimeError((res.stderr or res.stdout or "git clone fehlgeschlagen").strip())
    sha_res = subprocess.run(
        ["git", "-C", str(dest), "rev-parse", "HEAD"],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    sha = sha_res.stdout.strip() if sha_res.returncode == 0 else None
    return sha, (res.stdout or "") + "\n" + (res.stderr or "")


def run_build(
    db: Session,
    deployment_id: int,
    *,
    actor_user_id: int | None = None,
) -> FrontendDeployment:
    dep = db.get(FrontendDeployment, deployment_id)
    if dep is None:
        raise HTTPException(status_code=404, detail="Deployment nicht gefunden")
    server = db.get(Server, dep.server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    bp = _resolve_frontend_blueprint(server)
    if bp is None or bp.frontend is None or bp.source.github is None:
        raise HTTPException(status_code=400, detail="Server ist kein GitHub-Frontend")

    quota = resolve_build_quota(db, actor_user_id)
    dep.status = "building"
    dep.started_at = _now()
    db.flush()

    install_dir = Path(server.install_dir)
    logs_dir = install_dir / "build-logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / f"deploy-{dep.id}.log"
    dep.log_path = str(log_file)

    resolved_cred = credential_service.resolve_for_server(db, server.id, KIND_GITHUB_TOKEN)
    token = resolved_cred.secret if resolved_cred is not None else None
    secrets_to_mask = [token] if token else []

    work_src = install_dir / "_build_src" / f"dep-{dep.id}"
    full_log = ""
    try:
        sha, clone_log = _clone_repo(
            repo=bp.source.github.repo,
            branch=dep.branch,
            dest=work_src,
            token=token,
        )
        full_log += clone_log + "\n"
        if sha and not dep.commit_sha:
            dep.commit_sha = sha

        project_dir = work_src / bp.source.github.subPath if bp.source.github.subPath else work_src
        scope = "production" if dep.kind == "production" else "preview"
        merged_env = dict(bp.frontend.env)
        merged_env.update(get_env_vars(db, server.id, scope))
        secrets_to_mask.extend(v for v in merged_env.values() if len(v) >= 6)

        timeout_sec = min(bp.frontend.build.timeoutSeconds, quota.build_timeout_seconds)
        build_res = run_node_frontend_build(
            project_dir,
            node_version=bp.frontend.build.nodeVersion,
            install_command=bp.frontend.build.installCommand,
            build_command=bp.frontend.build.buildCommand,
            output_dir=bp.frontend.build.outputDir,
            env_vars=merged_env,
            timeout_seconds=timeout_sec,
            node=server.node,
        )
        full_log += build_res.log_output

        if not build_res.ok or build_res.output_dir is None:
            raise RuntimeError("Build fehlgeschlagen oder index.html im Ausgabeordner nicht gefunden.")

        release_dir = install_dir / "deployments" / str(dep.id)
        if release_dir.exists():
            shutil.rmtree(release_dir, ignore_errors=True)
        shutil.copytree(build_res.output_dir, release_dir)

        _activate_deployment(db, server, dep, release_dir, bp)
        dep.status = "ready"
        dep.finished_at = _now()
        prune(db, server)
    except Exception as exc:
        dep.status = "failed"
        dep.is_live = False
        dep.finished_at = _now()
        summary = _mask_secret_values(str(exc), secrets_to_mask)
        dep.error_summary = summary[:1000]
        full_log += f"\n[FEHLER] {summary}\n"
    finally:
        log_file.write_text(_mask_secret_values(full_log, secrets_to_mask), encoding="utf-8")
        if work_src.exists():
            shutil.rmtree(work_src, ignore_errors=True)
        db.flush()
    return dep


def _activate_deployment(
    db: Session,
    server: Server,
    dep: FrontendDeployment,
    release_dir: Path,
    bp: Blueprint | None,
) -> None:
    install_dir = Path(server.install_dir)
    if dep.kind == "production":
        others = (
            db.query(FrontendDeployment)
            .filter(
                FrontendDeployment.server_id == server.id,
                FrontendDeployment.kind == "production",
                FrontendDeployment.is_live.is_(True),
                FrontendDeployment.id != dep.id,
            )
            .all()
        )
        for o in others:
            o.is_live = False
        _atomic_symlink(release_dir, install_dir / "current")
    else:
        others = (
            db.query(FrontendDeployment)
            .filter(
                FrontendDeployment.server_id == server.id,
                FrontendDeployment.kind == "preview",
                FrontendDeployment.branch_slug == dep.branch_slug,
                FrontendDeployment.is_live.is_(True),
                FrontendDeployment.id != dep.id,
            )
            .all()
        )
        for o in others:
            o.is_live = False
        _atomic_symlink(release_dir, install_dir / "previews" / dep.branch_slug)

    dep.is_live = True
    rewrite_caddyfile(db, server, bp)
    _reload_caddy_container(server)
    fs = get_or_create_settings(db, server)
    if fs.online and dep.kind == "preview" and dep.port is not None:
        try:
            open_ports(
                server.name,
                [(int(dep.port), "tcp", "preview")],
                node=server.node,
                db=db,
                server_id=server.id,
            )
        except Exception as exc:
            logger.debug("Firewall open_ports fuer Preview %s uebersprungen: %s", dep.port, exc)


def promote(db: Session, deployment_id: int) -> FrontendDeployment:
    dep = db.get(FrontendDeployment, deployment_id)
    if dep is None or dep.status != "ready":
        raise HTTPException(status_code=400, detail="Deployment nicht bereit fuer Produktion")
    server = db.get(Server, dep.server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    release_dir = Path(server.install_dir) / "deployments" / str(dep.id)
    if not release_dir.is_dir():
        raise HTTPException(status_code=404, detail="Build-Artefakt fehlt")

    promoted = FrontendDeployment(
        server_id=server.id,
        kind="production",
        branch=dep.branch,
        branch_slug=dep.branch_slug,
        commit_sha=dep.commit_sha,
        commit_message=dep.commit_message,
        commit_author=dep.commit_author,
        source="promote",
        status="ready",
        is_live=False,
        port=_server_web_port(server),
        created_at=_now(),
        started_at=dep.started_at,
        finished_at=_now(),
    )
    db.add(promoted)
    db.flush()
    promoted_dir = Path(server.install_dir) / "deployments" / str(promoted.id)
    shutil.copytree(release_dir, promoted_dir)
    _activate_deployment(db, server, promoted, promoted_dir, _resolve_frontend_blueprint(server))
    db.flush()
    return promoted


def rollback(db: Session, deployment_id: int) -> FrontendDeployment:
    dep = db.get(FrontendDeployment, deployment_id)
    if dep is None or dep.kind != "production" or dep.status != "ready":
        raise HTTPException(status_code=400, detail="Nur fertige Produktions-Builds koennen wiederhergestellt werden")
    server = db.get(Server, dep.server_id)
    if server is None:
        raise HTTPException(status_code=404, detail="Server nicht gefunden")
    release_dir = Path(server.install_dir) / "deployments" / str(dep.id)
    if not release_dir.is_dir():
        raise HTTPException(status_code=404, detail="Build-Artefakt wurde bereits aufgeraeumt")
    _activate_deployment(db, server, dep, release_dir, _resolve_frontend_blueprint(server))
    db.flush()
    return dep


def prune(db: Session, server: Server) -> int:
    ready_prod = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server.id,
            FrontendDeployment.kind == "production",
            FrontendDeployment.status == "ready",
            FrontendDeployment.is_live.is_(False),
        )
        .order_by(FrontendDeployment.created_at.desc())
        .all()
    )
    removed = 0
    for stale in ready_prod[MAX_RETAINED_PRODUCTION_BUILDS:]:
        path = Path(server.install_dir) / "deployments" / str(stale.id)
        if path.exists():
            shutil.rmtree(path, ignore_errors=True)
        removed += 1
    return removed


def delete_preview(db: Session, server: Server, branch: str) -> int:
    """Entfernt eine Branch-Preview samt Symlink, Port, Firewall-Freigabe und Caddyfile-Block."""
    slug = slugify_branch(branch)
    rows = (
        db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server.id,
            FrontendDeployment.kind == "preview",
            FrontendDeployment.branch_slug == slug,
            FrontendDeployment.is_live.is_(True),
        )
        .all()
    )
    ports_to_close: list[int] = []
    for row in rows:
        row.is_live = False
        if row.port is not None:
            ports_to_close.append(int(row.port))

    if ports_to_close:
        try:
            close_ports(
                [(p, "tcp", "preview") for p in ports_to_close],
                node=server.node,
                name=server.name,
                db=db,
                server_id=server.id,
            )
        except Exception as exc:
            logger.debug("Firewall close_ports fuer Preview uebersprungen: %s", exc)
        db.query(ServerPort).filter(
            ServerPort.server_id == server.id,
            ServerPort.role == "preview",
            ServerPort.port.in_(ports_to_close),
        ).delete(synchronize_session=False)

    link_path = Path(server.install_dir) / "previews" / slug
    if link_path.is_symlink():
        link_path.unlink(missing_ok=True)
    elif link_path.exists():
        shutil.rmtree(link_path, ignore_errors=True)

    bp = _resolve_frontend_blueprint(server)
    rewrite_caddyfile(db, server, bp)
    _reload_caddy_container(server)
    db.flush()
    return len(rows)


def set_online(db: Session, server: Server, online: bool) -> FrontendSettings:
    """Schaltet ein Frontend online/offline und oeffnet/schliesst Ports dynamisch."""
    fs = get_or_create_settings(db, server)
    fs.online = bool(online)
    web_port = _server_web_port(server)
    preview_ports = [
        int(row.port)
        for row in db.query(FrontendDeployment)
        .filter(
            FrontendDeployment.server_id == server.id,
            FrontendDeployment.kind == "preview",
            FrontendDeployment.is_live.is_(True),
            FrontendDeployment.port.isnot(None),
        )
        .all()
        if row.port is not None
    ]
    tuples: list[tuple[int, str, str]] = [(web_port, "tcp", "web")] + [
        (p, "tcp", "preview") for p in preview_ports
    ]
    try:
        if fs.online:
            open_ports(server.name, tuples, node=server.node, db=db, server_id=server.id)
        else:
            close_ports(tuples, node=server.node, name=server.name, db=db, server_id=server.id)
    except Exception as exc:
        logger.debug("Firewall-Umschaltung fuer Frontend %s uebersprungen: %s", server.id, exc)
    server.desired_power_state = "running" if fs.online else "stopped"
    db.flush()
    return fs


def trigger_async_build(deployment_id: int, *, actor_user_id: int | None = None) -> None:
    """Startet einen Frontend-Build asynchron in einem eigenen Daemon-Thread."""
    import threading

    def _worker() -> None:
        from database import SessionLocal

        session = SessionLocal()
        try:
            run_build(session, deployment_id, actor_user_id=actor_user_id)
            session.commit()
        except Exception as exc:
            session.rollback()
            logger.exception("Asynchroner Frontend-Build %s fehlgeschlagen: %s", deployment_id, exc)
        finally:
            session.close()

    threading.Thread(
        target=_worker,
        name=f"frontend-build-{deployment_id}",
        daemon=True,
    ).start()
