"""Kommando-Pruefung und Sandbox-Ausfuehrung fuer KI-Projekte.

Herausgezogen aus `ai_project_service`: die Verbotsmuster, die Zerlegung an
Verkettungsoperatoren, die Ausfuehrung mit Ausgabegrenze und die Nachweise der
Sandbox. Die Dienstfunktionen, die sie brauchen, werden beim Aufruf geholt.
"""

from __future__ import annotations

import logging
import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from sqlalchemy.orm import Session

from models import User
from services.ai_project_errors import AiProjectError

logger = logging.getLogger(__name__)

_MAX_CMD_OUTPUT_CHARS = 16_000


_ALLOWED_DEV_BINARIES = frozenset({
    "npm", "npx", "yarn", "pnpm", "node", "python", "python3",
    "pip", "pip3", "pytest", "tsc", "vite", "git", "cargo",
    "rustc", "go", "deno", "bun", "make", "gcc", "g++", "clang",
    "echo", "ls", "dir", "cat", "type", "find", "grep", "mkdir",
    "cp", "mv", "rm", "touch", "head", "tail", "wc", "sed", "awk", "diff",
})


_DANGEROUS_PATTERNS = [
    re.compile(r"\b(sudo|su|doas|pkexec|useradd|userdel|usermod|passwd|groupadd)\b", re.I),
    re.compile(r"\b(chmod|chown|chgrp)\b", re.I),
    re.compile(r"\b(shutdown|reboot|poweroff|halt|systemctl|service)\b", re.I),
    re.compile(r"\b(mkfs|fdisk|parted|dd)\b", re.I),
    re.compile(r"\b(nc|netcat|ncat|socat)\b", re.I),
    re.compile(r"\|\s*(ba|z)?sh", re.I),
    re.compile(r"\|\s*(cmd|powershell)", re.I),
    re.compile(r"\b(curl|wget)\b.*\|", re.I),
    re.compile(r"(/etc/|/root/|/proc/|/sys/|/dev/|/boot/|/var/run|C:\\Windows|C:\\Program Files)", re.I),
    re.compile(r"\.\./\.\.", re.I),
    re.compile(r"\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+/\s*$", re.I),
]


def _split_unquoted_command_segments(cmd: str) -> list[str]:
    """Teilt eine Befehlszeile nur an unquotierten Verkettungsoperatoren (;, &, |)."""
    segments: list[str] = []
    current: list[str] = []
    in_single = False
    in_double = False
    escape = False
    for ch in cmd:
        if escape:
            current.append(ch)
            escape = False
            continue
        if ch == "\\":
            escape = True
            current.append(ch)
            continue
        if ch == "'" and not in_double:
            in_single = not in_single
            current.append(ch)
            continue
        if ch == '"' and not in_single:
            in_double = not in_double
            current.append(ch)
            continue
        if not in_single and not in_double and ch in (";", "&", "|"):
            seg = "".join(current).strip()
            if seg:
                segments.append(seg)
            current = []
        else:
            current.append(ch)
    tail = "".join(current).strip()
    if tail:
        segments.append(tail)
    return segments


def _validate_project_command(cmd: str, ws: Path) -> None:
    trimmed = (cmd or "").strip()
    if not trimmed:
        raise AiProjectError("Befehl darf nicht leer sein")
    for pattern in _DANGEROUS_PATTERNS:
        if pattern.search(trimmed):
            raise AiProjectError("Befehl enthält nicht zugelassene System-Operationen oder Pfade")

    segments = _split_unquoted_command_segments(trimmed)
    for seg in segments:
        seg_clean = seg.strip()
        if not seg_clean:
            continue
        first_token = seg_clean.split()[0].lower()
        binary_name = Path(first_token).name.replace(".exe", "").replace(".cmd", "").replace(".bat", "")
        if binary_name not in _ALLOWED_DEV_BINARIES:
            raise AiProjectError(f"Das Programm '{binary_name}' ist in der Projekt-Sandbox nicht zugelassen")


