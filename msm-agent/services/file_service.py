"""Filesystem operations with strict path-traversal protection.

All paths are resolved with realpath/resolve and must stay inside
``MSM_SERVERS_DIR / server_id``. Symlink escapes and ``..`` segments are rejected.
"""

from __future__ import annotations

import errno
import glob
import hashlib
import json
import logging
import os
import re
import shutil
import stat as stat_module
import subprocess
import tarfile

try:
    import grp
    import pwd
except ImportError:  # pragma: no cover - Windows dev hosts
    grp = None  # type: ignore[assignment]
    pwd = None  # type: ignore[assignment]
import tempfile
import threading
import uuid
import zipfile
from pathlib import Path
from typing import Any

from config import settings

logger = logging.getLogger(__name__)

MAX_CHUNK_SIZE = 64 * 1024 * 1024
MAX_CHUNKED_UPLOAD_SIZE = 10 * 1024 * 1024 * 1024


class PathEscapeError(Exception):
    """Raised when a path would leave the allowed server root."""

    def __init__(self, message: str = "Path outside allowed server directory") -> None:
        super().__init__(message)
        self.message = message


class PathValidationError(Exception):
    """Raised for malformed relative paths (absolute, empty server_id, etc.)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class RevisionConflictError(Exception):
    """Raised when a caller tries to replace a file based on a stale revision."""

    def __init__(self, current_revision: str | None) -> None:
        super().__init__("File changed since it was opened")
        self.current_revision = current_revision


_write_locks_guard = threading.Lock()
_write_locks: dict[str, threading.Lock] = {}


def _write_lock(target: Path) -> threading.Lock:
    key = str(target)
    with _write_locks_guard:
        return _write_locks.setdefault(key, threading.Lock())


def assert_no_symlink_path(target: Path, root: Path) -> None:
    """Reject symlinks anywhere between ``root`` and ``target`` (inclusive)."""
    if root.is_symlink():
        raise PathEscapeError("Server root cannot be a symlink")
    try:
        rel_parts = target.relative_to(root).parts
    except ValueError as exc:
        raise PathEscapeError() from exc
    current = root
    for part in rel_parts:
        current = current / part
        if current.is_symlink():
            raise PathEscapeError("Symlinks are not allowed")


def open_regular_file_nofollow(server_id: str | int, rel_path: str) -> tuple[Any, os.stat_result, Path]:
    """Open a regular file inside ``server_root`` using ``O_NOFOLLOW`` against symlink TOCTOU."""
    root = server_root(server_id)
    rel = (rel_path or "").strip().replace("\\", "/")
    if rel.startswith("/"):
        raise PathValidationError("Absolute paths are not allowed")
    parts = Path(rel).parts if rel else ()
    if not parts or any(p == ".." for p in parts):
        raise PathValidationError("Invalid file path")
    raw_target = root / rel
    assert_no_symlink_path(raw_target, root)
    target = safe_path(server_id, rel_path)
    assert_no_symlink_path(target, root)

    flags = (
        os.O_RDONLY
        | getattr(os, "O_NOFOLLOW", 0)
        | getattr(os, "O_NONBLOCK", 0)
        | getattr(os, "O_BINARY", 0)
    )
    try:
        fd = os.open(str(target), flags)
    except OSError as exc:
        if exc.errno == errno.ELOOP:
            raise PathEscapeError("Symlinks are not allowed") from exc
        if exc.errno == errno.ENOENT:
            raise FileNotFoundError("File not found") from exc
        if exc.errno == errno.EISDIR:
            raise IsADirectoryError("Path is a directory") from exc
        raise
    try:
        st = os.fstat(fd)
        if not stat_module.S_ISREG(st.st_mode):
            raise FileNotFoundError("Not a regular file")
        return os.fdopen(fd, "rb"), st, target
    except Exception:
        try:
            os.close(fd)
        except OSError:
            pass
        raise


def _content_revision(data: bytes) -> str:
    """Opaque, content-bound revision used for optimistic write protection."""
    return f"sha256:{hashlib.sha256(data).hexdigest()}"


def _identity_name(value: int, *, group: bool) -> str | None:
    """Resolve POSIX uid/gid where supported without exposing host paths."""
    try:
        if os.name != "posix":
            return None
        if group:
            import grp

            return grp.getgrgid(value).gr_name
        import pwd

        return pwd.getpwuid(value).pw_name
    except (KeyError, ImportError, OSError):
        return None


def file_metadata(target: Path) -> dict[str, Any]:
    info = target.stat(follow_symlinks=False)
    return {
        "size": info.st_size if target.is_file() else 0,
        "modified": info.st_mtime,
        "mode": format(stat_module.S_IMODE(info.st_mode), "04o"),
        "owner": _identity_name(info.st_uid, group=False),
        "group": _identity_name(info.st_gid, group=True),
    }


def server_root(server_id: str | int) -> Path:
    """Return the absolute root directory for a server_id under MSM_SERVERS_DIR."""
    sid = str(server_id).strip()
    if not sid or sid in {".", ".."} or "/" in sid or "\\" in sid or ".." in sid:
        raise PathValidationError("Invalid server_id")
    base = settings.servers_path()
    root = (base / sid).resolve(strict=False)
    try:
        root.relative_to(base)
    except ValueError as exc:
        raise PathEscapeError("server_id escapes servers directory") from exc
    return root


def safe_path(server_id: str | int, rel_path: str) -> Path:
    """Resolve ``rel_path`` strictly inside the server root.

    - Rejects absolute paths.
    - Rejects ``..`` segments before resolve (defense in depth).
    - After resolve (symlinks expanded), requires path under server root.
    """
    if rel_path is None:
        rel_path = ""
    # Normalize empty / "." to server root
    rel = rel_path.strip().replace("\\", "/")
    if rel.startswith("/"):
        raise PathValidationError("Absolute paths are not allowed")
    parts = Path(rel).parts if rel else ()
    if any(p == ".." for p in parts):
        raise PathValidationError("Path traversal (..) is not allowed")

    root = server_root(server_id)
    candidate = (root / rel).resolve(strict=False) if rel else root
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise PathEscapeError() from exc
    return candidate


def disk_info(server_id: str | int) -> dict[str, int]:
    """Return used bytes for this server and free bytes on its node filesystem."""
    root = server_root(server_id)
    usage_target = root if root.exists() else root.parent
    free_bytes = shutil.disk_usage(usage_target).free
    used_bytes = 0
    if root.exists():
        for current_root, dir_names, file_names in os.walk(root, followlinks=False):
            current = Path(current_root)
            dir_names[:] = [name for name in dir_names if not (current / name).is_symlink()]
            for name in file_names:
                path = current / name
                try:
                    if not path.is_symlink():
                        used_bytes += path.stat().st_size
                except OSError:
                    continue
    return {"used_bytes": used_bytes, "free_bytes": free_bytes}


def list_dir(server_id: str | int, rel_path: str = "") -> list[dict[str, Any]]:
    target = safe_path(server_id, rel_path)
    if not target.exists():
        raise FileNotFoundError("Path not found")
    if not target.is_dir():
        raise NotADirectoryError("Not a directory")

    entries: list[dict[str, Any]] = []
    for entry in sorted(target.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower())):
        try:
            # Re-check each entry stays inside root (symlink defense)
            entry_resolved = entry.resolve(strict=False)
            entry_resolved.relative_to(server_root(server_id))
        except (ValueError, OSError):
            continue
        try:
            metadata = file_metadata(entry)
        except OSError:
            metadata = {
                "size": 0,
                "modified": 0,
                "mode": None,
                "owner": None,
                "group": None,
            }
        entries.append(
            {
                "name": entry.name,
                "path": str(entry.relative_to(server_root(server_id))).replace("\\", "/"),
                "is_dir": entry.is_dir(),
                **metadata,
                # Backwards-compatible agent contract for older panels.
                "mtime": metadata["modified"],
            }
        )
    return entries


def read_text(server_id: str | int, rel_path: str) -> str:
    return read_text_with_metadata(server_id, rel_path)["content"]


def read_text_with_metadata(server_id: str | int, rel_path: str) -> dict[str, Any]:
    handle, st, target = open_regular_file_nofollow(server_id, rel_path)
    with handle:
        if st.st_size > settings.max_read_size:
            raise ValueError(f"File exceeds max read size ({settings.max_read_size} bytes)")
        chunks: list[bytes] = []
        total = 0
        while chunk := handle.read(65536):
            total += len(chunk)
            if total > settings.max_read_size:
                raise ValueError(f"File exceeds max read size ({settings.max_read_size} bytes)")
            chunks.append(chunk)
    data = b"".join(chunks)
    return {
        "content": data.decode("utf-8", errors="replace"),
        "revision": _content_revision(data),
        **file_metadata(target),
    }


def write_text(server_id: str | int, rel_path: str, content: str) -> None:
    write_text_if_revision(server_id, rel_path, content)


def write_text_if_revision(
    server_id: str | int,
    rel_path: str,
    content: str,
    expected_revision: str | None = None,
    create_only: bool = False,
) -> dict[str, Any]:
    root = server_root(server_id)
    rel = (rel_path or "").strip().replace("\\", "/")
    if not rel:
        raise PathValidationError("Invalid file path")
    assert_no_symlink_path(root / rel, root)
    target = safe_path(server_id, rel_path)
    assert_no_symlink_path(target, root)
    parent = target.parent
    # Parent must stay inside server root (mkdir does not re-validate)
    try:
        parent.resolve(strict=False).relative_to(root)
    except ValueError as exc:
        raise PathEscapeError() from exc
    parent.mkdir(parents=True, exist_ok=True)
    assert_no_symlink_path(parent, root)
    encoded = content.encode("utf-8")
    with _write_lock(target):
        if target.is_symlink():
            raise PathEscapeError("Symlinks are not allowed")
        if create_only and target.exists():
            raise FileExistsError("Target file already exists")
        current_revision: str | None = None
        if target.exists():
            read_handle, _, _ = open_regular_file_nofollow(server_id, rel_path)
            with read_handle:
                current_revision = _content_revision(read_handle.read())
        if expected_revision is not None and current_revision != expected_revision:
            raise RevisionConflictError(current_revision)

        # Bestandsdateien behalten ihren Modus. Neue Dateien bekommen 0660 —
        # das Gruppenmodell des Panels: Panel und Spielprozess teilen sich die
        # Dateien ueber die Gruppe des Serververzeichnisses (setgid vererbt
        # sie), "andere" bleiben aussen vor. Hier stand 0644: die Gruppe
        # durfte nicht schreiben (der Spielprozess konnte eine vom Panel
        # angelegte Konfiguration nicht aendern), dafuer durfte jeder
        # Host-Prozess mitlesen.
        previous_mode = (
            stat_module.S_IMODE(target.stat(follow_symlinks=False).st_mode)
            if target.exists()
            else 0o660
        ) & 0o777
        temp_path: Path | None = None
        try:
            with tempfile.NamedTemporaryFile(
                mode="wb",
                delete=False,
                dir=parent,
                prefix=".msm-edit-",
            ) as temp_file:
                if hasattr(os, "fchmod"):
                    os.fchmod(temp_file.fileno(), 0o600)
                temp_file.write(encoded)
                temp_file.flush()
                os.fsync(temp_file.fileno())
                temp_path = Path(temp_file.name)
            assert_no_symlink_path(target, root)
            os.replace(temp_path, target)
            temp_path = None
            os.chmod(target, previous_mode)
        finally:
            if temp_path is not None:
                temp_path.unlink(missing_ok=True)

    return {
        "revision": _content_revision(encoded),
        **file_metadata(target),
    }


def _safe_workshop_pattern(value: str, *, allow_glob: bool) -> str:
    rel = str(value or "").strip().replace("\\", "/")
    if not rel or rel.startswith("/") or "\x00" in rel:
        raise PathValidationError("Unsafe workshop path")
    if any(part == ".." for part in Path(rel).parts):
        raise PathValidationError("Workshop path traversal is not allowed")
    if not allow_glob and any(char in rel for char in ("*", "?", "[")):
        raise PathValidationError("Workshop target glob is not allowed")
    return rel


def _workshop_sources(root: Path, source_pattern: str) -> list[Path]:
    pattern = _safe_workshop_pattern(source_pattern, allow_glob=True)
    matches = glob.glob(str(root / pattern), recursive=True)
    sources: list[Path] = []
    for raw in matches:
        source = Path(raw).resolve(strict=False)
        try:
            source.relative_to(root)
        except ValueError as exc:
            raise PathEscapeError("Workshop source escapes server directory") from exc
        if source.exists():
            sources.append(source)
    return sources


def _workshop_target(root: Path, target_pattern: str, basename: str) -> Path:
    rendered = _safe_workshop_pattern(
        target_pattern.replace("{BASENAME}", basename),
        allow_glob=False,
    )
    target = root / rendered
    try:
        target.parent.resolve(strict=False).relative_to(root)
    except ValueError as exc:
        raise PathEscapeError("Workshop target escapes server directory") from exc
    return target


def _workshop_target_ready(root: Path, target: Path) -> bool:
    if not target.exists():
        return False
    if not target.is_symlink():
        return True
    try:
        target.resolve(strict=True).relative_to(root)
    except (FileNotFoundError, ValueError):
        return False
    return True


_WORKSHOP_ITEM_SECTIONS = frozenset({"WorkshopItemsInstalled", "WorkshopItemDetails"})


def _scan_vdf_line(line: str) -> tuple[list[str], int, int]:
    """Extract quoted VDF tokens and brace counts outside quotes."""
    tokens: list[str] = []
    open_braces = 0
    close_braces = 0
    in_quotes = False
    escaped = False
    token_chars: list[str] = []

    for ch in line:
        if escaped:
            if in_quotes:
                token_chars.append(ch)
            escaped = False
            continue
        if ch == "\\" and in_quotes:
            escaped = True
            token_chars.append(ch)
            continue
        if ch == '"':
            if in_quotes:
                tokens.append("".join(token_chars))
                token_chars.clear()
                in_quotes = False
            else:
                in_quotes = True
            continue
        if in_quotes:
            token_chars.append(ch)
        elif ch == "{":
            open_braces += 1
        elif ch == "}":
            close_braces += 1
    return tokens, open_braces, close_braces


def prune_appworkshop_acf(
    acf_path: Path,
    content_app_dir: Path | None,
    remove_ids: set[str] | None = None,
) -> bool:
    """Prune missing or removed Workshop IDs and dirty flags from ``appworkshop_<appid>.acf``.

    Returns True if the manifest was modified or removed.
    """
    if acf_path.is_symlink():
        acf_path.unlink(missing_ok=True)
        return True
    if not acf_path.is_file():
        return False

    try:
        original = acf_path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return False

    remove_set = {str(w).strip() for w in (remove_ids or set()) if str(w).strip()}
    valid_cache: dict[str, bool] = {}

    def _keep_item(wid: str) -> bool:
        if wid in remove_set or content_app_dir is None:
            return False
        cached = valid_cache.get(wid)
        if cached is not None:
            return cached
        item_dir = content_app_dir / wid
        try:
            ok = (
                not item_dir.is_symlink()
                and item_dir.is_dir()
                and any(True for _ in item_dir.iterdir())
            )
        except OSError:
            ok = False
        valid_cache[wid] = ok
        return ok

    output_lines: list[str] = []
    stack: list[str] = []
    pending_key: str | None = None
    pending_line: str | None = None
    skip_depth: int | None = None
    kept_installed = 0
    changed = False
    unbalanced = False

    def _flush_pending() -> None:
        nonlocal pending_key, pending_line
        if pending_line is not None:
            output_lines.append(pending_line)
            pending_line = None
        pending_key = None

    for line in original.splitlines(keepends=True):
        tokens, opens, closes = _scan_vdf_line(line)

        if skip_depth is not None:
            for _ in range(opens):
                stack.append("_skip")
            for _ in range(closes):
                if not stack:
                    unbalanced = True
                    break
                stack.pop()
                if len(stack) == skip_depth:
                    skip_depth = None
            changed = True
            if unbalanced:
                break
            continue

        if pending_line is not None and opens > 0 and not tokens:
            if (
                len(stack) == 2
                and stack[0] == "AppWorkshop"
                and stack[1] in _WORKSHOP_ITEM_SECTIONS
                and pending_key is not None
                and not _keep_item(pending_key)
            ):
                skip_depth = len(stack)
                stack.append(pending_key)
                pending_key = None
                pending_line = None
                changed = True
                for _ in range(opens - 1):
                    stack.append("_sub")
                for _ in range(closes):
                    if not stack:
                        unbalanced = True
                        break
                    stack.pop()
                    if skip_depth is not None and len(stack) == skip_depth:
                        skip_depth = None
                if unbalanced:
                    break
                continue
            if (
                len(stack) == 2
                and stack[0] == "AppWorkshop"
                and stack[1] == "WorkshopItemsInstalled"
            ):
                kept_installed += 1
            output_lines.append(pending_line)
            pending_line = None
            section = pending_key or "_anon"
            pending_key = None
            stack.append(section)
            for _ in range(opens - 1):
                stack.append("_sub")
            for _ in range(closes):
                if not stack:
                    unbalanced = True
                    break
                stack.pop()
            output_lines.append(line)
            if unbalanced:
                break
            continue

        if pending_line is not None and not line.strip():
            pending_line += line
            continue

        if pending_line is not None:
            _flush_pending()

        if (
            len(tokens) == 1
            and opens == 1
            and closes == 0
            and len(stack) == 2
            and stack[0] == "AppWorkshop"
            and stack[1] in _WORKSHOP_ITEM_SECTIONS
            and not _keep_item(tokens[0])
        ):
            skip_depth = len(stack)
            stack.append(tokens[0])
            changed = True
            continue

        if len(tokens) == 1 and opens == 0 and closes == 0:
            pending_key = tokens[0]
            pending_line = line
            continue

        if (
            len(stack) == 1
            and stack[0] == "AppWorkshop"
            and len(tokens) == 2
            and opens == 0
            and closes == 0
            and tokens[0] in {"NeedsUpdate", "NeedsDownload"}
        ):
            if tokens[1] != "0":
                indent = line[: len(line) - len(line.lstrip(" \t"))]
                newline = "\r\n" if line.endswith("\r\n") else ("\n" if line.endswith("\n") else "")
                line = f'{indent}"{tokens[0]}"\t\t"0"{newline}'
                changed = True
            output_lines.append(line)
            continue

        if (
            len(stack) == 3
            and stack[0] == "AppWorkshop"
            and stack[1] == "WorkshopItemDetails"
            and len(tokens) == 2
            and opens == 0
            and closes == 0
            and tokens[0] in {"BytesDownloaded", "BytesToDownload"}
        ):
            changed = True
            continue

        if (
            len(tokens) == 1
            and opens == 1
            and len(stack) == 2
            and stack[0] == "AppWorkshop"
            and stack[1] == "WorkshopItemsInstalled"
            and closes == 0
        ):
            kept_installed += 1

        for i in range(opens):
            stack.append(tokens[0] if i == 0 and tokens else "_sub")
        for _ in range(closes):
            if not stack:
                unbalanced = True
                break
            stack.pop()
        if unbalanced:
            break
        output_lines.append(line)

    _flush_pending()

    if unbalanced or stack or skip_depth is not None or kept_installed == 0:
        acf_path.unlink(missing_ok=True)
        return True

    new_text = "".join(output_lines)
    if not changed and new_text == original:
        return False

    tmp_fd, tmp_name = tempfile.mkstemp(prefix=".acf_prune_", dir=str(acf_path.parent))
    try:
        with os.fdopen(tmp_fd, "w", encoding="utf-8", newline="") as fh:
            fh.write(new_text)
        os.replace(tmp_name, acf_path)
    except Exception:
        Path(tmp_name).unlink(missing_ok=True)
        raise
    return True


def _remove_path_if_present(target: Path) -> None:
    if target.is_symlink() or target.is_file():
        target.unlink(missing_ok=True)
    elif target.is_dir():
        shutil.rmtree(target, ignore_errors=True)


def _safe_existing_subdir(root: Path, *parts: str) -> Path | None:
    cur = root
    for part in parts:
        cur = cur / part
        if cur.is_symlink():
            return None
        if not cur.exists():
            return None
    return cur if cur.is_dir() else None


def _clean_workshop_temp_files(root: Path, workshop_app_id: str | None = None) -> None:
    """Remove leftover SteamCMD temp directories and ``.temp_write_*`` probe files."""
    temp_dir = _safe_existing_subdir(root, "steamapps", "workshop", "temp")
    if temp_dir is not None:
        for entry in list(temp_dir.iterdir()):
            _remove_path_if_present(entry)

    probe_dirs: list[Path] = []
    steam_dir = _safe_existing_subdir(root, "Steam")
    if steam_dir is not None:
        probe_dirs.append(steam_dir)
    downloads_root = _safe_existing_subdir(root, "steamapps", "workshop", "downloads")
    if downloads_root is not None:
        probe_dirs.append(downloads_root)
        if workshop_app_id:
            app_dl = _safe_existing_subdir(root, "steamapps", "workshop", "downloads", str(workshop_app_id))
            if app_dl is not None:
                probe_dirs.append(app_dl)
        else:
            for app_dir in list(downloads_root.iterdir()):
                if not app_dir.is_symlink() and app_dir.is_dir():
                    probe_dirs.append(app_dir)

    for probe_dir in probe_dirs:
        for probe in list(probe_dir.glob(".temp_write_*")):
            _remove_path_if_present(probe)


def workshop_files(
    server_id: str | int,
    *,
    workshop_app_id: str,
    workshop_id: str,
    actions: list[dict[str, Any]],
    mode: str,
    resolvers: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Apply, inspect, or remove blueprint Workshop runtime artifacts on-node."""
    if mode not in {"apply", "inspect", "cleanup", "resolve_ids"}:
        raise PathValidationError("Invalid workshop operation")
    if not str(workshop_app_id).isdigit() or not str(workshop_id).isdigit():
        raise PathValidationError("Invalid workshop identifier")

    root = server_root(server_id)
    root.mkdir(parents=True, exist_ok=True)

    if mode == "resolve_ids":
        resolved_map: dict[str, list[str]] = {}
        error_map: dict[str, str] = {}
        safe_re = re.compile(r"^[^\x00-\x1f\x7f;]{1,64}\Z")
        for res in resolvers or []:
            name = str(res.get("name") or "")
            file_glob = str(res.get("file_glob") or "")
            format_val = str(res.get("format") or "iniKey")
            key_val = str(res.get("key") or "id").strip().lower()
            regex_val = res.get("regex")
            max_matches = int(res.get("max_matches") or 16)
            fallback = str(res.get("fallback") or "skip")

            rel_pattern = (
                file_glob
                .replace("{WORKSHOP_APP_ID}", str(workshop_app_id))
                .replace("{WORKSHOP_ID}", str(workshop_id))
            )
            matches = glob.glob(str(root / rel_pattern), recursive=True)
            found: list[str] = []
            valid_files: list[Path] = []
            for m in matches:
                p = Path(m).resolve()
                try:
                    p.relative_to(root)
                    if p.is_file():
                        valid_files.append(p)
                except ValueError:
                    continue
            valid_files.sort()
            for p in valid_files:
                try:
                    content = p.read_bytes()[:65536].decode("utf-8", errors="replace")
                except Exception:
                    continue
                if format_val == "iniKey":
                    for line in content.splitlines():
                        line = line.strip()
                        if not line or line.startswith(("#", ";")):
                            continue
                        if "=" in line:
                            k, v = line.split("=", 1)
                            if k.strip().lower() == key_val:
                                val = v.strip().strip("'\"")
                                if val and safe_re.match(val) and len(val) <= 64:
                                    found.append(val)
                elif format_val == "regex" and regex_val:
                    pat = re.compile(regex_val)
                    for match in pat.finditer(content):
                        val = match.group(1) if match.groups() else match.group(0)
                        val = val.strip().strip("'\"")
                        if val and safe_re.match(val) and len(val) <= 64:
                            found.append(val)
            dedup = list(dict.fromkeys(found))[:max_matches]
            if dedup:
                resolved_map[name] = dedup
            else:
                if fallback == "workshopId":
                    resolved_map[name] = [str(workshop_id)]
                else:
                    resolved_map[name] = []
                    error_map[name] = "mod_info_missing"
        return {
            "ok": True,
            "resolved": resolved_map,
            "resolve_errors": error_map,
        }

    targets: list[Path] = []

    for action in actions:
        operation = str(action.get("operation") or "")
        if operation not in {"copy", "symlink"}:
            raise PathValidationError("Invalid workshop file operation")
        source_pattern = str(action.get("source") or "")
        target_pattern = str(action.get("target") or "")
        _safe_workshop_pattern(source_pattern, allow_glob=True)
        _safe_workshop_pattern(
            target_pattern.replace("{BASENAME}", "synthetic-target"),
            allow_glob=False,
        )
        sources = _workshop_sources(root, source_pattern)
        if bool(action.get("required")) and not sources and mode != "cleanup":
            raise FileNotFoundError("Required workshop source not found")

        if mode == "cleanup" and "{BASENAME}" in target_pattern and not sources:
            cleanup_pattern = _safe_workshop_pattern(
                target_pattern.replace("{BASENAME}", "*"), allow_glob=True
            )
            for raw in glob.glob(str(root / cleanup_pattern)):
                candidate = Path(raw)
                try:
                    candidate.parent.resolve(strict=False).relative_to(root)
                except ValueError as exc:
                    raise PathEscapeError("Workshop cleanup target escapes server directory") from exc
                targets.append(candidate)
        else:
            basenames = [source.name for source in sources] if "{BASENAME}" in target_pattern else [""]
            targets.extend(_workshop_target(root, target_pattern, name) for name in basenames)

        if mode == "apply":
            purge_templates = [str(p) for p in action.get("purge_before") or []]
            for source in sources:
                stem = source.stem
                for tmpl in purge_templates:
                    rendered = tmpl.replace("{STEM}", stem).replace("{BASENAME}", source.name)
                    if any(ch in rendered for ch in ("*", "?", "[")):
                        for m in glob.glob(str(root / rendered)):
                            p = Path(m).resolve()
                            try:
                                p.relative_to(root)
                                if p.is_file():
                                    p.unlink(missing_ok=True)
                            except ValueError:
                                pass
                    else:
                        p = (root / rendered).resolve()
                        try:
                            p.relative_to(root)
                            if p.is_file():
                                p.unlink(missing_ok=True)
                        except ValueError:
                            pass

                target = _workshop_target(root, target_pattern, source.name)
                target.parent.mkdir(parents=True, exist_ok=True)
                if operation == "copy":
                    if not source.is_file():
                        raise PathValidationError("Workshop copy source is not a file")
                    if target.is_symlink() or target.is_file():
                        target.unlink()
                    elif target.exists():
                        raise PathValidationError("Workshop copy target is not a file")
                    shutil.copy2(source, target)
                else:
                    if target.is_symlink():
                        target.unlink()
                    elif target.exists():
                        raise FileExistsError("Workshop target already exists")
                    target.symlink_to(os.path.relpath(source, target.parent), target_is_directory=source.is_dir())

    unique_targets = list(dict.fromkeys(targets))
    if mode == "cleanup":
        for target in unique_targets:
            if target.is_symlink() or target.is_file():
                target.unlink(missing_ok=True)
            elif target.is_dir():
                shutil.rmtree(target)
        for rel in (
            f"steamapps/workshop/content/{workshop_app_id}/{workshop_id}",
            f"steamapps/workshop/downloads/{workshop_app_id}/{workshop_id}",
        ):
            cache = safe_path(server_id, rel)
            if cache.is_symlink() or cache.is_file():
                cache.unlink(missing_ok=True)
            elif cache.is_dir():
                shutil.rmtree(cache)
        _clean_workshop_temp_files(root, str(workshop_app_id))
        workshop_dir = _safe_existing_subdir(root, "steamapps", "workshop")
        if workshop_dir is not None:
            content_app_dir = _safe_existing_subdir(
                root, "steamapps", "workshop", "content", str(workshop_app_id)
            )
            prune_appworkshop_acf(
                workshop_dir / f"appworkshop_{workshop_app_id}.acf",
                content_app_dir,
                remove_ids={str(workshop_id)},
            )

    ready = all(_workshop_target_ready(root, target) for target in unique_targets)
    return {
        "ok": True,
        "ready": ready,
        "targets": [target.relative_to(root).as_posix() for target in unique_targets],
        "target_basenames": [target.name for target in unique_targets],
    }


