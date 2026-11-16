"""Sicheres, inkrementelles Lesen deklarierter Blueprint-Dateilogs."""

from __future__ import annotations

import glob
from pathlib import Path

from services.guardian_service import redact_log_text


def read_declared_log_updates(
    *,
    root: Path,
    sources: list[str],
    redactors: list[str],
    max_tail_bytes: int,
    positions: dict[str, int],
) -> list[str]:
    resolved_root = root.resolve(strict=False)
    candidates: list[tuple[Path, str]] = []
    seen_keys: set[str] = set()
    for source in sources:
        if source == "stdout":
            continue
        matched: list[tuple[float, Path, str]] = []
        for raw in glob.glob(str(resolved_root / source), recursive=False):
            candidate = Path(raw)
            if candidate.is_symlink() or not candidate.is_file():
                continue
            try:
                resolved = candidate.resolve(strict=True)
                resolved.relative_to(resolved_root)
                st = resolved.stat()
            except (FileNotFoundError, OSError, ValueError):
                continue
            key = str(resolved)
            if key in seen_keys:
                continue
            matched.append((st.st_mtime, resolved, key))
        # Prioritize newest files when a directory holds more than 8 logs,
        # then return them oldest-to-newest so console output stays chronological.
        matched.sort(key=lambda item: (item[0], item[2]), reverse=True)
        for _, resolved, key in reversed(matched[:8]):
            seen_keys.add(key)
            candidates.append((resolved, key))

    if not candidates or max_tail_bytes <= 0:
        return []

    unread_count = sum(1 for _, key in candidates if key not in positions)
    initial_file_cap = (
        max(1024, max_tail_bytes // unread_count)
        if unread_count > 1
        else max_tail_bytes
    )

    remaining = max_tail_bytes
    lines: list[str] = []
    for resolved, key in candidates:
        if remaining <= 0:
            break
        try:
            size = resolved.stat().st_size
            previous = positions.get(key)
            if previous is None:
                budget = min(remaining, initial_file_cap)
                start = max(0, size - budget)
                jumped_mid_file = start > 0
            elif size < previous:
                start = 0
                jumped_mid_file = False
                if size > remaining:
                    start = size - remaining
                    jumped_mid_file = start > 0
            else:
                start = previous
                jumped_mid_file = False
                if size - start > remaining:
                    start = size - remaining
                    jumped_mid_file = start > previous

            if size <= start:
                positions[key] = size
                continue

            with resolved.open("rb") as stream:
                stream.seek(start)
                chunk = stream.read(min(size - start, remaining))
        except OSError:
            continue

        if not chunk:
            positions[key] = start
            continue

        if jumped_mid_file:
            first_nl = chunk.find(b"\n")
            if first_nl == -1:
                positions[key] = start + len(chunk)
                remaining -= len(chunk)
                continue
            start += first_nl + 1
            chunk = chunk[first_nl + 1 :]

        if not chunk:
            positions[key] = start
            continue

        if not chunk.endswith(b"\n"):
            last_nl = chunk.rfind(b"\n")
            if last_nl != -1:
                chunk = chunk[: last_nl + 1]

        positions[key] = start + len(chunk)
        remaining -= len(chunk)
        split = chunk.decode("utf-8", errors="replace").splitlines()
        lines.extend(redact_log_text(line, redactors) for line in split if line)
    return lines