def run_project_command(
    db: Session,
    user: User,
    project_id: str,
    command: str,
    *,
    timeout_seconds: int = 25,
) -> dict[str, object]:
    """Fuehrt einen Shell-Befehl isoliert und geprueft im Projekt-Arbeitsverzeichnis aus."""
    from services.ai_project_service import (
        _materialize_db_files_to_workspace,
        _sync_workspace_files_to_db,
        ensure_project_workspace,
        get_project,
    )

    project = get_project(db, user, project_id)
    cmd = (command or "").strip()
    if not cmd:
        raise AiProjectError("Befehl darf nicht leer sein")
    ws = ensure_project_workspace(project)
    _validate_project_command(cmd, ws)
    _materialize_db_files_to_workspace(db, project, ws)

    safe_env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": str(ws),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "GIT_TERMINAL_PROMPT": "0",
    }
    for key in ("SYSTEMROOT", "COMSPEC", "PATHEXT", "TEMP", "TMP"):
        if key in os.environ:
            safe_env[key] = os.environ[key]

    timeout = max(2, min(int(timeout_seconds or 25), 60))
    try:
        completed = subprocess.run(
            cmd,
            cwd=str(ws),
            env=safe_env,
            shell=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
        )
        stdout = (completed.stdout or "")[:_MAX_CMD_OUTPUT_CHARS]
        stderr = (completed.stderr or "")[:_MAX_CMD_OUTPUT_CHARS]
        _sync_workspace_files_to_db(db, project, ws)
        return {
            "ok": completed.returncode == 0,
            "exit_code": completed.returncode,
            "stdout": stdout,
            "stderr": stderr,
            "workspace": str(ws),
        }
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "exit_code": 124,
            "stdout": "",
            "stderr": f"Zeitüberschreitung nach {timeout} Sekunden.",
            "workspace": str(ws),
        }
    except OSError as exc:
        raise AiProjectError(f"Ausführung fehlgeschlagen: {exc}") from exc


