"""Panel-to-Agent Guardian reconciliation and commit-before-ACK delivery."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

_MAX_ERROR_MESSAGE_LEN = 200

def _sanitize_error_message(exc: Exception) -> str:
    """Truncate and strip potential secrets from exception messages."""
    raw = str(exc)
    # Remove anything that looks like a connection string, URL with credentials,
    # or absolute filesystem path from error messages before persisting them.
    import re as _re
    raw = _re.sub(r'(?i)\b(?:postgres(?:ql)?|mysql|redis)://[^\s]+', '[REDACTED_URL]', raw)
    raw = _re.sub(r'(?i)bearer\s+\S+', 'Bearer [REDACTED]', raw)
    raw = _re.sub(r'/(?:opt|var|etc|home|tmp)/[^\s:"]+', '[REDACTED_PATH]', raw)
    return raw[:_MAX_ERROR_MESSAGE_LEN]

from games import get_plugin
from models import Server
from services.guardian_runtime_compiler import (
    GuardianCompileError,
    compile_desired_state as compile_state,
    validate_agent_capabilities,
)
from services.guardian_state_service import ensure_guardian_config_generation
from services.node_client import NodeClient
from services.guardian_incident_service import ingest_incidents_and_ack


logger = logging.getLogger(__name__)

_OBSERVED_STATES = frozenset(
    {
        "unknown",
        "stopped",
        "starting",
        "healthy",
        "degraded",
        "unhealthy",
        "recovering",
        "verifying",
        "quarantined",
        "disabled",
    }
)


class GuardianContractError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


class GuardianSyncMismatchError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


_ALLOWED_CONTAINER_STATES = frozenset(
    {
        "created",
        "restarting",
        "running",
        "removing",
        "paused",
        "exited",
        "dead",
        "missing",
        "unknown",
        "stopped",
        "installing",
        "updating",
        "error",
        "awaiting_files",
    }
)


def _parse_datetime(value: Any) -> datetime:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            raise GuardianContractError("guardian_invalid_observed_timestamp", "Naive datetime objects are not allowed")
        return value.astimezone(timezone.utc)
    if not value:
        raise GuardianContractError("guardian_invalid_observed_timestamp", "Timestamp is empty")
    try:
        val_str = str(value)
        if val_str.endswith("Z"):
            val_str = val_str[:-1] + "+00:00"
        parsed = datetime.fromisoformat(val_str)
    except (TypeError, ValueError) as exc:
        raise GuardianContractError("guardian_invalid_observed_timestamp", f"Invalid timestamp: {value}") from exc
    if parsed.tzinfo is None:
        raise GuardianContractError("guardian_invalid_observed_timestamp", f"Naive timestamp strings are not allowed: {value}")
    return parsed.astimezone(timezone.utc)


def compile_desired_state(
    db: Session,
    server: Server,
    *,
    capabilities: dict | None = None,
) -> dict:
    plugin = get_plugin(server.game_type)
    if plugin is None and getattr(server, "game_type", None) in ("custom", None, ""):
        plugin = get_plugin("node_backend")
    blueprint = plugin.get_blueprint() if plugin else None
    if blueprint is None:
        raise GuardianCompileError("blueprint_unavailable", "Guardian Blueprint is unavailable")
    ensure_guardian_config_generation(db, server, blueprint)
    payload = compile_state(server, blueprint)
    if capabilities is not None:
        validate_agent_capabilities(payload, capabilities)
    return payload


def compile_and_sync_desired_state(
    db: Session,
    server: Server,
) -> dict:
    node = server.node
    if node is None or node.status != "online":
        raise RuntimeError("Guardian node is not online")
    client = NodeClient.from_node(node, timeout=5.0)
    capabilities = client.get_guardian_capabilities()
    payload = compile_desired_state(db, server, capabilities=capabilities)
    acknowledgement = client.set_desired_state(f"msm-srv-{server.id}", payload)
    _validate_desired_state_acknowledgement(acknowledgement, payload)
    return payload


def _validate_desired_state_acknowledgement(
    acknowledgement: Any,
    payload: dict[str, Any],
) -> None:
    """Verify the Agent's atomic desired-state persistence acknowledgement."""
    if not isinstance(acknowledgement, dict):
        raise GuardianSyncMismatchError(
            "guardian_desired_state_ack_invalid",
            "Agent returned an invalid desired-state acknowledgement",
        )

    expected_generation = payload.get("generation")
    accepted_generation = acknowledgement.get("generation")
    if accepted_generation != expected_generation:
        raise GuardianSyncMismatchError(
            "guardian_generation_mismatch",
            f"Generation mismatch: expected {expected_generation}, accepted {accepted_generation}",
        )

    expected_payload_hash = payload.get("payload_hash")
    accepted_payload_hash = acknowledgement.get("payload_hash")
    if accepted_payload_hash != expected_payload_hash:
        raise GuardianSyncMismatchError(
            "guardian_payload_hash_mismatch",
            f"Payload hash mismatch: expected {expected_payload_hash}, accepted {accepted_payload_hash}",
        )

