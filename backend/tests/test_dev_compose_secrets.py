from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_dev_compose_requires_docs_secrets_and_isolates_network():
    compose = (ROOT / "docker-compose.dev.yml").read_text(encoding="utf-8")
    for key in (
        "MSM_DOCS_SIDECAR_TOKEN",
        "MSM_DOCS_COLLAB_SECRET",
        "MSM_DOCS_SIGNING_SECRET",
    ):
        assert f"${{{key}:?" in compose
        assert f"${{{key}:-" not in compose
    assert "docsnet:\n    internal: true" in compose
    assert "USER node" in (ROOT / "docs-sidecar" / "Dockerfile.dev").read_text(
        encoding="utf-8"
    )


def test_dev_env_setup_generates_and_preserves_docs_secrets():
    setup = (ROOT / "scripts" / "setup-dev-env.py").read_text(encoding="utf-8")
    assert 'DOCS_ENV_DEV = ROOT / ".env.dev"' in setup
    assert "secrets.token_urlsafe(32)" in setup
    assert "docs_values.get(key)" in setup
    assert ".env.dev" in (ROOT / ".gitignore").read_text(encoding="utf-8")
