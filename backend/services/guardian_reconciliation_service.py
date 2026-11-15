from __future__ import annotations

import asyncio
from collections import defaultdict
import logging
from sqlalchemy.orm import Session

from database import SessionLocal
from models import Server, Node
from services.guardian_sync_service import reconcile_guardian_server
from services.node_client import NodeClient

logger = logging.getLogger(__name__)

# Documented maximum parallel nodes for reconciliation to avoid DB connection exhaustion
# and overwhelming the scheduler event loop.
_MAX_CONCURRENCY = 10


def _load_node_to_servers() -> dict[int, list[int]]:
    db = SessionLocal()
    try:
        servers = db.query(Server).filter(Server.node_id.is_not(None)).all()
        node_to_servers: dict[int, list[int]] = defaultdict(list)
        for server in servers:
            if server.node_id is not None:
                node_to_servers[server.node_id].append(server.id)
        return dict(node_to_servers)
    finally:
        db.close()


def _reconcile_node_servers(node_id: int, server_ids: list[int]) -> None:
    node_db = SessionLocal()
    try:
        node = node_db.query(Node).filter(Node.id == node_id).first()
        if not node or node.status != "online":
            return

        try:
            client = NodeClient.from_node(node, timeout=5.0)
        except Exception as node_err:
            logger.warning(
                "Failed to construct NodeClient for node_id=%s: %s",
                node.id,
                node_err,
            )
            return
    finally:
        node_db.close()

    for server_id in server_ids:
        db = SessionLocal()
        try:
            server = db.query(Server).filter(Server.id == server_id).first()
            if not server:
                continue

            reconcile_guardian_server(db, server, node_client=client)
        except Exception as srv_err:
            db.rollback()
            logger.warning(
                "Guardian reconciliation failed for server_id=%s code=%s",
                server_id,
                getattr(srv_err, "code", type(srv_err).__name__),
            )
        finally:
            db.close()


async def reconcile_guardian_servers() -> None:
    """Reconcile durable intent, observed state and incidents for every server assigned to a node."""
    try:
        node_to_servers = await asyncio.to_thread(_load_node_to_servers)
    except Exception as exc:
        logger.warning(
            "Guardian reconciliation initialization failed code=%s",
            type(exc).__name__,
        )
        return

    if not node_to_servers:
        return
        
    semaphore = asyncio.Semaphore(_MAX_CONCURRENCY)
    
    async def _reconcile_with_semaphore(n_id: int, s_ids: list[int]) -> None:
        async with semaphore:
            await asyncio.to_thread(_reconcile_node_servers, n_id, s_ids)
            
    tasks = [
        _reconcile_with_semaphore(node_id, server_ids)
        for node_id, server_ids in node_to_servers.items()
    ]
    await asyncio.gather(*tasks)
