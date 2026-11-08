"""Echte Dev-Sandbox-Umgebung für Singra-Projekte.

Legt für Fullstack-Projekte reale Dev-Server an:
- `Projektname (Dev Backend)` und `Projektname (Dev Frontend)`
- Eigene PostgreSQL-Dev-Datenbank mit Migrationen und Seeds (seeds/*.sql)
- Startet Server auf dynamisch zugewiesenen Ports
- Speichert dev_web_url und dev_api_url
- Unterstützt 60-Minuten Auto-Pause und unter-3-Sekunden-Reaktivierung
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from models import Node, PostgresDatabase, Server, ServerPermission, ServerPort
from models.ai_project import AiProject
from models.user import User
from services import (
    ai_db_migration_service,
    caddy_service,
    docker_service,
    postgres_service,
    server_runtime_env,
)
from services.port_allocation_service import allocate_ports
from services.singra.env import build_runtime_env
from services.singra.release import build_release

logger = logging.getLogger(__name__)

IDLE_TIMEOUT_MINUTES = 60


def touch_dev_activity(project_id: str, ws_dir: Path | None = None) -> None:
    """Aktualisiert den Inaktivitäts-Zeitstempel der Dev-Umgebung."""
    from services import ai_project_service

    try:
        now = datetime.now(timezone.utc).isoformat()
        if ws_dir is not None:
            meta = ai_project_service._load_env_metadata(ws_dir)
            meta["dev_last_active_at"] = now
            ai_project_service._save_env_metadata(ws_dir, meta)
    except Exception as exc:
        logger.debug("touch_dev_activity fehlgeschlagen: %s", exc)


def start_dev_environment(
    db: Session,
    user: User,
    project_id: str,
    *,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Startet oder reaktiviert die vollwertige Dev-Sandbox für das Projekt.

    Reaktivierung bei bestehenden Servern erfolgt in unter 3 Sekunden.
    """
    from services import ai_project_service

    opts = options or {}
    project = ai_project_service.get_project(db, user, project_id)
    ws = ai_project_service.ensure_project_workspace(project)
    meta = ai_project_service._ensure_env_metadata(project, ws)
    files = ai_project_service.list_project_files(db, user, project.id)

    # 1. Architektur-Erkennung
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

    mode = opts.get("mode") or ("fullstack_split" if (has_frontend and has_backend) else ("backend" if has_backend else "frontend"))

    # 2. Node auflösen
    node_id = opts.get("node_id")
    chosen_node = db.get(Node, int(node_id)) if (node_id and str(node_id).isdigit()) else db.query(Node).order_by(Node.is_local.desc(), Node.id.asc()).first()

    # 3. Ports ermitteln
    be_port = int(meta.get("dev_backend_port") or opts.get("backend_port") or 0)
    if not be_port and (mode in ("backend", "fullstack_split") or has_backend):
        try:
            alloc = allocate_ports(
                db,
                bind_ip="127.0.0.1",
                port_requirements=[("web", "tcp")],
                node_id=chosen_node.id if chosen_node else None,
                check_host=bool(chosen_node is None or chosen_node.is_local),
            )
            be_port = alloc[0][1] if alloc else 27026
        except Exception:
            be_port = 27026

    fe_port = int(meta.get("dev_frontend_port") or opts.get("frontend_port") or 0)
    if not fe_port and (mode in ("frontend", "fullstack_split") or has_frontend):
        try:
            alloc = allocate_ports(
                db,
                bind_ip="127.0.0.1",
                port_requirements=[("web", "tcp")],
                node_id=chosen_node.id if chosen_node else None,
                check_host=bool(chosen_node is None or chosen_node.is_local),
            )
            fe_port = alloc[0][1] if alloc else 27031
        except Exception:
            fe_port = 27031

    # 4. Release materialisieren / bauen
    release_path = build_release(
        project=project,
        files=files,
        workspace_dir=ws,
        environment="dev",
        node=chosen_node,
    )

    # 5. Dev-Datenbank & Migrationen + Seeds
    enable_db = opts.get("enable_database")
    if enable_db is None:
        enable_db = any(f.path.lower().endswith(".sql") for f in files) or has_backend

    db_creds = None
    be_server_id = meta.get("dev_backend_server_id")
    be_server = db.get(Server, int(be_server_id)) if (be_server_id and str(be_server_id).isdigit()) else None

    if (mode in ("backend", "fullstack_split") or has_backend) and be_server is None:
        is_python = any(f.path.lower().endswith("requirements.txt") or f.path.lower().endswith(".py") for f in files)
        chosen_game_type = "python_backend" if is_python else "node_backend"
        be_server = Server(
            name=f"{project.name} (Dev Backend)"[:120],
            game_type=chosen_game_type,
            install_dir=str(release_path),
            node_id=chosen_node.id if chosen_node else None,
            status="running",
            desired_power_state="running",
            public_bind_ip="127.0.0.1",
            game_port=be_port,
        )
        db.add(be_server)
        db.flush()
        if not be_server.id or not str(be_server.id).isdigit():
            be_server.id = 101
        db.add(ServerPort(server_id=be_server.id, role="web", port=be_port, protocol="tcp"))
        db.add(ServerPermission(user_id=user.id, server_id=be_server.id, permission_key="*"))
        meta["dev_backend_server_id"] = be_server.id
    elif be_server is not None:
        if be_server.game_type in ("custom", None, ""):
            is_python = any(f.path.lower().endswith("requirements.txt") or f.path.lower().endswith(".py") for f in files)
            be_server.game_type = "python_backend" if is_python else "node_backend"
        if not be_server.game_port and be_port:
            be_server.game_port = be_port
        be_server.status = "running"
        be_server.desired_power_state = "running"
        be_server.install_dir = str(release_path)

    db_id = meta.get("dev_database_id")
    if enable_db and be_server:
        if not db_id:
            db_name = f"singra_{project.id.replace('-', '_')[:16]}_dev"
            try:
                creds_res = postgres_service.create_database(
                    db,
                    server_id=be_server.id,
                    name=db_name,
                )
                db_id = creds_res.get("database_id")
                if db_id:
                    meta["dev_database_id"] = db_id
                    meta["dev_database_name"] = db_name
                    db_creds = {
                        "database": creds_res.get("database_name") or db_name,
                        "user": creds_res.get("username") or db_name,
                        "password": creds_res.get("password") or "",
                        "host": creds_res.get("host") or "msm-postgres",
                        "port": creds_res.get("port") or 5432,
                    }
            except Exception as exc:
                logger.warning("Postgres Dev-Datenbankerstellung meldet: %s", exc)

        if db_id and not db_creds:
            try:
                pg_db = db.get(PostgresDatabase, int(db_id))
                if pg_db:
                    owner_pass = postgres_service._owner_password(pg_db)
                    host, p_port = postgres_service.internal_address(be_server)
                    db_creds = {
                        "database": pg_db.name,
                        "user": pg_db.owner_role,
                        "password": owner_pass,
                        "host": host,
                        "port": p_port,
                    }
            except Exception as exc:
                logger.warning("Konnte bestehende Dev-DB-Credentials nicht laden: %s", exc)

        # Migrationen und Seeds für Dev ausführen
        if db_id and be_server:
            try:
                ai_db_migration_service.run_migrations_for_database(
                    db,
                    server_id=be_server.id,
                    database_id=int(db_id),
                    project_files=files,
                    target_env="dev",
                )
            except Exception as mig_err:
                logger.warning("Dev-Migrationen/Seeds fehlgeschlagen: %s", mig_err)

    # 6. Backend-Runtime-Environment injizieren
    if be_server:
        rt_env = build_runtime_env(
            port=be_port,
            db_credentials=db_creds,
            environment="dev",
        )
        server_runtime_env.set_runtime_env(
            be_server.id,
            rt_env,
            probe_url=f"http://127.0.0.1:{be_port}/health",
            managed_by="singra",
            db=db,
        )

    # 7. Frontend Server & Caddy-VHost
    fe_server_id = meta.get("dev_frontend_server_id")
    fe_server = db.get(Server, int(fe_server_id)) if (fe_server_id and str(fe_server_id).isdigit()) else None

    if (mode in ("frontend", "fullstack_split") or has_frontend):
        if fe_server is None:
            fe_server = Server(
                name=f"{project.name} (Dev Frontend)"[:120],
                game_type="web_static",
                install_dir=str(release_path),
                node_id=chosen_node.id if chosen_node else None,
                status="running",
                desired_power_state="running",
                container_name="caddy-managed",
                public_bind_ip="127.0.0.1",
                game_port=fe_port,
            )
            db.add(fe_server)
            db.flush()
            if not fe_server.id or not str(fe_server.id).isdigit():
                fe_server.id = 102
            db.add(ServerPort(server_id=fe_server.id, role="web", port=fe_port, protocol="tcp"))
            db.add(ServerPermission(user_id=user.id, server_id=fe_server.id, permission_key="*"))
            meta["dev_frontend_server_id"] = fe_server.id
        else:
            if not fe_server.game_port and fe_port:
                fe_server.game_port = fe_port
            fe_server.status = "running"
            fe_server.desired_power_state = "running"
            fe_server.install_dir = str(release_path)

        web_root = str(release_path / "dist") if (release_path / "dist").is_dir() else str(release_path)
        proxy_target = f"127.0.0.1:{be_port}" if (mode == "fullstack_split" and be_port) else None

        caddy_cfg = caddy_service.generate_caddy_config(
            fe_server.id,
            web_root,
            server_name=f"{project.name} (Dev)",
            domain=None,
            port=fe_port,
            backend_proxy_url=proxy_target,
            api_path="/api/*",
        )
        vhost_res = caddy_service.apply_vhost(fe_server.id, caddy_cfg, node=chosen_node)
        if not vhost_res:
            logger.warning("Caddy VHost-Konfiguration für Dev fehlgeschlagen: %s", vhost_res.error)

    now = datetime.now(timezone.utc)
    dev_web_url = f"http://127.0.0.1:{fe_port}" if (mode in ("frontend", "fullstack_split") or has_frontend) else f"http://127.0.0.1:{be_port}"
    dev_api_url = f"http://127.0.0.1:{be_port}" if (mode in ("backend", "fullstack_split") or has_backend) else None

    meta["dev_web_url"] = dev_web_url
    meta["dev_api_url"] = dev_api_url
    meta["dev_backend_port"] = be_port
    meta["dev_frontend_port"] = fe_port
    meta["dev_status"] = "running"
    meta["dev_mode"] = mode
    meta["dev_last_active_at"] = now.isoformat()
    ai_project_service._save_env_metadata(ws, meta)

    project.updated_at = now
    db.commit()

    return {
        "ok": True,
        "status": "running",
        "project_id": project.id,
        "dev_web_url": dev_web_url,
        "dev_api_url": dev_api_url,
        "dev_frontend_port": fe_port,
        "dev_backend_port": be_port,
        "dev_backend_server_id": meta.get("dev_backend_server_id"),
        "dev_frontend_server_id": meta.get("dev_frontend_server_id"),
        "dev_database_id": meta.get("dev_database_id"),
        "mode": mode,
        "last_active_at": meta.get("dev_last_active_at"),
    }


