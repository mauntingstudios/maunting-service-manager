"""Gemeinsamer Node-Build-Runner fuer Frontend-Projekte (Singra & Frontend-Server)."""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from config import settings
from services import docker_service
from services.docker_service import VolumeBind

_LOCKFILE_INSTALL: tuple[tuple[str, list[str]], ...] = (
    ("pnpm-lock.yaml", ["corepack", "enable", "&&", "pnpm", "install", "--frozen-lockfile"]),
    ("yarn.lock", ["corepack", "enable", "&&", "yarn", "install", "--frozen-lockfile"]),
    ("package-lock.json", ["npm", "ci"]),
)

_DEFAULT_OUTPUT_DIRS = ("dist", "build", "out", ".output/public", "_site")


@dataclass(frozen=True)
class FrontendBuildResult:
    ok: bool
    output_dir: Path | None
    log_output: str


def detect_install_command(project_dir: Path) -> list[str]:
    if (project_dir / "pnpm-lock.yaml").exists():
        return ["pnpm", "install", "--frozen-lockfile"]
    if (project_dir / "yarn.lock").exists():
        return ["yarn", "install", "--frozen-lockfile"]
    if (project_dir / "package-lock.json").exists():
        return ["npm", "ci", "--include=dev"]
    pkg_file = project_dir / "package.json"
    if pkg_file.is_file():
        try:
            import json

            pkg = json.loads(pkg_file.read_text(encoding="utf-8", errors="replace"))
            pm = str(pkg.get("packageManager") or "").split("@", 1)[0].strip().lower()
            if pm == "pnpm":
                return ["pnpm", "install"]
            if pm == "yarn":
                return ["yarn", "install"]
        except Exception:
            pass
    return ["npm", "install", "--include=dev"]


def _has_package_build_script(project_dir: Path) -> bool:
    pkg_file = project_dir / "package.json"
    if not pkg_file.is_file():
        return False
    try:
        import json

        pkg = json.loads(pkg_file.read_text(encoding="utf-8", errors="replace"))
        scripts = pkg.get("scripts")
        return isinstance(scripts, dict) and bool(scripts.get("build"))
    except Exception:
        return True


def detect_output_dir(project_dir: Path, configured_dir: str | None = None) -> Path | None:
    if configured_dir:
        candidate = project_dir / configured_dir
        if (candidate / "index.html").is_file():
            return candidate
        return None
    for name in _DEFAULT_OUTPUT_DIRS:
        candidate = project_dir / name
        if (candidate / "index.html").is_file():
            return candidate
    dist_dir = project_dir / "dist"
    if dist_dir.is_dir():
        for pattern in ("*/browser", "*"):
            for child in sorted(dist_dir.glob(pattern)):
                if child.is_dir() and (child / "index.html").is_file():
                    return child
    public_dir = project_dir / "public"
    if (public_dir / "index.html").is_file():
        return public_dir
    if not _has_package_build_script(project_dir) and (project_dir / "index.html").is_file():
        return project_dir
    return None


def _join_shell_cmd(argv: list[str]) -> str:
    return " ".join(shlex.quote(arg) for arg in argv)


