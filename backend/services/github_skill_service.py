"""Sicherer Import reiner ``SKILL.md``-Anleitungen aus oeffentlichen GitHub-Repositories.

Dieses Modul laedt ausschliesslich Markdown-Skilldateien herunter — keine Hooks,
keine Skripte, keine Plugin-Wrapper. Alle fremden URLs werden streng auf
``github.com`` / ``raw.githubusercontent.com`` begrenzt (SSRF-Schutz, keine
Redirects, gestreamtes Groessenlimit) und auf UTF-8 sowie Zugangsdaten geprueft.
"""

from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote, unquote, urlparse

import httpx
from fastapi import HTTPException

from services.ai_redaction import enthaelt_zugangsdaten
from services.ai_skill_service import (
    MAX_BODY_CHARS,
    MAX_DESCRIPTION_CHARS,
    MAX_NAME_CHARS,
    parse_skill_frontmatter,
)

logger = logging.getLogger(__name__)

GITHUB_FETCH_TIMEOUT_SECONDS = 10.0
MAX_RAW_MARKDOWN_BYTES = 32_768
MAX_API_JSON_BYTES = 2_097_152
MAX_CANDIDATE_SKILLS = 8
_GITHUB_USER_AGENT = "MauntingServerManager-SkillImport/1.0"

_OWNER_REPO_RE = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_REF_RE = re.compile(r"^[A-Za-z0-9_./-]{1,120}$")
_FORBIDDEN_SEGMENT_CHARS = ("/", "\\", "?", "#", "\x00")


@dataclass(frozen=True)
class GitHubSkillTarget:
    owner: str
    repo: str
    ref: str | None
    subpath: str
    kind: str  # "repo" | "tree" | "blob" | "raw"

    @property
    def repo_slug(self) -> str:
        return f"{self.owner}/{self.repo}"


def _clean_segment(segment: str) -> str:
    # Zweifach pruefen (roh und dekodiert), damit %3F/%23/%2F..%2F keine Query-,
    # Fragment- oder Pfad-Traversal-Injektion auf raw.githubusercontent.com ausloest.
    decoded = unquote(segment).strip()
    if (
        not decoded
        or decoded in {".", ".."}
        or ".." in decoded
        or any(ch in decoded for ch in _FORBIDDEN_SEGMENT_CHARS)
    ):
        raise HTTPException(status_code=422, detail="Ungueltiger Pfad in GitHub-Adresse")
    return decoded


def _validate_rel_path(rel_path: str) -> str:
    parts = [_clean_segment(p) for p in (rel_path or "").split("/") if p]
    if not parts:
        raise HTTPException(status_code=422, detail="Leerer Pfad in GitHub-Adresse")
    return "/".join(parts)


