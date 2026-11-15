"""Validated on-node HTTP and GitHub source installation."""

from __future__ import annotations

import base64
import hashlib
import ipaddress
import re
import socket
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpcore
import httpx

from config import settings
from services import docker_service, file_service

MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024 * 1024
_CGNAT_NET = ipaddress.ip_network("100.64.0.0/10")


class SourceInstallError(RuntimeError):
    pass


def _is_public_ip(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ):
        return False
    if isinstance(address, ipaddress.IPv4Address) and address in _CGNAT_NET:
        return False
    return True


def _resolve_public_ips(host: str, port: int = 443) -> list[str]:
    ips: list[str] = []
    for info in socket.getaddrinfo(host, port, type=socket.SOCK_STREAM):
        raw_ip = info[4][0].split("%", 1)[0]
        address = ipaddress.ip_address(raw_ip)
        if not _is_public_ip(address):
            raise SourceInstallError("Source host resolved to a non-public address")
        if str(address) not in ips:
            ips.append(str(address))
    if not ips:
        raise SourceInstallError("Source host resolved to no addresses")
    return ips


class _PinnedPublicNetworkBackend(httpcore.SyncBackend):
    """Resolve DNS once per TCP connect, validate public IPs, and pin the peer IP."""

    def connect_tcp(
        self,
        host: str,
        port: int,
        timeout: float | None = None,
        local_address: str | None = None,
        socket_options: Any = None,
    ) -> httpcore.NetworkStream:
        try:
            literal = ipaddress.ip_address(host.split("%", 1)[0])
            if not _is_public_ip(literal):
                raise SourceInstallError("Source host resolved to a non-public address")
            pinned_ip = str(literal)
        except ValueError:
            pinned_ip = _resolve_public_ips(host, port)[0]
        stream = super().connect_tcp(
            pinned_ip,
            port,
            timeout=timeout,
            local_address=local_address,
            socket_options=socket_options,
        )
        sock = stream.get_extra_info("socket")
        if sock is not None:
            peer = ipaddress.ip_address(sock.getpeername()[0].split("%", 1)[0])
            if not _is_public_ip(peer):
                stream.close()
                raise SourceInstallError("Connected peer IP is not public")
        return stream


def _build_pinned_http_client(timeout: httpx.Timeout) -> httpx.Client:
    if isinstance(httpx.Client, type) and httpx.Client.__module__.startswith("httpx"):
        transport = httpx.HTTPTransport()
        transport._pool._network_backend = _PinnedPublicNetworkBackend()  # type: ignore[attr-defined]
        return httpx.Client(timeout=timeout, transport=transport)
    return httpx.Client(timeout=timeout)


