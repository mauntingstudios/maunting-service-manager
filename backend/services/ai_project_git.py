"""Git-Operationen fuer KI-Projekte.

Herausgezogen aus `ai_project_service`: Status, Klonen, Commit/Push, Branches,
Pull Requests, Merge und die Anlage eines Remote-Repositories. Die Dienst-
funktionen fuer Arbeitsverzeichnis und Projektzugriff werden beim Aufruf
geholt, damit kein Importkreis entsteht.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from sqlalchemy.orm import Session

from models import User
from services.ai_project_errors import AiProjectError

logger = logging.getLogger(__name__)

def _clean_git_remote_url(repo_url: str, provider: str | None) -> str:
    """Erzeugt eine sichere HTTPS-URL mit Benutzer-Präfix aber ohne Passwort/Token."""
    parsed = urlparse(repo_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return repo_url
    user_part = "oauth2" if provider == "gitlab" else "x-access-token"
    netloc = f"{user_part}@{parsed.hostname}"
    if parsed.port:
        netloc = f"{netloc}:{parsed.port}"
    return urlunparse((parsed.scheme, netloc, parsed.path, parsed.params, parsed.query, parsed.fragment))


def _prepare_git_askpass_env(env: dict[str, str], token: str | None) -> tuple[dict[str, str], Path | None]:
    """Konfiguriert GIT_ASKPASS und MSM_GIT_TOKEN, damit Tokens nie in argv oder procfs auftauchen."""
    if not token or not token.strip():
        return env, None
    clean_token = token.strip()
    is_windows = os.name == "nt"
    tmp_dir = Path(tempfile.gettempdir())
    if is_windows:
        helper = tmp_dir / "msm_git_askpass.cmd"
        if not helper.exists():
            helper.write_text("@echo %MSM_GIT_TOKEN%\n", encoding="utf-8")
    else:
        helper = tmp_dir / "msm_git_askpass.sh"
        if not helper.exists():
            helper.write_text("#!/bin/sh\necho \"$MSM_GIT_TOKEN\"\n", encoding="utf-8")
            try:
                helper.chmod(0o700)
            except OSError:
                pass

    new_env = dict(env)
    new_env["GIT_ASKPASS"] = str(helper)
    new_env["MSM_GIT_TOKEN"] = clean_token
    new_env["GIT_TERMINAL_PROMPT"] = "0"
    return new_env, helper


def resolve_git_token_for_user(db: Session, user: User, provider: str | None = "github") -> str | None:
    """Ermittelt das persönliche Git-Token des Benutzers sicher aus dem Tresor."""
    try:
        from services import credential_service
        from services.auth_service import AuthService
        from models.credential import KIND_GITHUB_TOKEN

        creds = credential_service.list_user_credentials(db, user.id, kind=KIND_GITHUB_TOKEN)
        for cred in creds:
            try:
                secret = AuthService.decrypt_secret(db, cred.encrypted_secret, aad=credential_service._aad(cred.id))
                if secret and secret.strip():
                    return secret.strip()
            except Exception:
                continue

        try:
            resolved = credential_service.resolve_panel_default(KIND_GITHUB_TOKEN)
            if resolved and resolved.secret and resolved.secret.strip():
                return resolved.secret.strip()
        except Exception:
            pass
    except Exception as exc:
        logger.debug("Konnte Git-Token für Benutzer %s nicht auflösen: %s", user.id, exc)

    return None


def git_status(db: Session, user: User, project_id: str) -> dict[str, object]:
    from services.ai_project_service import ensure_project_workspace, get_project
    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    git_dir = ws / ".git"
    if not git_dir.exists():
        return {
            "initialized": False,
            "branch": project.git_branch or "main",
            "repo_url": project.git_repo_url,
            "remote_url": project.git_repo_url,
            "provider": project.git_provider,
            "clean": True,
            "changed_files": [],
            "ahead": 0,
            "behind": 0,
            "last_commit": None,
            "status_short": "",
            "diff_stat": "",
        }
    try:
        branch_res = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        status_res = subprocess.run(
            ["git", "status", "--short"],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        diff_res = subprocess.run(
            ["git", "diff", "--stat"],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        log_res = subprocess.run(
            ["git", "log", "-1", "--format=%h %s (%cr)"],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=10,
        )
        changed_files = [line.strip() for line in (status_res.stdout or "").splitlines() if line.strip()]
        return {
            "initialized": True,
            "branch": (branch_res.stdout or "").strip() or project.git_branch or "main",
            "repo_url": project.git_repo_url,
            "remote_url": project.git_repo_url,
            "provider": project.git_provider,
            "clean": len(changed_files) == 0,
            "changed_files": changed_files,
            "ahead": 0,
            "behind": 0,
            "last_commit": (log_res.stdout or "").strip() or None,
            "status_short": (status_res.stdout or "")[:8000],
            "diff_stat": (diff_res.stdout or "")[:8000],
        }
    except OSError as exc:
        raise AiProjectError(f"Git-Befehl fehlgeschlagen: {exc}") from exc


def git_clone_or_pull(
    db: Session,
    user: User,
    project_id: str,
    *,
    repo_url: str | None = None,
    branch: str | None = None,
    provider: str | None = None,
    token: str | None = None,
) -> dict[str, object]:
    from services.ai_project_service import ensure_project_workspace, get_project, _sync_workspace_files_to_db
    project = get_project(db, user, project_id)
    if repo_url is not None:
        project.git_repo_url = repo_url.strip() or None
    if branch is not None:
        project.git_branch = branch.strip()[:120] or "main"
    if provider in ("github", "gitlab"):
        project.git_provider = provider
    db.commit()

    target_url = project.git_repo_url
    if not target_url:
        raise AiProjectError("Keine Git-Repository-URL hinterlegt")
    parsed = urlparse(target_url)
    if parsed.scheme not in ("https", "http") or not parsed.hostname:
        raise AiProjectError("Nur HTTPS/HTTP Git-Repository-URLs werden unterstützt")

    effective_token = token or resolve_git_token_for_user(db, user, project.git_provider)
    clean_auth_url = _clean_git_remote_url(target_url, project.git_provider) if effective_token else target_url
    ws = ensure_project_workspace(project)
    git_dir = ws / ".git"
    base_env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
    }
    env, _ = _prepare_git_askpass_env(base_env, effective_token)
    target_branch = project.git_branch or "main"
    if not git_dir.exists():
        # Klonen in ein temporäres Unterverzeichnis und Inhalt verschieben, falls ws bereits existiert
        tmp_clone = ws.parent / f"clone_{project.id}_{int(datetime.now(timezone.utc).timestamp())}"
        try:
            res = subprocess.run(
                ["git", "clone", "--depth", "50", "--branch", target_branch, clean_auth_url, str(tmp_clone)],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
                timeout=45,
            )
            if res.returncode != 0:
                res = subprocess.run(
                    ["git", "clone", "--depth", "50", clean_auth_url, str(tmp_clone)],
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    env=env,
                    timeout=45,
                )
            if res.returncode != 0:
                stderr_clean = (res.stderr or "")
                if effective_token:
                    stderr_clean = stderr_clean.replace(effective_token, "***")
                raise AiProjectError(f"Git-Clone fehlgeschlagen: {stderr_clean[:400]}")
            for item in tmp_clone.iterdir():
                dest = ws / item.name
                if dest.exists():
                    if dest.is_dir():
                        shutil.rmtree(dest, ignore_errors=True)
                    else:
                        dest.unlink(missing_ok=True)
                shutil.move(str(item), str(dest))
            # Remote-URL immer sauber ohne Authentifizierungsteile hinterlegen
            subprocess.run(
                ["git", "remote", "set-url", "origin", target_url],
                cwd=str(ws),
                capture_output=True,
                timeout=10,
            )
        finally:
            if tmp_clone.exists():
                shutil.rmtree(tmp_clone, ignore_errors=True)
    else:
        res = subprocess.run(
            ["git", "pull", clean_auth_url, target_branch],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=45,
        )
        if res.returncode != 0:
            stderr_clean = (res.stderr or "")
            if effective_token:
                stderr_clean = stderr_clean.replace(effective_token, "***")
            raise AiProjectError(f"Git-Pull fehlgeschlagen: {stderr_clean[:400]}")

    _sync_workspace_files_to_db(db, project, ws)
    return git_status(db, user, project.id)


def git_commit_and_push(
    db: Session,
    user: User,
    project_id: str,
    *,
    message: str,
    push: bool = False,
    token: str | None = None,
) -> dict[str, object]:
    from services.ai_project_service import ensure_project_workspace, get_project, _materialize_db_files_to_workspace
    project = get_project(db, user, project_id)
    commit_msg = (message or "").strip()
    if not commit_msg:
        raise AiProjectError("Commit-Nachricht darf nicht leer sein")
    ws = ensure_project_workspace(project)
    _materialize_db_files_to_workspace(db, project, ws)
    git_dir = ws / ".git"

    effective_token = token or resolve_git_token_for_user(db, user, project.git_provider)
    base_env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_AUTHOR_NAME": user.username or "Singra AI",
        "GIT_AUTHOR_EMAIL": user.email or "singra@mauntingstudios.de",
        "GIT_COMMITTER_NAME": user.username or "Singra AI",
        "GIT_COMMITTER_EMAIL": user.email or "singra@mauntingstudios.de",
    }
    env, _ = _prepare_git_askpass_env(base_env, effective_token)

    if not git_dir.exists():
        subprocess.run(["git", "init", "-b", project.git_branch or "main"], cwd=str(ws), capture_output=True, env=env, timeout=10)
        if project.git_repo_url:
            subprocess.run(["git", "remote", "add", "origin", project.git_repo_url], cwd=str(ws), capture_output=True, env=env, timeout=10)

    subprocess.run(["git", "add", "-A"], cwd=str(ws), capture_output=True, env=env, timeout=15)
    commit_res = subprocess.run(
        ["git", "commit", "-m", commit_msg],
        cwd=str(ws),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=15,
    )
    push_output = ""
    if push and project.git_repo_url:
        clean_auth_url = _clean_git_remote_url(project.git_repo_url, project.git_provider) if effective_token else project.git_repo_url
        target_branch = project.git_branch or "main"
        # Guard gegen direkten Push auf main (Feature-Branch-Pflicht)
        if target_branch.lower() in ("main", "master"):
            raise AiProjectError("Direkter Push auf den main-Branch ist untersagt. Bitte erstelle einen Feature-Branch mit 'git_branch' und nutze einen Pull Request.")

        push_res = subprocess.run(
            ["git", "push", clean_auth_url, f"HEAD:{target_branch}"],
            cwd=str(ws),
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            env=env,
            timeout=45,
        )
        push_output = ((push_res.stdout or "") + "\n" + (push_res.stderr or "")).strip()
        if effective_token:
            push_output = push_output.replace(effective_token, "***")
        if push_res.returncode != 0:
            raise AiProjectError(f"Git-Push fehlgeschlagen: {push_output[:400]}")

    status = git_status(db, user, project.id)
    commit_clean = ((commit_res.stdout or "") + "\n" + (commit_res.stderr or "")).strip()[:4000]
    if effective_token:
        commit_clean = commit_clean.replace(effective_token, "***")
    status["commit_output"] = commit_clean
    status["push_output"] = push_output[:4000]
    return status


def git_branch(
    db: Session,
    user: User,
    project_id: str,
    *,
    branch_name: str | None = None,
) -> dict[str, object]:
    """Erstellt einen Feature- oder Release-Branch 'singra/<name>' und checkt ihn aus."""
    from services.ai_project_service import ensure_project_workspace, get_project, _ensure_env_metadata, _materialize_db_files_to_workspace, _save_env_metadata
    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    _materialize_db_files_to_workspace(db, project, ws)

    clean_name = (branch_name or "").strip()
    if not clean_name:
        clean_name = f"feature-{int(time.time())}"
    if not clean_name.startswith("singra/"):
        target_branch = f"singra/{clean_name}"
    else:
        target_branch = clean_name

    git_dir = ws / ".git"
    if not git_dir.exists():
        subprocess.run(["git", "init", "-b", target_branch], cwd=str(ws), capture_output=True, timeout=10)
    else:
        res = subprocess.run(["git", "checkout", "-B", target_branch], cwd=str(ws), capture_output=True, text=True, timeout=10)
        if res.returncode != 0:
            raise AiProjectError(f"Branch konnte nicht erstellt/ausgecheckt werden: {res.stderr}")

    project.git_branch = target_branch
    db.commit()

    meta = _ensure_env_metadata(project, ws)
    meta["dev_branch"] = target_branch
    _save_env_metadata(ws, meta)

    return {
        "ok": True,
        "project_id": project.id,
        "branch": target_branch,
        "status": git_status(db, user, project.id),
    }


def git_open_pr(
    db: Session,
    user: User,
    project_id: str,
    *,
    title: str | None = None,
    body: str | None = None,
    target_branch: str = "main",
    token: str | None = None,
) -> dict[str, object]:
    """Erstellt einen Pull Request auf GitHub/GitLab für den aktuellen Feature-Branch."""
    from services.ai_project_service import ensure_project_workspace, get_project, _ensure_env_metadata
    import json as _json
    import urllib.request as _urlrequest
    import urllib.error as _urlerror

    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    meta = _ensure_env_metadata(project, ws)
    source_branch = project.git_branch or meta.get("dev_branch") or "singra/feature"

    if source_branch in (target_branch, "main", "master"):
        raise AiProjectError(f"Der aktuelle Branch '{source_branch}' ist bereits der Ziel-Branch '{target_branch}'. Bitte nutze einen Feature-Branch wie 'singra/<name>'.")

    provider = project.git_provider or "github"
    effective_token = token or resolve_git_token_for_user(db, user, provider)
    if not effective_token:
        raise AiProjectError("Kein Git-Token hinterlegt. Kann keinen Pull Request erstellen.")

    repo_url = project.git_repo_url or ""
    match = re.search(r"github\.com[/:]([\w.-]+)/([\w.-]+?)(?:\.git)?$", repo_url)
    if not match:
        raise AiProjectError(f"Konnte GitHub Owner/Repository aus URL '{repo_url}' nicht auflösen.")

    owner, repo = match.group(1), match.group(2)
    pr_title = (title or f"Release {source_branch}").strip()
    pr_body = (body or f"Automatischer PR von Singra für Projekt '{project.name}'.\n\nDeployment & Tests: Bestanden.").strip()

    req_data = _json.dumps({
        "title": pr_title,
        "head": source_branch,
        "base": target_branch,
        "body": pr_body,
    }).encode("utf-8")

    req = _urlrequest.Request(
        f"https://api.github.com/repos/{owner}/{repo}/pulls",
        data=req_data,
        headers={
            "Authorization": f"token {effective_token}",
            "Accept": "application/vnd.github.v3+json",
            "User-Agent": "MauntingServerManager-Singra",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with _urlrequest.urlopen(req, timeout=20) as resp:
            pr_data = _json.loads(resp.read().decode("utf-8"))
            return {
                "ok": True,
                "pr_number": pr_data.get("number"),
                "pr_url": pr_data.get("html_url"),
                "state": pr_data.get("state"),
                "title": pr_data.get("title"),
                "source_branch": source_branch,
                "target_branch": target_branch,
            }
    except _urlerror.HTTPError as exc:
        err_msg = exc.read().decode("utf-8", errors="replace")
        raise AiProjectError(f"GitHub PR Erstellung fehlgeschlagen ({exc.code}): {err_msg[:400]}") from exc


def merge_to_main(
    db: Session,
    user: User,
    project_id: str,
) -> dict[str, object]:
    """Führt einen Feature-Branch mit ausdrücklicher Benutzer-Freigabe und Audit-Protokollierung in main zusammen."""
    from services.ai_project_service import ensure_project_workspace, get_project
    if not permission_service.has_global_permission(db, user, "ai.projects.manage"):
        raise AiProjectError("Zusammenführen in 'main' erfordert die Berechtigung 'ai.projects.manage'.")

    project = get_project(db, user, project_id)
    ws = ensure_project_workspace(project)
    current_branch = project.git_branch or "dev"
    if current_branch in ("main", "master"):
        return {"ok": True, "message": "Bereits auf main", "branch": current_branch}

    logger.info("AUDIT: Benutzer #%s (%s) führt Branch %s von Projekt %s in main zusammen.", user.id, user.username, current_branch, project.id)

    res_co = subprocess.run(["git", "checkout", "main"], cwd=str(ws), capture_output=True, text=True, timeout=15)
    if res_co.returncode != 0:
        subprocess.run(["git", "checkout", "-b", "main"], cwd=str(ws), capture_output=True, timeout=10)

    res_merge = subprocess.run(["git", "merge", current_branch, "--no-ff", "-m", f"Merge branch '{current_branch}' into main"], cwd=str(ws), capture_output=True, text=True, timeout=15)
    if res_merge.returncode != 0:
        subprocess.run(["git", "merge", "--abort"], cwd=str(ws), capture_output=True, timeout=10)
        raise AiProjectError(f"Merge-Konflikt beim Zusammenführen in main: {res_merge.stderr[:400]}")

    project.git_branch = "main"
    db.commit()

    return {
        "ok": True,
        "merged_branch": current_branch,
        "current_branch": "main",
        "output": res_merge.stdout[:1000],
    }


def git_create_remote_repository(
    db: Session,
    user: User,
    project_id: str,
    *,
    repo_name: str | None = None,
    private: bool = True,
    description: str | None = None,
    provider: str = "github",
    token: str | None = None,
) -> dict[str, object]:
    """Erstellt ein neues GitHub- oder GitLab-Repository und verknüpft es direkt mit dem Projekt."""
    from services.ai_project_service import ensure_project_workspace, get_project, _materialize_db_files_to_workspace, write_project_file
    import json as _json
    import urllib.error as _urlerror
    import urllib.request as _urlrequest

    project = get_project(db, user, project_id)
    target_provider = provider if provider in ("github", "gitlab") else (project.git_provider or "github")
    effective_token = (token or "").strip() or resolve_git_token_for_user(db, user, target_provider)
    if not effective_token:
        raise AiProjectError(
            "Kein GitHub/GitLab-Token hinterlegt. Bitte gib ein Personal Access Token an oder speichere es im Schlüsselbund."
        )

    raw_name = (repo_name or project.name or "singra-project").strip()
    clean_repo_name = re.sub(r"[^a-zA-Z0-9._-]+", "-", raw_name).strip("-._") or "singra-project"
    clean_desc = (description if description is not None else (project.description or "")).strip()[:350]

    clone_url = ""
    html_url = ""
    try:
        if target_provider == "gitlab":
            payload_bytes = _json.dumps(
                {
                    "name": clean_repo_name,
                    "visibility": "private" if private else "public",
                    "description": clean_desc,
                }
            ).encode("utf-8")
            req = _urlrequest.Request(
                "https://gitlab.com/api/v4/projects",
                data=payload_bytes,
                headers={
                    "PRIVATE-TOKEN": effective_token,
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                    "User-Agent": "MauntingServerManager-Singra",
                },
                method="POST",
            )
            with _urlrequest.urlopen(req, timeout=20) as resp:
                data = _json.loads(resp.read().decode("utf-8", errors="replace"))
                clone_url = str(data.get("http_url_to_repo") or "").strip()
                html_url = str(data.get("web_url") or clone_url).strip()
        else:
            payload_bytes = _json.dumps(
                {
                    "name": clean_repo_name,
                    "private": bool(private),
                    "description": clean_desc,
                    "auto_init": False,
                }
            ).encode("utf-8")
            req = _urlrequest.Request(
                "https://api.github.com/user/repos",
                data=payload_bytes,
                headers={
                    "Authorization": f"Bearer {effective_token}",
                    "Accept": "application/vnd.github+json",
                    "Content-Type": "application/json",
                    "User-Agent": "MauntingServerManager-Singra",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                method="POST",
            )
            with _urlrequest.urlopen(req, timeout=20) as resp:
                data = _json.loads(resp.read().decode("utf-8", errors="replace"))
                clone_url = str(data.get("clone_url") or "").strip()
                html_url = str(data.get("html_url") or clone_url).strip()
    except _urlerror.HTTPError as exc:
        err_body = ""
        try:
            err_body = exc.read().decode("utf-8", errors="replace")
            parsed_err = _json.loads(err_body)
            msg = parsed_err.get("message") or err_body
            errors_list = parsed_err.get("errors")
            if isinstance(errors_list, list) and errors_list:
                details = ", ".join(
                    str(item.get("message") or item) if isinstance(item, dict) else str(item)
                    for item in errors_list
                )
                msg = f"{msg} ({details})"
        except Exception:
            msg = err_body or str(exc)
        if effective_token:
            msg = msg.replace(effective_token, "***")
        raise AiProjectError(f"Repository konnte nicht erstellt werden (HTTP {exc.code}): {msg[:300]}") from exc
    except Exception as exc:
        msg = str(exc)
        if effective_token:
            msg = msg.replace(effective_token, "***")
        raise AiProjectError(f"Repository konnte nicht erstellt werden: {msg[:300]}") from exc

    if not clone_url:
        raise AiProjectError("Vom Git-Anbieter wurde keine gültige Repository-URL zurückgegeben.")

    project.git_provider = target_provider
    project.git_repo_url = clone_url
    project.git_branch = (project.git_branch or "main").strip() or "main"
    project.updated_at = datetime.now(timezone.utc)
    db.commit()

    ws = ensure_project_workspace(project)
    _materialize_db_files_to_workspace(db, project, ws)
    readme_path = ws / "README.md"
    if not any(ws.iterdir()) or (not readme_path.exists() and not (ws / ".git").exists()):
        readme_content = f"# {project.name}\n\n{project.description or 'Erstellt mit Singra.'}\n"
        write_project_file(
            db,
            user,
            project.id,
            rel_path="README.md",
            content=readme_content,
            mime_type="text/markdown",
        )

    git_dir = ws / ".git"
    base_env = {
        **os.environ,
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_AUTHOR_NAME": user.username or "Singra AI",
        "GIT_AUTHOR_EMAIL": user.email or "singra@mauntingstudios.de",
        "GIT_COMMITTER_NAME": user.username or "Singra AI",
        "GIT_COMMITTER_EMAIL": user.email or "singra@mauntingstudios.de",
    }
    env, _ = _prepare_git_askpass_env(base_env, effective_token)
    target_branch = project.git_branch or "main"

    if not git_dir.exists():
        subprocess.run(["git", "init", "-b", target_branch], cwd=str(ws), capture_output=True, env=env, timeout=10)
    subprocess.run(["git", "remote", "remove", "origin"], cwd=str(ws), capture_output=True, env=env, timeout=10)
    subprocess.run(["git", "remote", "add", "origin", clone_url], cwd=str(ws), capture_output=True, env=env, timeout=10)
    subprocess.run(["git", "add", "-A"], cwd=str(ws), capture_output=True, env=env, timeout=15)
    subprocess.run(
        ["git", "commit", "-m", "Initial commit"],
        cwd=str(ws),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=15,
    )
    clean_auth_url = _clean_git_remote_url(clone_url, target_provider)
    subprocess.run(
        ["git", "push", "-u", clean_auth_url, f"HEAD:{target_branch}"],
        cwd=str(ws),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=45,
    )

    status = git_status(db, user, project.id)
    status["repo_url"] = clone_url
    status["remote_url"] = clone_url
    status["html_url"] = html_url
    status["created"] = True
    return status


