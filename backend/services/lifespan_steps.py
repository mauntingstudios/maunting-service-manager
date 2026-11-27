"""Modulare Startup- und Shutdown-Bausteine für den FastAPI-Lifespan (`main.py`).

Wichtig: Auf Modulebene dürfen ausschließlich Standardbibliothek und Pakete aus
`KERN` (`test_startup_dependencies.py`) importiert werden, damit `import main`
auch ohne optionale Abhängigkeiten durchläuft.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
import importlib.util
import logging
import os

from fastapi import FastAPI
import httpx
from sqlalchemy import inspect, text

logger = logging.getLogger("main")


def init_http_clients_and_ai_runtime(app: FastAPI, is_testing: bool) -> None:
    """Initialisiert langlebige HTTPX-Clients, Arbeitsverzeichnisse und KI-Laufzeit."""
    from config import settings
    from services import ai_run_service
    from services.openai_compatible_adapter import MAX_FIRST_DATA_SECONDS

    limits = httpx.Limits(max_connections=200, max_keepalive_connections=50)
    app.state.http_client = httpx.AsyncClient(limits=limits, timeout=5.0)
    app.state.ai_http_client = httpx.AsyncClient(
        limits=httpx.Limits(max_connections=50, max_keepalive_connections=20),
        timeout=httpx.Timeout(connect=5.0, read=MAX_FIRST_DATA_SECONDS, write=10.0, pool=5.0),
        follow_redirects=False,
        http2=importlib.util.find_spec("h2") is not None,
    )

    ai_run_service.laufzeit_setzen(
        asyncio.get_running_loop(), app.state.ai_http_client
    )

    os.makedirs(settings.servers_dir, exist_ok=True)
    os.makedirs("/opt/msm/backups", exist_ok=True)

    if not is_testing:
        from services import ai_mail_outbox, ai_model_catalog, ai_provider_service

        ai_model_catalog.laufzeit_setzen(app.state.ai_http_client)
        ai_model_catalog.schluesselquelle_setzen(ai_provider_service.katalogschluessel)
        ai_model_catalog.vorwaermen_anstossen()
        prewarm_ai_runtime_async()
        ai_mail_outbox.arbeiter_starten()


def prewarm_ai_runtime() -> None:
    """Waermt Embedding-Modell, Router-Prototypen und Built-in-Tool-Router im Hintergrund vor."""
    try:
        from services import ai_embedding_service, ai_router_service
        from services.ai_action_service import provider_tool_definitions
        from services.ai_stream.lifecycle import _panel_tool_router_fuer

        if ai_embedding_service.is_available():
            ai_embedding_service._load()
        if ai_embedding_service.is_ready():
            model_tag = ai_embedding_service.aktives_modell()
            if model_tag:
                ai_router_service._get_tier_prototypes(model_tag)
            defs = provider_tool_definitions()
            schemas = {
                str(e["function"]["name"]): e
                for e in defs
                if isinstance(e, dict)
                and isinstance(e.get("function"), dict)
                and isinstance(e["function"].get("name"), str)
            }
            if schemas:
                _panel_tool_router_fuer(schemas).warm(frozenset(schemas))
    except Exception as exc:  # noqa: BLE001 - Prewarm darf Startup niemals blockieren
        logger.debug("AI-Startup-Prewarm uebersprungen: %s", type(exc).__name__)


def prewarm_ai_runtime_async() -> None:
    """Startet den KI-Prewarm nicht-blockierend in einem Daemon-Thread."""
    import threading

    threading.Thread(
        target=prewarm_ai_runtime,
        daemon=True,
        name="msm-ai-prewarm",
    ).start()


def verify_dis_and_upgrade_schema(engine, is_testing: bool) -> None:
    """Prüft den DIS-Sidecar (fail-closed) und hebt das Datenbankschema auf head."""
    if is_testing:
        return

    from services.dis_client import DisClient
    from services.email_altbestand import klartext_verschluesseln
    from services.schema_manager import initialize_or_upgrade_schema

    if not DisClient.health_check():
        raise RuntimeError(
            "CRITICAL: DIS Sidecar nicht erreichbar. "
            "Starte den Sidecar zuerst (systemctl start msm-dis-sidecar). "
            "Das Panel enthaelt keine eigene Kryptographie und kann "
            "ohne DIS nicht operieren."
        )

    with engine.begin() as conn:
        klartext_verschluesseln(conn)

    try:
        status = initialize_or_upgrade_schema(engine)
        logger.info("PostgreSQL-Datenbankschema: %s", status)
    except Exception as exc:
        logger.critical(
            "Datenbankschema-Initialisierung/Upgrade fehlgeschlagen: %s. "
            "Bitte führe 'install.sh' aus oder führe die Alembic-Migrationen manuell aus.",
            exc,
        )
        raise


def _bridge_users_and_webhooks(engine, inspector, legacy_schema_bridge: bool) -> None:
    from database import Base

    tables = inspector.get_table_names()
    if legacy_schema_bridge and "users" in tables:
        cols = [c["name"] for c in inspector.get_columns("users")]
        if "email_notifications" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN email_notifications BOOLEAN DEFAULT true"))
        if "email_encrypted" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN email_encrypted VARCHAR(4096)"))
                conn.execute(text("ALTER TABLE users ADD COLUMN email_hash VARCHAR(64)"))
                conn.execute(text("CREATE INDEX ix_users_email_hash ON users (email_hash)"))
        if "role_id" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE users ADD COLUMN role_id INTEGER"))

    if legacy_schema_bridge and "webhook_subscriptions" in tables:
        wh_cols = [c["name"] for c in inspector.get_columns("webhook_subscriptions")]
        if "secret_encrypted" not in wh_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE webhook_subscriptions ADD COLUMN secret_encrypted VARCHAR(4096)"))

    if "singra_webhook_events" not in tables:
        from models.singra_webhook_event import SingraWebhookEvent  # noqa: F401

        SingraWebhookEvent.__table__.create(bind=engine, checkfirst=True)

    if legacy_schema_bridge and "hoster_integrations" in tables:
        hi_cols = [c["name"] for c in inspector.get_columns("hoster_integrations")]
        if "is_sandbox" not in hi_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE hoster_integrations ADD COLUMN is_sandbox BOOLEAN NOT NULL DEFAULT false"))

    if legacy_schema_bridge and "email_verifications" in tables:
        ev_cols = [c["name"] for c in inspector.get_columns("email_verifications")]
        if "email" in ev_cols and "email_hash" not in ev_cols:
            with engine.begin() as conn:
                conn.execute(text("DROP TABLE email_verifications"))
            Base.metadata.create_all(bind=engine)


def _bridge_server_ports_and_columns(engine, inspector, legacy_schema_bridge: bool) -> None:
    if not legacy_schema_bridge:
        return

    tables = inspector.get_table_names()
    if "server_ports" not in tables:
        with engine.begin() as conn:
            conn.execute(text("""
                CREATE TABLE server_ports (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    server_id INTEGER NOT NULL,
                    role VARCHAR(64) NOT NULL,
                    port INTEGER NOT NULL,
                    protocol VARCHAR(16) NOT NULL,
                    FOREIGN KEY(server_id) REFERENCES servers(id) ON DELETE CASCADE
                )
            """))
            conn.execute(text("CREATE INDEX ix_server_ports_id ON server_ports (id)"))

    if "servers" not in tables:
        return

    cols = [c["name"] for c in inspector.get_columns("servers")]
    if "auth_required" not in cols:
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE servers ADD COLUMN auth_required BOOLEAN NOT NULL DEFAULT false"))

    if "game_port" in cols:
        with engine.begin() as conn:
            servers_data = conn.execute(text("SELECT id, game_port, query_port, rcon_port FROM servers")).fetchall()
            for row in servers_data:
                srv_id, g_port, q_port, r_port = row[0], row[1], row[2], row[3]
                if g_port:
                    conn.execute(
                        text("INSERT INTO server_ports (server_id, role, port, protocol) VALUES (:sid, 'game', :port, 'udp')"),
                        {"sid": srv_id, "port": g_port},
                    )
                if q_port:
                    conn.execute(
                        text("INSERT INTO server_ports (server_id, role, port, protocol) VALUES (:sid, 'query', :port, 'udp')"),
                        {"sid": srv_id, "port": q_port},
                    )
                if r_port:
                    conn.execute(
                        text("INSERT INTO server_ports (server_id, role, port, protocol) VALUES (:sid, 'rcon', :port, 'tcp')"),
                        {"sid": srv_id, "port": r_port},
                    )
            try:
                conn.execute(text("ALTER TABLE servers DROP COLUMN game_port"))
                conn.execute(text("ALTER TABLE servers DROP COLUMN query_port"))
                conn.execute(text("ALTER TABLE servers DROP COLUMN rcon_port"))
            except Exception as exc:
                logger.warning("Konnte alte Port-Spalten nicht droppen: %s", exc)
            cols = [c["name"] for c in inspector.get_columns("servers")]

    column_alters = (
        ("backup_on_start", "BOOLEAN DEFAULT false"),
        ("backup_interval_hours", "INTEGER"),
        ("backup_retention_count", "INTEGER DEFAULT 5"),
        ("container_name", "VARCHAR(64)"),
        ("public_bind_ip", "VARCHAR(64)"),
        ("disk_usage_mb", "INTEGER"),
        ("restart_times_utc", "VARCHAR(256)"),
        ("last_auto_restart_attempt_at", "TIMESTAMP"),
        ("last_auto_restart_completed_at", "TIMESTAMP"),
        ("last_auto_restart_status", "VARCHAR(16)"),
        ("last_started_at", "TIMESTAMP"),
    )
    with engine.begin() as conn:
        for col_name, col_def in column_alters:
            if col_name not in cols:
                conn.execute(text(f"ALTER TABLE servers ADD COLUMN {col_name} {col_def}"))
        if "linux_user" in cols:
            conn.execute(text("ALTER TABLE servers DROP COLUMN linux_user"))


def _bridge_mods_and_backups(engine, inspector, legacy_schema_bridge: bool) -> None:
    if not legacy_schema_bridge:
        return

    tables = inspector.get_table_names()
    if "mods" in tables:
        cols = [c["name"] for c in inspector.get_columns("mods")]
        mod_alters = (
            ("enabled", "BOOLEAN DEFAULT true"),
            ("install_status", "VARCHAR(24) NOT NULL DEFAULT 'installed'"),
            ("install_action", "VARCHAR(24)"),
            ("install_progress", "INTEGER"),
            ("install_eta_seconds", "INTEGER"),
            ("install_started_at", "TIMESTAMP"),
            ("install_completed_at", "TIMESTAMP"),
            ("install_error", "TEXT"),
            ("update_status", "VARCHAR(24) NOT NULL DEFAULT 'unknown'"),
            ("update_reason", "VARCHAR(128)"),
            ("update_checked_at", "TIMESTAMP"),
        )
        with engine.begin() as conn:
            for col_name, col_def in mod_alters:
                if col_name not in cols:
                    conn.execute(text(f"ALTER TABLE mods ADD COLUMN {col_name} {col_def}"))

    if "backups" in tables:
        cols = [c["name"] for c in inspector.get_columns("backups")]
        backup_alters = (
            ("name", "VARCHAR(256)"),
            ("s3_key", "VARCHAR(512)"),
            ("s3_bucket", "VARCHAR(255)"),
            ("encrypted", "BOOLEAN NOT NULL DEFAULT false"),
        )
        for col_name, col_def in backup_alters:
            if col_name not in cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE backups ADD COLUMN {col_name} {col_def}"))


def _bridge_oauth_and_e2ee_devices(engine, inspector, legacy_schema_bridge: bool) -> None:
    if not legacy_schema_bridge:
        return

    tables = inspector.get_table_names()
    if "oauth_user_links" in tables:
        ol_cols = [c["name"] for c in inspector.get_columns("oauth_user_links")]
        if "email_at_link_encrypted" not in ol_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE oauth_user_links ADD COLUMN email_at_link_encrypted VARCHAR(4096)"))
        if "username_at_link_encrypted" not in ol_cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE oauth_user_links ADD COLUMN username_at_link_encrypted VARCHAR(4096)"))

    if "oauth_providers" in tables:
        cols = [c["name"] for c in inspector.get_columns("oauth_providers")]
        if "client_secret_mask" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE oauth_providers ADD COLUMN client_secret_mask VARCHAR(64)"))

    if "user_e2ee_devices" in tables:
        cols = [c["name"] for c in inspector.get_columns("user_e2ee_devices")]
        if "is_approved" not in cols:
            with engine.begin() as conn:
                conn.execute(text("ALTER TABLE user_e2ee_devices ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT TRUE"))
        for spalte, typ in (
            ("approved_by", "VARCHAR(64)"),
            ("approval_signature", "TEXT"),
            ("auth_family", "VARCHAR(64)"),
        ):
            if spalte not in cols:
                with engine.begin() as conn:
                    conn.execute(text(f"ALTER TABLE user_e2ee_devices ADD COLUMN {spalte} {typ}"))


def sync_node_and_run_legacy_schema_bridges(engine, is_testing: bool) -> None:
    """Synchronisiert die Node-Registrierung und bedient historische Alt-DB-Brücken."""
    from config import settings
    from database import SessionLocal
    from services.multi_node_migration_service import sync_multi_node_registration

    sync_multi_node_registration(
        engine,
        SessionLocal,
        allow_missing_local_token=is_testing,
        local_agent_enabled=settings.local_agent_enabled,
    )

    inspector = inspect(engine)
    legacy_schema_bridge = "alembic_version" not in inspector.get_table_names()
    _bridge_users_and_webhooks(engine, inspector, legacy_schema_bridge)
    _bridge_server_ports_and_columns(engine, inspector, legacy_schema_bridge)
    _bridge_mods_and_backups(engine, inspector, legacy_schema_bridge)
    _bridge_oauth_and_e2ee_devices(engine, inspector, legacy_schema_bridge)


def seed_system_roles_and_migrate_legacy_permissions(engine) -> None:
    """Seedet eingebaute Rollen und migriert ggf. die alte `permissions`-Tabelle."""
    from database import SessionLocal
    from services.permission_catalog import LEGACY_PERMISSION_MAPPING, SYSTEM_ROLE_USER
    from services.role_service import ensure_system_roles, get_role_by_name

    seed_db = SessionLocal()
    try:
        ensure_system_roles(seed_db)
        user_role = get_role_by_name(seed_db, SYSTEM_ROLE_USER)
        if user_role is not None:
            seed_db.execute(
                text(
                    "UPDATE users SET role_id = :rid "
                    "WHERE role_id IS NULL AND is_owner = :is_owner"
                ),
                {"rid": user_role.id, "is_owner": False},
            )
            seed_db.commit()
    finally:
        seed_db.close()

    inspector = inspect(engine)
    legacy_schema_bridge = "alembic_version" not in inspector.get_table_names()
    if not (legacy_schema_bridge and "permissions" in inspector.get_table_names()):
        return

    legacy_cols = {c["name"] for c in inspector.get_columns("permissions")}
    select_cols = [c for c in LEGACY_PERMISSION_MAPPING.keys() if c in legacy_cols]
    if not select_cols:
        with engine.begin() as conn:
            conn.execute(text("DROP TABLE permissions"))
        return

    migrated = 0
    with engine.begin() as conn:
        rows = conn.execute(
            text("SELECT id, user_id, server_id, " + ", ".join(select_cols) + " FROM permissions")
        ).fetchall()
        for row in rows:
            desired_keys: set[str] = set()
            for col in select_cols:
                if getattr(row, col):
                    desired_keys.update(LEGACY_PERMISSION_MAPPING[col])
            if desired_keys:
                desired_keys.add("server.view")
            for key in desired_keys:
                exists = conn.execute(
                    text(
                        "SELECT id FROM server_permissions "
                        "WHERE user_id = :uid AND server_id = :sid AND permission_key = :key"
                    ),
                    {"uid": row.user_id, "sid": row.server_id, "key": key},
                ).first()
                if exists is None:
                    conn.execute(
                        text(
                            "INSERT INTO server_permissions "
                            "(user_id, server_id, permission_key, granted_at) "
                            "VALUES (:uid, :sid, :key, :ts)"
                        ),
                        {
                            "uid": row.user_id,
                            "sid": row.server_id,
                            "key": key,
                            "ts": datetime.now(timezone.utc),
                        },
                    )
                    migrated += 1
        conn.execute(text("DROP TABLE permissions"))
    if migrated:
        logger.info("Phase-3 RBAC-Migration: %d Permission-Eintraege migriert.", migrated)


def _is_worker_role() -> bool:
    """True if this process runs background schedulers and startup recovery."""
    from config import settings

    mode = (getattr(settings, "worker_mode", "all") or "all").strip().lower()
    return mode in {"all", "worker"}


def init_local_agent_and_background_jobs(is_testing: bool) -> None:
    """Initialisiert Firewall/Port-Manager, Managed-PostgreSQL und DIS-Altbestand."""
    from config import settings

    if not _is_worker_role():
        logger.info("Worker-Modus '%s': Hintergrund-Init im HTTP-Worker übersprungen.", settings.worker_mode)
        return

    if settings.local_agent_enabled:
        try:
            from services.docker_iptables_service import ensure_baseline_drop
            from services.firewall_service import cleanup_legacy_msm_ranges

            removed = cleanup_legacy_msm_ranges()
            if removed:
                logger.info("Port-Manager: %d Legacy-MSM-Range(s) aus UFW entfernt.", removed)
            ensure_baseline_drop()
        except Exception as exc:
            logger.warning("Phase-2 Port-Manager-Init partiell fehlgeschlagen: %s", exc)

        if is_testing:
            try:
                from database import SessionLocal
                from services.postgres_service import ensure_internal_postgres

                with SessionLocal() as pg_db:
                    ensure_internal_postgres(pg_db)
            except Exception as exc:
                logger.warning("Managed-PostgreSQL beim Panel-Start nicht bereit: %s", exc)
        else:
            async def _bg_ensure_postgres():
                try:
                    from database import SessionLocal
                    from services.postgres_service import ensure_internal_postgres

                    def _run():
                        with SessionLocal() as pg_db:
                            ensure_internal_postgres(pg_db)

                    await asyncio.to_thread(_run)
                except Exception as exc:
                    logger.warning("Managed-PostgreSQL beim Panel-Start nicht bereit: %s", exc)

            asyncio.create_task(_bg_ensure_postgres())

    if not is_testing:
        async def _bg_dis_altbestand():
            try:
                from database import SessionLocal
                from services.dis_altbestand import beim_start
                from services.dis_client import DisSidecarError

                def _run():
                    with SessionLocal() as alt_db:
                        beim_start(alt_db)

                await asyncio.to_thread(_run)
            except Exception as exc:
                from services.dis_client import DisSidecarError

                logger.warning(
                    "DIS-Altbestand nicht nachgezogen: %s",
                    exc if isinstance(exc, DisSidecarError) else type(exc).__name__,
                )

        asyncio.create_task(_bg_dis_altbestand())


def subscribe_remote_backplane(app: FastAPI, is_testing: bool) -> None:
    """Starts the Redis Pub/Sub subscriber for cross-worker state & streams."""
    import asyncio
    from services import redis_backplane

    if not redis_backplane.is_redis_enabled():
        return

    async def _on_settings_invalidate(_channel: str, _payload: dict) -> None:
        from services.panel_settings_service import PanelSettingsService

        PanelSettingsService.invalidate_cache()

    async def _on_sync_event(_channel: str, payload: dict) -> None:
        from services.sync_event_service import SyncEventService

        SyncEventService.handle_remote_event(payload)

    async def _on_console_event(channel: str, payload: dict) -> None:
        from services import console_stream_service

        await console_stream_service.handle_remote_console_message(channel, payload)

    async def _on_ai_run_event(channel: str, payload: dict) -> None:
        from services import ai_run_broker

        await ai_run_broker.handle_remote_event(channel, payload)

    handlers = [
        (redis_backplane.CHANNEL_SETTINGS_INVALIDATE, _on_settings_invalidate),
        (redis_backplane.CHANNEL_SYNC_EVENTS, _on_sync_event),
        (f"{redis_backplane.CHANNEL_CONSOLE_PREFIX}*", _on_console_event),
        (f"{redis_backplane.CHANNEL_AI_RUN_PREFIX}*", _on_ai_run_event),
    ]
    app.state._redis_pubsub_task = asyncio.create_task(
        redis_backplane.run_pubsub_subscriber(handlers),
        name="msm-redis-pubsub",
    )


def recover_scheduler_and_cleanup_expired() -> None:
    """Startet den Scheduler, gleicht Server-Status ab und räumt abgelaufene Token auf."""
    if not _is_worker_role():
        return
    from database import SessionLocal
    from services.operation_task_service import recover_interrupted_tasks
    from services.scheduler_service import init_server_schedules, start_scheduler
    from services.server_lifecycle_service import (
        reconcile_orphaned_lifecycle_statuses,
        recover_servers_after_docker_restart,
    )

    start_scheduler()
    db = SessionLocal()
    try:
        recovered_tasks = recover_interrupted_tasks(db)
        if recovered_tasks:
            logger.info("%d offene Backend-Aufgabe(n) nach Panel-Start abgeglichen.", recovered_tasks)
        reconciled = reconcile_orphaned_lifecycle_statuses(db)
        if reconciled:
            logger.info(
                "Lifecycle-Status für %d Server nach Panel-Start mit Docker abgeglichen.",
                reconciled,
            )
        recovered_servers = recover_servers_after_docker_restart(db)
        if recovered_servers:
            logger.info(
                "Wiederanlauf nach Docker-Daemon-Restart für %d Server gestartet: %s",
                len(recovered_servers),
                recovered_servers,
            )
        from services.frontend_deploy_service import (
            prune_all_old_deployments,
            reconcile_orphaned_frontend_deployments,
        )

        reconciled_builds = reconcile_orphaned_frontend_deployments(db, max_age_hours=0)
        if reconciled_builds:
            logger.info(
                "%d verwaiste(r) Frontend-Build(s) nach Panel-Start bereinigt.",
                reconciled_builds,
            )
        pruned_builds = prune_all_old_deployments(db)
        if pruned_builds:
            logger.info(
                "%d alte/fehlgeschlagene Frontend-Deployment(s) beim Start aufgeraeumt.",
                pruned_builds,
            )
        init_server_schedules(db)
    finally:
        db.close()

    _run_startup_cleanup("OAuth-LoginChallenge-Cleanup", "services.login_challenge_service", "cleanup_expired")
    _run_startup_cleanup("KI-Freigaben-Cleanup", "services.ai_approval_service", "abgelaufene_aufraeumen")
    _run_startup_cleanup("E2EE-Nachrichten-Cleanup", "services.social.messages_service", "cleanup_expired")


def _run_startup_cleanup(label: str, module_path: str, fn_name: str) -> None:
    import importlib

    from database import SessionLocal

    try:
        mod = importlib.import_module(module_path)
        cleanup_fn = getattr(mod, fn_name)
        db = SessionLocal()
        try:
            cleanup_fn(db)
        finally:
            db.close()
    except Exception as exc:
        logger.warning("%s fehlgeschlagen: %s", label, exc)


async def reconcile_ai_runs_on_startup() -> None:
    """Gleicht unterbrochene KI-Streams, Aktionen, Reservierungen und Worker ab."""
    if not _is_worker_role():
        return
    from database import SessionLocal
    from services.ai_chat_service import reconcile_interrupted_ai_streams
    from services.ai_proposal_service import reconcile_interrupted_actions
    from services.ai_run_service import (
        unterbrochene_laeufe_abgleichen,
        worker_wiederanlauf_saehen,
    )
    from services.ai_usage_service import verwaiste_reservierungen_abgleichen

    recovery_db = SessionLocal()
    try:
        reconcile_interrupted_ai_streams(recovery_db)
        reconcile_interrupted_actions(recovery_db)
        verwaist = verwaiste_reservierungen_abgleichen(recovery_db)
        if verwaist:
            logger.info("%d verwaiste KI-Reservierung(en) nach Panel-Start abgerechnet.", verwaist)
        unterbrochene = unterbrochene_laeufe_abgleichen(recovery_db)
        if unterbrochene:
            logger.info("%d unterbrochene(r) KI-Lauf/Laeufe nach Panel-Start abgeschlossen.", unterbrochene)
        gesaet = await worker_wiederanlauf_saehen(recovery_db)
        if gesaet:
            logger.info("%d Worker nach Panel-Start wiederangelaufen.", gesaet)
    finally:
        recovery_db.close()


async def shutdown_panel_services(app: FastAPI, is_testing: bool) -> None:
    """Beendet SSE/WebSockets, Hintergrund-Worker, HTTP-Clients, Scheduler und Steam."""
    from services.scheduler_service import stop_scheduler
    from services.steam_service import close_steam_service

    try:
        from services.sync_event_service import SyncEventService

        SyncEventService.close_all()
    except Exception as exc:
        logger.debug("SyncEventService.close_all bei Shutdown: %s", exc)

    if not is_testing:
        from services import ai_mail_outbox, ai_model_catalog

        await ai_model_catalog.aufraeumen()
        await ai_mail_outbox.aufraeumen()

    await app.state.http_client.aclose()
    await app.state.ai_http_client.aclose()

    from services.ai_geo_image_service import shutdown_http_client as shutdown_geo_image_http_client
    from services.ai_geo_service import shutdown_http_client as shutdown_geo_http_client
    from services.ai_regional_connectors_service import shutdown_http_client as shutdown_regional_connectors_http_client
    from services.ai_satellite_service import shutdown_http_client as shutdown_satellite_http_client
    from services.ai_web_search_service import shutdown_http_client
    from services.calendar_service import shutdown_caldav_client
    from services.oauth_service import close_http_client as shutdown_oauth_http_client

    shutdown_caldav_client()
    shutdown_http_client()
    shutdown_geo_http_client()
    shutdown_regional_connectors_http_client()
    shutdown_satellite_http_client()
    shutdown_geo_image_http_client()
    shutdown_oauth_http_client()
    stop_scheduler()
    await close_steam_service()

    pubsub_task = getattr(app.state, "_redis_pubsub_task", None)
    if pubsub_task is not None:
        pubsub_task.cancel()
        try:
            await pubsub_task
        except Exception:
            pass
    try:
        from services import redis_backplane

        await redis_backplane.aclose_async_clients()
    except Exception:
        pass