def _validate_public_https(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        raise SourceInstallError("Only public HTTPS source URLs are allowed")
    port = parsed.port or 443
    _resolve_public_ips(parsed.hostname, port)


def install_http(
    server_id: str | int,
    *,
    url: str,
    sha256: str | None,
    archive_type: str,
    extract_to: str | None,
) -> dict[str, Any]:
    _validate_public_https(url)
    if archive_type not in {"zip", "tar.gz", "tgz", "tar.xz", "txz", "tar.bz2", "tbz2"}:
        raise SourceInstallError("Unsupported archive type")
    root = file_service.server_root(server_id)
    destination = file_service.safe_path(server_id, extract_to or "")
    file_service.assert_no_symlink_path(destination, root)
    destination.mkdir(parents=True, exist_ok=True)
    archive = destination / f".msm-source.{archive_type}"
    if archive.is_symlink():
        raise SourceInstallError("Invalid archive path")
    digest = hashlib.sha256()
    written = 0
    current_url = url
    try:
        timeout = httpx.Timeout(60.0, read=60.0, connect=15.0)
        with _build_pinned_http_client(timeout) as client:
            for _ in range(6):
                _validate_public_https(current_url)
                with client.stream("GET", current_url, follow_redirects=False) as response:
                    if response.status_code in {301, 302, 303, 307, 308}:
                        location = response.headers.get("location")
                        if not location:
                            raise SourceInstallError("Redirect is missing a target")
                        current_url = location
                        continue
                    if response.status_code != 200:
                        raise SourceInstallError(f"Source download failed with HTTP {response.status_code}")
                    with archive.open("wb") as handle:
                        for chunk in response.iter_bytes(1024 * 1024):
                            written += len(chunk)
                            if written > MAX_DOWNLOAD_BYTES:
                                raise SourceInstallError("Source archive exceeds maximum size")
                            digest.update(chunk)
                            handle.write(chunk)
                    break
            else:
                raise SourceInstallError("Too many source redirects")
        if sha256 and digest.hexdigest() != sha256:
            raise SourceInstallError("Source archive checksum mismatch")
        relative = archive.relative_to(root).as_posix()
        file_service.extract_archive(server_id, relative)
        return {"ok": True}
    finally:
        archive.unlink(missing_ok=True)


def _untrusted_runtime() -> str | None:
    candidate = (getattr(settings, "default_untrusted_runtime", "") or "").strip()
    if not candidate or candidate == "runc":
        return None
    return candidate


def _run_container_git(
    root: Path,
    args: list[str],
    *,
    token: str | None = None,
    timeout: int = 900,
) -> dict[str, Any]:
    """Execute git inside a hardened ephemeral container rather than bare-metal."""
    git_env: dict[str, str] = {
        "HOME": "/tmp",
        "LC_ALL": "C.UTF-8",
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "/bin/false",
    }
    if token:
        basic = base64.b64encode(f"x-access-token:{token}".encode("utf-8")).decode("ascii")
        git_env.update({
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
            "GIT_CONFIG_VALUE_0": f"AUTHORIZATION: basic {basic}",
        })
    hardened_args = [
        "-c", "protocol.file.allow=never",
        "-c", "core.fsmonitor=false",
        "-c", "core.hooksPath=/dev/null",
        "-c", "safe.directory=/data",
        *args,
    ]
    try:
        return docker_service.run_ephemeral(
            image=getattr(settings, "git_helper_image", "alpine/git:latest"),
            command=hardened_args,
            volumes={str(root): {"bind": "/data", "mode": "rw"}},
            env=git_env,
            workdir="/data",
            entrypoint="git",
            timeout=timeout,
            runtime=_untrusted_runtime(),
        )
    finally:
        git_env.pop("GIT_CONFIG_VALUE_0", None)


def install_github(
    server_id: str | int,
    *,
    repo: str,
    branch: str,
    token: str | None,
    setup_commands: list[list[str]],
    sub_path: str | None,
    runtime_image: str,
) -> dict[str, Any]:
    if (
        not re.fullmatch(r"[A-Za-z0-9_.-]{1,100}/[A-Za-z0-9_.-]{1,100}", repo)
        or repo.startswith("-")
        or "/-" in repo
        or ".." in repo
    ):
        raise SourceInstallError("Invalid GitHub repository")
    if (
        not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", branch)
        or ".." in branch
    ):
        raise SourceInstallError("Invalid GitHub branch")
    root = file_service.server_root(server_id)
    root.mkdir(parents=True, exist_ok=True)
    if sub_path:
        sub_target = file_service.safe_path(server_id, sub_path)
        file_service.assert_no_symlink_path(sub_target, root)
        rel_sub = sub_target.relative_to(root).as_posix()
        workdir = "/data" + (f"/{rel_sub}" if rel_sub and rel_sub != "." else "")
    else:
        workdir = "/data"

    url = f"https://github.com/{repo}.git"
    try:
        if (root / ".git").is_dir():
            git_steps: list[tuple[list[str], str | None]] = [
                (["-C", "/data", "fetch", "--no-recurse-submodules", "origin", branch, "--depth", "1", "--prune"], token),
                (["-C", "/data", "reset", "--hard", f"origin/{branch}"], None),
            ]
        else:
            if any(root.iterdir()):
                raise SourceInstallError("Server directory is not empty and is not a Git repository")
            git_steps = [
                (["clone", "--no-recurse-submodules", "--branch", branch, "--depth", "1", url, "/data"], token),
            ]

        for step_args, step_token in git_steps:
            res = _run_container_git(root, step_args, token=step_token, timeout=900)
            if not res.get("ok"):
                raise SourceInstallError("GitHub source operation failed")

        # Never forward GitHub PAT or host environment into setup containers.
        setup_env = {"HOME": "/tmp", "LC_ALL": "C.UTF-8"}
        untrusted_rt = _untrusted_runtime()
        for command in setup_commands:
            if not command or len(command) > 32 or any(not part or "\x00" in part or "\n" in part for part in command):
                raise SourceInstallError("Invalid setup command")
            result = docker_service.run_ephemeral(
                image=runtime_image,
                command=command,
                volumes={str(root): {"bind": "/data", "mode": "rw"}},
                env=setup_env,
                workdir=workdir,
                entrypoint="",
                timeout=1800,
                runtime=untrusted_rt,
            )
            if not result.get("ok"):
                raise SourceInstallError("Source setup command failed")

        sha_res = _run_container_git(root, ["-C", "/data", "rev-parse", "HEAD"], token=None, timeout=30)
        commit_sha = (sha_res.get("stdout") or "").strip()[:40]
        return {"ok": True, "commit": commit_sha, "branch": branch, "repo": repo}
    finally:
        token = None