def _parse_and_validate_observed(observed: dict[str, Any], expected_server_id: int) -> dict[str, Any]:
    """Validate and normalize Agent observed Guardian state."""
    import re as _re

    required_fields = [
        "schema_version",
        "supported_schema_version",
        "server_id",
        "accepted_generation",
        "payload_hash",
        "guardian_observed_state",
        "observed_runtime_state",
        "container_state",
        "active_incident_uuid",
        "last_probe_at",
        "last_transition_at",
    ]
    for field in required_fields:
        if field not in observed:
            raise GuardianContractError("guardian_missing_observed_field", f"Missing {field}")

    if observed.get("schema_version") != 1:
        raise GuardianContractError("guardian_schema_version_mismatch", "Schema version mismatch")
    if observed.get("supported_schema_version") != 1:
        raise GuardianContractError("guardian_schema_version_mismatch", "Supported schema version mismatch")
    if observed.get("server_id") != expected_server_id:
        raise GuardianContractError("guardian_server_id_mismatch", "Server ID mismatch")

    accepted_generation = observed.get("accepted_generation")
    if type(accepted_generation) is not int:
        raise GuardianContractError("guardian_invalid_observed_field", "accepted_generation must be an integer")

    accepted_payload_hash = observed.get("payload_hash")
    if (
        not accepted_payload_hash
        or type(accepted_payload_hash) is not str
        or not _re.match(r"^sha256:[a-f0-9]{64}$", accepted_payload_hash)
    ):
        raise GuardianContractError("guardian_invalid_observed_field", "Invalid payload_hash format")

    observed_state = observed.get("guardian_observed_state")
    observed_runtime_state = observed.get("observed_runtime_state")
    if observed_state != observed_runtime_state:
        raise GuardianContractError("guardian_observed_state_mismatch", "Observed states do not match")

    if observed_state not in _OBSERVED_STATES:
        raise GuardianContractError("guardian_invalid_observed_field", "Agent returned an invalid Guardian observed state")

    container_state = observed.get("container_state")
    if container_state not in _ALLOWED_CONTAINER_STATES:
        raise GuardianContractError("guardian_invalid_observed_field", f"Agent returned an invalid container state: {container_state}")

    q_data = observed.get("quarantine")
    if q_data is not None and not isinstance(q_data, dict):
        raise GuardianContractError("guardian_invalid_observed_field", "quarantine must be null or an object")

    rs_data = observed.get("recovery_suspension")
    if rs_data is not None and not isinstance(rs_data, dict):
        raise GuardianContractError("guardian_invalid_observed_field", "recovery_suspension must be null or an object")

    probe_ts = observed.get("last_probe_at")
    trans_ts = observed.get("last_transition_at")
    probe_dt = _parse_datetime(probe_ts) if probe_ts else None
    if trans_ts is None:
        raise GuardianContractError("guardian_missing_observed_field", "Missing last_transition_at")
    trans_dt = _parse_datetime(trans_ts)

    return {
        "accepted_generation": accepted_generation,
        "accepted_payload_hash": accepted_payload_hash,
        "observed_state": observed_state,
        "container_state": container_state,
        "q_data": q_data,
        "q_json": json.dumps(q_data, sort_keys=True, separators=(",", ":")) if q_data is not None else None,
        "rs_json": json.dumps(rs_data, sort_keys=True, separators=(",", ":")) if rs_data is not None else None,
        "probe_dt": probe_dt,
        "trans_dt": trans_dt,
        "active_incident_uuid": observed.get("active_incident_uuid"),
    }


