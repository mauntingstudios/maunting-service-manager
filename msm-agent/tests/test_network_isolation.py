"""Zero-Trust network isolation and cross-server lateral movement prevention tests."""

from __future__ import annotations

import ipaddress
import json
import os
import subprocess
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from config import settings
from services import docker_service, network_isolation_service as netiso


def test_disjoint_slash29_subnets_never_overlap_and_use_icc_false() -> None:
    srv_nets = [netiso.server_subnet_spec(i) for i in range(1, 51)]
    db_nets = [netiso.db_subnet_spec(i) for i in range(1, 51)]

    seen: list[ipaddress.IPv4Network] = []
    for spec in srv_nets:
        net = ipaddress.IPv4Network(spec.subnet)
        assert net.prefixlen == 29
        assert net.subnet_of(netiso.SERVER_NETWORK_POOL)
        assert ipaddress.IPv4Address(spec.gateway) in net
        assert spec.internal is False
        assert spec.enable_icc is False
        assert all(not net.overlaps(prev) for prev in seen)
        seen.append(net)

    for spec in db_nets:
        net = ipaddress.IPv4Network(spec.subnet)
        assert net.prefixlen == 29
        assert net.subnet_of(netiso.DB_NETWORK_POOL)
        assert ipaddress.IPv4Address(spec.gateway) in net
        assert spec.internal is True
        assert spec.enable_icc is False
        assert all(not net.overlaps(prev) for prev in seen)
        seen.append(net)


