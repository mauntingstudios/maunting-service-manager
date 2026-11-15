"""Zero-Trust network isolation and Rootless/Host netfilter enforcement.

Assigns every server a dedicated /29 bridge (``msm-srv-net-<server_id>``)
with ``enable_icc=false``, keeps shared/dedicated PostgreSQL hubs strictly
point-to-point with kernel L2/L3 lateral DROP rules, and blocks container
egress to loopback, ``10.0.2.2``, RFC1918 LANs, CGNAT, cloud metadata, and
all discovered local host IPs.
"""

from __future__ import annotations

import ipaddress
import json
import logging
import os
import shutil
import subprocess
import sys
from dataclasses import dataclass
from typing import Any

from config import settings
from services.agent_operation_coordinator import server_id_from_container_name
from services.network_interfaces_service import list_host_interfaces

logger = logging.getLogger(__name__)

# Dedicated /13 pools -> 65,536 disjoint /29 subnets each (6 usable IPs per bridge).
SERVER_NETWORK_POOL = ipaddress.IPv4Network("10.200.0.0/13")
DB_NETWORK_POOL = ipaddress.IPv4Network("10.208.0.0/13")
PG_HUB_POOL = ipaddress.IPv4Network("10.216.0.0/16")

EPHEMERAL_NETWORK_NAME = "msm-ephemeral-net"
CHAIN_ISOLATION = "MSM-ISOLATION"
CHAIN_EGRESS_BLOCK = "MSM-EGRESS-BLOCK"
IPTABLES_HELPER = "/usr/local/sbin/msm-iptables"

BLOCKED_EGRESS_CIDRS_V4: tuple[str, ...] = (
    "127.0.0.0/8",      # Loopback
    "10.0.2.2/32",      # slirp4netns host-loopback gateway alias
    "169.254.0.0/16",   # Link-local + AWS/Hetzner/GCP metadata
    "100.64.0.0/10",    # CGNAT / Tailscale / carrier mesh
    "10.0.0.0/8",       # RFC1918 private + container pools
    "172.16.0.0/12",    # RFC1918 + default Docker bridges
    "192.168.0.0/16",   # RFC1918 LAN
)

BLOCKED_EGRESS_CIDRS_V6: tuple[str, ...] = (
    "::1/128",          # IPv6 loopback
    "fe80::/10",        # IPv6 link-local
    "fc00::/7",         # IPv6 ULA
    "fd00:ec2::254/128",  # AWS IMDSv2 IPv6
)

_CONTAINER_SOURCE_CIDRS: tuple[str, ...] = (
    str(SERVER_NETWORK_POOL),
    str(DB_NETWORK_POOL),
    str(PG_HUB_POOL),
    "172.16.0.0/12",
)


@dataclass(frozen=True)
class NetworkSpec:
    name: str
    subnet: str
    gateway: str
    internal: bool
    enable_icc: bool


def server_network_name(server_id: int) -> str:
    return f"msm-srv-net-{int(server_id)}"


def db_network_name(server_id: int) -> str:
    return f"msm-db-net-{int(server_id)}"


def _nth_slash29(pool: ipaddress.IPv4Network, server_id: int) -> ipaddress.IPv4Network:
    sid = int(server_id)
    if sid <= 0:
        raise ValueError("server_id must be a positive integer")
    max_subnets = 1 << (29 - pool.prefixlen)
    index = (sid - 1) % max_subnets
    base_int = int(pool.network_address) + (index * 8)
    return ipaddress.IPv4Network((base_int, 29))


def server_subnet_spec(server_id: int) -> NetworkSpec:
    net = _nth_slash29(SERVER_NETWORK_POOL, server_id)
    gateway = str(ipaddress.IPv4Address(int(net.network_address) + 1))
    return NetworkSpec(
        name=server_network_name(server_id),
        subnet=str(net),
        gateway=gateway,
        internal=False,
        enable_icc=False,
    )


def db_subnet_spec(server_id: int) -> NetworkSpec:
    net = _nth_slash29(DB_NETWORK_POOL, server_id)
    gateway = str(ipaddress.IPv4Address(int(net.network_address) + 1))
    return NetworkSpec(
        name=db_network_name(server_id),
        subnet=str(net),
        gateway=gateway,
        internal=True,
        enable_icc=False,
    )


