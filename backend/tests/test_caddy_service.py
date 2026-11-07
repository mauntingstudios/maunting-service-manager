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
    assert apply_vhost(99, cfg_text) is True

    vhost_file = get_vhost_path(99)
    assert vhost_file.exists()
    assert ":8099 {" in vhost_file.read_text(encoding="utf-8")

    assert remove_vhost(99) is True
    assert not vhost_file.exists()