def _apply_observed_to_server(
    db: Session,
    server: Server,
    parsed: dict[str, Any],
    *,
    desired_acknowledgement: dict[str, Any] | None,
    payload: dict[str, Any] | None,
) -> str:
    """Persist validated observed state and verify generation/hash alignment."""
    observed_state = parsed["observed_state"]
    container_state = parsed["container_state"]
    accepted_generation = parsed["accepted_generation"]
    accepted_payload_hash = parsed["accepted_payload_hash"]
    q_data = parsed["q_data"]

    server.guardian_observed_state = observed_state
    server.guardian_container_status = container_state
    if container_state in ("exited", "dead", "stopped", "missing") and server.status == "running":
        server.status = "stopped"
        from games.base import _append_console_log
        from services.console_stream_service import append_msm_log_to_memory

        crash_msg = f"[MSM] Container unerwartet beendet: status={container_state}\n"
        _append_console_log(server.id, crash_msg)
        append_msm_log_to_memory(server.id, crash_msg.rstrip("\n"))
        try:
            from services.server_lifecycle_service import _ports
            from services.firewall_service import close_ports

            close_ports(
                _ports(server),
                node=server.node,
                name=server.name,
                db=db,
                server_id=server.id,
                reason="Crash-Cleanup (Guardian/Sync)",
            )
        except Exception as exc:
            logger.warning("Failed to auto-close ports for crashed server %s: %s", server.id, exc)

    server.guardian_active_incident_uuid = parsed["active_incident_uuid"]
    server.guardian_probe_timestamp = parsed["probe_dt"]
    server.guardian_transition_timestamp = parsed["trans_dt"]
    server.guardian_agent_quarantine_json = parsed["q_json"]
    server.guardian_agent_recovery_suspension_json = parsed["rs_json"]
    if desired_acknowledgement is not None:
        server.guardian_accepted_generation = desired_acknowledgement["generation"]
        server.guardian_accepted_payload_hash = desired_acknowledgement["payload_hash"]
    else:
        server.guardian_accepted_generation = accepted_generation
        server.guardian_accepted_payload_hash = accepted_payload_hash

    if (
        q_data is None
        and server.guardian_quarantine_control is not None
        and accepted_generation == server.desired_state_generation
    ):
        server.guardian_quarantine_control = None
        server.desired_state_generation = int(server.desired_state_generation or 0) + 1

    if payload is not None:
        expected_generation = payload.get("generation")
        expected_payload_hash = payload.get("payload_hash")

        if desired_acknowledgement is None and accepted_generation != expected_generation:
            err_data = {
                "code": "guardian_generation_mismatch",
                "expected_generation": expected_generation,
                "accepted_generation": accepted_generation,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            server.guardian_sync_error_statistics = json.dumps(err_data, sort_keys=True, separators=(",", ":"))
            db.commit()
            db.refresh(server)
            raise GuardianSyncMismatchError(
                "guardian_generation_mismatch",
                f"Generation mismatch: expected {expected_generation}, accepted {accepted_generation}",
            )

        if desired_acknowledgement is None and accepted_payload_hash != expected_payload_hash:
            err_data = {
                "code": "guardian_payload_hash_mismatch",
                "expected_payload_hash": expected_payload_hash,
                "accepted_payload_hash": accepted_payload_hash,
                "timestamp": datetime.now(timezone.utc).isoformat(),
            }
            server.guardian_sync_error_statistics = json.dumps(err_data, sort_keys=True, separators=(",", ":"))
            db.commit()
            db.refresh(server)
            raise GuardianSyncMismatchError(
                "guardian_payload_hash_mismatch",
                f"Payload hash mismatch: expected {expected_payload_hash}, accepted {accepted_payload_hash}",
            )

        server.guardian_last_sync_at = datetime.now(timezone.utc)
        server.guardian_sync_error_statistics = None

    db.commit()
    return observed_state


def _compile_error_dict(exc: Exception) -> dict[str, Any]:
    if isinstance(exc, GuardianCompileError):
        return {
            "code": exc.code,
            "message": exc.message,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    return {
        "last_error": type(exc).__name__,
        "last_error_message": _sanitize_error_message(exc),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


def reconcile_guardian_server(
    db: Session,
    server: Server,
    *,
    node_client: NodeClient | None = None,
) -> dict[str, Any]:
    # Caddy-managed Web-Server laufen nicht als Docker-Container.
    # Guardian prüft stattdessen HTTP-Erreichbarkeit (probe_url) und markiert nicht fälschlich 'stopped'.
    if server.container_name == "caddy-managed" or server.game_type == "web_static":
        import httpx
        from services import server_runtime_env

        probe_url = server_runtime_env.get_probe_url(server.id, db=db)
        if not probe_url:
            ports = [p.port for p in (server.ports or []) if p.role == "web"]
            port = ports[0] if ports else 80
            probe_url = f"http://127.0.0.1:{port}/"

        is_healthy = False
        try:
            with httpx.Client(timeout=2.0) as http_client:
                resp = http_client.get(probe_url)
                is_healthy = resp.status_code == 200
        except Exception:
            is_healthy = False

        now = datetime.now(timezone.utc)
        if server.desired_power_state == "running":
            server.status = "running" if is_healthy else "stopped"
            server.guardian_observed_state = "healthy" if is_healthy else "stopped"
            server.guardian_container_status = "running" if is_healthy else "stopped"
        else:
            server.status = "stopped"
            server.guardian_observed_state = "stopped"
            server.guardian_container_status = "stopped"

        server.guardian_probe_timestamp = now
        server.guardian_transition_timestamp = now
        db.commit()
        return {
            "status": "synchronized",
            "server_id": server.id,
            "managed_by": "caddy",
            "healthy": is_healthy,
        }

    node = server.node
    if node is None or node.status != "online":
        raise RuntimeError("Guardian node is not online")
    try:
        client = node_client or NodeClient.from_node(node, timeout=5.0)

        capabilities = client.get_guardian_capabilities()
        payload = None
        desired_acknowledgement = None
        try:
            payload = compile_desired_state(db, server, capabilities=capabilities)
            server.guardian_last_payload_hash = payload.get("payload_hash")
            raw_acknowledgement = client.set_desired_state(f"msm-srv-{server.id}", payload)
            if isinstance(raw_acknowledgement, dict):
                _validate_desired_state_acknowledgement(raw_acknowledgement, payload)
                desired_acknowledgement = raw_acknowledgement
        except GuardianSyncMismatchError:
            raise
        except Exception as compile_exc:
            payload = None
            logger.warning("Guardian desired state compilation/sync failed for server %s: %s", server.id, compile_exc)
            server.guardian_sync_error_statistics = json.dumps(
                _compile_error_dict(compile_exc), sort_keys=True, separators=(",", ":")
            )
            db.commit()

        container_name = f"msm-srv-{server.id}"
        observed = client.get_guardian_state(container_name)
        parsed = _parse_and_validate_observed(observed, server.id)
        observed_state = _apply_observed_to_server(
            db,
            server,
            parsed,
            desired_acknowledgement=desired_acknowledgement,
            payload=payload,
        )
        accepted_generation = parsed["accepted_generation"]
        accepted_payload_hash = parsed["accepted_payload_hash"]

    except GuardianSyncMismatchError:
        raise
    except GuardianContractError as exc:
        db.rollback()
        err_data = {
            "code": exc.code,
            "message": exc.message,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            server.guardian_sync_error_statistics = json.dumps(err_data, sort_keys=True, separators=(",", ":"))
            db.commit()
            db.refresh(server)
        except Exception:
            db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        error_info = {
            "last_error": type(exc).__name__,
            "last_error_message": _sanitize_error_message(exc),
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        try:
            server.guardian_sync_error_statistics = json.dumps(error_info)
            db.commit()
            db.refresh(server)
        except Exception:
            db.rollback()

        import requests
        from services.node_client import NodeClientError

        if isinstance(exc, (NodeClientError, requests.exceptions.RequestException, ConnectionError)):
            logger.warning("Transient Guardian sync error for server %s: %s", server.id, exc)
            return {
                "payload_hash": None,
                "generation": None,
                "observed_state": "unknown",
                "acknowledged_incidents": [],
            }

        raise

    if (
        payload is not None
        and payload.get("guardian_enabled") is True
        and accepted_generation == payload.get("generation")
        and accepted_payload_hash == payload.get("payload_hash")
    ):
        from services.guardian_restart_service import _trigger_guardian_auto_restart

        _trigger_guardian_auto_restart(db, server.id)

    try:
        incidents = client.get_incidents(container_name)
        acknowledged = ingest_incidents_and_ack(db, server, client, container_name, incidents)
    except Exception as exc:
        error_info = {
            "last_error": type(exc).__name__,
            "last_error_message": _sanitize_error_message(exc),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "context": "incident_sync",
        }
        try:
            server.guardian_sync_error_statistics = json.dumps(error_info, sort_keys=True, separators=(",", ":"))
            db.commit()
        except Exception:
            db.rollback()
        raise
    db.commit()
    db.refresh(server)

    return {
        "payload_hash": payload.get("payload_hash") if payload else None,
        "generation": payload.get("generation") if payload else None,
        "observed_state": observed_state,
        "acknowledged_incidents": acknowledged,
    }


def reconcile_guardian_server_detached(
    server_id: int,
    *,
    node_client: NodeClient,
    session_factory: Any,
) -> dict[str, Any]:
    """Session-hygienic Guardian reconcile: closes DB sessions across Node HTTP calls."""
    import requests
    from services.node_client import NodeClientError

    db = session_factory()
    try:
        server = db.query(Server).filter(Server.id == server_id).first()
        if not server:
            return {"status": "missing"}
        is_caddy = server.container_name == "caddy-managed" or server.game_type == "web_static"
        if is_caddy:
            return reconcile_guardian_server(db, server, node_client=node_client)
        node = server.node
        if node is None or node.status != "online":
            raise RuntimeError("Guardian node is not online")
    finally:
        db.close()

    container_name = f"msm-srv-{server_id}"
    payload: dict[str, Any] | None = None
    desired_acknowledgement: dict[str, Any] | None = None
    compile_error: dict[str, Any] | None = None

    try:
        # Phase 1 (HTTP only, 0 DB sessions): query capabilities
        capabilities = node_client.get_guardian_capabilities()

        # Phase 2 (short DB read): compile desired state
        db = session_factory()
        try:
            server = db.query(Server).filter(Server.id == server_id).first()
            if not server:
                return {"status": "missing"}
            payload = compile_desired_state(db, server, capabilities=capabilities)
            server.guardian_last_payload_hash = payload.get("payload_hash")
            db.commit()
        except Exception as compile_exc:
            payload = None
            compile_error = _compile_error_dict(compile_exc)
            logger.warning("Guardian desired state compilation failed for server %s: %s", server_id, compile_exc)
        finally:
            db.close()

        # Phase 3 (HTTP only, 0 DB sessions): push desired state + read observed state
        if payload is not None:
            try:
                raw_acknowledgement = node_client.set_desired_state(container_name, payload)
                if isinstance(raw_acknowledgement, dict):
                    _validate_desired_state_acknowledgement(raw_acknowledgement, payload)
                    desired_acknowledgement = raw_acknowledgement
            except GuardianSyncMismatchError:
                raise
            except Exception as sync_exc:
                payload = None
                compile_error = _compile_error_dict(sync_exc)
                logger.warning("Guardian desired state sync failed for server %s: %s", server_id, sync_exc)

        observed = node_client.get_guardian_state(container_name)
        parsed = _parse_and_validate_observed(observed, server_id)

        # Phase 4 (short DB write): persist observed state
        db = session_factory()
        try:
            server = db.query(Server).filter(Server.id == server_id).first()
            if not server:
                return {"status": "missing"}
            if compile_error is not None:
                server.guardian_sync_error_statistics = json.dumps(
                    compile_error, sort_keys=True, separators=(",", ":")
                )
                db.commit()
            observed_state = _apply_observed_to_server(
                db,
                server,
                parsed,
                desired_acknowledgement=desired_acknowledgement,
                payload=payload,
            )
            accepted_generation = parsed["accepted_generation"]
            accepted_payload_hash = parsed["accepted_payload_hash"]
            if (
                payload is not None
                and payload.get("guardian_enabled") is True
                and accepted_generation == payload.get("generation")
                and accepted_payload_hash == payload.get("payload_hash")
            ):
                from services.guardian_restart_service import _trigger_guardian_auto_restart

                _trigger_guardian_auto_restart(db, server.id)
                db.commit()
        finally:
            db.close()
    except GuardianSyncMismatchError:
        raise
    except GuardianContractError as exc:
        err_db = session_factory()
        try:
            srv = err_db.query(Server).filter(Server.id == server_id).first()
            if srv:
                err_data = {
                    "code": exc.code,
                    "message": exc.message,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                }
                srv.guardian_sync_error_statistics = json.dumps(err_data, sort_keys=True, separators=(",", ":"))
                err_db.commit()
        except Exception:
            err_db.rollback()
        finally:
            err_db.close()
        raise
    except Exception as exc:
        err_db = session_factory()
        try:
            srv = err_db.query(Server).filter(Server.id == server_id).first()
            if srv:
                srv.guardian_sync_error_statistics = json.dumps(
                    {
                        "last_error": type(exc).__name__,
                        "last_error_message": _sanitize_error_message(exc),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                    }
                )
                err_db.commit()
        except Exception:
            err_db.rollback()
        finally:
            err_db.close()

        if isinstance(exc, (NodeClientError, requests.exceptions.RequestException, ConnectionError)):
            logger.warning("Transient Guardian sync error for server %s: %s", server_id, exc)
            return {
                "payload_hash": None,
                "generation": None,
                "observed_state": "unknown",
                "acknowledged_incidents": [],
            }
        raise

    # Phase 5: fetch incidents with 0 DB sessions open, then commit ACK in short session
    try:
        incidents = node_client.get_incidents(container_name)
        inc_db = session_factory()
        try:
            srv = inc_db.query(Server).filter(Server.id == server_id).first()
            acknowledged = (
                ingest_incidents_and_ack(inc_db, srv, node_client, container_name, incidents)
                if srv is not None
                else []
            )
            inc_db.commit()
        finally:
            inc_db.close()
    except Exception as exc:
        err_db = session_factory()
        try:
            srv = err_db.query(Server).filter(Server.id == server_id).first()
            if srv:
                srv.guardian_sync_error_statistics = json.dumps(
                    {
                        "last_error": type(exc).__name__,
                        "last_error_message": _sanitize_error_message(exc),
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "context": "incident_sync",
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                )
                err_db.commit()
        except Exception:
            err_db.rollback()
        finally:
            err_db.close()
        raise

    return {
        "payload_hash": payload.get("payload_hash") if payload else None,
        "generation": payload.get("generation") if payload else None,
        "observed_state": observed_state,
        "acknowledged_incidents": acknowledged,
    }