def parse_github_skill_url(url: str) -> GitHubSkillTarget:
    """Prueft und zerlegt eine oeffentliche GitHub-URL streng ohne Wildcards."""
    raw = (url or "").strip()
    if not raw:
        raise HTTPException(status_code=422, detail="Bitte eine GitHub-URL angeben")

    parsed = urlparse(raw)
    if parsed.scheme != "https" or parsed.username or parsed.password:
        raise HTTPException(
            status_code=422,
            detail="Nur oeffentliche HTTPS-Adressen von github.com oder raw.githubusercontent.com sind erlaubt",
        )
    host = (parsed.hostname or "").lower()
    if host not in {"github.com", "www.github.com", "raw.githubusercontent.com"}:
        raise HTTPException(
            status_code=422,
            detail="Nur github.com oder raw.githubusercontent.com werden unterstuetzt",
        )

    parts = [_clean_segment(p) for p in parsed.path.split("/") if p]
    if len(parts) < 2:
        raise HTTPException(status_code=422, detail="GitHub-URL muss Owner und Repository enthalten")

    owner = parts[0]
    repo = parts[1][:-4] if parts[1].endswith(".git") else parts[1]
    if not _OWNER_REPO_RE.match(owner) or not _OWNER_REPO_RE.match(repo):
        raise HTTPException(status_code=422, detail="Ungueltiger GitHub-Owner oder -Repositoryname")

    if host == "raw.githubusercontent.com":
        if len(parts) < 4:
            raise HTTPException(status_code=422, detail="Raw-GitHub-URL braucht Branch und Dateipfad")
        ref = parts[2]
        if not _REF_RE.match(ref) or ".." in ref:
            raise HTTPException(status_code=422, detail="Ungueltiger Git-Ref")
        subpath = "/".join(parts[3:])
        if not subpath.lower().endswith(".md"):
            raise HTTPException(status_code=422, detail="Es duerfen nur Markdown-Dateien (.md) geladen werden")
        return GitHubSkillTarget(owner=owner, repo=repo, ref=ref, subpath=subpath, kind="raw")

    if len(parts) == 2:
        return GitHubSkillTarget(owner=owner, repo=repo, ref=None, subpath="", kind="repo")

    mode = parts[2]
    if mode not in {"tree", "blob"} or len(parts) < 4:
        raise HTTPException(
            status_code=422,
            detail="Unterstuetzt werden Repository-Startseiten sowie /tree/... oder /blob/... Links",
        )
    ref = parts[3]
    if not _REF_RE.match(ref) or ".." in ref:
        raise HTTPException(status_code=422, detail="Ungueltiger Git-Ref")
    subpath = "/".join(parts[4:])
    if mode == "blob":
        if not subpath or not subpath.lower().endswith(".md"):
            raise HTTPException(status_code=422, detail="Direkte Datei-Links muessen auf eine .md-Datei zeigen")
        return GitHubSkillTarget(owner=owner, repo=repo, ref=ref, subpath=subpath, kind="blob")
    return GitHubSkillTarget(owner=owner, repo=repo, ref=ref, subpath=subpath, kind="tree")


def _normalize_skill_key(raw: str, fallback: str = "imported-skill") -> str:
    cleaned = re.sub(r"[^a-z0-9-]+", "-", (raw or "").strip().lower()).strip("-")
    cleaned = re.sub(r"-{2,}", "-", cleaned)[:64].strip("-")
    if len(cleaned) < 2 or not cleaned[0].isalnum():
        cleaned = re.sub(r"[^a-z0-9-]+", "-", fallback.lower()).strip("-")[:64]
    if len(cleaned) < 2:
        return "imported-skill"
    return cleaned


def _path_hint(source_path: str, repo_name: str) -> str:
    parts = [p for p in source_path.split("/") if p]
    if len(parts) >= 2 and parts[-1].lower() == "skill.md":
        return parts[-2]
    if parts:
        stem = parts[-1].rsplit(".", 1)[0]
        if stem.lower() != "skill":
            return stem
    return repo_name


def _parse_skill_markdown(
    markdown_text: str,
    *,
    source_path: str,
    repo_name: str,
) -> dict[str, Any]:
    raw = (markdown_text or "").strip()
    if not raw:
        raise HTTPException(status_code=422, detail="Die Skill-Datei ist leer")

    frontmatter = parse_skill_frontmatter(raw)
    if frontmatter is not None:
        meta, body = frontmatter
    else:
        meta, body = {}, raw

    folder_hint = _path_hint(source_path, repo_name)
    raw_name = str(meta.get("name") or "").strip()
    if not raw_name:
        for line in body.splitlines():
            stripped = line.strip()
            if stripped.startswith("#"):
                raw_name = stripped.lstrip("#").strip()
                break
        if not raw_name:
            raw_name = folder_hint

    raw_desc = str(meta.get("description") or "").strip()
    if not raw_desc:
        paragraphs = [
            p.strip()
            for p in body.split("\n\n")
            if p.strip() and not p.strip().startswith("#") and not p.strip().startswith("```")
        ]
        raw_desc = " ".join((paragraphs[0] if paragraphs else raw_name).splitlines()).strip()

    name = " ".join(raw_name.splitlines()).strip()[:MAX_NAME_CHARS]
    description = " ".join(raw_desc.splitlines()).strip()[:MAX_DESCRIPTION_CHARS]
    skill_key = _normalize_skill_key(raw_name, fallback=folder_hint)

    truncated = False
    if len(body) > MAX_BODY_CHARS:
        body = body[: MAX_BODY_CHARS - 20].rstrip() + "\n...[gekuerzt]"
        truncated = True

    if not name or not description or not body:
        raise HTTPException(status_code=422, detail="Skill-Datei enthaelt keinen verwertbaren Inhalt")
    for field_name, value in (("Name", name), ("Beschreibung", description), ("Text", body)):
        if enthaelt_zugangsdaten(value):
            raise HTTPException(
                status_code=422,
                detail=f"Import abgelehnt: {field_name} der Skill-Datei enthaelt Zugangsdaten",
            )

    return {
        "skill_key": skill_key,
        "name": name,
        "description": description,
        "body": body,
        "truncated": truncated,
        "source_path": source_path,
    }