def delete_path(
    server_id: str | int, rel_path: str, expected_revision: str | None = None
) -> None:
    """Löscht eine Datei oder einen Baum; mit Revision nur den erwarteten Inhalt.

    Das Panel liest eine Datei, legt daraus einen Versionsschnappschuss an und
    löscht sie erst danach. Zwischen Lesen und Löschen kann der Spielprozess
    sie neu geschrieben haben — dann zeigt der Rückweg auf den alten Inhalt
    und der neue ist ersatzlos weg. Nennt das Panel die Revision, die es
    gesichert hat, wird hier gegen den Inhalt auf der Platte geprüft und bei
    Abweichung `RevisionConflictError` geworfen; der Router bildet sie wie
    beim Schreiben auf 409 ab.

    Ohne Revision bleibt es beim bedingungslosen Löschen — das brauchen die
    Aufräumpfade (Manifeste, `.bak`-Reste), die gar keinen Inhalt gelesen
    haben.
    """
    if not rel_path or rel_path.strip() in {".", ""}:
        raise PathValidationError("Cannot delete server root")
    target = safe_path(server_id, rel_path)
    if not target.exists():
        raise FileNotFoundError("Path not found")
    # Dieselbe Sperre wie beim Schreiben: `write_text_if_revision` darf nicht
    # zwischen der Prüfung und dem Löschen dazwischenkommen.
    with _write_lock(target):
        if expected_revision is not None:
            current = _content_revision(target.read_bytes()) if target.is_file() else None
            if current != expected_revision:
                raise RevisionConflictError(current)
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()


