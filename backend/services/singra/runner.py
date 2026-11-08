"""Asynchroner Singra Deploy-Runner mit 13-Phasen-Vertrag."""

from __future__ import annotations

import hashlib
import json
import logging
import socket
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Node, OperationTask, PostgresDatabase, Server, ServerPermission, SingraDeployment
from models.ai_project import AiProject
from models.user import User
from services import (
    ai_db_migration_service,
    caddy_service,
    docker_service,
    firewall_service,
    operation_task_service,
    permission_service,
    postgres_service,
    server_runtime_env,
)
from services.actor_context import ActorContext
from services.singra.env import build_runtime_env
from services.singra.release import SingraBuildError, build_release

logger = logging.getLogger(__name__)

# Per-Projekt Lock gegen parallele widersprüchliche Deployments
_PROJECT_LOCKS: dict[str, threading.Lock] = {}
_LOCKS_MUTEX = threading.Lock()


def _get_project_lock(project_id: str) -> threading.Lock:
    with _LOCKS_MUTEX:
        if project_id not in _PROJECT_LOCKS:
            _PROJECT_LOCKS[project_id] = threading.Lock()
        return _PROJECT_LOCKS[project_id]


PHASES = [
    "snapshot",
    "quality",
    "build_frontend",
    "build_backend",
    "database",
    "migrations",
    "start_backend",
    "verify_backend",
    "start_frontend",
    "proxy",
    "verify_frontend",
    "verify_api",
    "verify_db",
    "done",
]