def _skill_path_priority(path: str) -> tuple[int, str]:
    lower = path.lower()
    if lower == "skill.md":
        return (0, lower)
    if lower.startswith("skills/") and lower.endswith("/skill.md"):
        return (1, lower)
    if not any(seg.startswith(".") for seg in lower.split("/")):
        return (2, lower)
    return (3, lower)


def _github_get_bytes(client: httpx.Client, url: str, *, max_bytes: int) -> bytes:
    """Laedt eine GitHub-Ressource gestreamt bis maximal ``max_bytes`` ohne Weiterleitungen."""
    try:
        stream_ctx = client.stream("GET", url, follow_redirects=False)
    except AttributeError:
        # Fallback fuer einfache Test-Mocks, die nur client.get patchen.
        try:
            response = client.get(url, follow_redirects=False)
        except httpx.HTTPError as exc:
            logger.warning("GitHub-Abruf fehlgeschlagen (%s): %s", url, type(exc).__name__)
            raise HTTPException(status_code=502, detail="GitHub konnte nicht erreicht werden") from exc
        _check_github_status(response.status_code, response.text)
        raw = response.content
        if len(raw) > max_bytes:
            raise HTTPException(status_code=422, detail=f"GitHub-Antwort ueberschreitet {max_bytes} Bytes")
        return raw

    try:
        with stream_ctx as response:
            if response.status_code >= 400 or response.status_code in {301, 302, 303, 307, 308}:
                response.read()
                _check_github_status(response.status_code, response.text)
            chunks: list[bytes] = []
            total = 0
            for chunk in response.iter_bytes():
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(status_code=422, detail=f"GitHub-Antwort ueberschreitet {max_bytes} Bytes")
                chunks.append(chunk)
            return b"".join(chunks)
    except httpx.HTTPError as exc:
        logger.warning("GitHub-Abruf fehlgeschlagen (%s): %s", url, type(exc).__name__)
        raise HTTPException(status_code=502, detail="GitHub konnte nicht erreicht werden") from exc


def _check_github_status(status_code: int, body_preview: str) -> None:
    if status_code in {301, 302, 303, 307, 308}:
        raise HTTPException(status_code=422, detail="GitHub-Weiterleitungen werden aus Sicherheitsgruenden blockiert")
    if status_code == 404:
        raise HTTPException(status_code=404, detail="GitHub-Repository oder Skill-Datei nicht gefunden")
    if status_code == 403 and "rate limit" in body_preview.lower():
        raise HTTPException(status_code=429, detail="GitHub API Rate-Limit erreicht — bitte gleich erneut versuchen")
    if status_code >= 400:
        raise HTTPException(status_code=502, detail=f"GitHub antwortete mit Status {status_code}")


