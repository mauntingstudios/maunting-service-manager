"""Strict OCI seccomp profiles for MSM workload containers.

Reuses the canonical profile generator in ``msm-agent/security/seccomp.py``
when present in the monorepo, with a self-contained fallback profile for
standalone backend deployments so ``seccomp=unconfined`` is never emitted.
"""

from __future__ import annotations

from functools import lru_cache
import importlib.util
import json
import os
from pathlib import Path
from typing import Any


def _load_agent_seccomp():
    candidate = Path(__file__).resolve().parents[2] / "msm-agent" / "security" / "seccomp.py"
    if not candidate.is_file():
        return None
    spec = importlib.util.spec_from_file_location("_msm_agent_seccomp", candidate)
    if spec is None or spec.loader is None:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_AGENT_SECCOMP = _load_agent_seccomp()

if _AGENT_SECCOMP is not None:
    EXPLICITLY_DENIED_SYSCALLS: tuple[str, ...] = _AGENT_SECCOMP.EXPLICITLY_DENIED_SYSCALLS
    seccomp_profile_dict = _AGENT_SECCOMP.seccomp_profile_dict
    seccomp_profile_json = _AGENT_SECCOMP.seccomp_profile_json
    apparmor_profile_active = _AGENT_SECCOMP.apparmor_profile_active
    container_security_options = _AGENT_SECCOMP.container_security_options
else:  # pragma: no cover - standalone container deployments without sibling msm-agent
    EXPLICITLY_DENIED_SYSCALLS = (
        "acct",
        "add_key",
        "adjtimex",
        "bpf",
        "clock_adjtime",
        "clock_settime",
        "delete_module",
        "finit_module",
        "init_module",
        "io_uring_enter",
        "io_uring_register",
        "io_uring_setup",
        "kexec_file_load",
        "kexec_load",
        "keyctl",
        "lookup_dcookie",
        "mount",
        "move_mount",
        "name_to_handle_at",
        "nfsservctl",
        "open_by_handle_at",
        "open_tree",
        "perf_event_open",
        "pivot_root",
        "process_vm_readv",
        "process_vm_writev",
        "ptrace",
        "quotactl",
        "quotactl_fd",
        "reboot",
        "request_key",
        "settimeofday",
        "stime",
        "swapoff",
        "swapon",
        "syslog",
        "umount",
        "umount2",
        "userfaultfd",
    )

    def seccomp_profile_dict(*, allow_userns: bool = False) -> dict[str, Any]:
        syscalls: list[dict[str, Any]] = [
            {"names": list(EXPLICITLY_DENIED_SYSCALLS), "action": "SCMP_ACT_ERRNO", "errnoRet": 1},
        ]
        if allow_userns:
            syscalls.append(
                {"names": ["clone", "clone3", "setns", "unshare"], "action": "SCMP_ACT_ALLOW"}
            )
        return {
            "defaultAction": "SCMP_ACT_ERRNO",
            "defaultErrnoRet": 1,
            "architectures": ["SCMP_ARCH_X86_64", "SCMP_ARCH_AARCH64"],
            "syscalls": syscalls,
        }

    @lru_cache(maxsize=2)
    def seccomp_profile_json(*, allow_userns: bool = False) -> str:
        return json.dumps(
            seccomp_profile_dict(allow_userns=allow_userns),
            separators=(",", ":"),
            ensure_ascii=True,
        )

    def apparmor_profile_active(profile_name: str = "msm-container-default") -> bool:
        if os.name != "posix":
            return False
        profiles_path = Path("/sys/kernel/security/apparmor/profiles")
        if not profiles_path.is_file():
            return False
        try:
            content = profiles_path.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            return False
        return any(line.split(" (", 1)[0].strip() == profile_name for line in content.splitlines())

    def container_security_options(
        *,
        allow_unprivileged_user_namespaces: bool = False,
        apparmor_profile: str = "msm-container-default",
    ) -> list[str]:
        options = [
            "no-new-privileges",
            f"seccomp={seccomp_profile_json(allow_userns=bool(allow_unprivileged_user_namespaces))}",
        ]
        if apparmor_profile and apparmor_profile_active(apparmor_profile):
            options.append(f"apparmor={apparmor_profile}")
        return options
