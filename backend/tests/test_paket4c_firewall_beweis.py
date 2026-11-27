"""Wirksamkeitsbeweis für Paket 4C: UFW-Reconciliation ohne N*3 Subprozesse/Audit-Spam."""

from __future__ import annotations

import pytest
from sqlalchemy.orm import Session

from models import AuditLog, Server, ServerPort
from services import firewall_service


def test_reconcile_firewall_checks_allowed_ports_once_and_skips_closed_ports(
    db: Session,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    servers: list[Server] = []
    for i in range(10):
        srv = Server(
            name=f"FwStop-{i}",
            game_type="minecraft",
            install_dir=f"/tmp/fw-{i}",
            status="stopped",
            desired_power_state="stopped",
        )
        db.add(srv)
        db.flush()
        db.add(ServerPort(server_id=srv.id, role="game", port=29100 + i, protocol="udp"))
        db.add(ServerPort(server_id=srv.id, role="rcon", port=29200 + i, protocol="tcp"))
        servers.append(srv)
    db.commit()

    allowed_calls = 0
    delete_calls: list[tuple[int, str]] = []

    # 1. Kein Port offen -> genau 1 allowed_ports()-Call, 0 _delete(), 0 AuditLog
    def fake_allowed_empty() -> set[tuple[int, str]]:
        nonlocal allowed_calls
        allowed_calls += 1
        return set()

    def fake_delete(port: int, protocol: str) -> bool:
        delete_calls.append((port, protocol))
        return True

    monkeypatch.setattr(firewall_service, "allowed_ports", fake_allowed_empty)
    monkeypatch.setattr(firewall_service, "_delete", fake_delete)
    monkeypatch.setattr(firewall_service, "_ufw_available", lambda: True)

    closed = firewall_service.reconcile_firewall_rules(db)
    assert closed == 0
    assert allowed_calls == 1
    assert delete_calls == []
    assert (
        db.query(AuditLog)
        .filter(AuditLog.action == "server.firewall_closed")
        .count()
        == 0
    )

    # 2. Genau 1 Port (29103/udp) offen -> nur dieser 1 Port wird gelöscht, genau 1 AuditLog
    allowed_calls = 0

    def fake_allowed_one() -> set[tuple[int, str]]:
        nonlocal allowed_calls
        allowed_calls += 1
        return {(29103, "udp"), (22, "tcp")}

    monkeypatch.setattr(firewall_service, "allowed_ports", fake_allowed_one)

    closed_one = firewall_service.reconcile_firewall_rules(db)
    assert closed_one == 1
    assert allowed_calls == 1
    assert delete_calls == [(29103, "udp")]
    audit_rows = (
        db.query(AuditLog)
        .filter(AuditLog.action == "server.firewall_closed")
        .all()
    )
    assert len(audit_rows) == 1
    assert audit_rows[0].target_id == str(servers[3].id)
