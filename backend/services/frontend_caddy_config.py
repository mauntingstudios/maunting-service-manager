"""Caddyfile-Generator und Branch-Slug-Helfer fuer isolierte Frontend-Container."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_RESERVED_SLUGS = frozenset({"current", "previews", "deployments", "assets", "api"})


@dataclass(frozen=True)
class PreviewRoute:
    """Einzelner Preview-VHost-Block innerhalb eines Frontend-Caddy-Containers."""

    branch_slug: str
    port: int
    root_dir: str
    forward_auth_url: str | None = None


def slugify_branch(branch: str, *, max_length: int = 48, with_hash: bool = False) -> str:
    """Erzeugt einen URL- und pfadsicheren Slug aus einem Git-Branch-Namen.

    ``feature/Login_v2`` -> ``feature-login-v2``. Optional mit kurzem
    SHA-256-Suffix zur Kollisionsaufloesung.
    """
    raw = (branch or "").strip()
    cleaned = _NON_ALNUM_RE.sub("-", raw.lower()).strip("-")
    if not cleaned or cleaned in _RESERVED_SLUGS:
        cleaned = f"branch-{cleaned}" if cleaned else "branch"

    if with_hash:
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:6]
        head_len = max(8, max_length - len(digest) - 1)
        head = cleaned[:head_len].rstrip("-") or "branch"
        return f"{head}-{digest}"

    if len(cleaned) > max_length:
        digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()[:6]
        head = cleaned[: max(8, max_length - len(digest) - 1)].rstrip("-")
        return f"{head}-{digest}"

    return cleaned


def _render_site_block(
    *,
    port: int,
    root_dir: str,
    spa_fallback: bool,
    noindex: bool = False,
    forward_auth_url: str | None = None,
    server_id: int | None = None,
    comment: str | None = None,
) -> str:
    lines: list[str] = []
    if comment:
        lines.append(f"# {comment}")
    lines.append(f":{int(port)} {{")
    lines.append(f"    root * {root_dir}")
    lines.append("    encode gzip")
    if noindex:
        lines.append('    header X-Robots-Tag "noindex, nofollow"')

    if forward_auth_url:
        auth_uri = (
            f"/api/frontend-previews/authorize?server_id={int(server_id)}"
            if server_id is not None
            else "/api/frontend-previews/authorize"
        )
        lines.extend([
            f"    forward_auth {forward_auth_url} {{",
            f"        uri {auth_uri}",
            "        copy_headers X-MSM-Preview-User",
            "    }",
        ])

    lines.extend([
        "    handle /assets/* {",
        "        @exists file",
        '        header @exists Cache-Control "public, max-age=31536000, immutable"',
        "        file_server",
        "    }",
        "    handle {",
    ])
    if spa_fallback:
        lines.append("        try_files {path} /index.html")
    lines.extend([
        "        file_server",
        "    }",
        "}",
    ])
    return "\n".join(lines)


def generate_container_caddyfile(
    *,
    port: int,
    root_dir: str = "/data",
    spa_fallback: bool = True,
    previews: tuple[PreviewRoute, ...] | list[PreviewRoute] = (),
    server_id: int | None = None,
) -> str:
    """Erzeugt die vollstaendige Caddyfile fuer einen isolierten Frontend-Container."""
    header = f"# Managed by MSM: Frontend #{server_id}" if server_id is not None else "# Managed by MSM: Frontend"
    blocks = [
        header,
        _render_site_block(
            port=port,
            root_dir=root_dir,
            spa_fallback=spa_fallback,
            noindex=False,
            comment="Produktion",
        ),
    ]
    for preview in previews:
        blocks.append(
            _render_site_block(
                port=preview.port,
                root_dir=preview.root_dir,
                spa_fallback=spa_fallback,
                noindex=True,
                forward_auth_url=preview.forward_auth_url,
                comment=f"Preview: {preview.branch_slug}",
            )
        )
    return "\n\n".join(blocks) + "\n"
