from pathlib import Path
import subprocess

from blueprints.schema import load_blueprint_file


ROOT = Path(__file__).resolve().parents[2]
CONTAINERS_DIR = ROOT / "containers"
NATIVE_BLUEPRINTS_DIR = ROOT / "backend" / "blueprints" / "native"


def test_fivem_runtime_is_pinned_and_executable_wrapper_valid() -> None:
    runtime_dir = CONTAINERS_DIR / "fivem-runtime"
    dockerfile = (runtime_dir / "Dockerfile").read_text(encoding="utf-8")
    wrapper = (runtime_dir / "msm-fivem-server").read_text(encoding="utf-8")
    blueprint = load_blueprint_file(NATIVE_BLUEPRINTS_DIR / "fivem.blueprint.json")

    assert "ARG FIVEM_BUILD=" in dockerfile
    assert "ARG FIVEM_SHA256=" in dockerfile
    assert "sha256sum --check -" in dockerfile
    assert 'ENTRYPOINT ["/usr/bin/tini", "-g", "--"]' in dockerfile
    assert "TXHOST_DATA_PATH=/home/container/txData" in dockerfile

    assert "ld-musl-x86_64.so.1" in wrapper
    assert "+set citizen_dir /opt/cfx-server/alpine/opt/cfx-server/citizen/" in wrapper
    assert blueprint.runtime.image.startswith("ghcr.io/mauntingstudios/msm-fivem-runtime:")
    assert "/usr/local/bin/msm-fivem-server" in blueprint.runtime.startup


def test_space_engineers_runtime_prepares_dotnet48_prefix() -> None:
    runtime_dir = CONTAINERS_DIR / "space-engineers-runtime"
    dockerfile = (runtime_dir / "Dockerfile").read_text(encoding="utf-8")
    entrypoint = (runtime_dir / "entrypoint.sh").read_text(encoding="utf-8")
    blueprint = load_blueprint_file(NATIVE_BLUEPRINTS_DIR / "space_engineers.blueprint.json")

    assert "FROM ghcr.io/parkervcp/yolks:wine_10" in dockerfile
    assert "vcrun2013 vcrun2017 dotnet48" in dockerfile
    assert 'WINEDLLOVERRIDES=""' in dockerfile
    assert 'ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/msm-se-entrypoint"]' in dockerfile

    assert "set -euo pipefail" in entrypoint
    assert "cp -a /opt/se-wineprefix/." in entrypoint
    assert 'exec "$@"' in entrypoint
    assert blueprint.runtime.image.startswith(
        "ghcr.io/mauntingstudios/msm-space-engineers-runtime:"
    )

    try:
        subprocess.run(
            ["bash", "-n"],
            input=entrypoint.replace("\r\n", "\n").encode("utf-8"),
            check=True,
        )
    except FileNotFoundError:
        pass


def test_proton_runtime_is_reproducibly_pinned() -> None:
    dockerfile = (CONTAINERS_DIR / "proton-runtime" / "Dockerfile").read_text(encoding="utf-8")
    entrypoint = (CONTAINERS_DIR / "proton-runtime" / "entrypoint.sh").read_text(encoding="utf-8")
    workflow = (ROOT / ".github" / "workflows" / "proton-runtime-image.yml").read_text(encoding="utf-8")

    assert "@sha256:" in dockerfile
    assert "UMU_VERSION=1.4.0" in dockerfile
    assert "GE-Proton10-34" in dockerfile
    assert 'ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/msm-proton-entrypoint"]' in dockerfile
    assert '"${HOME}/.steam/sdk64/steamclient.so"' in entrypoint
    assert "msm-proton-runtime" in workflow
    assert "STABLE_TAG: ge-proton10-34-umu1.4.0" in workflow

    for blueprint_id in ("windrose", "myth_of_empires", "abiotic_factor", "lotr_return_to_moria"):
        bp = load_blueprint_file(NATIVE_BLUEPRINTS_DIR / f"{blueprint_id}.blueprint.json")
        assert bp.runtime.image == "ghcr.io/mauntingstudios/msm-proton-runtime:ge-proton10-34-umu1.4.0"
        assert bp.runtime.allowUnprivilegedUserNamespaces is True

    try:
        subprocess.run(
            ["bash", "-n"],
            input=entrypoint.replace("\r\n", "\n").encode("utf-8"),
            check=True,
        )
    except FileNotFoundError:
        pass