def fetch_github_skills(
    url: str,
    *,
    skill_path: str | None = None,
) -> dict[str, Any]:
    """Laedt passende ``SKILL.md``-Dateien aus einem GitHub-Link und filtert Beiwerk aus."""
    target = parse_github_skill_url(url)
    headers = {
        "User-Agent": _GITHUB_USER_AGENT,
        "Accept": "application/vnd.github+json",
    }
    encoded_owner = quote(target.owner, safe="")
    encoded_repo = quote(target.repo, safe="")

    with httpx.Client(timeout=GITHUB_FETCH_TIMEOUT_SECONDS, headers=headers) as client:
        ref = target.ref
        if ref is None:
            raw_meta = _github_get_bytes(
                client,
                f"https://api.github.com/repos/{encoded_owner}/{encoded_repo}",
                max_bytes=MAX_API_JSON_BYTES,
            )
            try:
                repo_meta = json.loads(raw_meta.decode("utf-8"))
            except (UnicodeDecodeError, ValueError) as exc:
                raise HTTPException(status_code=502, detail="Ungueltige Antwort von GitHub") from exc
            ref = str(repo_meta.get("default_branch") or "main")
            if not _REF_RE.match(ref) or ".." in ref:
                ref = "main"

        encoded_ref = "/".join(quote(seg, safe="") for seg in ref.split("/"))
        selected_paths: list[str]
        ignored_files_count = 0
        if target.kind in {"raw", "blob"}:
            selected_paths = [_validate_rel_path(target.subpath)]
        else:
            raw_tree = _github_get_bytes(
                client,
                f"https://api.github.com/repos/{encoded_owner}/{encoded_repo}/git/trees/{encoded_ref}?recursive=1",
                max_bytes=MAX_API_JSON_BYTES,
            )
            try:
                tree_data = json.loads(raw_tree.decode("utf-8"))
            except (UnicodeDecodeError, ValueError) as exc:
                raise HTTPException(status_code=502, detail="Ungueltige Dateibaum-Antwort von GitHub") from exc
            blobs = [
                str(entry.get("path") or "")
                for entry in (tree_data.get("tree") or [])
                if isinstance(entry, dict) and entry.get("type") == "blob"
            ]
            prefix = f"{target.subpath.rstrip('/')}/" if target.subpath else ""
            scoped_blobs = [
                p for p in blobs
                if not prefix or p == target.subpath or p.startswith(prefix)
            ]
            skill_candidates = [
                p for p in scoped_blobs
                if p.rsplit("/", 1)[-1].lower() == "skill.md"
            ]
            if not skill_candidates:
                raise HTTPException(
                    status_code=404,
                    detail=(
                        "Keine SKILL.md im angegebenen Repository-Pfad gefunden. "
                        "Falls es eine einzelne Markdown-Datei ist, gib den direkten Datei-Link an."
                    ),
                )
            skill_candidates.sort(key=_skill_path_priority)
            canonical = [
                p for p in skill_candidates if not any(seg.startswith(".") for seg in p.split("/"))
            ]
            if canonical and not skill_path:
                skill_candidates = canonical
            if skill_path:
                wanted = _validate_rel_path(skill_path.strip().lstrip("/"))
                if wanted not in skill_candidates:
                    raise HTTPException(status_code=404, detail="Gewuenschter Skill-Pfad im Repository nicht gefunden")
                selected_paths = [wanted]
            else:
                selected_paths = [_validate_rel_path(p) for p in skill_candidates[:MAX_CANDIDATE_SKILLS]]
            ignored_files_count = max(0, len(scoped_blobs) - len(selected_paths))

        skills: list[dict[str, Any]] = []
        seen_keys: set[str] = set()
        for rel_path in selected_paths:
            safe_rel = _validate_rel_path(rel_path)
            encoded_rel = "/".join(quote(seg, safe="") for seg in safe_rel.split("/"))
            raw_url = f"https://raw.githubusercontent.com/{encoded_owner}/{encoded_repo}/{encoded_ref}/{encoded_rel}"
            raw_bytes = _github_get_bytes(client, raw_url, max_bytes=MAX_RAW_MARKDOWN_BYTES)
            if b"\x00" in raw_bytes:
                raise HTTPException(status_code=422, detail=f"Skill-Datei '{safe_rel}' enthaelt Binaerdaten")
            try:
                markdown_text = raw_bytes.decode("utf-8")
            except UnicodeDecodeError as exc:
                raise HTTPException(
                    status_code=422, detail=f"Skill-Datei '{safe_rel}' ist kein gueltiges UTF-8"
                ) from exc
            parsed = _parse_skill_markdown(
                markdown_text,
                source_path=safe_rel,
                repo_name=target.repo,
            )
            if parsed["skill_key"] in seen_keys:
                ignored_files_count += 1
                continue
            seen_keys.add(parsed["skill_key"])
            parsed["source_url"] = f"https://github.com/{encoded_owner}/{encoded_repo}/blob/{encoded_ref}/{encoded_rel}"
            skills.append(parsed)

    return {
        "repo": target.repo_slug,
        "ref": ref,
        "ignored_files_count": ignored_files_count,
        "skills": skills,
    }