def run_node_frontend_build(
    project_dir: Path,
    *,
    node_version: str = "22",
    install_command: list[str] | None = None,
    build_command: list[str] | None = None,
    output_dir: str | None = None,
    env_vars: dict[str, str] | None = None,
    timeout_seconds: int = 900,
    nano_cpus: int | None = None,
    mem_limit: str | None = None,
    node=None,
    log_callback: Callable[[str], None] | None = None,
) -> FrontendBuildResult:
    """Baut ein Frontend-Projekt in einem Wegwerf-Node-Container (mit lokalem Fallback)."""
    has_pkg = (project_dir / "package.json").is_file()
    has_build = _has_package_build_script(project_dir)

    if not has_pkg and install_command is None and build_command is None:
        resolved_static = detect_output_dir(project_dir, output_dir)
        msg = (
            "[MSM] Kein package.json gefunden — statische Bereitstellung erkannt.\n"
            if resolved_static
            else "[MSM] Kein package.json und keine index.html gefunden.\n"
        )
        if log_callback:
            log_callback(msg)
        return FrontendBuildResult(
            ok=resolved_static is not None,
            output_dir=resolved_static,
            log_output=msg,
        )

    install_argv = install_command or detect_install_command(project_dir)
    if build_command is not None:
        build_argv: list[str] | None = build_command
    elif has_build:
        build_argv = ["npm", "run", "build"]
    else:
        build_argv = None
    image = f"node:{node_version}-bookworm-slim"

    docker_avail, exec_node = docker_service.resolve_ephemeral_executor(node)
    pkg_net = "msm-ephemeral-net" if getattr(settings, "coding_sandbox_allow_package_network", True) else "none"
    allow_host_fallback = bool(getattr(settings, "coding_sandbox_allow_host_fallback", False))
    sandbox_env = {
        **(env_vars or {}),
        "HOME": "/tmp/sandbox_home",
        "npm_config_cache": "/tmp/npm_cache",
    }
    build_output = ""
    build_succeeded = False

    if docker_avail:
        install_str = _join_shell_cmd(install_argv)
        if install_argv[0] in ("pnpm", "yarn"):
            install_cmd = f"NODE_ENV=development corepack enable && NODE_ENV=development {install_str}"
        else:
            install_cmd = f"NODE_ENV=development {install_str}"
        if build_argv:
            build_str = _join_shell_cmd(build_argv)
            container_script = (
                f'echo "[MSM] === Dependencies installieren ===" && {install_cmd} && '
                f'echo "[MSM] === Anwendung bauen ===" && {build_str}'
            )
        else:
            container_script = f'echo "[MSM] === Dependencies installieren ===" && {install_cmd}'
        volumes = [
            VolumeBind(
                host_path=str(project_dir.resolve()),
                container_path="/app",
                read_only=False,
            )
        ]
        res = docker_service.run_ephemeral(
            image=image,
            command=["sh", "-c", container_script],
            workdir="/app",
            volumes=volumes,
            env=sandbox_env,
            read_only_rootfs=True,
            tmpfs_paths=["/tmp"],
            network=pkg_net,
            timeout=timeout_seconds,
            nano_cpus=nano_cpus,
            mem_limit=mem_limit,
            node=exec_node,
            log_callback=log_callback,
        )
        build_succeeded = bool(res.get("ok"))
        build_output = (res.get("stdout") or "") + "\n" + (res.get("stderr") or "")
    elif not allow_host_fallback:
        msg = "Frontend-Build erfordert eine aktive Container-Sandbox (msm-agent/Docker).\n"
        if log_callback:
            log_callback(msg)
        build_output = msg
        build_succeeded = False
    else:
        if log_callback:
            log_callback("Docker nicht verfuegbar; verwende lokalen Node-Prozess fuer Build...\n")
        install_env = dict(os.environ)
        if env_vars:
            install_env.update(env_vars)
        install_env["NODE_ENV"] = "development"
        build_env = dict(os.environ)
        if env_vars:
            build_env.update(env_vars)
        try:
            bin_name = install_argv[0]
            resolved_bin = shutil.which(f"{bin_name}.cmd") or shutil.which(bin_name)
            resolved_build_bin = None
            if build_argv:
                build_bin = build_argv[0]
                resolved_build_bin = shutil.which(f"{build_bin}.cmd") or shutil.which(build_bin)
            if not resolved_bin or (build_argv and not resolved_build_bin):
                return FrontendBuildResult(
                    ok=False,
                    output_dir=None,
                    log_output=f"Kein {bin_name}/{(build_argv or ['build'])[0]} auf dem Host gefunden.",
                )
            p1 = subprocess.run(
                [resolved_bin, *install_argv[1:]],
                cwd=str(project_dir),
                env=install_env,
                capture_output=True,
                text=True,
                timeout=max(60, timeout_seconds // 2),
            )
            p2_stdout = ""
            p2_stderr = ""
            p2_rc = 0
            if build_argv and resolved_build_bin:
                p2 = subprocess.run(
                    [resolved_build_bin, *build_argv[1:]],
                    cwd=str(project_dir),
                    env=build_env,
                    capture_output=True,
                    text=True,
                    timeout=max(60, timeout_seconds // 2),
                )
                p2_stdout = p2.stdout
                p2_stderr = p2.stderr
                p2_rc = p2.returncode
            build_output = p1.stdout + p1.stderr + "\n" + p2_stdout + p2_stderr
            build_succeeded = p1.returncode == 0 and p2_rc == 0
        except Exception as exc:
            build_output = f"Lokaler Build-Fehler: {exc}"
            build_succeeded = False

    resolved_output = detect_output_dir(project_dir, output_dir)

    if resolved_output is None and output_dir is None:
        has_vite = any(
            (project_dir / marker).exists()
            for marker in ("vite.config.ts", "vite.config.js", "vite.config.mjs")
        )
        if has_vite:
            if log_callback:
                log_callback("index.html fehlt nach Build; fuehre Vite-Fallback aus...")
            if docker_avail:
                fallback_res = docker_service.run_ephemeral(
                    image=image,
                    command=[
                        "sh",
                        "-c",
                        "npx --no-install vite build || npx vite build || ./node_modules/.bin/vite build",
                    ],
                    workdir="/app",
                    volumes=[
                        VolumeBind(
                            host_path=str(project_dir.resolve()),
                            container_path="/app",
                            read_only=False,
                        )
                    ],
                    env=sandbox_env,
                    read_only_rootfs=True,
                    tmpfs_paths=["/tmp"],
                    network="none",
                    timeout=min(300, timeout_seconds),
                    node=node,
                    log_callback=log_callback,
                )
                build_output += (
                    "\n"
                    + (fallback_res.get("stdout") or "")
                    + "\n"
                    + (fallback_res.get("stderr") or "")
                )
            elif allow_host_fallback:
                npx_bin = shutil.which("npx.cmd") or shutil.which("npx")
                if npx_bin:
                    merged_env = dict(os.environ)
                    if env_vars:
                        merged_env.update(env_vars)
                    try:
                        pf = subprocess.run(
                            [npx_bin, "vite", "build"],
                            cwd=str(project_dir),
                            env=merged_env,
                            capture_output=True,
                            text=True,
                            timeout=min(300, timeout_seconds),
                        )
                        build_output += "\n" + pf.stdout + pf.stderr
                    except Exception as fallback_exc:
                        build_output += f"\nVite-Fallback-Fehler: {fallback_exc}"
            resolved_output = detect_output_dir(project_dir, output_dir)

    ok = resolved_output is not None and (build_succeeded or resolved_output.exists())
    return FrontendBuildResult(ok=ok, output_dir=resolved_output, log_output=build_output)