def test_ensure_bridge_recreates_insecure_icc_bridge_and_fails_closed_when_required(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    insecure_bridge = MagicMock()
    insecure_bridge.attrs = {
        "Options": {"com.docker.network.bridge.enable_icc": "true"},
        "Internal": False,
        "Containers": {},
    }
    networks_api = MagicMock()
    networks_api.get.return_value = insecure_bridge
    client = SimpleNamespace(networks=networks_api)

    name = netiso.ensure_isolated_server_network(client, 9)
    assert name == "msm-srv-net-9"
    insecure_bridge.remove.assert_called_once()
    networks_api.create.assert_called_once()
    create_kw = networks_api.create.call_args.kwargs
    assert create_kw["options"]["com.docker.network.bridge.enable_icc"] == "false"
    assert create_kw["internal"] is False

    # Fail closed if isolation is required and Docker network manager is unavailable
    monkeypatch.setattr(settings, "require_network_isolation", True, raising=False)
    with pytest.raises(RuntimeError, match="unavailable"):
        netiso.ensure_bridge_network(SimpleNamespace(), name="msm-srv-net-9")


def test_build_isolation_plan_blocks_loopback_metadata_rfc1918_host_ips_and_routes_db(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "services.network_isolation_service.list_host_interfaces",
        lambda: [
            SimpleNamespace(name="eth0", ip="203.0.113.50"),
            SimpleNamespace(name="eth0", ip="2001:db8::50"),
        ],
    )

    srv_net_1 = SimpleNamespace(
        id="1111222233334444",
        name="msm-srv-net-1",
        attrs={
            "Id": "1111222233334444",
            "Name": "msm-srv-net-1",
            "Driver": "bridge",
            "IPAM": {"Config": [{"Subnet": "10.200.0.0/29", "Gateway": "10.200.0.1"}]},
            "Containers": {"c1": {"IPv4Address": "10.200.0.2/29", "Name": "msm-srv-1"}},
        },
    )
    srv_net_2 = SimpleNamespace(
        id="5555666677778888",
        name="msm-srv-net-2",
        attrs={
            "Id": "5555666677778888",
            "Name": "msm-srv-net-2",
            "Driver": "bridge",
            "IPAM": {"Config": [{"Subnet": "10.200.0.8/29", "Gateway": "10.200.0.9"}]},
            "Containers": {"c2": {"IPv4Address": "10.200.0.10/29", "Name": "msm-srv-2"}},
        },
    )
    pg_hub = SimpleNamespace(
        id="9999aaaabbbbcccc",
        name="msm-pg-hub",
        attrs={
            "Id": "9999aaaabbbbcccc",
            "Name": "msm-pg-hub",
            "Driver": "bridge",
            "IPAM": {"Config": [{"Subnet": "10.216.0.0/29", "Gateway": "10.216.0.1"}]},
            "Containers": {
                "pg": {"IPv4Address": "10.216.0.2/29", "Name": "msm-postgres"},
                "c1": {"IPv4Address": "10.216.0.3/29", "Name": "msm-srv-1"},
            },
        },
    )
    db_net_5 = SimpleNamespace(
        id="ddddeeeeffff0000",
        name="msm-db-net-5",
        attrs={
            "Id": "ddddeeeeffff0000",
            "Name": "msm-db-net-5",
            "Driver": "bridge",
            "IPAM": {"Config": [{"Subnet": "10.208.0.32/29", "Gateway": "10.208.0.33"}]},
            "Containers": {
                "db": {"IPv4Address": "10.208.0.34/29", "Name": "msm-srv-5"},
                "app": {"IPv4Address": "10.208.0.35/29", "Name": "msm-srv-1"},
            },
        },
    )
    fake_client = SimpleNamespace(networks=SimpleNamespace(list=lambda: [srv_net_1, srv_net_2, pg_hub, db_net_5]))

    plan = netiso.build_isolation_plan(fake_client)
    blocked_v4 = set(plan["blocked_v4"])
    blocked_v6 = set(plan["blocked_v6"])

    assert {
        "127.0.0.0/8",
        "10.0.2.2/32",
        "169.254.0.0/16",
        "100.64.0.0/10",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "203.0.113.50/32",
    }.issubset(blocked_v4)
    assert {"::1/128", "fe80::/10", "fc00::/7", "fd00:ec2::254/128", "2001:db8::50/128"}.issubset(blocked_v6)
    assert "10.200.0.1" in set(plan["dns_gateways"])
    assert "10.200.0.9" in set(plan["dns_gateways"])
    assert "br-111122223333" in plan["icc_drop_bridges"]
    assert "br-555566667777" in plan["icc_drop_bridges"]
    # Authorized container-to-Postgres 5432 flows explicitly allowlisted prior to generic RFC1918 DROP
    db_tuples = {(entry["src"], entry["dst"], entry["port"]) for entry in plan["db_allows"]}
    assert ("10.216.0.3/32", "10.216.0.2/32", 5432) in db_tuples
    assert ("10.208.0.35/32", "10.208.0.34/32", 5432) in db_tuples

    cmds = netiso._iptables_commands_for_plan(plan)
    rendered = [" ".join(c) for c in cmds]
    assert any("-A MSM-EGRESS-BLOCK -d 169.254.0.0/16 -j DROP" in line for line in rendered)
    assert any("-A MSM-ISOLATION -s 10.200.0.0/13 -j MSM-EGRESS-BLOCK" in line for line in rendered)
    assert any("-s 10.216.0.3/32 -d 10.216.0.2/32 -p tcp --dport 5432 -j ACCEPT" in line for line in rendered)
    assert any("-i br-111122223333 -o br-111122223333 -j DROP" in line for line in rendered)


def test_build_isolation_plan_reloads_db_network_when_list_omits_containers() -> None:
    class LazyNetwork:
        def __init__(self) -> None:
            self.id = "9999aaaabbbbcccc"
            self.name = "msm-pg-hub"
            self.reloaded = False
            self.attrs = {
                "Id": "9999aaaabbbbcccc",
                "Name": "msm-pg-hub",
                "Driver": "bridge",
                "IPAM": {"Config": [{"Subnet": "172.23.0.0/16", "Gateway": "172.23.0.1"}]},
                "Containers": None,
            }

        def reload(self) -> None:
            self.reloaded = True
            self.attrs = {
                **self.attrs,
                "Containers": {
                    "pg": {"IPv4Address": "172.23.0.2/16", "Name": "msm-postgres"},
                    "app": {"IPv4Address": "172.23.0.3/16", "Name": "msm-srv-80"},
                },
            }

    pg_hub = LazyNetwork()
    fake_client = SimpleNamespace(networks=SimpleNamespace(list=lambda: [pg_hub]))

    plan = netiso.build_isolation_plan(fake_client)

    assert pg_hub.reloaded is True
    assert {"src": "172.23.0.3/32", "dst": "172.23.0.2/32", "port": 5432} in plan["db_allows"]


def test_reconcile_invokes_msm_iptables_wrapper_with_json_and_respects_fail_closed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[list[str]] = []

    def fake_run(cmd, **_kwargs):  # noqa: ANN001
        calls.append(list(cmd))
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    posix_path = SimpleNamespace(
        **{
            **os.path.__dict__,
            "exists": lambda p: p == netiso.IPTABLES_HELPER,
            "isfile": lambda p: p == netiso.IPTABLES_HELPER,
        }
    )
    posix_os = SimpleNamespace(
        **{
            **os.__dict__,
            "name": "posix",
            "geteuid": lambda: 1000,
            "access": lambda p, _m=0: p == netiso.IPTABLES_HELPER,
            "path": posix_path,
        }
    )
    monkeypatch.setattr("services.network_isolation_service.sys", SimpleNamespace(platform="linux"))
    monkeypatch.setattr("services.network_isolation_service.os", posix_os)
    monkeypatch.setattr("services.network_isolation_service.subprocess.run", fake_run)
    monkeypatch.setattr("services.network_isolation_service.list_host_interfaces", lambda: [])
    monkeypatch.setattr("services.network_isolation_service._find_rootlesskit_child_pids", lambda: [4321])
    fake_client = SimpleNamespace(networks=SimpleNamespace(list=lambda: []))

    res = netiso.reconcile_network_isolation(fake_client)
    assert res["ok"] is True
    assert res["applied_host"] is True
    assert len(calls) == 1
    cmd = calls[0]
    assert netiso.IPTABLES_HELPER in cmd
    assert "apply-isolation" in cmd
    payload = json.loads(cmd[-1])
    assert "169.254.0.0/16" in payload["blocked_v4"]
    assert "blocked_v6" in payload
    assert "db_allows" in payload

    # Direct root fallback path uses rootlesskit child netns PIDs when wrapper absent
    posix_path_no_helper = SimpleNamespace(
        **{
            **os.path.__dict__,
            "exists": lambda _p: False,
            "isfile": lambda _p: False,
        }
    )
    posix_os_root = SimpleNamespace(
        **{
            **os.__dict__,
            "name": "posix",
            "geteuid": lambda: 0,
            "access": lambda _p, _m=0: False,
            "path": posix_path_no_helper,
        }
    )
    ns_calls: list[list[str]] = []
    monkeypatch.setattr("services.network_isolation_service.os", posix_os_root)
    monkeypatch.setattr("services.network_isolation_service.shutil.which", lambda name: f"/usr/sbin/{name}" if name in {"iptables", "nsenter"} else None)
    monkeypatch.setattr(
        "services.network_isolation_service.subprocess.run",
        lambda c, **_kw: (ns_calls.append(list(c)), subprocess.CompletedProcess(c, 0, stdout="", stderr=""))[1],
    )
    res_root = netiso.reconcile_network_isolation(fake_client)
    assert res_root["ok"] is True
    assert res_root["applied_netns"] >= 1
    assert any("nsenter" in " ".join(c) and "4321" in " ".join(c) for c in ns_calls)

    # When strict isolation is enabled and wrapper fails -> raise RuntimeError (fail-closed)
    monkeypatch.setattr(settings, "require_network_isolation", True, raising=False)
    monkeypatch.setattr(
        "services.network_isolation_service.subprocess.run",
        lambda cmd, **_kw: subprocess.CompletedProcess(cmd, 1, stdout="", stderr="denied"),
    )
    with pytest.raises(RuntimeError):
        netiso.reconcile_network_isolation(fake_client)


def test_managed_postgres_requires_loopback_bind_and_isolated_hub(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    with pytest.raises(docker_service.HardeningError, match="127.0.0.1"):
        docker_service.run_managed_postgres(
            name="msm-postgres",
            image="postgres:17-alpine",
            env={"POSTGRES_PASSWORD": "secret"},
            host_port=15432,
            host_ip="0.0.0.0",
            data_dir=str(tmp_path),
            network_name="msm-pg-hub",
            cap_adds=["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"],
        )

    net_obj = MagicMock()
    created_nets: dict[str, dict] = {}

    def create_net(name, **kwargs):  # noqa: ANN001
        created_nets[name] = kwargs
        return net_obj

    client = SimpleNamespace(
        images=SimpleNamespace(get=MagicMock()),
        containers=SimpleNamespace(
            get=MagicMock(side_effect=docker_service.NotFound("missing")),
            run=MagicMock(return_value=MagicMock(id="pg1234567890")),
        ),
        networks=SimpleNamespace(
            get=MagicMock(side_effect=[docker_service.NotFound("missing"), docker_service.NotFound("missing"), net_obj]),
            create=create_net,
        ),
    )
    monkeypatch.setattr("services.docker_service._get_client", lambda: client)

    res = docker_service.run_managed_postgres(
        name="msm-postgres",
        image="postgres:17-alpine",
        env={"POSTGRES_PASSWORD": "secret"},
        host_port=15432,
        host_ip="127.0.0.1",
        data_dir=str(tmp_path),
        network_name="msm-pg-hub",
        cap_adds=["CHOWN", "SETUID", "SETGID", "DAC_OVERRIDE"],
    )
    assert res["ok"] is True
    assert created_nets["msm-pg-hub"]["internal"] is True
    assert created_nets["msm-pg-hub"]["options"]["com.docker.network.bridge.enable_icc"] == "false"
    assert client.containers.run.call_args.kwargs["ports"] == {"5432/tcp": ("127.0.0.1", 15432)}