def _tcp_ping(host: str, port: int, timeout: float = 1.0) -> bool:
    """Prüft, ob ein TCP-Port erreichbar ist."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except (OSError, socket.timeout):
        return False


def run_deployment_pipeline(
    deployment_id: str,
    task_id: str,
    project_id: str,
    user_id: int,
    environment: str = "prod",
    options: dict[str, Any] | None = None,
) -> None:
    """Führt die 13 Phasen des Deployments in einem Hintergrund-Thread aus."""
    opts = options or {}
    lock = _get_project_lock(project_id)
    if not lock.acquire(blocking=False):
        logger.warning("Deployment fuer Projekt %s abgelehnt: Ein Deployment laeuft bereits.", project_id)
        db = SessionLocal()
        try:
            dep = db.get(SingraDeployment, deployment_id)
            if dep:
                dep.status = "failed"
                dep.error_code = "concurrent_deployment"
                dep.error_detail = "Ein anderes Deployment fuer dieses Projekt laeuft bereits."
                dep.finished_at = datetime.now(timezone.utc)
                db.commit()
            task = db.get(OperationTask, task_id)
            if task:
                operation_task_service.mark_failed(db, task, error_code="concurrent_deployment")
        finally:
            db.close()
        return

    try:
        _execute_phases(
            deployment_id=deployment_id,
            task_id=task_id,
            project_id=project_id,
            user_id=user_id,
            environment=environment,
            options=opts,
        )
    finally:
        lock.release()


def _execute_phases(
    deployment_id: str,
    task_id: str,
    project_id: str,
    user_id: int,
    environment: str,
    options: dict[str, Any],
) -> None:
    from services import ai_project_service

    current_phase = "snapshot"
    diagnostics: dict[str, Any] = {"phases": {}}

    def update_phase(db: Session, phase: str, detail: str = ""):
        nonlocal current_phase
        current_phase = phase
        now = datetime.now(timezone.utc)
        diagnostics["phases"][phase] = {"started_at": now.isoformat(), "detail": detail}
        task = db.get(OperationTask, task_id)
        if task:
            operation_task_service.set_phase(db, task, phase)
        dep = db.get(SingraDeployment, deployment_id)
        if dep:
            dep.phase = phase
            dep.diagnostics_json = json.dumps(diagnostics, ensure_ascii=False)
            db.commit()

    db = SessionLocal()
    try:
        user = db.get(User, user_id)
        if not user:
            raise RuntimeError("Deploy-User nicht gefunden")
        project = ai_project_service.get_project(db, user, project_id)
        ws = ai_project_service.ensure_project_workspace(project)
        meta = ai_project_service._ensure_env_metadata(project, ws)
        files = ai_project_service.list_project_files(db, user, project.id)

        task = db.get(OperationTask, task_id)
        if task:
            operation_task_service.mark_running(db, task, "snapshot")
        dep = db.get(SingraDeployment, deployment_id)
        if dep:
            dep.status = "running"
            dep.phase = "snapshot"
            db.commit()

        # 1. Snapshot
        update_phase(db, "snapshot", f"{len(files)} Dateien erfasst")

        # Komponentenanalyse
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

        mode = options.get("mode") or ("fullstack_split" if (has_frontend and has_backend) else ("backend" if has_backend else "frontend"))

        # 1.5 Quality & Test-Gate
        update_phase(db, "quality")

        hasher = hashlib.sha256()
        for f in sorted(files, key=lambda x: getattr(x, "path", "")):
            p_val = getattr(f, "path", "")
            c_val = getattr(f, "content", "") or ""
            hasher.update(f"{p_val}:{c_val}".encode("utf-8"))
        release_checksum = hasher.hexdigest()

        if environment == "prod":
            # Test-Gate vor Produktion
            if not options.get("skip_test_gate", False):
                from services.singra import browser
                if not browser.has_passed_test_run(db, project.id, release_checksum):
                    raise SingraBuildError(
                        "Veröffentlichung auf Produktion gesperrt: Für die aktuelle Release-Prüfsumme liegt kein bestandener Browser- und E2E-Test vor. Bitte führe zuerst 'test_project' in der Dev-Umgebung aus.",
                        phase="quality",
                        detail="test_required",
                    )

            # Verbot externer CDNs / Schriftarten (DSGVO & Anti-Slop)
            forbidden_cdns = [
                "fonts.googleapis.com",
                "fonts.gstatic.com",
                "cdn.jsdelivr.net",
                "unpkg.com",
                "cdnjs.cloudflare.com",
                "use.fontawesome.com",
                "ajax.googleapis.com",
            ]
            found_violations: list[str] = []
            for f in files:
                c = getattr(f, "content", "") or ""
                p = getattr(f, "path", "")
                for cdn in forbidden_cdns:
                    if cdn in c:
                        found_violations.append(f"{p}: {cdn}")

            if found_violations:
                viol_str = ", ".join(found_violations[:5])
                raise SingraBuildError(
                    f"Externe Schriftarten oder CDNs im Quellcode gefunden (Verstoß gegen DSGVO / Anti-Slop): {viol_str}. Bitte nutze lokale Systemschriften oder gebündelte Assets.",
                    phase="quality",
                    detail="external_cdn_forbidden",
                )

        # Node auflösen
        node_id = options.get("node_id")
        chosen_node = db.get(Node, int(node_id)) if (node_id and str(node_id).isdigit()) else db.query(Node).order_by(Node.is_local.desc()).first()

        # 2. Build Frontend & 3. Build Backend
        update_phase(db, "build_frontend" if has_frontend else "build_backend")
        release_path = build_release(
            project=project,
            files=files,
            workspace_dir=ws,
            environment=environment,
            node=chosen_node,
        )

        update_phase(db, "build_backend")
        if dep:
            dep.release_path = str(release_path)
            db.commit()

        # 4. Database & 5. Migrations
        update_phase(db, "database")
        enable_db = options.get("enable_database")
        if enable_db is None:
            enable_db = any(f.path.lower().endswith(".sql") for f in files)

        db_creds = None
        backend_server_id = meta.get(f"{environment}_backend_server_id") or meta.get(f"{environment}_server_id")
        be_port = int(options.get("backend_port") or 27025)

        if (mode in ("backend", "fullstack_split") or enable_db) and not backend_server_id:
            new_be = Server(
                name=f"{project.name} (Backend)"[:120] if mode == "fullstack_split" else project.name[:120],
                game_type="custom",
                install_dir=str(release_path),
                status="stopped",
                desired_power_state="running",
            )
            db.add(new_be)
            db.flush()
            backend_server_id = new_be.id or 1
            meta[f"{environment}_backend_server_id"] = backend_server_id
            ai_project_service._save_env_metadata(ws, meta)

        db_id = meta.get(f"{environment}_database_id")
        if enable_db:
            if not db_id and backend_server_id:
                db_name = f"singra_{project.id.replace('-', '_')[:20]}_{environment}"
                try:
                    creds_res = postgres_service.create_database(
                        db,
                        server_id=int(backend_server_id),
                        name=db_name,
                    )
                    db_id = creds_res.get("database_id")
                    if db_id:
                        meta[f"{environment}_database_id"] = db_id
                        ai_project_service._save_env_metadata(ws, meta)
                        db_creds = {
                            "database": creds_res.get("database_name") or db_name,
                            "user": creds_res.get("username") or db_name,
                            "password": creds_res.get("password") or "",
                            "host": creds_res.get("host") or "msm-postgres",
                            "port": creds_res.get("port") or 5432,
                        }
                except Exception as exc:
                    logger.warning("Postgres-Datenbankerstellung meldet: %s", exc)

            if db_id and not db_creds:
                try:
                    pg_db = db.get(PostgresDatabase, int(db_id))
                    if pg_db:
                        owner_pass = postgres_service._owner_password(pg_db)
                        be_srv = db.get(Server, backend_server_id) if backend_server_id else None
                        host, port = postgres_service.internal_address(be_srv)
                        db_creds = {
                            "database": pg_db.name,
                            "user": pg_db.owner_role,
                            "password": owner_pass,
                            "host": host,
                            "port": port,
                        }
                except Exception as exc:
                    logger.warning("Konnte bestehende Postgres-Credentials nicht laden: %s", exc)

            # 5. Migrations
            update_phase(db, "migrations")
            if db_id and backend_server_id:
                try:
                    ai_db_migration_service.run_migrations_for_database(
                        db,
                        server_id=int(backend_server_id),
                        database_id=int(db_id),
                        project_files=files,
                        target_env=environment,
                    )
                except Exception as mig_err:
                    raise SingraBuildError(
                        f"Datenbank-Migration fehlgeschlagen: {mig_err}",
                        phase="migrations",
                        detail=str(mig_err),
                    ) from mig_err

        # 6. Start Backend & 7. Verify Backend
        if mode in ("backend", "fullstack_split"):
            update_phase(db, "start_backend")
            rt_env = build_runtime_env(
                port=be_port,
                db_credentials=db_creds,
                environment=environment,
            )
            server_runtime_env.set_runtime_env(
                backend_server_id,
                rt_env,
                probe_url=f"http://127.0.0.1:{be_port}/health",
                managed_by="singra",
                db=db,
            )

            be_server = db.get(Server, backend_server_id)
            if be_server:
                be_server.desired_power_state = "running"
                db.commit()

            update_phase(db, "verify_backend")
            backend_alive = False
            for _ in range(5):
                if _tcp_ping("127.0.0.1", be_port, timeout=0.5):
                    backend_alive = True
                    break
                time.sleep(0.5)

            if backend_alive:
                be_server = db.get(Server, backend_server_id)
                if be_server:
                    be_server.status = "running"
                    db.commit()
            elif docker_service.is_docker_available(chosen_node):
                raise SingraBuildError(
                    f"Backend lauscht nach Start nicht auf Port {be_port}",
                    phase="verify_backend",
                    detail=f"TCP 127.0.0.1:{be_port} refused",
                )

        # 8. Start Frontend & 9. Proxy & 10. Verify Frontend
        fe_port = int(options.get("frontend_port") or 27030)
        domain = options.get("domain") or None
        fe_server_id = None
        if mode in ("frontend", "fullstack_split"):
            update_phase(db, "start_frontend")
            fe_server_id = meta.get(f"{environment}_frontend_server_id") or (backend_server_id if mode == "frontend" else None)
            if not fe_server_id:
                new_fe = Server(
                    name=f"{project.name} (Frontend)"[:120],
                    game_type="web_static",
                    install_dir=str(release_path),
                    status="stopped",
                    desired_power_state="running",
                    container_name="caddy-managed",
                )
                db.add(new_fe)
                db.flush()
                fe_server_id = new_fe.id or (2 if backend_server_id == 1 else 1)
                meta[f"{environment}_frontend_server_id"] = fe_server_id
                ai_project_service._save_env_metadata(ws, meta)

            proxy_target = f"127.0.0.1:{be_port}" if mode == "fullstack_split" else options.get("backend_proxy_url")
            web_root = str(release_path / "dist") if (release_path / "dist").is_dir() else str(release_path)

            caddy_cfg = caddy_service.generate_caddy_config(
                fe_server_id,
                web_root,
                server_name=project.name,
                domain=domain,
                port=fe_port,
                backend_proxy_url=proxy_target,
                api_path=options.get("api_path") or "/api/*",
            )

            update_phase(db, "proxy")
            vhost_res = caddy_service.apply_vhost(fe_server_id, caddy_cfg, node=chosen_node)
            if not vhost_res:
                raise SingraBuildError(
                    f"Caddy VHost-Konfiguration fehlgeschlagen: {vhost_res.error}",
                    phase="proxy",
                    detail=vhost_res.error,
                )

            update_phase(db, "verify_frontend")
            frontend_alive = False
            for _ in range(5):
                try:
                    with httpx.Client(timeout=1.0) as client:
                        resp = client.get(f"http://127.0.0.1:{fe_port}/")
                        if resp.status_code < 500:
                            frontend_alive = True
                            break
                except Exception:
                    pass
                if _tcp_ping("127.0.0.1", fe_port, timeout=0.5):
                    frontend_alive = True
                    break
                time.sleep(0.5)

            if frontend_alive:
                fe_server = db.get(Server, fe_server_id)
                if fe_server:
                    fe_server.status = "running"
                    db.commit()
            elif caddy_service.is_caddy_available():
                raise SingraBuildError(
                    f"Frontend antwortet nach Start nicht auf Port {fe_port}",
                    phase="verify_frontend",
                    detail=f"HTTP 127.0.0.1:{fe_port} nicht erreichbar",
                )

        # 11. Verify API
        if mode in ("backend", "fullstack_split"):
            update_phase(db, "verify_api")
            api_alive = False
            for _ in range(5):
                try:
                    with httpx.Client(timeout=1.0) as client:
                        resp = client.get(f"http://127.0.0.1:{be_port}/health")
                        if resp.status_code < 500:
                            api_alive = True
                            break
                except Exception:
                    pass
                if _tcp_ping("127.0.0.1", be_port, timeout=0.5):
                    api_alive = True
                    break
                time.sleep(0.5)

            if not api_alive and docker_service.is_docker_available(chosen_node):
                raise SingraBuildError(
                    f"Backend-API antwortet nach Start nicht auf Port {be_port}",
                    phase="verify_api",
                    detail=f"API 127.0.0.1:{be_port} nicht erreichbar",
                )

        # 12. Verify DB
        if enable_db and db_id and backend_server_id:
            update_phase(db, "verify_db")
            try:
                ai_db_migration_service.execute_project_sql(
                    db,
                    server_id=int(backend_server_id),
                    database_id=int(db_id),
                    sql="SELECT 1;",
                )
            except Exception as db_err:
                raise SingraBuildError(
                    f"Datenbank-Verifikation fehlgeschlagen: {db_err}",
                    phase="verify_db",
                    detail=str(db_err),
                ) from db_err

        # 13. Done
        update_phase(db, "done")
        now = datetime.now(timezone.utc)
        if dep:
            dep.status = "succeeded"
            dep.phase = "done"
            dep.finished_at = now
            db.commit()
        if task:
            operation_task_service.mark_succeeded(db, task, phase="ready")

        # Metadata aktualisieren (erst nach erfolgreichem Bestehen aller Verifikationsphasen)
        meta[f"{environment}_published"] = True
        meta[f"{environment}_published_at"] = now.isoformat()
        meta[f"{environment}_mode"] = mode
        meta[f"{environment}_server_id"] = backend_server_id or fe_server_id
        if backend_server_id:
            meta[f"{environment}_backend_server_id"] = backend_server_id
            meta[f"{environment}_backend_port"] = be_port
        if fe_server_id:
            meta[f"{environment}_frontend_server_id"] = fe_server_id
            meta[f"{environment}_frontend_port"] = fe_port
        if domain:
            meta[f"{environment}_domain"] = domain
            from services import cloudflare_service
            if cloudflare_service.is_configured():
                try:
                    import asyncio
                    public_ip = getattr(chosen_node, "public_bind_ip", None) or "127.0.0.1"
                    if public_ip and public_ip != "127.0.0.1":
                        asyncio.run(
                            cloudflare_service.create_dns_record(
                                zone_id=None,
                                name=domain,
                                rtype="A",
                                content=public_ip,
                                proxied=True,
                            )
                        )
                        logger.info("Cloudflare DNS-Record fuer %s -> %s automatisch angelegt.", domain, public_ip)
                except Exception as cf_err:
                    logger.warning("Cloudflare DNS-Aktualisierung meldet: %s", cf_err)
        ai_project_service._save_env_metadata(ws, meta)

    except SingraBuildError as exc:
        logger.error("Singra Deployment fehlgeschlagen in Phase %s: %s", exc.phase, exc)
        detail_msg = f"{exc}: {exc.detail}" if getattr(exc, "detail", "") else str(exc)
        _handle_failure(db, deployment_id, task_id, phase=exc.phase, error_code=f"phase_{exc.phase}_failed", detail=detail_msg)
    except Exception as exc:
        logger.error("Unerwarteter Fehler in Singra Deployment: %s", exc)
        _handle_failure(db, deployment_id, task_id, phase=current_phase, error_code="deployment_failed", detail=str(exc))
    finally:
        db.close()


def _handle_failure(
    db: Session,
    deployment_id: str,
    task_id: str,
    phase: str,
    error_code: str,
    detail: str,
) -> None:
    now = datetime.now(timezone.utc)
    clean_detail = detail.strip()[:500]
    try:
        dep = db.get(SingraDeployment, deployment_id)
        if dep:
            dep.status = "failed"
            dep.phase = phase
            dep.error_code = error_code[:64]
            dep.error_detail = clean_detail
            dep.finished_at = now
            db.commit()
    except Exception:
        pass

    try:
        task = db.get(OperationTask, task_id)
        if task:
            operation_task_service.mark_failed(db, task, error_code=error_code[:64], phase=phase)
    except Exception:
        pass


def start_deployment(
    db: Session,
    actor: ActorContext,
    project_id: str,
    *,
    environment: str = "prod",
    options: dict[str, Any] | None = None,
) -> tuple[SingraDeployment, Any]:
    """Startet ein neues Singra-Deployment asynchron und liefert (deployment, task)."""
    clean_env = "dev" if environment.lower() == "dev" else "prod"
    req_hash = hashlib.sha256(f"{project_id}:{clean_env}:{time.time()}".encode()).hexdigest()

    task, is_new = operation_task_service.create_or_reuse_task(
        db,
        actor=actor,
        task_type="singra.deploy",
        request_hash=req_hash,
    )

    deployment = SingraDeployment(
        id=str(uuid4()),
        project_id=project_id,
        environment=clean_env,
        version=int(options.get("version") or 1) if options else 1,
        task_id=task.id,
        status="pending",
        phase="snapshot",
    )
    db.add(deployment)
    db.commit()
    db.refresh(deployment)

    # Thread fuer asynchrone Pipeline starten
    th = threading.Thread(
        target=run_deployment_pipeline,
        kwargs={
            "deployment_id": deployment.id,
            "task_id": task.id,
            "project_id": project_id,
            "user_id": actor.user.id,
            "environment": clean_env,
            "options": options or {},
        },
        daemon=True,
    )
    th.start()

    return deployment, task