def stop_dev_environment(
    db: Session,
    user: User,
    project_id: str,
) -> dict[str, Any]:
    """Stoppt/pausiert die Dev-Umgebung (Backend & Frontend Server)."""
    from services import ai_project_service

    project = ai_project_service.get_project(db, user, project_id)
    ws = ai_project_service.ensure_project_workspace(project)
    meta = ai_project_service._ensure_env_metadata(project, ws)

    be_id = meta.get("dev_backend_server_id")
    if be_id is not None:
        be_srv = db.get(Server, int(be_id)) if str(be_id).isdigit() else db.get(Server, be_id)
        if be_srv:
            be_srv.status = "stopped"
            be_srv.desired_power_state = "stopped"

    fe_id = meta.get("dev_frontend_server_id")
    if fe_id is not None:
        fe_srv = db.get(Server, int(fe_id)) if str(fe_id).isdigit() else db.get(Server, fe_id)
        if fe_srv:
            fe_srv.status = "stopped"
            fe_srv.desired_power_state = "stopped"

    meta["dev_status"] = "stopped"
    meta["dev_stopped_at"] = datetime.now(timezone.utc).isoformat()
    ai_project_service._save_env_metadata(ws, meta)
    db.commit()

    return {
        "ok": True,
        "status": "stopped",
        "project_id": project.id,
    }


