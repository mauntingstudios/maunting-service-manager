"""Gemeinsamer Node-Build-Runner fuer Frontend-Projekte (Singra & Frontend-Server)."""

from __future__ import annotations

import os
import shlex
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from services import docker_service
from services.docker_service import VolumeBind

_LOCKFILE_INSTALL: tuple[tuple[str, list[str]], ...] = (
    ("pnpm-lock.yaml", ["corepack", "enable", "&&", "pnpm", "install", "--frozen-lockfile"]),
    ("yarn.lock", ["corepack", "enable", "&&", "yarn", "install", "--frozen-lockfile"]),
    ("package-lock.json", ["npm", "ci"]),
)

_DEFAULT_OUTPUT_DIRS = ("dist", "build", "out")


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
        return ["npm", "ci"]
    return ["npm", "install"]


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
    node=None,
    log_callback: Callable[[str], None] | None = None,
) -> FrontendBuildResult:
    """Baut ein Frontend-Projekt in einem Wegwerf-Node-Container (mit lokalem Fallback)."""
    install_argv = install_command or detect_install_command(project_dir)
    build_argv = build_command or ["npm", "run", "build"]
    image = f"node:{node_version}-bookworm-slim"

    docker_avail = docker_service.is_docker_available(node=node)
    build_output = ""
    build_succeeded = False

    if docker_avail:
        install_str = _join_shell_cmd(install_argv)
        if install_argv[0] in ("pnpm", "yarn"):
            install_str = f"corepack enable && {install_str}"
        build_str = _join_shell_cmd(build_argv)
        volumes = [
            VolumeBind(
                host_path=str(project_dir.resolve()),
                container_path="/app",
                read_only=False,
            )
        ]
        res = docker_service.run_ephemeral(
            image=image,
            command=["sh", "-c", f"{install_str} && {build_str}"],
            workdir="/app",
            volumes=volumes,
            env=env_vars or None,
            timeout=timeout_seconds,
            node=node,
            log_callback=log_callback,
        )
        build_succeeded = bool(res.get("ok"))
        build_output = (res.get("stdout") or "") + "\n" + (res.get("stderr") or "")
    else:
        if log_callback:
            log_callback("Docker nicht verfuegbar; verwende lokalen Node-Prozess fuer Build...")
        merged_env = dict(os.environ)
        if env_vars:
            merged_env.update(env_vars)
        try:
            bin_name = install_argv[0]
            resolved_bin = shutil.which(f"{bin_name}.cmd") or shutil.which(bin_name)
            build_bin = build_argv[0]
            resolved_build_bin = shutil.which(f"{build_bin}.cmd") or shutil.which(build_bin)
            if not resolved_bin or not resolved_build_bin:
                return FrontendBuildResult(
                    ok=False,
                    output_dir=None,
                    log_output=f"Kein {bin_name}/{build_bin} auf dem Host gefunden.",
                )
            p1 = subprocess.run(
                [resolved_bin, *install_argv[1:]],
                cwd=str(project_dir),
                env=merged_env,
                capture_output=True,
                text=True,
                timeout=max(60, timeout_seconds // 2),
            )
            p2 = subprocess.run(
                [resolved_build_bin, *build_argv[1:]],
                cwd=str(project_dir),
                env=merged_env,
                capture_output=True,
                text=True,
                timeout=max(60, timeout_seconds // 2),
            )
            build_output = p1.stdout + p1.stderr + "\n" + p2.stdout + p2.stderr
            build_succeeded = p1.returncode == 0 and p2.returncode == 0
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
                    env=env_vars or None,
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
            else:
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