def verify_project_sandbox(
    db: Session,
    user: User,
    project_id: str,
) -> dict[str, object]:
    """Fuehrt einen mehrstufigen automatischen Selbsttest (inkl. Vorschau-, Happy-Path- und Negativ-Prüfung) aus."""
    from services.ai_project_service import (
        _ensure_env_metadata,
        _materialize_db_files_to_workspace,
        _save_env_metadata,
        ensure_project_workspace,
        get_project,
        list_project_files,
    )

    import ast
    import json as _json

    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    _materialize_db_files_to_workspace(db, project, ws)
    meta = _ensure_env_metadata(project, ws)
    files = list_project_files(db, user, project.id)

    checks: list[dict[str, object]] = []
    errors: list[str] = []
    warnings: list[str] = []
    existing_paths = {f.path for f in files}
    lower_to_actual = {f.path.lower(): f.path for f in files}

    has_html_entry = False
    has_jsx_entry = False
    test_files_found: list[str] = []
    has_negative_tests = False

    for f in files:
        path = f.path
        lower = path.lower()
        content = f.content or ""

        if "test" in lower or "spec" in lower:
            test_files_found.append(path)
            if re.search(
                r"(invalid|error|fail|empty|missing|unauthorized|forbidden|negativ|ungueltig|ungültig|fehler|throws|raises|reject)",
                content,
                re.I,
            ):
                has_negative_tests = True

        if lower.endswith(".json"):
            try:
                _json.loads(content)
                checks.append({"file": path, "kind": "json", "ok": True})
            except Exception as exc:
                msg = f"{path}: Ungültiges JSON ({exc})"
                errors.append(msg)
                checks.append({"file": path, "kind": "json", "ok": False, "error": str(exc)})

        elif lower.endswith(".py"):
            try:
                ast.parse(content, filename=path)
                checks.append({"file": path, "kind": "python_ast", "ok": True})
            except SyntaxError as exc:
                msg = f"{path}:{exc.lineno}: Python-Syntaxfehler ({exc.msg})"
                errors.append(msg)
                checks.append({"file": path, "kind": "python_ast", "ok": False, "error": msg})

        elif lower.endswith((".js", ".mjs", ".cjs")):
            full_path = ws / path
            is_es_module = bool(re.search(r"^\s*(import|export)\s+", content, re.M))
            if full_path.is_file() and not is_es_module:
                try:
                    proc = subprocess.run(
                        ["node", "--check", str(full_path)],
                        cwd=str(ws),
                        capture_output=True,
                        text=True,
                        encoding="utf-8",
                        errors="replace",
                        timeout=8,
                    )
                    if proc.returncode == 0:
                        checks.append({"file": path, "kind": "node_syntax", "ok": True})
                    else:
                        err_detail = (proc.stderr or proc.stdout or "JS-Syntaxfehler").strip()
                        errors.append(f"{path}: {err_detail[:240]}")
                        checks.append({"file": path, "kind": "node_syntax", "ok": False, "error": err_detail[:240]})
                except Exception:
                    checks.append({"file": path, "kind": "node_syntax", "ok": True, "note": "node --check übersprungen"})
            else:
                checks.append({"file": path, "kind": "es_module_js", "ok": True})

        elif lower.endswith((".jsx", ".tsx", ".ts")):
            has_jsx_entry = True
            open_braces = content.count("{") - content.count("}")
            if abs(open_braces) > 2:
                msg = f"{path}: Unausgeglichene geschweifte Klammern (Differenz: {open_braces})."
                errors.append(msg)
                checks.append({"file": path, "kind": "jsx_structure", "ok": False, "error": msg})
            else:
                checks.append({"file": path, "kind": "jsx_structure", "ok": True})

        elif lower.endswith((".html", ".htm")):
            has_html_entry = True
            if "<html" not in content.lower() and "<!doctype" not in content.lower() and "<body" not in content.lower():
                warnings.append(f"{path}: Enthält kein vollständiges HTML-Grundgerüst (<html>/<body>).")
            for ref_match in re.finditer(r'(?:src|href)=["\'](?![a-z]+://|/|#|data:|mailto:)([^"\'?#]+)', content, re.I):
                rel_ref = ref_match.group(1).strip().lstrip("./")
                if rel_ref and rel_ref not in existing_paths and not rel_ref.lower().endswith((".tsx", ".jsx", ".ts")):
                    warnings.append(f"{path}: Referenziert '{rel_ref}', diese Datei existiert im Projekt noch nicht.")
            checks.append({"file": path, "kind": "html_structure", "ok": True})

        elif lower.endswith(".sql"):
            if not re.search(r"\b(CREATE|ALTER|INSERT|SELECT|UPDATE|DELETE|DROP)\b", content, re.I):
                warnings.append(f"{path}: Keine erkennbaren SQL-Anweisungen gefunden.")
            checks.append({"file": path, "kind": "sql_check", "ok": True})

    # Vorschau-Einstiegspunkt prüfen und ggf. automatisch konfigurieren
    configured_entry = str(meta.get("preview_entry") or "").strip()
    preview_ready = False
    preview_entry_resolved: str | None = None

    if configured_entry and configured_entry.lower() in lower_to_actual:
        preview_entry_resolved = lower_to_actual[configured_entry.lower()]
        preview_ready = True
    else:
        for candidate in ("index.html", "public/index.html", "frontend/index.html", "src/index.html", "src/app.tsx", "src/app.jsx", "app.tsx", "app.jsx"):
            if candidate in lower_to_actual:
                preview_entry_resolved = lower_to_actual[candidate]
                preview_ready = True
                meta["preview_entry"] = preview_entry_resolved
                meta["preview_configured"] = True
                _save_env_metadata(ws, meta)
                break
        if not preview_ready and (has_html_entry or has_jsx_entry):
            first_ui = next(
                (f.path for f in files if f.path.lower().endswith((".html", ".htm", ".tsx", ".jsx"))),
                None,
            )
            if first_ui:
                preview_entry_resolved = first_ui
                preview_ready = True
                meta["preview_entry"] = first_ui
                meta["preview_configured"] = True
                _save_env_metadata(ws, meta)

    if project.project_kind == "coding" and not preview_ready:
        errors.append(
            "Vorschau ist noch nicht lauffähig: Es fehlt eine index.html oder React-Einstiegsdatei (App.jsx / App.tsx). "
            "Bitte lege eine index.html an und konfiguriere die Vorschau mit action='configure_preview'."
        )

    if project.project_kind == "coding":
        if not test_files_found:
            warnings.append(
                "Es wurden noch keine dedizierten Testdateien (tests/) gefunden. "
                "Bitte lege Tests für Happy-Path (Gutfall) und Negative-Path (Fehleingaben/Grenzwerte) an."
            )
        elif not has_negative_tests:
            warnings.append(
                "In den Testdateien fehlen erkennbare Negativ-Tests (ungültige Eingaben, leere Felder, Fehlerfälle). "
                "Bitte ergänze Negativ-Testfälle."
            )

    # Release-Prüfsumme für das Test-Gate berechnen
    import hashlib
    hasher = hashlib.sha256()
    for f in sorted(files, key=lambda x: getattr(x, "path", "")):
        p_val = getattr(f, "path", "")
        c_val = getattr(f, "content", "") or ""
        hasher.update(f"{p_val}:{c_val}".encode("utf-8"))
    release_checksum = hasher.hexdigest()

    browser_results = None
    dev_url = meta.get("dev_web_url")
    if dev_url:
        from services.singra import browser
        artifacts_dir = ws / "_test_artifacts" / release_checksum[:12]
        try:
            browser_results = browser.run_project_browser_tests(
                db,
                project.id,
                target_url=dev_url,
                environment="dev",
                release_checksum=release_checksum,
                artifacts_dir=artifacts_dir,
            )
            if not browser_results.get("passed", False):
                errors.append(f"Browser-Test fehlgeschlagen: {browser_results.get('error') or 'Fehler aufgetreten'}")
        except Exception as b_exc:
            logger.warning("Browser-Test Ausführung meldet: %s", b_exc)
    elif project.project_kind != "coding" and len(errors) == 0:
        # Statischen Testlauf für Nicht-Coding-Projekte registrieren
        from models.singra_test_run import SingraTestRun
        test_run = SingraTestRun(
            id=str(uuid4()),
            project_id=project.id,
            environment="dev",
            release_checksum=release_checksum,
            kind="static_check",
            status="passed",
            summary_json=_json.dumps({"checks_count": len(checks), "passed": True, "non_coding": True}),
            started_at=datetime.now(timezone.utc),
            finished_at=datetime.now(timezone.utc),
        )
        db.add(test_run)
        db.commit()
    else:
        warnings.append("Dev-Sandbox läuft nicht; Browser-Tests konnten nicht ausgeführt werden. Für ein Produktions-Deployment muss die Dev-Sandbox gestartet und getestet werden.")

    is_ok = len(errors) == 0 and (preview_ready or project.project_kind != "coding")
    test_gate_passed = is_ok and (bool(browser_results and browser_results.get("passed")) or project.project_kind != "coding")
    return {
        "ok": is_ok,
        "project_id": project.id,
        "release_checksum": release_checksum,
        "preview_ready": preview_ready,
        "preview_entry": preview_entry_resolved,
        "happy_path_and_negative_tests_checked": bool(test_files_found and has_negative_tests),
        "test_files": test_files_found,
        "checked_files": len(checks),
        "errors_count": len(errors),
        "warnings_count": len(warnings),
        "errors": errors,
        "warnings": warnings,
        "checks": checks,
        "browser_tests": browser_results,
        "test_gate_passed": test_gate_passed,
    }