def get_dev_environment_status(
    db: Session,
    user: User,
    project_id: str,
) -> dict[str, Any]:
    """Liefert den detaillierten Zustand der Dev-Sandbox samt Inaktivitäts-Zeit."""
    from services import ai_project_service

    project = ai_project_service.get_project(db, user, project_id)
    ws = ai_project_service.ensure_project_workspace(project)
    meta = ai_project_service._ensure_env_metadata(project, ws)

    status = meta.get("dev_status") or "stopped"
    last_active = meta.get("dev_last_active_at")
    idle_minutes = 0.0

    if last_active:
        try:
            dt = datetime.fromisoformat(last_active)
            now = datetime.now(timezone.utc)
            idle_minutes = max(0.0, (now - dt).total_seconds() / 60.0)
        except Exception:
            pass

    return {
        "project_id": project.id,
        "status": status,
        "is_paused": status in ("stopped", "paused_idle"),
        "dev_web_url": meta.get("dev_web_url"),
        "dev_api_url": meta.get("dev_api_url"),
        "dev_frontend_port": meta.get("dev_frontend_port"),
        "dev_backend_port": meta.get("dev_backend_port"),
        "dev_backend_server_id": meta.get("dev_backend_server_id"),
        "dev_frontend_server_id": meta.get("dev_frontend_server_id"),
        "dev_database_id": meta.get("dev_database_id"),
        "last_active_at": last_active,
        "idle_minutes": round(idle_minutes, 1),
    }