def rename_path(server_id: str | int, old_path: str, new_path: str) -> None:
    src = safe_path(server_id, old_path)
    dst = safe_path(server_id, new_path)
    if not src.exists():
        raise FileNotFoundError("Source not found")
    if dst.exists():
        raise FileExistsError("Destination already exists")
    dst.parent.mkdir(parents=True, exist_ok=True)
    src.rename(dst)


def create_dir(server_id: str | int, rel_path: str) -> None:
    if not rel_path or rel_path.strip() in {".", ""}:
        raise PathValidationError("Invalid directory path")
    target = safe_path(server_id, rel_path)
    target.mkdir(parents=True, exist_ok=True)


def apply_shared_server_acl(root: Path) -> None:
    """Restore shared msm-agent / msm-docker ownership and default POSIX ACLs.

    When a backup restore replaces ``root`` with a fresh directory, the new inode
    loses inherited ``msm-docker`` ACLs. Containers running under rootless Docker
    would otherwise fail with EACCES. Best-effort when ``msm-docker`` or
    ``setfacl`` is absent (e.g. unit tests or Windows dev).
    """
    if not root.exists() or not root.is_dir():
        return
    docker_user = None
    agent_user = None
    servers_gr = None
    if pwd is not None:
        try:
            docker_user = pwd.getpwnam("msm-docker").pw_name
        except (KeyError, OSError):
            docker_user = None
        try:
            uid = os.getuid() if hasattr(os, "getuid") else 0
            agent_user = pwd.getpwuid(uid).pw_name
        except (KeyError, OSError):
            agent_user = None
    if grp is not None:
        try:
            servers_gr = grp.getgrnam("msm-servers")
        except (KeyError, OSError):
            servers_gr = None

    if servers_gr is not None:
        try:
            os.chown(root, -1, servers_gr.gr_gid)
        except OSError:
            pass
    if docker_user is not None or servers_gr is not None:
        try:
            root.chmod(0o2770)
        except OSError:
            pass

    if not docker_user or not agent_user or not shutil.which("setfacl"):
        return

    acl_spec = (
        f"u:{agent_user}:rwX,u:{docker_user}:rwX,"
        f"d:u:{agent_user}:rwX,d:u:{docker_user}:rwX,m::rwx"
    )
    pg_data_dir = root / ".msm" / "postgres-data"
    if pg_data_dir.exists():
        # PostgreSQL container data must keep its 0700 subUID/subGID permissions.
        subprocess.run(
            ["setfacl", "-m", acl_spec, str(root)],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
        for child in root.iterdir():
            if child.name == ".msm":
                subprocess.run(
                    ["setfacl", "-m", acl_spec, str(child)],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=30,
                )
                for sub in child.iterdir():
                    if sub.name != "postgres-data":
                        subprocess.run(
                            ["setfacl", "-R", "-m", acl_spec, str(sub)],
                            check=False,
                            capture_output=True,
                            text=True,
                            timeout=60,
                        )
            else:
                subprocess.run(
                    ["setfacl", "-R", "-m", acl_spec, str(child)],
                    check=False,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
    else:
        subprocess.run(
            ["setfacl", "-R", "-m", acl_spec, str(root)],
            check=False,
            capture_output=True,
            text=True,
            timeout=60,
        )


def ensure_server_root(server_id: str | int) -> None:
    """Create the server root itself; only the authenticated panel calls this."""
    root = server_root(server_id)
    root.mkdir(parents=True, exist_ok=False)
    apply_shared_server_acl(root)


def delete_server_root(server_id: str | int) -> None:
    """Remove one complete server root after the panel authorized server deletion."""
    sid = str(server_id).strip()
    if sid.isdigit() and int(sid) > 0:
        from services import quota_service

        try:
            quota_service.remove_quota(sid)
        except Exception as exc:
            logger.warning("Failed to remove disk quota for server %s: %s", sid, exc)
    root = server_root(server_id)
    if not root.exists():
        return
    if not root.is_dir():
        raise PathValidationError("Server root is not a directory")
    shutil.rmtree(root)


def _set_ini_value(target: Path, section: str, key: str, value: str) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    lines = target.read_text(encoding="utf-8", errors="replace").splitlines(keepends=True) if target.exists() else []
    section_header = f"[{section}]"
    in_section = found_section = wrote_key = False
    output: list[str] = []
    for line in lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            if in_section and not wrote_key:
                output.append(f"{key}={value}\n")
                wrote_key = True
            in_section = stripped == section_header
            found_section = found_section or in_section
            output.append(line)
        elif in_section and not wrote_key and stripped.startswith(f"{key}="):
            output.append(f"{key}={value}\n")
            wrote_key = True
        else:
            output.append(line)
    if in_section and not wrote_key:
        output.append(f"{key}={value}\n")
    if not found_section:
        if output and output[-1].strip():
            output.append("\n")
        output.extend([f"{section_header}\n", f"{key}={value}\n"])
    target.write_text("".join(output), encoding="utf-8")


def prepare_runtime(
    server_id: str | int,
    *,
    ensure_dirs: list[str],
    required_files: list[str],
    patches: list[dict[str, str | None]],
    executable_files: list[str] | None = None,
    seed_files: list[dict[str, str]] | None = None,
) -> None:
    """Apply declarative, blueprint-validated runtime file preparation on-node."""
    for rel_path in ensure_dirs:
        safe_path(server_id, rel_path).mkdir(parents=True, exist_ok=True)
    # Seed-once before patches so first-start defaults exist to patch.
    for seed in seed_files or []:
        rel_path = str(seed.get("file") or "")
        content = str(seed.get("content") or "")
        if not rel_path or not content:
            raise PathValidationError("Invalid runtime seed file")
        target = safe_path(server_id, rel_path)
        if target.is_file():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
    for patch in patches:
        target = safe_path(server_id, str(patch.get("file") or ""))
        patch_type = patch.get("type")
        if patch_type == "ini":
            section = str(patch.get("section") or "")
            key = str(patch.get("key") or "")
            if not section or not key:
                raise PathValidationError("Invalid INI patch")
            _set_ini_value(target, section, key, str(patch.get("value") or ""))
        elif patch_type == "regex":
            pattern = str(patch.get("regex") or "")
            if pattern and target.exists():
                content = target.read_text(encoding="utf-8", errors="replace")
                target.write_text(
                    re.sub(pattern, str(patch.get("value") or ""), content),
                    encoding="utf-8",
                )
        else:
            raise PathValidationError("Unknown runtime patch type")
    missing = [rel_path for rel_path in required_files if not safe_path(server_id, rel_path).is_file()]
    if missing:
        raise FileNotFoundError("Required runtime files are missing: " + ", ".join(missing))
    required = set(required_files)
    for rel_path in executable_files or []:
        if rel_path not in required:
            raise PathValidationError("Executable runtime file must also be required")
        root = server_root(server_id)
        unresolved = root / rel_path
        if unresolved.is_symlink():
            raise PathValidationError("Executable runtime file cannot be a symlink")
        target = safe_path(server_id, rel_path)
        if not target.is_file():
            raise FileNotFoundError("Executable runtime file is missing")
        # Rootless Docker: SteamCMD files are often owned by a container subuid.
        # The agent/panel user cannot chmod foreign UIDs (EPERM). Prefer 0750 when
        # possible; otherwise accept any existing execute bit. Wine PE binaries
        # only need to be readable on the host.
        try:
            target.chmod(0o750)
        except OSError:
            pass
        mode = stat_module.S_IMODE(target.stat(follow_symlinks=False).st_mode)
        if os.name != "posix":
            continue
        if mode & (stat_module.S_IXUSR | stat_module.S_IXGRP | stat_module.S_IXOTH):
            continue
        if rel_path.lower().endswith((".exe", ".bat", ".cmd")) and mode & (
            stat_module.S_IRUSR | stat_module.S_IRGRP | stat_module.S_IROTH
        ):
            continue
        raise PermissionError("Executable runtime file could not be prepared")


def search_paths(server_id: str | int, query: str, *, limit: int = 200) -> dict[str, Any]:
    root = server_root(server_id)
    if not root.exists():
        return {"q": query, "results": [], "truncated": False}
    needle = query.lower()
    results: list[dict[str, Any]] = []
    for current_root, dirs, files in os.walk(root, followlinks=False):
        current = Path(current_root)
        dirs[:] = [d for d in dirs if not (current / d).is_symlink()]
        for name in dirs + files:
            if needle not in name.lower():
                continue
            full = current / name
            if full.is_symlink():
                continue
            try:
                resolved = full.resolve(strict=False)
                resolved.relative_to(root)
            except (ValueError, OSError):
                continue
            results.append({
                "name": name,
                "path": full.relative_to(root).as_posix(),
                "is_dir": full.is_dir(),
            })
            if len(results) >= limit:
                return {"q": query, "results": results, "truncated": True}
    return {"q": query, "results": results, "truncated": False}


def move_path(server_id: str | int, source_path: str, target_path: str) -> None:
    source = safe_path(server_id, source_path)
    target = safe_path(server_id, target_path)
    root = server_root(server_id)
    if source == root:
        raise PathValidationError("Cannot move server root")
    if not source.exists():
        raise FileNotFoundError("Source not found")
    if target.exists():
        raise FileExistsError("Destination already exists")
    try:
        target.relative_to(source)
        raise PathValidationError("Destination is inside source")
    except ValueError:
        pass
    if not target.parent.is_dir():
        raise FileNotFoundError("Destination directory not found")
    shutil.move(str(source), str(target))


def _validated_archive_destination(root: Path, raw_name: str) -> Path:
    if not raw_name or "\x00" in raw_name or Path(raw_name).is_absolute():
        raise PathValidationError("Unsafe archive member")
    target = (root / raw_name).resolve(strict=False)
    try:
        target.relative_to(root)
    except ValueError as exc:
        raise PathEscapeError("Archive member escapes server directory") from exc
    return target


def _archive_limits() -> tuple[int, int]:
    max_members = max(1, int(getattr(settings, "max_archive_members", 50000)))
    max_bytes = max(1, int(getattr(settings, "max_archive_extract_bytes", 10 * 1024 * 1024 * 1024)))
    return max_members, max_bytes


def _validate_tar_members(
    destination: Path,
    members: list[tarfile.TarInfo],
    *,
    require_regular: bool = False,
) -> None:
    max_members, max_bytes = _archive_limits()
    if len(members) > max_members:
        raise ValueError("Archive exceeds maximum entry count")
    total_size = 0
    for member in members:
        _validated_archive_destination(destination, member.name)
        if member.issym() or member.islnk() or member.isdev() or member.isfifo():
            raise PathValidationError("Archive links and devices are not allowed")
        if require_regular and not member.isfile():
            raise PathValidationError("Config cache contains invalid entry")
        if member.size < 0:
            raise PathValidationError("Archive member has invalid negative size")
        total_size += int(member.size)
        if total_size > max_bytes:
            raise ValueError("Archive exceeds maximum extracted size")
        # Never materialize setuid/setgid/sticky bits from untrusted archives.
        member.mode = member.mode & 0o777


def _extract_tar_members_safe(handle: tarfile.TarFile, destination: Path, members: list[tarfile.TarInfo]) -> None:
    if hasattr(tarfile, "data_filter"):
        handle.extractall(destination, members=members, filter=tarfile.data_filter)
    else:
        handle.extractall(destination, members=members)


def _extract_zip_safe(archive: Path, destination: Path) -> None:
    max_members, max_bytes = _archive_limits()
    with zipfile.ZipFile(archive) as handle:
        members = handle.infolist()
        if len(members) > max_members:
            raise ValueError("Archive exceeds maximum entry count")
        declared_total = 0
        for member in members:
            _validated_archive_destination(destination, member.filename)
            mode = (member.external_attr >> 16) & 0o170000
            if mode == 0o120000:
                raise PathValidationError("Archive symlinks are not allowed")
            if mode in {0o010000, 0o020000, 0o060000, 0o140000}:
                raise PathValidationError("Archive links and devices are not allowed")
            declared_total += max(0, int(member.file_size))
            if declared_total > max_bytes:
                raise ValueError("Archive exceeds maximum extracted size")

        written_total = 0
        write_flags = (
            os.O_WRONLY
            | os.O_CREAT
            | os.O_TRUNC
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_BINARY", 0)
        )
        for member in members:
            target = _validated_archive_destination(destination, member.filename)
            assert_no_symlink_path(target, destination)
            if member.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            assert_no_symlink_path(target.parent, destination)
            with handle.open(member, "r") as src:
                fd = os.open(str(target), write_flags, 0o660)
                with os.fdopen(fd, "wb") as dst:
                    while chunk := src.read(65536):
                        written_total += len(chunk)
                        if written_total > max_bytes:
                            raise ValueError("Archive exceeds maximum extracted size")
                        dst.write(chunk)


def extract_archive(server_id: str | int, rel_path: str) -> None:
    root = server_root(server_id)
    archive = safe_path(server_id, rel_path)
    assert_no_symlink_path(archive, root)
    if not archive.is_file():
        raise FileNotFoundError("Archive not found")
    destination = archive.parent.resolve()
    lower = archive.name.lower()
    if lower.endswith(".zip"):
        _extract_zip_safe(archive, destination)
        return
    if any(lower.endswith(ext) for ext in (".tar.gz", ".tgz", ".tar.xz", ".txz", ".tar.bz2", ".tbz2")):
        with tarfile.open(archive, mode="r:*") as handle:
            members = handle.getmembers()
            _validate_tar_members(destination, members)
            _extract_tar_members_safe(handle, destination, members)
        return
    raise PathValidationError("Unsupported archive type")


def restore_backup_archive(server_id: str | int, source) -> None:
    """Atomically replace one server root from a validated tar.gz stream."""
    root = server_root(server_id)
    parent = root.parent
    staging = parent / f".{root.name}-restore-{uuid.uuid4().hex}"
    previous = parent / f".{root.name}-pre-restore"
    archive_path = parent / f".{root.name}-restore-{uuid.uuid4().hex}.tar.gz"
    staging.mkdir(mode=0o750)
    try:
        written = 0
        with archive_path.open("wb") as output:
            while chunk := source.read(1024 * 1024):
                written += len(chunk)
                if written > MAX_CHUNKED_UPLOAD_SIZE:
                    raise ValueError("Restore archive exceeds maximum size")
                output.write(chunk)
        with tarfile.open(archive_path, "r:gz") as handle:
            members = handle.getmembers()
            _validate_tar_members(staging, members)
            _extract_tar_members_safe(handle, staging, members)
        if previous.exists():
            shutil.rmtree(previous)
        if root.exists():
            root.rename(previous)
        staging.rename(root)
        apply_shared_server_acl(root)
    except Exception:
        if previous.exists() and not root.exists():
            previous.rename(root)
        raise
    finally:
        archive_path.unlink(missing_ok=True)
        shutil.rmtree(staging, ignore_errors=True)


def finalize_backup_restore(server_id: str | int) -> None:
    root = server_root(server_id)
    previous = root.parent / f".{root.name}-pre-restore"
    shutil.rmtree(previous, ignore_errors=True)


def rollback_backup_restore(server_id: str | int) -> None:
    root = server_root(server_id)
    previous = root.parent / f".{root.name}-pre-restore"
    if root.exists():
        shutil.rmtree(root)
    if previous.exists():
        previous.rename(root)


def _upload_paths(server_id: str | int, upload_id: str) -> tuple[Path, Path]:
    if len(upload_id) != 32 or not upload_id.isalnum():
        raise PathValidationError("Invalid upload id")
    directory = safe_path(server_id, ".msm-uploads")
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{upload_id}.part", directory / f"{upload_id}.json"


def init_chunked_upload(
    server_id: str | int, upload_id: str, *, path: str, filename: str, total_size: int
) -> None:
    if total_size < 0 or total_size > MAX_CHUNKED_UPLOAD_SIZE:
        raise ValueError("Upload exceeds maximum size")
    if not filename or "/" in filename or "\\" in filename:
        raise PathValidationError("Invalid filename")
    safe_path(server_id, path)
    safe_path(server_id, f"{path}/{filename}" if path else filename)
    part, meta = _upload_paths(server_id, upload_id)
    if part.exists() or meta.exists():
        raise FileExistsError("Upload already exists")
    part.touch()
    meta.write_text(
        json.dumps({"path": path, "filename": filename, "total_size": total_size}),
        encoding="utf-8",
    )


def append_upload_chunk(server_id: str | int, upload_id: str, data_stream: Any) -> int:
    part, meta = _upload_paths(server_id, upload_id)
    if not part.exists() or not meta.exists():
        raise FileNotFoundError("Upload not found")
    current = part.stat().st_size
    expected = int(json.loads(meta.read_text(encoding="utf-8"))["total_size"])
    
    total_written = 0
    with part.open("ab") as handle:
        while block := data_stream.read(1024 * 1024):  # 1MB buffer
            total_written += len(block)
            if current + total_written > MAX_CHUNKED_UPLOAD_SIZE or (expected and current + total_written > expected):
                raise ValueError("Upload exceeds declared size")
            if total_written > MAX_CHUNK_SIZE:
                raise ValueError("Chunk exceeds maximum size")
            handle.write(block)
            
    return current + total_written


def upload_status(server_id: str | int, upload_id: str) -> int:
    part, meta = _upload_paths(server_id, upload_id)
    if not part.exists() or not meta.exists():
        raise FileNotFoundError("Upload not found")
    return part.stat().st_size


def finalize_chunked_upload(server_id: str | int, upload_id: str) -> dict[str, Any]:
    part, meta = _upload_paths(server_id, upload_id)
    if not part.exists() or not meta.exists():
        raise FileNotFoundError("Upload not found")
    values = json.loads(meta.read_text(encoding="utf-8"))
    actual_size = part.stat().st_size
    expected = int(values["total_size"])
    if expected and actual_size != expected:
        raise ValueError(f"Upload incomplete ({actual_size}/{expected} bytes)")
    rel_path = f"{values['path']}/{values['filename']}" if values["path"] else values["filename"]
    target = safe_path(server_id, rel_path)
    if target.exists():
        raise FileExistsError("Destination already exists")
    target.parent.mkdir(parents=True, exist_ok=True)
    os.replace(part, target)
    meta.unlink(missing_ok=True)
    return {"name": values["filename"], "size": actual_size, "path": rel_path}


def abort_chunked_upload(server_id: str | int, upload_id: str) -> None:
    part, meta = _upload_paths(server_id, upload_id)
    part.unlink(missing_ok=True)
    meta.unlink(missing_ok=True)


def cache_config_files(server_id: str | int, patterns: list[str]) -> int:
    root = server_root(server_id)
    cache_dir = safe_path(server_id, ".msm-config-cache")
    assert_no_symlink_path(cache_dir, root)
    cache_dir.mkdir(parents=True, exist_ok=True)
    archive = cache_dir / "manual-configs.tar"
    if archive.is_symlink():
        raise PathEscapeError("Config cache archive cannot be a symlink")
    selected: dict[str, Path] = {}
    for pattern in patterns:
        for path in root.rglob(pattern):
            try:
                assert_no_symlink_path(path, root)
                resolved = path.resolve(strict=False)
                relative = resolved.relative_to(root)
                st = path.lstat()
            except (PathEscapeError, ValueError, OSError):
                continue
            if not stat_module.S_ISREG(st.st_mode):
                continue
            if relative.parts and relative.parts[0] in {"steamapps", ".msm-config-cache", ".msm-uploads"}:
                continue
            if "workshop" in relative.parts:
                continue
            selected[relative.as_posix()] = path
    if not selected:
        archive.unlink(missing_ok=True)
        return 0
    with tarfile.open(archive, "w") as handle:
        for relative, path in sorted(selected.items()):
            handle.add(path, arcname=relative, recursive=False)
    return len(selected)


def restore_config_files(server_id: str | int) -> int:
    root = server_root(server_id)
    archive = safe_path(server_id, ".msm-config-cache/manual-configs.tar")
    assert_no_symlink_path(archive, root)
    if not archive.is_file():
        return 0
    with tarfile.open(archive, "r") as handle:
        members = handle.getmembers()
        _validate_tar_members(root, members, require_regular=True)
        _extract_tar_members_safe(handle, root, members)
    return len(members)


def clear_config_cache(server_id: str | int) -> None:
    cache_dir = safe_path(server_id, ".msm-config-cache")
    if cache_dir.exists():
        shutil.rmtree(cache_dir)


def ensure_servers_dir() -> None:
    path = settings.servers_path()
    try:
        path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        logger.warning("Could not create servers_dir: %s", exc)


def iter_archive_tar_gz(
    server_id: str | int,
    postgres: dict[str, Any] | None = None,
):
    """Yield tar.gz chunks of the server root (for panel backup streaming).

    Uses tarfile in streaming mode; path escape is prevented by walking only
    under server_root after realpath checks.
    """
    import io
    import tempfile

    root = server_root(server_id)
    if not root.is_dir():
        raise FileNotFoundError("Server directory not found")

    postgres_dumps: dict[str, str] = {}
    if postgres:
        from services.postgres_service import dump_databases

        postgres_dumps = dump_databases(
            admin_password=str(postgres.get("admin_password") or ""),
            database_names=list(postgres.get("database_names") or []),
        )

    with tempfile.TemporaryFile() as buf:
        with tarfile.open(fileobj=buf, mode="w:gz") as tar:
            for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
                current = Path(dirpath)
                dirnames[:] = [name for name in dirnames if not (current / name).is_symlink()]
                for name in filenames:
                    full = current / name
                    try:
                        resolved = full.resolve(strict=False)
                        resolved.relative_to(root)
                    except (ValueError, OSError):
                        continue
                    if full.is_symlink():
                        continue
                    try:
                        st = full.lstat()
                    except OSError:
                        continue
                    if not stat_module.S_ISREG(st.st_mode):
                        continue
                    arcname = resolved.relative_to(root).as_posix()
                    try:
                        info = tar.gettarinfo(str(full), arcname=arcname)
                        if info.issym() or info.islnk() or info.isdev() or info.isfifo():
                            continue
                        fd = os.open(
                            str(full),
                            os.O_RDONLY
                            | getattr(os, "O_NOFOLLOW", 0)
                            | getattr(os, "O_NONBLOCK", 0)
                            | getattr(os, "O_BINARY", 0),
                        )
                        with os.fdopen(fd, "rb") as member_handle:
                            tar.addfile(info, member_handle)
                    except OSError:
                        continue
            for database_name, sql_text in postgres_dumps.items():
                payload = sql_text.encode("utf-8")
                info = tarfile.TarInfo(f".msm/postgres/{database_name}.sql")
                info.size = len(payload)
                info.mode = 0o600
                tar.addfile(info, io.BytesIO(payload))
        buf.seek(0)
        while chunk := buf.read(64 * 1024):
            yield chunk
