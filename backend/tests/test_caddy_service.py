from pathlib import Path
import pytest

from services.caddy_service import (
    generate_caddy_config,
    normalize_api_path,
    normalize_backend_target,
    apply_vhost,
    remove_vhost,
    get_vhost_path,
)


def test_normalize_api_path():
    assert normalize_api_path("/api/*") == "/api/*"
    assert normalize_api_path("api") == "/api/*"
    assert normalize_api_path("/graphql") == "/graphql/*"
    assert normalize_api_path("/trpc/*") == "/trpc/*"
    assert normalize_api_path("") == "/api/*"
    assert normalize_api_path(None) == "/api/*"


def test_normalize_backend_target():
    assert normalize_backend_target(None, default_port=5000) == "127.0.0.1:5000"
    assert normalize_backend_target("http://127.0.0.1:8000") == "127.0.0.1:8000"
    assert normalize_backend_target("http://localhost:3000") == "localhost:3000"
    assert normalize_backend_target("https://api.extern.de") == "https://api.extern.de"
    assert normalize_backend_target("10.0.0.5:8080") == "10.0.0.5:8080"


def test_generate_caddy_config_port_only():
    cfg = generate_caddy_config(
        server_id=42,
        root_dir="/opt/msm/servers/web_42",
        server_name="Mein Frontend",
        port=8080,
    )
    assert ":8080 {" in cfg
    assert "root * /opt/msm/servers/web_42" in cfg
    assert "try_files {path} /index.html" in cfg
    assert "handle /assets/*" in cfg
    assert "reverse_proxy" not in cfg


def test_generate_caddy_config_with_domain_and_proxy():
    cfg = generate_caddy_config(
        server_id=42,
        root_dir="/opt/msm/servers/web_42",
        server_name="Mein Frontend",
        domain="app.beispiel.de",
        backend_proxy_url="http://127.0.0.1:5001",
        api_path="/api/*",
    )
    assert "app.beispiel.de {" in cfg
    assert "handle /api/* {" in cfg
    assert "reverse_proxy 127.0.0.1:5001" in cfg
    assert "try_files {path} /index.html" in cfg


def test_generate_caddy_config_custom_api_path():
    cfg = generate_caddy_config(
        server_id=101,
        root_dir="/var/www/site",
        port=3000,
        backend_proxy_url="https://api.external-cloud.com",
        api_path="graphql",
    )
    assert ":3000 {" in cfg
    assert "handle /graphql/* {" in cfg
    assert "reverse_proxy https://api.external-cloud.com" in cfg


def test_apply_and_remove_vhost(tmp_path, monkeypatch):
    from config import settings
    monkeypatch.setattr(settings, "caddy_conf_dir", str(tmp_path))

    cfg_text = generate_caddy_config(server_id=99, root_dir=str(tmp_path), port=8099)
    res = apply_vhost(99, cfg_text)
    assert res
    assert res == True
    assert res.success is True

    vhost_file = get_vhost_path(99)
    assert vhost_file.exists()
    assert ":8099 {" in vhost_file.read_text(encoding="utf-8")

    assert remove_vhost(99) is True
    assert not vhost_file.exists()


def test_apply_vhost_remote_node_unsupported():
    class DummyNode:
        is_local = False

    res = apply_vhost(123, "test config", node=DummyNode())
    assert not res
    assert res.success is False
    assert res.error == "caddy_agent_unsupported"
    ok, err = res
    assert ok is False
    assert err == "caddy_agent_unsupported"


def test_apply_vhost_via_msm_caddy_success(tmp_path, monkeypatch):
    import subprocess
    from config import settings
    from services.caddy_service import get_staging_path

    staging_dir = tmp_path / "staging"
    fake_bin = tmp_path / "msm-caddy"
    fake_bin.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")

    monkeypatch.setattr(settings, "caddy_staging_dir", str(staging_dir))
    monkeypatch.setattr(settings, "msm_caddy_path", str(fake_bin))

    called_cmds = []

    def fake_run(cmd, **kwargs):
        called_cmds.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    res = apply_vhost(55, "cfg for 55")
    assert res
    assert res.success is True
    assert res.error == ""

    # Verify staging file was created
    staging_file = get_staging_path(55)
    assert staging_file.exists()
    assert staging_file.read_text(encoding="utf-8") == "cfg for 55"

    # Verify sudo -n was invoked
    assert called_cmds == [["sudo", "-n", str(fake_bin), "apply", "55"]]


def test_apply_vhost_via_msm_caddy_failure(tmp_path, monkeypatch):
    import subprocess
    from config import settings

    fake_bin = tmp_path / "msm-caddy"
    fake_bin.write_text("#!/bin/sh\nexit 1\n", encoding="utf-8")
    monkeypatch.setattr(settings, "caddy_staging_dir", str(tmp_path / "staging"))
    monkeypatch.setattr(settings, "msm_caddy_path", str(fake_bin))

    def fake_run(cmd, **kwargs):
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="caddy validate failed for server 55")

    monkeypatch.setattr(subprocess, "run", fake_run)

    res = apply_vhost(55, "cfg for 55")
    assert not res
    assert res.success is False
    assert "caddy validate failed for server 55" in res.error


def test_remove_vhost_via_msm_caddy(tmp_path, monkeypatch):
    import subprocess
    from config import settings

    fake_bin = tmp_path / "msm-caddy"
    fake_bin.write_text("#!/bin/sh\nexit 0\n", encoding="utf-8")
    monkeypatch.setattr(settings, "msm_caddy_path", str(fake_bin))

    called_cmds = []

    def fake_run(cmd, **kwargs):
        called_cmds.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")

    monkeypatch.setattr(subprocess, "run", fake_run)

    assert remove_vhost(77) is True
    assert called_cmds == [["sudo", "-n", str(fake_bin), "remove", "77"]]

