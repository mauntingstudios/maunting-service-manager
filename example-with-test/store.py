"""Local SQLite persistence for the external Phase 8 test shop.

Stores customer orders, Stripe session/subscription mappings, MSM service
contracts, and verified incoming webhook deliveries strictly outside MSM.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class ShopStore:
    """Thread-safe SQLite store for contracts, Stripe links, and webhook logs."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._init_db()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _init_db(self) -> None:
        with self._lock, self._connect() as conn:
            conn.executescript(
                """
                CREATE TABLE IF NOT EXISTS contracts (
                    external_service_id TEXT PRIMARY KEY,
                    external_subject TEXT NOT NULL,
                    email TEXT,
                    item_kind TEXT NOT NULL DEFAULT 'server',
                    plan_id INTEGER,
                    product_key TEXT,
                    addon_slug TEXT,
                    ram_mb INTEGER,
                    cpu_percent INTEGER,
                    slots INTEGER,
                    variables_json TEXT NOT NULL DEFAULT '{}',
                    stripe_checkout_session_id TEXT,
                    stripe_customer_id TEXT,
                    stripe_subscription_id TEXT,
                    stripe_payment_intent_id TEXT,
                    payment_status TEXT NOT NULL DEFAULT 'pending',
                    desired_state TEXT NOT NULL DEFAULT 'active',
                    msm_status TEXT NOT NULL DEFAULT 'pending',
                    msm_status_code TEXT,
                    msm_server_id INTEGER,
                    msm_correlation_id TEXT,
                    msm_terminate_after TEXT,
                    msm_updated_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS webhook_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    external_service_id TEXT,
                    correlation_id TEXT,
                    signature_valid INTEGER NOT NULL,
                    payload_json TEXT NOT NULL,
                    received_at TEXT NOT NULL
                );
                """
            )

    def upsert_contract(self, data: dict[str, Any]) -> dict[str, Any]:
        now = _utc_now()
        service_id = str(data["external_service_id"])
        with self._lock, self._connect() as conn:
            existing = conn.execute(
                "SELECT * FROM contracts WHERE external_service_id = ?",
                (service_id,),
            ).fetchone()
            variables_json = json.dumps(data.get("variables") or {}, ensure_ascii=False)
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO contracts (
                        external_service_id, external_subject, email, item_kind,
                        plan_id, product_key, addon_slug, ram_mb, cpu_percent, slots,
                        variables_json, stripe_checkout_session_id, stripe_customer_id,
                        stripe_subscription_id, stripe_payment_intent_id, payment_status,
                        desired_state, msm_status, msm_status_code, msm_server_id,
                        msm_correlation_id, msm_terminate_after, msm_updated_at,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        service_id,
                        data["external_subject"],
                        data.get("email"),
                        data.get("item_kind", "server"),
                        data.get("plan_id"),
                        data.get("product_key"),
                        data.get("addon_slug"),
                        data.get("ram_mb"),
                        data.get("cpu_percent"),
                        data.get("slots"),
                        variables_json,
                        data.get("stripe_checkout_session_id"),
                        data.get("stripe_customer_id"),
                        data.get("stripe_subscription_id"),
                        data.get("stripe_payment_intent_id"),
                        data.get("payment_status", "pending"),
                        data.get("desired_state", "active"),
                        data.get("msm_status", "pending"),
                        data.get("msm_status_code"),
                        data.get("msm_server_id"),
                        data.get("msm_correlation_id"),
                        data.get("msm_terminate_after"),
                        data.get("msm_updated_at"),
                        now,
                        now,
                    ),
                )
            else:
                merged = dict(existing)
                for key, value in data.items():
                    if key == "variables" and value is not None:
                        merged["variables_json"] = json.dumps(value, ensure_ascii=False)
                    elif key in merged and value is not None:
                        merged[key] = value
                    elif key in ("msm_status_code", "msm_terminate_after", "msm_server_id") and key in data:
                        merged[key] = value
                conn.execute(
                    """
                    UPDATE contracts SET
                        external_subject = ?, email = ?, item_kind = ?, plan_id = ?,
                        product_key = ?, addon_slug = ?, ram_mb = ?, cpu_percent = ?,
                        slots = ?, variables_json = ?, stripe_checkout_session_id = ?,
                        stripe_customer_id = ?, stripe_subscription_id = ?,
                        stripe_payment_intent_id = ?, payment_status = ?, desired_state = ?,
                        msm_status = ?, msm_status_code = ?, msm_server_id = ?,
                        msm_correlation_id = ?, msm_terminate_after = ?, msm_updated_at = ?,
                        updated_at = ?
                    WHERE external_service_id = ?
                    """,
                    (
                        merged["external_subject"],
                        merged["email"],
                        merged["item_kind"],
                        merged["plan_id"],
                        merged["product_key"],
                        merged["addon_slug"],
                        merged["ram_mb"],
                        merged["cpu_percent"],
                        merged["slots"],
                        merged["variables_json"],
                        merged["stripe_checkout_session_id"],
                        merged["stripe_customer_id"],
                        merged["stripe_subscription_id"],
                        merged["stripe_payment_intent_id"],
                        merged["payment_status"],
                        merged["desired_state"],
                        merged["msm_status"],
                        merged["msm_status_code"],
                        merged["msm_server_id"],
                        merged["msm_correlation_id"],
                        merged["msm_terminate_after"],
                        merged["msm_updated_at"],
                        now,
                        service_id,
                    ),
                )
            row = conn.execute(
                "SELECT * FROM contracts WHERE external_service_id = ?",
                (service_id,),
            ).fetchone()
        return self._row_to_contract(row)

    def get_contract(self, external_service_id: str) -> dict[str, Any] | None:
        with self._lock, self._connect() as conn:
            row = conn.execute(
                "SELECT * FROM contracts WHERE external_service_id = ?",
                (external_service_id,),
            ).fetchone()
        return self._row_to_contract(row) if row else None

    def find_by_stripe_session(self, session_id: str) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM contracts WHERE stripe_checkout_session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
        return [self._row_to_contract(r) for r in rows]

    def find_by_stripe_subscription(self, subscription_id: str) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM contracts WHERE stripe_subscription_id = ? ORDER BY created_at ASC",
                (subscription_id,),
            ).fetchall()
        return [self._row_to_contract(r) for r in rows]

    def list_contracts(self) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM contracts ORDER BY created_at DESC"
            ).fetchall()
        return [self._row_to_contract(r) for r in rows]

    def apply_msm_state(self, msm_payload: dict[str, Any]) -> dict[str, Any] | None:
        service_id = str(msm_payload.get("external_service_id") or "")
        if not service_id:
            return None
        existing = self.get_contract(service_id)
        incoming_updated = msm_payload.get("updated_at")
        if existing and existing.get("msm_updated_at") and incoming_updated:
            # Docs: updated_at decides which message is newer when retries arrive out of order.
            if str(incoming_updated) < str(existing["msm_updated_at"]):
                return existing
        update_data: dict[str, Any] = {
            "external_service_id": service_id,
            "external_subject": (existing or {}).get("external_subject") or "UNKNOWN",
            "desired_state": msm_payload.get("desired_state") or (existing or {}).get("desired_state", "active"),
            "msm_status": msm_payload.get("status") or (existing or {}).get("msm_status", "pending"),
            "msm_status_code": msm_payload.get("status_code"),
            "msm_server_id": msm_payload.get("server_id"),
            "msm_correlation_id": msm_payload.get("correlation_id"),
            "msm_terminate_after": msm_payload.get("terminate_after"),
            "msm_updated_at": incoming_updated,
        }
        if msm_payload.get("item_kind"):
            update_data["item_kind"] = msm_payload["item_kind"]
        if msm_payload.get("plan_id") is not None:
            update_data["plan_id"] = msm_payload["plan_id"]
        if msm_payload.get("addon_slug") is not None:
            update_data["addon_slug"] = msm_payload["addon_slug"]
        return self.upsert_contract(update_data)

    def log_webhook(
        self,
        *,
        source: str,
        event_type: str,
        signature_valid: bool,
        payload: dict[str, Any],
        external_service_id: str | None = None,
        correlation_id: str | None = None,
    ) -> None:
        with self._lock, self._connect() as conn:
            conn.execute(
                """
                INSERT INTO webhook_events (
                    source, event_type, external_service_id, correlation_id,
                    signature_valid, payload_json, received_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    source,
                    event_type,
                    external_service_id,
                    correlation_id,
                    1 if signature_valid else 0,
                    json.dumps(payload, ensure_ascii=False),
                    _utc_now(),
                ),
            )

    def list_webhooks(self, limit: int = 50) -> list[dict[str, Any]]:
        with self._lock, self._connect() as conn:
            rows = conn.execute(
                "SELECT * FROM webhook_events ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        out: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["signature_valid"] = bool(item["signature_valid"])
            item["payload"] = json.loads(item.pop("payload_json"))
            out.append(item)
        return out

    @staticmethod
    def _row_to_contract(row: sqlite3.Row) -> dict[str, Any]:
        item = dict(row)
        item["variables"] = json.loads(item.pop("variables_json") or "{}")
        return item
