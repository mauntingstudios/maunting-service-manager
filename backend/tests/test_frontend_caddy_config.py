"""Tests fuer Caddyfile-Erzeugung und Branch-Slugs bei Frontend-Servern."""

from pathlib import Path

from blueprints.schema import load_blueprint_file
from games.blueprint_plugin import BlueprintPlugin
from services.frontend_caddy_config import (
    PreviewRoute,
    generate_container_caddyfile,
    slugify_branch,
)

_NATIVE_DIR = Path(__file__).resolve().parents[1] / "blueprints" / "native"


def test_slugify_branch_normalizes_slashes_and_special_chars() -> None:
    assert slugify_branch("feature/Login_v2!") == "feature-login-v2"
    assert slugify_branch("main") == "main"
    assert slugify_branch("current") == "branch-current"
    long_slug = slugify_branch("feature/" + "a" * 80)
    assert len(long_slug) <= 48


def test_slugify_branch_with_hash_resolves_collisions() -> None:
    a = slugify_branch("feature/a-b", with_hash=True)
    b = slugify_branch("feature_a/b", with_hash=True)
    assert a != b


def test_generate_container_caddyfile_production_and_previews() -> None:
    cfg = generate_container_caddyfile(
        port=8080,
        root_dir="/data/current",
        spa_fallback=True,
        server_id=42,
        previews=[
            PreviewRoute(
                branch_slug="feature-login",
                port=27101,
                root_dir="/data/previews/feature-login",
                forward_auth_url="http://127.0.0.1:8000",
            )
        ],
    )
    assert "# Managed by MSM: Frontend #42" in cfg
    assert ":8080 {" in cfg
    assert "root * /data/current" in cfg
    assert "try_files {path} /index.html" in cfg
    assert ":27101 {" in cfg
    assert 'header X-Robots-Tag "noindex, nofollow"' in cfg
    assert "forward_auth http://127.0.0.1:8000 {" in cfg
    assert "uri /api/frontend-previews/authorize" in cfg


def test_frontend_blueprints_inject_caddyfile_seed() -> None:
    for bid, expected_root in (
        ("web_static", "root * /data"),
        ("web_frontend_github", "root * /data/current"),
    ):
        bp = load_blueprint_file(_NATIVE_DIR / f"{bid}.blueprint.json")
        plugin = BlueprintPlugin(bp)
        seeds, _, _ = plugin._resolve_runtime_seeds_and_patches({"web": 28080})
        by_file = {item["file"]: item["content"] for item in seeds}
        assert "Caddyfile" in by_file
        assert ":28080 {" in by_file["Caddyfile"]
        assert expected_root in by_file["Caddyfile"]
        assert "try_files {path} /index.html" in by_file["Caddyfile"]