def is_isolation_required() -> bool:
    if bool(getattr(settings, "require_network_isolation", False)):
        return True
    return os.getenv("MSM_REQUIRE_NETWORK_ISOLATION", "").strip().lower() in {"1", "true", "yes"}


def blocked_destination_cidrs(*, include_host_ips: bool = True) -> dict[str, list[str]]:
    """Return IPv4 and IPv6 destination CIDRs every workload container must be blocked from."""
    v4: list[str] = list(BLOCKED_EGRESS_CIDRS_V4)
    v6: list[str] = list(BLOCKED_EGRESS_CIDRS_V6)
    if include_host_ips:
        try:
            for iface in list_host_interfaces():
                ip = (iface.ip or "").strip()
                if not ip:
                    continue
                addr = ipaddress.ip_address(ip)
                cidr = f"{addr}/32" if addr.version == 4 else f"{addr}/128"
                target = v4 if addr.version == 4 else v6
                if cidr not in target:
                    target.append(cidr)
        except Exception as exc:
            logger.debug("host interface lookup skipped: %s", exc)
    return {"ipv4": list(dict.fromkeys(v4)), "ipv6": list(dict.fromkeys(v6))}


def _build_ipam(subnet: str | None, gateway: str | None) -> Any | None:
    if not subnet or not gateway:
        return None
    try:
        from docker.types import IPAMConfig, IPAMPool
    except ImportError:
        return None
    return IPAMConfig(pool_configs=[IPAMPool(subnet=subnet, gateway=gateway)])


def ensure_bridge_network(
    client: Any,
    *,
    name: str,
    subnet: str | None = None,
    gateway: str | None = None,
    internal: bool = False,
    enable_icc: bool = False,
) -> str | None:
    """Ensure a Docker bridge network exists with ICC disabled by default."""
    if client is None or not hasattr(client, "networks"):
        if is_isolation_required():
            raise RuntimeError("Docker network management is unavailable")
        return None

    networks = client.networks
    options = {"com.docker.network.bridge.enable_icc": "true" if enable_icc else "false"}
    if not internal:
        options["com.docker.network.bridge.enable_ip_masquerade"] = "true"

    try:
        existing = networks.get(name)
        attrs = getattr(existing, "attrs", None)
        if isinstance(attrs, dict) and hasattr(networks, "create"):
            opts = attrs.get("Options") or {}
            containers = attrs.get("Containers") or {}
            expected_icc = "true" if enable_icc else "false"
            if (opts.get("com.docker.network.bridge.enable_icc") != expected_icc or bool(attrs.get("Internal")) != bool(internal)) and not containers:
                try:
                    existing.remove()
                except Exception:
                    return name
            else:
                return name
        else:
            return name
    except Exception:
        # Either NotFound or minimal mock; attempt creation if supported.
        if not hasattr(networks, "create"):
            return name

    ipam = _build_ipam(subnet, gateway)
    kwargs: dict[str, Any] = {
        "driver": "bridge",
        "internal": bool(internal),
        "options": options,
    }
    if ipam is not None:
        kwargs["ipam"] = ipam
    try:
        networks.create(name, **kwargs)
        return name
    except Exception as exc:
        msg = str(exc).lower()
        if ipam is not None and ("overlap" in msg or "pool" in msg or "typeerror" in msg):
            kwargs.pop("ipam", None)
            networks.create(name, **kwargs)
            return name
        if is_isolation_required():
            raise
        logger.warning("Failed to create isolated network %s: %s", name, exc)
        return None


def ensure_isolated_server_network(client: Any, server_id: int | None) -> str | None:
    """Ensure the server's dedicated /29 bridge exists with ``enable_icc=false``."""
    if not server_id or int(server_id) <= 0:
        return None
    spec = server_subnet_spec(int(server_id))
    return ensure_bridge_network(
        client,
        name=spec.name,
        subnet=spec.subnet,
        gateway=spec.gateway,
        internal=False,
        enable_icc=False,
    )


