"""Node RAM booking: SUM(limits), allocatable, and create/update guard."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from models import Node, Server
from services import node_capacity
from services.node_service import apply_agent_metrics, node_out_dict


def test_apply_agent_metrics_persists_cpu_model():
    node = SimpleNamespace(
        cpu_total=None,
        cpu_model=None,
        ram_total=None,
        disk_total=None,
        cpu_percent=None,
        ram_used=None,
        disk_used=None,
        container_count=None,
        docker_connected=None,
        agent_version=None,
    )
    apply_agent_metrics(
        node,
        {
            "cpu_count": 8,
            "cpu_model": "  AMD EPYC 7763 64-Core Processor  ",
        },
    )
    assert node.cpu_total == 8.0
    assert node.cpu_model == "AMD EPYC 7763 64-Core Processor"


def test_apply_agent_metrics_ignores_blank_cpu_model():
    node = SimpleNamespace(cpu_model="keep-me", cpu_total=None)
    apply_agent_metrics(node, {"cpu_model": "   "})
    assert node.cpu_model == "keep-me"


def test_node_out_dict_includes_cpu_model_and_allocated():
    node = SimpleNamespace(
        id=1,
        name="edge",
        host="https://example:9000",
        is_local=False,
        status="online",
        tls_fingerprint=None,
        cpu_total=16.0,
        cpu_model="Test CPU",
        ram_total=32768,
        disk_total=100000,
        last_heartbeat=None,
        cpu_percent=40.0,
        ram_used=8192,
        disk_used=1000,
        agent_version="1.0",
        docker_connected=True,
        container_count=2,
        servers=[],
    )
    out = node_out_dict(node, server_count=2, ram_allocated_mb=16384)
    assert out["cpu_model"] == "Test CPU"
    assert out["ram_allocated_mb"] == 16384
    # default headroom 1024 → 32768 - 1024 - 16384 = 15360
    assert out["ram_allocatable_mb"] == 15360
    assert "auth_token" not in out
    assert out["metrics"]["cpu_model"] == "Test CPU"


def test_sum_allocated_excludes_null_limits_and_other_nodes(db):
    node_a = Node(
        name="a",
        host="https://a:9000",
        auth_token_enc="enc",
        is_local=False,
        status="online",
        ram_total=32768,
    )
    node_b = Node(
        name="b",
        host="https://b:9000",
        auth_token_enc="enc",
        is_local=False,
        status="online",
        ram_total=16384,
    )
    db.add_all([node_a, node_b])
    db.commit()
    db.refresh(node_a)
    db.refresh(node_b)

    db.add_all(
        [
            Server(
                name="s1",
                game_type="t",
                install_dir="/tmp/s1",
                node_id=node_a.id,
                ram_limit_mb=8192,
            ),
            Server(
                name="s2",
                game_type="t",
                install_dir="/tmp/s2",
                node_id=node_a.id,
                ram_limit_mb=4096,
            ),
            Server(
                name="s3",
                game_type="t",
                install_dir="/tmp/s3",
                node_id=node_a.id,
                ram_limit_mb=None,
            ),
            Server(
                name="s4",
                game_type="t",
                install_dir="/tmp/s4",
                node_id=node_b.id,
                ram_limit_mb=16000,
            ),
        ]
    )
    db.commit()

    assert node_capacity.sum_allocated_ram_mb(db, node_a.id) == 8192 + 4096
    assert node_capacity.sum_allocated_ram_mb(db, node_b.id) == 16000

    servers = db.query(Server).filter(Server.node_id == node_a.id).all()
    exclude_id = next(s.id for s in servers if s.ram_limit_mb == 8192)
    assert node_capacity.sum_allocated_ram_mb(
        db, node_a.id, exclude_server_id=exclude_id
    ) == 4096


def test_ensure_ram_limit_fits_allows_overbook(db, monkeypatch):
    """Überbuchung ist eine Betreiberentscheidung, keine Lücke im Code.

    Bis e9ae9847 wies `ensure_ram_limit_fits` jeden Wunsch mit 400 ab, der die
    Node überbucht. Seitdem ist die Funktion bewusst leer: gewarnt wird im
    Frontend (`servers.overcommitWarning`), entschieden wird vom Menschen.
    Deshalb prüft dieser Test nicht "wirft nicht" — das täte auch eine
    gelöschte Funktion —, sondern belegt zuerst, dass der Wunsch die Node
    wirklich überbucht, und erst dann, dass er trotzdem durchgeht.
    """
    monkeypatch.setattr(node_capacity, "ram_headroom_mb", lambda: 1024)
    node = Node(
        name="n",
        host="https://n:9000",
        auth_token_enc="enc",
        is_local=False,
        status="online",
        ram_total=8192,
    )
    db.add(node)
    db.commit()
    db.refresh(node)
    db.add(
        Server(
            name="existing",
            game_type="t",
            install_dir="/tmp/e",
            node_id=node.id,
            ram_limit_mb=6144,
        )
    )
    db.commit()

    # Die Buchung ist nachweislich eine Überbuchung: 8192 MB Node minus
    # 1024 MB Headroom minus 6144 MB bereits gebucht lassen 1024 MB frei.
    frei = node_capacity.allocatable_ram_mb(
        node, node_capacity.sum_allocated_ram_mb(db, node.id)
    )
    assert frei == 1024

    # Und genau diese Überbuchung darf nicht abgewiesen werden. Wer die
    # Schranke von damals zurückholt, macht hier rot.
    node_capacity.ensure_ram_limit_fits(
        db, node, new_ram_limit_mb=frei * 2, exclude_server_id=None
    )


def test_capacity_summary_endpoint_auth_and_shape(client, owner_cookies, db):
    node = Node(
        name="busy",
        host="https://busy:9000",
        auth_token_enc="enc",
        is_local=False,
        status="online",
        cpu_total=32,
        cpu_model="EPYC Test",
        ram_total=32768,
        ram_used=20000,
    )
    quiet = Node(
        name="quiet",
        host="https://quiet:9000",
        auth_token_enc="enc",
        is_local=False,
        status="offline",
        cpu_total=8,
        ram_total=8192,
        ram_used=1000,
    )
    db.add_all([node, quiet])
    db.commit()
    db.refresh(node)
    db.add(
        Server(
            name="s",
            game_type="t",
            install_dir="/tmp/s",
            node_id=node.id,
            ram_limit_mb=16000,
        )
    )
    db.commit()

    r = client.get("/api/nodes/capacity-summary?limit=5", cookies=owner_cookies)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["total"] >= 2
    assert body["online"] >= 1
    assert len(body["items"]) >= 1
    first = body["items"][0]
    assert first["name"] == "busy"
    assert first["cpu_model"] == "EPYC Test"
    assert first["ram_allocated_mb"] == 16000
    assert "host" not in first
    assert "auth_token" not in first

    # Without auth
    denied = client.get("/api/nodes/capacity-summary")
    assert denied.status_code in (401, 403)


def test_disk_capacity_accounting(db):
    node = Node(
        name="disk_node",
        host="https://disk:9000",
        auth_token_enc="enc",
        is_local=False,
        status="online",
        disk_total=204800,  # 200 GB in MB
        disk_used=51200,    # 50 GB in MB
    )
    db.add(node)
    db.commit()
    db.refresh(node)

    db.add_all([
        Server(
            name="d1",
            game_type="t",
            install_dir="/tmp/d1",
            node_id=node.id,
            disk_limit_gb=20,
            disk_usage_mb=10240,
        ),
        Server(
            name="d2",
            game_type="t",
            install_dir="/tmp/d2",
            node_id=node.id,
            disk_limit_gb=30,
            disk_usage_mb=5120,
        ),
    ])
    db.commit()

    assert node_capacity.sum_allocated_disk_gb(db, node.id) == 50
    assert node_capacity.sum_panel_disk_used_mb(db, node.id) == 15360
    # 200 GB total - 50 GB allocated = 150 GB allocatable
    assert node_capacity.allocatable_disk_gb(node, 50) == 150


def test_strict_capacity_guard_blocks_ram_and_disk_overcommit(db, monkeypatch):
    from config import settings

    node = Node(
        name="strict_node",
        host="https://strict:9000",
        auth_token_enc="enc",
        is_local=False,
        status="online",
        ram_total=8192,
        disk_total=102400,  # 100 GB in MB
    )
    db.add(node)
    db.commit()
    db.refresh(node)

    db.add(
        Server(
            name="existing",
            game_type="t",
            install_dir="/tmp/existing",
            node_id=node.id,
            ram_limit_mb=4096,
            disk_limit_gb=70,
        )
    )
    db.commit()

    # Overbook stays allowed when strict_resource_capacity_guard is False
    monkeypatch.setattr(settings, "strict_resource_capacity_guard", False)
    node_capacity.ensure_strict_capacity_fits(
        db, node, new_ram_limit_mb=4096, new_disk_limit_gb=50
    )

    monkeypatch.setattr(settings, "strict_resource_capacity_guard", True)
    monkeypatch.setattr(settings, "host_reserved_ram_mb", 1536)
    # Remaining RAM = 8192 - 1536 - 4096 = 2560 MB -> 3072 MB must fail with 409
    with pytest.raises(HTTPException) as ram_exc:
        node_capacity.ensure_strict_capacity_fits(
            db, node, new_ram_limit_mb=3072, new_disk_limit_gb=20
        )
    assert ram_exc.value.status_code == 409
    assert ram_exc.value.detail["code"] == "insufficient_node_ram"

    # Remaining disk = 100 - 70 = 30 GB -> 40 GB must fail with 409
    with pytest.raises(HTTPException) as disk_exc:
        node_capacity.ensure_strict_capacity_fits(
            db, node, new_ram_limit_mb=2048, new_disk_limit_gb=40
        )
    assert disk_exc.value.status_code == 409
    assert disk_exc.value.detail["code"] == "insufficient_node_disk"

    # Fits within both RAM and disk ceilings -> passes
    node_capacity.ensure_strict_capacity_fits(
        db, node, new_ram_limit_mb=2048, new_disk_limit_gb=25
    )


def test_quota_delegation_respects_local_agent_required(monkeypatch):
    from config import settings
    from services.node_client import NodeClient

    local_node = SimpleNamespace(is_local=True, host="http://127.0.0.1:9000", auth_token_enc="enc")
    remote_node = SimpleNamespace(is_local=False, host="https://r:9000", auth_token_enc="enc")

    monkeypatch.setattr(settings, "local_agent_required", False)
    assert node_capacity.should_delegate_node_fs_to_agent(local_node) is False
    assert node_capacity.should_delegate_node_fs_to_agent(remote_node) is True

    monkeypatch.setattr(settings, "local_agent_required", True)
    assert node_capacity.should_delegate_node_fs_to_agent(local_node) is True

    calls = []

    class FakeClient:
        def files_apply_quota(self, server_id, limit_gb):
            calls.append(("apply", server_id, limit_gb))
            return {"ok": True}

        def files_remove_quota(self, server_id):
            calls.append(("remove", server_id))
            return {"ok": True}

    monkeypatch.setattr(NodeClient, "from_node", staticmethod(lambda _n: FakeClient()))
    node_capacity.sync_node_disk_quota(local_node, 42, 30, enforce=True)
    node_capacity.sync_node_disk_quota(local_node, 42, None, enforce=True)
    node_capacity.remove_node_disk_quota(remote_node, 42)
    assert calls == [("apply", 42, 30), ("remove", 42), ("remove", 42)]

