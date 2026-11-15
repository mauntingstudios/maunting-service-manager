"""Containment and isolation tests for untrusted Blueprint sources, build commands, and registries."""

from __future__ import annotations

import ipaddress
import socket
import subprocess
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import httpx
import pytest

from blueprints import github_source, http_source
from blueprints.schema import BlueprintValidationError, load_blueprint_dict
from config import settings


def _base_github_blueprint(
    *,
    image: str = "docker.io/library/node:22-bookworm-slim",
    env: dict[str, str] | None = None,
    user: str | None = "1000:1000",
    setup_commands: list[list[str]] | None = None,
    sub_path: str | None = None,
) -> dict:
    return {
        "version": 1,
        "meta": {
            "id": "isolated_test_bot",
            "name": "Isolated Test Bot",
            "category": "bot",
        },
        "runtime": {
            "image": image,
            "workdir": "/data",
            "user": user,
            "env": env or {"NODE_ENV": "production"},
            "startup": "node index.js",
        },
        "ports": [],
        "source": {
            "type": "github",
            "github": {
                "repo": "octocat/Hello-World",
                "branch": "main",
                "subPath": sub_path,
                "setupCommands": setup_commands if setup_commands is not None else [["npm", "ci"]],
            },
        },
    }


def test_panel_never_executes_bare_metal_setup_commands_by_default(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bp = load_blueprint_dict(_base_github_blueprint())
    called_subproc: list[list[str]] = []

    monkeypatch.setattr(settings, "allow_legacy_bare_metal_setup", False, raising=False)
    monkeypatch.setattr("services.docker_service.is_available", lambda: False)
    monkeypatch.setattr(
        subprocess,
        "run",
        lambda cmd, **_kw: called_subproc.append(list(cmd)),
    )

    with pytest.raises(github_source.GithubSourceError, match="Sandbox|Container"):
        github_source._run_setup_commands(tmp_path, bp)
    assert called_subproc == []


def test_setup_commands_run_in_ephemeral_container_with_scrubbed_env_and_metachar_guard(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    bp = load_blueprint_dict(_base_github_blueprint(sub_path="apps/bot"))
    (tmp_path / "apps" / "bot").mkdir(parents=True)
    ephemeral_calls: list[dict] = []

    monkeypatch.setattr(settings, "allow_legacy_bare_metal_setup", False, raising=False)
    monkeypatch.setattr("services.docker_service.is_available", lambda: True)
    monkeypatch.setattr(
        "services.docker_service.run_ephemeral",
        lambda **kw: (ephemeral_calls.append(kw), {"ok": True})[1],
    )
    monkeypatch.setenv("MSM_SECRET_KEY", "super-secret-must-not-leak")
    monkeypatch.setenv("MSM_GITHUB_CLONE_TOKEN", "ghp_secret_must_not_leak")

    github_source._run_setup_commands(tmp_path, bp)
    assert len(ephemeral_calls) == 1
    call = ephemeral_calls[0]
    assert call["workdir"] == "/data/apps/bot"
    assert call["env"] == {"HOME": "/tmp", "LC_ALL": "C.UTF-8"}
    assert "MSM_SECRET_KEY" not in call["env"]
    assert "MSM_GITHUB_CLONE_TOKEN" not in call["env"]

    # Shell metacharacters must be rejected even if supplied programmatically
    bad_bp = load_blueprint_dict(_base_github_blueprint(setup_commands=[["sh", "-c", "id"]]))
    bad_bp.source.github.setupCommands = [["npm", "ci;cat /etc/shadow"]]  # type: ignore[union-attr]
    with pytest.raises(github_source.GithubSourceError, match="Shell-Metazeichen"):
        github_source._run_setup_commands(tmp_path, bad_bp)


def test_github_clone_scrubs_pat_disables_hooks_and_delegates_to_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    secret_pat = "ghp_secretTokenValue123456"
    url = github_source._clone_url("octocat/Hello-World", secret_pat)
    assert secret_pat not in url
    assert url == "https://github.com/octocat/Hello-World.git"

    env = github_source._build_git_env(cwd=None, token=secret_pat)
    assert env["GIT_TERMINAL_PROMPT"] == "0"
    assert env["GIT_ASKPASS"] == "/bin/false"
    cfg_pairs = {
        env[f"GIT_CONFIG_KEY_{i}"]: env[f"GIT_CONFIG_VALUE_{i}"]
        for i in range(int(env["GIT_CONFIG_COUNT"]))
    }
    assert cfg_pairs["core.hooksPath"] == "/dev/null"
    assert cfg_pairs["core.fsmonitor"] == "false"
    assert cfg_pairs["protocol.file.allow"] == "never"
    assert cfg_pairs["http.https://github.com/.extraheader"].startswith("AUTHORIZATION: basic ")

    # Error sanitization strips credentials in stderr
    monkeypatch.setattr(
        github_source.subprocess,
        "run",
        lambda *_a, **_kw: subprocess.CompletedProcess(
            ["git"],
            128,
            stdout="",
            stderr="fatal: https://x-access-token:ghp_secretTokenValue123456@github.com failed AUTHORIZATION: basic dXNlcjpwYXNz",
        ),
    )
    with pytest.raises(github_source.GithubSourceError) as err:
        github_source._run_git(["ls-remote", url], token=secret_pat)
    msg = str(err.value)
    assert secret_pat not in msg
    assert "dXNlcjpwYXNz" not in msg
    assert "x-access-token:***" in msg

    # Remote / agent-managed node delegation passes payload via NodeClient rather than panel FS
    bp = load_blueprint_dict(_base_github_blueprint())
    delegated: list[dict] = []
    fake_node_client = SimpleNamespace(
        install_github_source=lambda payload: (delegated.append(payload), {"ok": True})[1]
    )
    monkeypatch.setattr("services.node_client.NodeClient.from_node", lambda _node, timeout=600: fake_node_client)
    remote_node = SimpleNamespace(is_local=False, host="https://node2.example.com:9000", auth_token_enc="enc")
    res = github_source.install_github_source_for_node(
        42, bp, "/opt/msm/servers/42", token=secret_pat, node=remote_node
    )
    assert res["ok"] is True
    assert delegated[0]["server_id"] == "42"
    assert delegated[0]["setup_commands"] == [["npm", "ci"]]


def test_http_source_blocks_ssrf_non_https_and_rebinding_redirects(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    for scheme_bad in ("http://example.com/mod.zip", "file:///etc/passwd", "ftp://example.com/a.tar.gz"):
        with pytest.raises(http_source.HttpSourceError):
            http_source._ensure_safe_https_url(scheme_bad)

    for private_ip in ("127.0.0.1", "10.0.0.5", "172.16.10.1", "192.168.1.10", "169.254.169.254", "100.64.0.5", "::1", "fd00::1"):
        monkeypatch.setattr(
            socket,
            "getaddrinfo",
            lambda _h, _p, type=0, _ip=private_ip: [(socket.AF_INET6 if ":" in _ip else socket.AF_INET, socket.SOCK_STREAM, 6, "", (_ip, 443))],
        )
        with pytest.raises(http_source.HttpSourceError, match="SSRF"):
            http_source._resolve_public_ips("rebind.example.invalid", 443)

    # Pinned backend rejects private literal IPs immediately before connect
    backend = http_source._PinnedPublicNetworkBackend()
    with pytest.raises(http_source.HttpSourceError, match="SSRF"):
        backend.connect_tcp("169.254.169.254", 80)

    # Redirect from public CDN -> internal metadata / http:// is rejected
    monkeypatch.setattr(http_source, "_resolve_public_ips", lambda host, _port=443: (
        ["93.184.216.34"] if host == "cdn.example.com" else (_ for _ in ()).throw(http_source.HttpSourceError("SSRF blocked"))
    ))

    class _FakeResp:
        def __init__(self, status_code: int, location: str):
            self.status_code = status_code
            self.headers = {"location": location}

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def raise_for_status(self):
            return None

    monkeypatch.setattr(
        httpx,
        "stream",
        lambda _m, _u, **_kw: _FakeResp(302, "https://169.254.169.254/latest/meta-data"),
    )
    with pytest.raises(http_source.HttpSourceError, match="SSRF"):
        http_source._stream_download("https://cdn.example.com/archive.zip", tmp_path / "out.zip", None)


def test_schema_enforces_registry_allowlist_forbidden_env_and_non_root_user(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(settings, "allowed_image_registries", "docker.io,ghcr.io", raising=False)

    # Trusted registry passes
    bp_ok = load_blueprint_dict(_base_github_blueprint(image="ghcr.io/maunting/java:21"))
    assert bp_ok.runtime.image == "ghcr.io/maunting/java:21"
    bp_short = load_blueprint_dict(_base_github_blueprint(image="alpine:3.20"))
    assert bp_short.runtime.image == "alpine:3.20"

    # Arbitrary untrusted registry rejected
    with pytest.raises(BlueprintValidationError) as exc_reg:
        load_blueprint_dict(_base_github_blueprint(image="evil.attacker.invalid/miner:latest"))
    assert "Allowlist" in " ".join(exc_reg.value.errors)

    # Dangerous runtime env vars rejected
    for bad_key in ("DOCKER_HOST", "LD_PRELOAD", "LD_AUDIT", "BASH_ENV", "PYTHONINSPECT"):
        with pytest.raises(BlueprintValidationError) as exc_env:
            load_blueprint_dict(_base_github_blueprint(env={bad_key: "/tmp/evil"}))
        assert bad_key in " ".join(exc_env.value.errors)

    # Root UID/GID rejected
    for root_user in ("0:0", "0:1000", "1000:0"):
        with pytest.raises(BlueprintValidationError):
            load_blueprint_dict(_base_github_blueprint(user=root_user))