def ensure_isolated_db_network(client: Any, db_server_id: int) -> str | None:
    """Ensure a dedicated internal /29 DB bridge exists with ``enable_icc=false``."""
    spec = db_subnet_spec(int(db_server_id))
    return ensure_bridge_network(
        client,
        name=spec.name,
        subnet=spec.subnet,
        gateway=spec.gateway,
        internal=True,
        enable_icc=False,
    )


def ensure_ephemeral_network(client: Any) -> str | None:
    """Ensure shared ephemeral build/tool bridge has ICC disabled."""
    if client is None or not hasattr(client, "networks") or not hasattr(client.networks, "create"):
        return None
    return ensure_bridge_network(
        client,
        name=EPHEMERAL_NETWORK_NAME,
        internal=False,
        enable_icc=False,
    )


def remove_isolated_server_network(client: Any, server_id: int | None) -> bool:
    """Remove unused per-server bridge after container deletion."""
    if not server_id or int(server_id) <= 0 or client is None or not hasattr(client, "networks"):
        return False
    name = server_network_name(int(server_id))
    try:
        net = client.networks.get(name)
        attrs = getattr(net, "attrs", None)
        if isinstance(attrs, dict) and (attrs.get("Containers") or {}):
            return False
        net.remove()
        return True
    except Exception:
        return False


def _bridge_ifname(network_attrs: dict[str, Any]) -> str | None:
    net_id = str(network_attrs.get("Id") or "")
    opts = network_attrs.get("Options") or {}
    explicit = opts.get("com.docker.network.bridge.name")
    if explicit:
        return str(explicit)
    if len(net_id) >= 12:
        return f"br-{net_id[:12]}"
    return None


def _strip_prefix(ip_cidr: str) -> str:
    return str(ip_cidr).split("/", 1)[0].strip()


def build_isolation_plan(client: Any) -> dict[str, Any]:
    """Build current L2/L3 firewall plan from Docker network topology."""
    cidrs = blocked_destination_cidrs(include_host_ips=True)
    dns_gateways: list[str] = ["10.0.2.3"]  # slirp4netns embedded DNS resolver
    db_allows: list[dict[str, Any]] = []
    icc_drop_bridges: list[str] = []

    managed_pg_container = getattr(settings, "managed_postgres_container_name", "msm-postgres")
    managed_pg_net = getattr(settings, "managed_postgres_network", "msm-internal")
    prefix = getattr(settings, "container_name_prefix", "msm-srv-")

    if client is not None and hasattr(client, "networks") and hasattr(client.networks, "list"):
        try:
            nets = client.networks.list()
        except Exception:
            nets = []
        for net in nets:
            try:
                attrs = getattr(net, "attrs", None)
                if not isinstance(attrs, dict):
                    continue
                net_name = str(attrs.get("Name") or "")
                ipam_cfgs = ((attrs.get("IPAM") or {}).get("Config") or [])
                for cfg in ipam_cfgs:
                    gw = str((cfg or {}).get("Gateway") or "").strip()
                    if gw and gw not in dns_gateways:
                        dns_gateways.append(gw)

                if net_name.startswith("msm-srv-net-") or net_name in {managed_pg_net, "msm-pg-hub", EPHEMERAL_NETWORK_NAME} or net_name.startswith("msm-db-net-"):
                    br = _bridge_ifname(attrs)
                    if br and br not in icc_drop_bridges:
                        icc_drop_bridges.append(br)

                containers = attrs.get("Containers") or {}
                if net_name in {managed_pg_net, "msm-pg-hub"}:
                    pg_ip = None
                    app_ips: list[str] = []
                    for ep in containers.values():
                        cname = str((ep or {}).get("Name") or "")
                        ipv4 = _strip_prefix(str((ep or {}).get("IPv4Address") or ""))
                        if not ipv4:
                            continue
                        if cname == managed_pg_container:
                            pg_ip = ipv4
                        else:
                            app_ips.append(ipv4)
                    if pg_ip:
                        for app_ip in app_ips:
                            db_allows.append({"src": f"{app_ip}/32", "dst": f"{pg_ip}/32", "port": 5432})

                elif net_name.startswith("msm-db-net-"):
                    try:
                        db_sid = int(net_name.removeprefix("msm-db-net-"))
                    except ValueError:
                        continue
                    db_container_name = f"{prefix}{db_sid}"
                    db_ip = None
                    client_ips: list[str] = []
                    for ep in containers.values():
                        cname = str((ep or {}).get("Name") or "")
                        ipv4 = _strip_prefix(str((ep or {}).get("IPv4Address") or ""))
                        if not ipv4:
                            continue
                        if cname == db_container_name:
                            db_ip = ipv4
                        elif server_id_from_container_name(cname, prefix) is not None:
                            client_ips.append(ipv4)
                    if db_ip:
                        for src_ip in client_ips:
                            db_allows.append({"src": f"{src_ip}/32", "dst": f"{db_ip}/32", "port": 5432})
            except Exception:
                continue

    return {
        "blocked_v4": cidrs["ipv4"],
        "blocked_v6": cidrs["ipv6"],
        "container_sources": list(_CONTAINER_SOURCE_CIDRS),
        "dns_gateways": list(dict.fromkeys(dns_gateways)),
        "db_allows": db_allows,
        "icc_drop_bridges": icc_drop_bridges,
    }


def _find_rootlesskit_child_pids() -> list[int]:
    if not sys.platform.startswith("linux"):
        return []
    try:
        import psutil
    except ImportError:
        return []

    try:
        self_net_ns = os.readlink("/proc/self/ns/net")
    except OSError:
        return []

    pids: list[int] = []
    for proc in psutil.process_iter(["pid", "name", "cmdline"]):
        try:
            name = (proc.info.get("name") or "").lower()
            cmd = " ".join(proc.info.get("cmdline") or []).lower()
            if "rootlesskit" not in name and "dockerd-rootless" not in cmd:
                continue
            pid = int(proc.info["pid"])
            net_ns = os.readlink(f"/proc/{pid}/ns/net")
            if net_ns != self_net_ns:
                pids.append(pid)
        except (OSError, psutil.Error, ValueError):
            continue
    return pids


def _iptables_commands_for_plan(plan: dict[str, Any], *, ipv6: bool = False) -> list[list[str]]:
    cmds: list[list[str]] = [
        ["-N", CHAIN_EGRESS_BLOCK],
        ["-F", CHAIN_EGRESS_BLOCK],
        ["-N", CHAIN_ISOLATION],
        ["-F", CHAIN_ISOLATION],
        ["-N", "DOCKER-USER"],
    ]

    if ipv6:
        for cidr in plan.get("blocked_v6") or []:
            cmds.append(["-A", CHAIN_EGRESS_BLOCK, "-d", cidr, "-j", "DROP"])
        cmds.extend([
            ["-A", CHAIN_EGRESS_BLOCK, "-j", "RETURN"],
            ["-A", CHAIN_ISOLATION, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"],
            ["-A", CHAIN_ISOLATION, "-i", "br-+", "-j", CHAIN_EGRESS_BLOCK],
            ["-A", CHAIN_ISOLATION, "-i", "docker0", "-j", CHAIN_EGRESS_BLOCK],
            ["-A", CHAIN_ISOLATION, "-j", "RETURN"],
        ])
        return cmds

    for cidr in plan.get("blocked_v4") or []:
        cmds.append(["-A", CHAIN_EGRESS_BLOCK, "-d", cidr, "-j", "DROP"])
    cmds.append(["-A", CHAIN_EGRESS_BLOCK, "-j", "RETURN"])

    cmds.append(["-A", CHAIN_ISOLATION, "-m", "conntrack", "--ctstate", "ESTABLISHED,RELATED", "-j", "ACCEPT"])
    for grant in plan.get("db_allows") or []:
        src = grant["src"]
        dst = grant["dst"]
        port = str(int(grant["port"]))
        cmds.append([
            "-A", CHAIN_ISOLATION,
            "-s", src, "-d", dst, "-p", "tcp", "--dport", port, "-j", "ACCEPT",
        ])

    for gw in plan.get("dns_gateways") or []:
        for proto in ("udp", "tcp"):
            cmds.append(["-A", CHAIN_ISOLATION, "-d", f"{_strip_prefix(gw)}/32", "-p", proto, "--dport", "53", "-j", "ACCEPT"])

    for br in plan.get("icc_drop_bridges") or []:
        cmds.append(["-A", CHAIN_ISOLATION, "-i", br, "-o", br, "-j", "DROP"])

    for src_net in plan.get("container_sources") or []:
        cmds.append(["-A", CHAIN_ISOLATION, "-s", src_net, "-j", CHAIN_EGRESS_BLOCK])
    cmds.append(["-A", CHAIN_ISOLATION, "-i", "br-+", "-j", CHAIN_EGRESS_BLOCK])
    cmds.append(["-A", CHAIN_ISOLATION, "-i", "docker0", "-j", CHAIN_EGRESS_BLOCK])
    cmds.append(["-A", CHAIN_ISOLATION, "-j", "RETURN"])
    return cmds


def _exec_iptables_sequence(prefix: list[str], binary: str, plan: dict[str, Any], *, ipv6: bool = False) -> bool:
    for args in _iptables_commands_for_plan(plan, ipv6=ipv6):
        # Ignore -N error when chain already exists
        is_create = args[0] == "-N"
        res = subprocess.run([*prefix, binary, *args], capture_output=True, text=True, timeout=10)
        if res.returncode != 0 and not is_create:
            return False

    # Ensure DOCKER-USER and OUTPUT jump to MSM-ISOLATION idempotently
    for hook in ("DOCKER-USER",):
        chk = subprocess.run(
            [*prefix, binary, "-C", hook, "-j", CHAIN_ISOLATION],
            capture_output=True,
            text=True,
            timeout=10,
        )
        if chk.returncode != 0:
            ins = subprocess.run(
                [*prefix, binary, "-I", hook, "1", "-j", CHAIN_ISOLATION],
                capture_output=True,
                text=True,
                timeout=10,
            )
            if ins.returncode != 0:
                return False
    return True


def reconcile_network_isolation(client: Any) -> dict[str, Any]:
    """Apply netfilter isolation rules inside RootlessKit netns and via host wrapper."""
    plan = build_isolation_plan(client)
    applied_netns = 0
    applied_host = False

    if not sys.platform.startswith("linux"):
        if is_isolation_required():
            raise RuntimeError("Linux netfilter required for strict network isolation")
        return {"ok": True, "skipped": "non-linux", "applied_netns": 0, "applied_host": False, "plan": plan}

    nsenter_bin = shutil.which("nsenter")
    iptables_bin = shutil.which("iptables")
    ip6tables_bin = shutil.which("ip6tables")

    if nsenter_bin and iptables_bin:
        for pid in _find_rootlesskit_child_pids():
            ns_prefix = [nsenter_bin, "--user", "--net", "-t", str(pid)]
            if _exec_iptables_sequence(ns_prefix, iptables_bin, plan, ipv6=False):
                applied_netns += 1
            if ip6tables_bin:
                _exec_iptables_sequence(ns_prefix, ip6tables_bin, plan, ipv6=True)

    # Also apply host-level DOCKER-USER / uid-owner egress block if helper exists
    if os.path.exists(IPTABLES_HELPER):
        sudo_bin = shutil.which("sudo")
        cmd = ([sudo_bin, "-n"] if sudo_bin and os.geteuid() != 0 else []) + [
            IPTABLES_HELPER,
            "apply-isolation",
            json.dumps(plan, separators=(",", ":")),
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=15)
            applied_host = res.returncode == 0
        except (OSError, subprocess.SubprocessError) as exc:
            logger.warning("Host msm-iptables isolation failed: %s", exc)
    elif os.geteuid() == 0 and iptables_bin:
        applied_host = _exec_iptables_sequence([], iptables_bin, plan, ipv6=False)
        if ip6tables_bin:
            _exec_iptables_sequence([], ip6tables_bin, plan, ipv6=True)

    if is_isolation_required() and applied_netns == 0 and not applied_host:
        raise RuntimeError("Failed to apply container network isolation firewall rules")

    return {
        "ok": True,
        "applied_netns": applied_netns,
        "applied_host": applied_host,
        "plan": plan,
    }
