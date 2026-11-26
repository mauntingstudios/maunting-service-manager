"""Projekt-Wiki (DeepWiki) je Repository: Knowledge Cards, semantischer Index und Docs-Sync.

Speichert strukturierte Markdown-Seiten direkt im Projekt-Workspace (Standard:
``.singra/wiki/``), bettet Abschnitte ueber `ai_embedding_service` ein, koppelt
optional ein Maunting-Docs-Dokument fuer Echtzeit-Team-Bearbeitung an und stoesst
bei Bedarf einen asynchronen Hintergrund-Worker fuer Aufbau und Pflege an.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import hashlib
import json
import logging
from pathlib import Path
import posixpath
import subprocess
import threading
import time
from typing import Literal
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy.orm import Session

from models import AiProject, AiProjectWikiChunk, AiProjectWikiPage, User
from services import ai_embedding_service, ai_project_service, permission_service
from services.ai_project_errors import AiProjectError


logger = logging.getLogger(__name__)

WIKI_PERMISSION = "ai.projects.wiki"
DEFAULT_WIKI_PATH = ".singra/wiki"
WIKI_CATEGORIES: tuple[str, ...] = (
    "overview",
    "architecture",
    "module",
    "api",
    "data",
    "workflow",
    "pitfalls",
)
_CATEGORY_SORT_BASE: dict[str, int] = {
    cat: idx * 100 for idx, cat in enumerate(WIKI_CATEGORIES)
}
_CHUNK_MAX_CHARS = 1100
_MIN_SEMANTIC_SCORE = 0.22
_AUTO_UPDATE_DEBOUNCE_SECONDS = 120.0
_MAX_WORKSPACE_WIKI_BYTES = 512 * 1024

_AUTO_UPDATE_LOCK = threading.Lock()
_LAST_AUTO_UPDATE: dict[str, float] = {}


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _soft_delete_linked_doc(db: Session, doc_uid: str | None) -> None:
    if not doc_uid:
        return
    from models.doc import Document

    doc = db.query(Document).filter(Document.doc_uid == doc_uid).first()
    if doc is not None and doc.deleted_at is None:
        now = _now()
        doc.deleted_at = now
        doc.purge_after = now + timedelta(days=30)


def _current_git_head(ws: Path) -> str | None:
    if not (ws / ".git").exists():
        return None
    try:
        res = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=str(ws),
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if res.returncode == 0:
            sha = (res.stdout or "").strip()
            return sha[:64] or None
    except Exception:
        return None
    return None


def _sha256(text: str) -> str:
    return hashlib.sha256((text or "").encode("utf-8")).hexdigest()


def normalize_slug(raw: str) -> str:
    """Normalisiert einen Seitennamen zu einem dateisystem-sicheren Slug."""
    umlaut_map = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"})
    lowered = (raw or "").strip().lower().translate(umlaut_map)
    chars: list[str] = []
    prev_dash = False
    for ch in lowered:
        if ch.isalnum() and ch.isascii():
            chars.append(ch)
            prev_dash = False
        elif not prev_dash:
            chars.append("-")
            prev_dash = True
    slug = "".join(chars).strip("-")[:110]
    if not slug:
        raise AiProjectError("Wiki-Slug darf nicht leer sein")
    return slug


def normalize_wiki_path(raw: str | None) -> str:
    """Bereinigt den relativen Projektordner fuer Wiki-Dateien."""
    cleaned = (raw or DEFAULT_WIKI_PATH).replace("\\", "/").strip().strip("/")
    if not cleaned:
        return DEFAULT_WIKI_PATH
    norm = posixpath.normpath(cleaned)
    if norm in (".", "..") or norm.startswith("../") or "/../" in f"/{norm}/":
        raise AiProjectError("Ungültiger Wiki-Pfad außerhalb des Projekts")
    if norm == ".git" or norm.startswith(".git/"):
        raise AiProjectError("Wiki-Pfad darf nicht innerhalb von .git liegen")
    return norm[:120]


def _normalize_category(raw: str | None) -> str:
    clean = (raw or "module").strip().lower()
    return clean if clean in WIKI_CATEGORIES else "module"


def _normalize_source_files(raw: list[str] | str | None) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            items = parsed if isinstance(parsed, list) else [raw]
        except Exception:
            items = [part.strip() for part in raw.split(",") if part.strip()]
    else:
        items = list(raw)
    result: list[str] = []
    seen: set[str] = set()
    for item in items:
        clean = str(item or "").replace("\\", "/").strip().lstrip("/")
        if clean and clean not in seen and ".." not in clean.split("/"):
            seen.add(clean)
            result.append(clean[:240])
            if len(result) >= 40:
                break
    return result


def require_wiki_access(db: Session, user: User, project_id: str) -> AiProject:
    """Prueft Projektzugriff und die Berechtigung ``ai.projects.wiki``."""
    if not permission_service.has_global_permission(db, user, WIKI_PERMISSION):
        raise AiProjectError("Für das Projekt-Wiki wird die Berechtigung ai.projects.wiki benötigt")
    return ai_project_service.get_project(db, user, project_id)


def _serialize_frontmatter(
    *,
    title: str,
    category: str,
    summary: str,
    source_files: list[str],
    markdown: str,
) -> str:
    header = "\n".join(
        [
            "---",
            f"title: {json.dumps(title, ensure_ascii=False)}",
            f"category: {json.dumps(category, ensure_ascii=False)}",
            f"summary: {json.dumps(summary, ensure_ascii=False)}",
            f"source_files: {json.dumps(source_files, ensure_ascii=False)}",
            "---",
            "",
        ]
    )
    body = (markdown or "").lstrip("\n")
    return f"{header}{body}".rstrip() + "\n"


def _parse_frontmatter(raw_text: str, fallback_slug: str) -> tuple[dict, str]:
    """Liest Frontmatter-Metadaten (JSON-Inline oder YAML-Listen) und Markdown-Inhalt."""
    text = (raw_text or "").replace("\r\n", "\n")
    meta: dict[str, object] = {
        "title": fallback_slug.replace("-", " ").title(),
        "category": "module",
        "summary": "",
        "source_files": [],
    }
    if not text.startswith("---\n"):
        return meta, text

    end_idx = text.find("\n---\n", 4)
    if end_idx == -1:
        return meta, text

    header_block = text[4:end_idx]
    body = text[end_idx + 5 :]
    active_list_key: str | None = None
    yaml_list_items: list[str] = []

    def _flush_active_list() -> None:
        nonlocal active_list_key, yaml_list_items
        if active_list_key == "source_files" and yaml_list_items:
            meta["source_files"] = _normalize_source_files(yaml_list_items)
        active_list_key = None
        yaml_list_items = []

    for line in header_block.splitlines():
        stripped = line.strip()
        if active_list_key == "source_files" and stripped.startswith("- "):
            item = stripped[2:].strip().strip("\"'")
            if item:
                yaml_list_items.append(item)
            continue
        if ":" not in line:
            _flush_active_list()
            continue
        _flush_active_list()
        key, val = line.split(":", 1)
        k = key.strip().lower()
        v = val.strip()
        if k not in ("title", "category", "summary", "source_files"):
            continue
        if k == "source_files" and not v:
            active_list_key = "source_files"
            continue
        try:
            parsed = json.loads(v)
        except Exception:
            parsed = v.strip("\"'")
        if k == "source_files":
            meta["source_files"] = _normalize_source_files(
                parsed if isinstance(parsed, list) else str(parsed)
            )
        elif k == "category":
            meta["category"] = _normalize_category(str(parsed))
        else:
            meta[k] = str(parsed or "").strip()

    _flush_active_list()
    return meta, body


def _split_markdown_chunks(title: str, markdown: str) -> list[tuple[str, str]]:
    """Teilt eine Wiki-Seite strukturell an Ueberschriften in semantische Abschnitte."""
    lines = (markdown or "").splitlines()
    sections: list[tuple[str, list[str]]] = []
    current_heading = title
    buffer: list[str] = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith("#"):
            hashes = len(stripped) - len(stripped.lstrip("#"))
            if 1 <= hashes <= 3 and len(stripped) > hashes and stripped[hashes] == " ":
                if any(part.strip() for part in buffer):
                    sections.append((current_heading, buffer))
                current_heading = stripped[hashes + 1 :].strip()[:240] or title
                buffer = []
                continue
        buffer.append(line)
    if any(part.strip() for part in buffer):
        sections.append((current_heading, buffer))

    if not sections:
        return [(title, (markdown or title)[:_CHUNK_MAX_CHARS])]

    chunks: list[tuple[str, str]] = []
    for heading, sec_lines in sections:
        text = "\n".join(sec_lines).strip()
        if not text:
            continue
        while len(text) > _CHUNK_MAX_CHARS:
            cut = text.rfind("\n", 0, _CHUNK_MAX_CHARS)
            if cut < _CHUNK_MAX_CHARS // 2:
                cut = _CHUNK_MAX_CHARS
            chunks.append((heading, text[:cut].strip()))
            text = text[cut:].strip()
        if text:
            chunks.append((heading, text))
    return chunks or [(title, (markdown or title)[:_CHUNK_MAX_CHARS])]


def _reindex_page_chunks(db: Session, page: AiProjectWikiPage) -> None:
    """Erstellt Chunks und Embeddings fuer eine einzelne Wiki-Seite neu."""
    db.query(AiProjectWikiChunk).filter(AiProjectWikiChunk.page_id == page.id).delete()
    raw_chunks = _split_markdown_chunks(page.title, page.content_markdown)
    embed_inputs = [
        f"{page.title} — {heading}\n{page.summary}\n{body}".strip()
        for heading, body in raw_chunks
    ]
    kodierung = ai_embedding_service.encode(embed_inputs, db=db) if embed_inputs else None

    for idx, (heading, body) in enumerate(raw_chunks):
        vec_bytes: bytes | None = None
        model_tag: str | None = None
        if kodierung is not None and idx < len(kodierung.vektoren):
            vec_bytes = ai_embedding_service.vektor_zu_bytes(kodierung.vektoren[idx])
            model_tag = kodierung.modell[:64]
        db.add(
            AiProjectWikiChunk(
                page_id=page.id,
                project_id=page.project_id,
                heading=heading[:240],
                content=body,
                embedding=vec_bytes,
                embedding_model=model_tag,
                chunk_index=idx,
            )
        )
    db.flush()


def _serialize_page_summary(page: AiProjectWikiPage) -> dict:
    return {
        "id": page.id,
        "slug": page.slug,
        "title": page.title,
        "category": page.category,
        "summary": page.summary,
        "file_path": page.file_path,
        "doc_uid": page.doc_uid,
        "source_files": _normalize_source_files(page.source_files_json),
        "sort_order": page.sort_order,
        "updated_by": page.updated_by,
        "updated_at": page.updated_at.isoformat() if page.updated_at else None,
    }


def _serialize_page_detail(page: AiProjectWikiPage) -> dict:
    return {
        **_serialize_page_summary(page),
        "content_markdown": page.content_markdown,
        "content_hash": page.content_hash,
    }


def _docs_collab_available(db: Session, user: User) -> bool:
    from services.docs_collab_service import DocsCollabService

    return bool(
        DocsCollabService.module_enabled()
        and permission_service.has_global_permission(db, user, "docs.use")
    )


def get_wiki_overview(db: Session, user: User, project_id: str) -> dict:
    """Liefert Status, Konfiguration und Knowledge-Cards-Uebersicht des Projekt-Wikis."""
    project = require_wiki_access(db, user, project_id)
    if project.wiki_status in ("generating", "updating"):
        from services import ai_worker_service

        if ai_worker_service.aktiver_auftrag_im_projekt(db, project.id) is None:
            project.wiki_status = "idle"
            db.commit()
    pages = (
        db.query(AiProjectWikiPage)
        .filter(AiProjectWikiPage.project_id == project.id)
        .all()
    )
    pages.sort(key=lambda p: (p.sort_order, (p.title or "").lower()))
    return {
        "project_id": project.id,
        "wiki_enabled": bool(project.wiki_enabled),
        "wiki_auto_update": bool(project.wiki_auto_update),
        "wiki_path": project.wiki_path or DEFAULT_WIKI_PATH,
        "wiki_status": project.wiki_status or "idle",
        "wiki_last_indexed_commit": project.wiki_last_indexed_commit,
        "wiki_last_updated_at": (
            project.wiki_last_updated_at.isoformat() if project.wiki_last_updated_at else None
        ),
        "wiki_last_error": project.wiki_last_error,
        "docs_collab_available": _docs_collab_available(db, user),
        "git_configured": bool(project.git_repo_url),
        "page_count": len(pages),
        "pages": [_serialize_page_summary(p) for p in pages],
    }


def update_wiki_settings(
    db: Session,
    user: User,
    project_id: str,
    *,
    wiki_enabled: bool | None = None,
    wiki_auto_update: bool | None = None,
    wiki_path: str | None = None,
) -> dict:
    """Aktualisiert Wiki-Aktivierung, automatische Hintergrundpflege und Ablagepfad."""
    project = require_wiki_access(db, user, project_id)
    if wiki_enabled is not None:
        project.wiki_enabled = bool(wiki_enabled)
    if wiki_auto_update is not None:
        project.wiki_auto_update = bool(wiki_auto_update)
    if wiki_path is not None:
        project.wiki_path = normalize_wiki_path(wiki_path)
    db.commit()
    db.refresh(project)
    return get_wiki_overview(db, user, project.id)


def get_wiki_page(db: Session, user: User, project_id: str, slug: str) -> dict:
    """Liest den Volltext einer einzelnen Wiki-Seite anhand ihres Slugs."""
    project = require_wiki_access(db, user, project_id)
    if not project.wiki_enabled:
        raise AiProjectError("Projekt-Wiki ist für dieses Projekt deaktiviert")
    clean_slug = normalize_slug(slug)
    page = (
        db.query(AiProjectWikiPage)
        .filter(AiProjectWikiPage.project_id == project.id, AiProjectWikiPage.slug == clean_slug)
        .first()
    )
    if page is None:
        raise AiProjectError(f"Wiki-Seite '{clean_slug}' nicht gefunden")
    return _serialize_page_detail(page)


def upsert_wiki_page(
    db: Session,
    user: User,
    project_id: str,
    *,
    slug: str,
    title: str,
    category: str = "module",
    summary: str = "",
    markdown: str = "",
    source_files: list[str] | None = None,
    updated_by: str = "user",
    write_workspace_file: bool = True,
    sort_order: int | None = None,
    require_enabled: bool = True,
    unlink_stale_doc: bool = True,
) -> dict:
    """Speichert oder aktualisiert eine Wiki-Seite inkl. Workspace-Datei und Vektor-Chunks."""
    project = require_wiki_access(db, user, project_id)
    if require_enabled and not project.wiki_enabled:
        raise AiProjectError("Projekt-Wiki ist für dieses Projekt deaktiviert")
    clean_slug = normalize_slug(slug)
    clean_title = (title or clean_slug).strip()[:200]
    if not clean_title:
        raise AiProjectError("Seitentitel darf nicht leer sein")
    clean_cat = _normalize_category(category)
    clean_summary = (summary or "").strip()[:500]
    clean_sources = _normalize_source_files(source_files)
    clean_body = (markdown or "").strip()
    wiki_dir = normalize_wiki_path(project.wiki_path)
    rel_file_path = f"{wiki_dir}/{clean_slug}.md"

    serialized_file = _serialize_frontmatter(
        title=clean_title,
        category=clean_cat,
        summary=clean_summary,
        source_files=clean_sources,
        markdown=clean_body,
    )
    new_hash = _sha256(serialized_file)

    page = (
        db.query(AiProjectWikiPage)
        .filter(AiProjectWikiPage.project_id == project.id, AiProjectWikiPage.slug == clean_slug)
        .first()
    )
    if page is None:
        default_order = _CATEGORY_SORT_BASE.get(clean_cat, 200)
        page = AiProjectWikiPage(
            id=str(uuid4()),
            project_id=project.id,
            slug=clean_slug,
            title=clean_title,
            category=clean_cat,
            summary=clean_summary,
            file_path=rel_file_path,
            source_files_json=json.dumps(clean_sources, ensure_ascii=False),
            content_markdown=clean_body,
            content_hash=new_hash,
            sort_order=default_order if sort_order is None else int(sort_order),
            updated_by=updated_by[:24],
        )
        db.add(page)
        db.flush()
    else:
        previous_hash = page.content_hash
        page.title = clean_title
        page.category = clean_cat
        page.summary = clean_summary
        page.file_path = rel_file_path
        page.source_files_json = json.dumps(clean_sources, ensure_ascii=False)
        page.content_markdown = clean_body
        page.content_hash = new_hash
        if sort_order is not None:
            page.sort_order = int(sort_order)
        if unlink_stale_doc and page.doc_uid and previous_hash != new_hash:
            _soft_delete_linked_doc(db, page.doc_uid)
            page.doc_uid = None
        page.updated_by = updated_by[:24]
        page.updated_at = _now()

    if write_workspace_file:
        ai_project_service.write_project_file(
            db,
            user,
            project.id,
            rel_file_path,
            serialized_file,
            mime_type="text/markdown",
        )

    _reindex_page_chunks(db, page)
    project.wiki_last_updated_at = _now()
    project.wiki_last_error = None
    db.commit()
    db.refresh(page)
    return _serialize_page_detail(page)


def delete_wiki_page(db: Session, user: User, project_id: str, slug: str) -> dict:
    """Loescht eine Wiki-Seite samt Chunks, verknuepftem Docs-Entwurf und Workspace-Datei."""
    project = require_wiki_access(db, user, project_id)
    clean_slug = normalize_slug(slug)
    page = (
        db.query(AiProjectWikiPage)
        .filter(AiProjectWikiPage.project_id == project.id, AiProjectWikiPage.slug == clean_slug)
        .first()
    )
    if page is None:
        raise AiProjectError(f"Wiki-Seite '{clean_slug}' nicht gefunden")
    rel_path = page.file_path
    _soft_delete_linked_doc(db, page.doc_uid)
    db.delete(page)
    db.flush()
    try:
        ai_project_service.delete_project_file(db, user, project.id, rel_path)
    except AiProjectError:
        pass
    db.commit()
    return {"deleted": True, "slug": clean_slug}


def sync_from_workspace(db: Session, user: User, project_id: str) -> dict:
    """Liest Markdown-Dateien direkt aus dem Wiki-Ordner auf dem Dateisystem und indiziert sie."""
    project = require_wiki_access(db, user, project_id)
    if not project.wiki_enabled:
        raise AiProjectError("Projekt-Wiki ist für dieses Projekt deaktiviert")
    wiki_dir = normalize_wiki_path(project.wiki_path)
    ws = ai_project_service.ensure_project_workspace(project)
    ws_resolved = ws.resolve()
    wiki_folder = (ws_resolved / wiki_dir).resolve()
    if not wiki_folder.is_relative_to(ws_resolved):
        raise AiProjectError("Ungültiger Wiki-Pfad außerhalb des Projekt-Workspaces")

    disk_entries: list[tuple[str, str]] = []
    if wiki_folder.is_dir() and not wiki_folder.is_symlink():
        for entry in sorted(wiki_folder.iterdir(), key=lambda p: p.name.lower()):
            if entry.is_symlink() or not entry.is_file():
                continue
            if not entry.name.lower().endswith(".md"):
                continue
            resolved_entry = entry.resolve()
            if not resolved_entry.is_relative_to(wiki_folder):
                continue
            try:
                if resolved_entry.stat().st_size > _MAX_WORKSPACE_WIKI_BYTES:
                    continue
                content_text = resolved_entry.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            stem = entry.name[:-3]
            try:
                slug = normalize_slug(stem)
            except AiProjectError:
                continue
            disk_entries.append((slug, content_text))

    seen_slugs: set[str] = set()
    updated = 0
    for slug, content_text in disk_entries:
        seen_slugs.add(slug)
        file_hash = _sha256(content_text)
        existing = (
            db.query(AiProjectWikiPage)
            .filter(AiProjectWikiPage.project_id == project.id, AiProjectWikiPage.slug == slug)
            .first()
        )
        if existing is not None and existing.content_hash == file_hash:
            continue
        meta, body = _parse_frontmatter(content_text, slug)
        upsert_wiki_page(
            db,
            user,
            project.id,
            slug=slug,
            title=str(meta["title"]),
            category=str(meta["category"]),
            summary=str(meta["summary"]),
            markdown=body,
            source_files=list(meta["source_files"]),  # type: ignore[arg-type]
            updated_by="workspace",
            write_workspace_file=False,
        )
        updated += 1

    orphans = (
        db.query(AiProjectWikiPage)
        .filter(AiProjectWikiPage.project_id == project.id)
        .all()
    )
    removed = 0
    for row in orphans:
        if row.slug not in seen_slugs:
            _soft_delete_linked_doc(db, row.doc_uid)
            try:
                ai_project_service.delete_project_file(db, user, project.id, row.file_path)
            except AiProjectError:
                pass
            db.delete(row)
            removed += 1
    if removed:
        db.commit()

    return {"synced_files": len(disk_entries), "updated": updated, "removed": removed}


def search_wiki(
    db: Session,
    user: User,
    project_id: str,
    query: str,
    *,
    limit: int = 5,
    commit_on_reindex: bool = True,
) -> list[dict]:
    """Durchsucht Projekt-Wiki-Abschnitte semantisch ueber lokale bzw. Fallback-Embeddings."""
    project = require_wiki_access(db, user, project_id)
    if not project.wiki_enabled:
        return []
    clean_q = (query or "").strip()
    if not clean_q:
        return []
    top_k = max(1, min(15, int(limit)))

    rows = (
        db.query(AiProjectWikiChunk, AiProjectWikiPage)
        .join(AiProjectWikiPage, AiProjectWikiPage.id == AiProjectWikiChunk.page_id)
        .filter(AiProjectWikiChunk.project_id == project.id)
        .all()
    )
    if not rows:
        return []

    kodierung = ai_embedding_service.encode([clean_q[:1500]], db=db)
    if kodierung is not None and len(kodierung.vektoren) > 0:
        q_vec = list(kodierung.vektoren[0])

        def _partition_rows(chunk_rows):
            matched: list[tuple[AiProjectWikiChunk, AiProjectWikiPage, object]] = []
            stale: dict[str, AiProjectWikiPage] = {}
            for chunk, page in chunk_rows:
                vec = (
                    ai_embedding_service.bytes_zu_vektor(chunk.embedding)
                    if chunk.embedding_model == kodierung.modell
                    else None
                )
                if vec is None:
                    stale[page.id] = page
                else:
                    matched.append((chunk, page, vec))
            return matched, stale

        matching_pairs, needs_reindex_pages = _partition_rows(rows)
        if needs_reindex_pages:
            for page in needs_reindex_pages.values():
                _reindex_page_chunks(db, page)
            if commit_on_reindex:
                db.commit()
            else:
                db.flush()
            rows = (
                db.query(AiProjectWikiChunk, AiProjectWikiPage)
                .join(AiProjectWikiPage, AiProjectWikiPage.id == AiProjectWikiChunk.page_id)
                .filter(AiProjectWikiChunk.project_id == project.id)
                .all()
            )
            matching_pairs, _ = _partition_rows(rows)

        if matching_pairs:
            sims = ai_embedding_service.similarity(q_vec, [p[2] for p in matching_pairs])  # type: ignore[arg-type]
            scored = []
            for (chunk, page, _), sim in zip(matching_pairs, sims):
                if sim < _MIN_SEMANTIC_SCORE:
                    continue
                scored.append((float(sim), chunk, page))
            scored.sort(key=lambda item: item[0], reverse=True)
            return [
                {
                    "slug": page.slug,
                    "title": page.title,
                    "category": page.category,
                    "heading": chunk.heading,
                    "content": chunk.content,
                    "score": round(score, 4),
                    "source_files": _normalize_source_files(page.source_files_json),
                }
                for score, chunk, page in scored[:top_k]
            ]
        return []

    # Offline-Fallback ohne verfuegbares Embedding-Modell
    tokens = [tok for tok in clean_q.lower().split() if len(tok) >= 2]
    if not tokens:
        return []
    fallback_hits: list[tuple[float, AiProjectWikiChunk, AiProjectWikiPage]] = []
    for chunk, page in rows:
        haystack = f"{page.title} {page.summary} {chunk.heading} {chunk.content}".lower()
        matches = sum(1 for tok in tokens if tok in haystack)
        if matches > 0:
            fallback_hits.append((matches / len(tokens), chunk, page))
    fallback_hits.sort(key=lambda item: item[0], reverse=True)
    return [
        {
            "slug": page.slug,
            "title": page.title,
            "category": page.category,
            "heading": chunk.heading,
            "content": chunk.content,
            "score": round(score, 4),
            "source_files": _normalize_source_files(page.source_files_json),
        }
        for score, chunk, page in fallback_hits[:top_k]
    ]


def open_page_doc(db: Session, user: User, project_id: str, slug: str) -> dict:
    """Verknuepft eine Wiki-Seite bei aktivem Maunting Docs mit einem kollaborativen Dokument."""
    project = require_wiki_access(db, user, project_id)
    if not project.wiki_enabled:
        raise AiProjectError("Projekt-Wiki ist für dieses Projekt deaktiviert")
    clean_slug = normalize_slug(slug)
    page = (
        db.query(AiProjectWikiPage)
        .filter(AiProjectWikiPage.project_id == project.id, AiProjectWikiPage.slug == clean_slug)
        .first()
    )
    if page is None:
        raise AiProjectError(f"Wiki-Seite '{clean_slug}' nicht gefunden")

    if not _docs_collab_available(db, user):
        return {"mode": "markdown", "doc_uid": None, "page": _serialize_page_detail(page)}

    from models.doc import Document
    from services.docs_collab_service import DocsCollabService
    from services.docs_service import DocsService

    created_new = False
    if page.doc_uid:
        existing_doc = db.query(Document).filter(Document.doc_uid == page.doc_uid).first()
        if existing_doc is None or existing_doc.deleted_at is not None:
            page.doc_uid = None

    if not page.doc_uid:
        created = DocsService.create_document(
            db, user, team_id=project.team_id, title=f"Wiki: {page.title}"
        )
        page.doc_uid = str(created["uid"])
        created_new = True
        db.commit()

    if created_new and page.content_markdown.strip():
        try:
            DocsCollabService.ai_edit(
                db,
                user,
                page.doc_uid,
                operation="append",
                markdown=page.content_markdown,
                summary="Wiki-Seite geladen",
            )
        except HTTPException:
            # Sidecar nicht erreichbar: leeres Temp-Dokument aufraeumen und auf Markdown-Editor fallen
            _soft_delete_linked_doc(db, page.doc_uid)
            page.doc_uid = None
            db.commit()
            return {"mode": "markdown", "doc_uid": None, "page": _serialize_page_detail(page)}

    return {"mode": "docs", "doc_uid": page.doc_uid, "page": _serialize_page_detail(page)}


def sync_page_from_doc(db: Session, user: User, project_id: str, slug: str) -> dict:
    """Uebernimmt den aktuellen Stand aus dem verknuepften Maunting-Docs-Dokument ins Wiki."""
    project = require_wiki_access(db, user, project_id)
    if not project.wiki_enabled:
        raise AiProjectError("Projekt-Wiki ist für dieses Projekt deaktiviert")
    clean_slug = normalize_slug(slug)
    page = (
        db.query(AiProjectWikiPage)
        .filter(AiProjectWikiPage.project_id == project.id, AiProjectWikiPage.slug == clean_slug)
        .first()
    )
    if page is None:
        raise AiProjectError(f"Wiki-Seite '{clean_slug}' nicht gefunden")
    if not page.doc_uid:
        return _serialize_page_detail(page)

    from services.docs_collab_service import DocsCollabService

    try:
        raw_bytes, _, _ = DocsCollabService.render(db, user, page.doc_uid, format="md")
    except HTTPException as exc:
        raise AiProjectError(f"Dokument konnte nicht synchronisiert werden: {exc.detail}") from exc

    rendered_md = raw_bytes.decode("utf-8", errors="replace").strip()
    return upsert_wiki_page(
        db,
        user,
        project.id,
        slug=page.slug,
        title=page.title,
        category=page.category,
        summary=page.summary,
        markdown=rendered_md,
        source_files=_normalize_source_files(page.source_files_json),
        updated_by="user",
        write_workspace_file=True,
        sort_order=page.sort_order,
        unlink_stale_doc=False,
    )


def commit_wiki(
    db: Session,
    user: User,
    project_id: str,
    *,
    message: str | None = None,
    push: bool = False,
) -> dict[str, object]:
    """Speichert Aenderungen im Wiki-Ordner per Git-Commit (und optional Push)."""
    project = require_wiki_access(db, user, project_id)
    if not project.wiki_enabled:
        raise AiProjectError("Projekt-Wiki ist für dieses Projekt deaktiviert")
    from services import ai_project_git

    wiki_dir = normalize_wiki_path(project.wiki_path)
    ws = ai_project_service.ensure_project_workspace(project)
    commit_msg = (message or f"docs(wiki): Projekt-Wiki aktualisiert ({project.name})").strip()
    result = ai_project_git.git_commit_and_push(
        db, user, project.id, message=commit_msg, push=push, paths=[wiki_dir]
    )
    project.wiki_last_indexed_commit = _current_git_head(ws) or project.wiki_last_indexed_commit
    project.wiki_last_updated_at = _now()
    db.commit()
    return result


def build_project_wiki_context(
    db: Session,
    user: User,
    project: AiProject,
    query: str,
) -> str | None:
    """Erstellt die kompakte Knowledge-Card-Uebersicht plus semantisch passende Treffer."""
    if not project.wiki_enabled:
        return None
    if not permission_service.has_global_permission(db, user, WIKI_PERMISSION):
        return None

    pages = (
        db.query(AiProjectWikiPage)
        .filter(AiProjectWikiPage.project_id == project.id)
        .all()
    )
    pages.sort(key=lambda p: (p.sort_order, (p.title or "").lower()))
    if not pages:
        return (
            "Projekt-Wiki ist aktiviert, enthaelt aber noch keine Knowledge Cards. "
            "Lege bei strukturellem Aufbau Karten ueber `project_workspace(action='wiki_upsert', ...)` an."
        )

    lines = [
        "Projekt-Wiki Knowledge Cards (fuer gezielte Abfragen `project_workspace(action='wiki_search' | 'wiki_read' | 'wiki_upsert')` nutzen):"
    ]
    for page in pages[:30]:
        summary_part = f" — {page.summary}" if page.summary else ""
        lines.append(f"- [{page.category}] `{page.slug}` ({page.title}){summary_part}")

    hits = search_wiki(db, user, project.id, query, limit=3, commit_on_reindex=False)
    if hits:
        lines.append("\nSemantisch passende Wiki-Abschnitte zur aktuellen Anfrage:")
        for hit in hits:
            snippet = hit["content"][:700]
            lines.append(f"### {hit['title']} :: {hit['heading']} (`{hit['slug']}`)\n{snippet}")
    return "\n".join(lines)


def trigger_wiki_worker(
    db: Session,
    user: User,
    project_id: str,
    *,
    mode: Literal["generate", "update"] = "generate",
    changed_files: list[str] | None = None,
    conversation_id: str | None = None,
) -> dict:
    """Startet einen asynchronen Hintergrund-Worker zum Aufbau oder Update des Projekt-Wikis."""
    project = require_wiki_access(db, user, project_id)
    if not permission_service.has_global_permission(db, user, "ai.background.use"):
        raise AiProjectError("Für den automatischen Wiki-Worker wird ai.background.use benötigt")

    wiki_dir = normalize_wiki_path(project.wiki_path)
    existing_pages = (
        db.query(AiProjectWikiPage)
        .filter(AiProjectWikiPage.project_id == project.id)
        .order_by(AiProjectWikiPage.sort_order.asc())
        .all()
    )
    card_index = "\n".join(
        f"- `{p.slug}` [{p.category}] {p.title} (Quellen: {p.source_files_json})"
        for p in existing_pages[:25]
    ) or "(noch keine Seiten)"

    if mode == "generate":
        auftrag = (
            f"Erstelle oder erneuere das strukturierte Projekt-Wiki fuer Projekt '{project.name}' "
            f"(project_id: {project.id}, Ablagepfad: {wiki_dir}).\n"
            "Vorgehen:\n"
            "1. Analysiere den Dateibaum mit `project_workspace(action='list_files')` und lies die "
            "zentralen Einstiegsdateien, Manifeste und Kernmodule mit `read_file`.\n"
            "2. Schreibe das Wiki einsprachig in der Sprache des Projekts — niemals zweisprachig.\n"
            "3. Strukturiere alles in 5 bis 8 klare Knowledge Cards statt in ein einziges Riesen-Dokument, "
            "jeweils ueber `project_workspace(action='wiki_upsert', project_id=..., slug=..., title=..., "
            "category=..., summary=..., content=..., source_files=[...])`.\n"
            "   Empfohlene Kategorien: `overview`, `architecture` (mit Mermaid-```mermaid```-Diagramm), "
            "`module`, `data`, `api`, `workflow`, `pitfalls`.\n"
            "4. Wenn ein wiederkehrendes Projektmuster oder wichtiger Stolperstein auffaellt, pruefe ob ein "
            "wiederverwendbarer Skill (`learn_skill`) sinnvoll ist.\n"
            f"Vorhandene Karten:\n{card_index}"
        )
        titel = f"Wiki aufbauen: {project.name}"
    else:
        changed = ", ".join(changed_files or []) or "(zuletzt geaenderte Dateien)"
        auftrag = (
            f"Pflege das Projekt-Wiki inkrementell fuer Projekt '{project.name}' "
            f"(project_id: {project.id}).\n"
            f"Geaenderte Pfade: {changed}\n"
            "Vorgehen:\n"
            "1. Lies die geaenderten Dateien mit `project_workspace(action='read_file')`.\n"
            "2. Pruefe anhand `wiki_search` / `wiki_read`, welche Knowledge Cards betroffen sind.\n"
            "3. Aktualisiere nur die betroffenen Karten (oder lege bei einem neuen Kernmodul eine neue Karte an) "
            "ueber `project_workspace(action='wiki_upsert', ...)`, in derselben Sprache wie die bestehenden Karten.\n"
            "4. Halte Erkenntnisse zu Architektur oder haeufigen Fehlerquellen knapp als Skill (`learn_skill`) fest, "
            "falls fuer das Team dauerhaft nuetzlich.\n"
            f"Vorhandene Karten:\n{card_index}"
        )
        titel = f"Wiki aktualisieren: {project.name}"

    from services import ai_worker_service
    from services.ai_action_errors import AiActionValidationError

    project.wiki_enabled = True
    project.wiki_status = "generating" if mode == "generate" else "updating"
    project.wiki_last_error = None
    db.commit()

    try:
        res = ai_worker_service.worker_start(
            db,
            user=user,
            arguments={"auftrag": auftrag, "titel": titel[:120], "kanal": "chat"},
            conversation_id=conversation_id,
            project_id=project.id,
        )
    except AiActionValidationError as exc:
        project.wiki_status = "error"
        project.wiki_last_error = str(exc)[:500]
        db.commit()
        raise AiProjectError(str(exc)) from exc

    if not res.get("started"):
        project.wiki_status = "idle"
        project.wiki_last_error = str(res.get("reason") or "")[:500] or None
        db.commit()
        return {"started": False, **res}

    return {"started": True, "wiki_status": project.wiki_status, **res}


def maybe_schedule_auto_update(
    db: Session,
    user: User,
    project: AiProject,
    *,
    changed_path: str,
    conversation_id: str | None = None,
) -> bool:
    """Stösst bei aktiviertem Auto-Update entprellt einen inkrementellen Wiki-Worker an."""
    if not project.wiki_enabled or not project.wiki_auto_update:
        return False
    wiki_dir = normalize_wiki_path(project.wiki_path)
    norm_changed = (changed_path or "").replace("\\", "/").strip().lstrip("/")
    if norm_changed == wiki_dir or norm_changed.startswith(f"{wiki_dir}/"):
        return False
    if not permission_service.has_global_permission(db, user, WIKI_PERMISSION):
        return False
    if not permission_service.has_global_permission(db, user, "ai.background.use"):
        return False

    if project.wiki_last_updated_at is not None:
        last_dt = project.wiki_last_updated_at
        if last_dt.tzinfo is None:
            last_dt = last_dt.replace(tzinfo=timezone.utc)
        if (_now() - last_dt).total_seconds() < _AUTO_UPDATE_DEBOUNCE_SECONDS:
            return False

    now_mono = time.monotonic()
    with _AUTO_UPDATE_LOCK:
        last = _LAST_AUTO_UPDATE.get(project.id, 0.0)
        if now_mono - last < _AUTO_UPDATE_DEBOUNCE_SECONDS:
            return False
        _LAST_AUTO_UPDATE[project.id] = now_mono

    try:
        res = trigger_wiki_worker(
            db,
            user,
            project.id,
            mode="update",
            changed_files=[norm_changed] if norm_changed else None,
            conversation_id=conversation_id,
        )
        return bool(res.get("started"))
    except Exception:
        logger.debug("Automatisches Wiki-Update uebersprungen project_id=%s", project.id, exc_info=True)
        return False


def on_worker_finished(db: Session, run: object, zustand: dict) -> None:
    """Fuehrt `wiki_status`, Fehlertext und Commit-Stand nach Abschluss eines Projekt-Workers nach."""
    conv_id = getattr(run, "conversation_id", None)
    if not conv_id:
        return
    from models.ai_conversation import AiConversation

    conv = db.get(AiConversation, str(conv_id))
    if conv is None or conv.kind != "worker" or not conv.project_id:
        return
    project = db.get(AiProject, conv.project_id)
    if project is None or project.wiki_status not in ("generating", "updating"):
        return

    run_status = str(getattr(run, "status", "") or "").lower()
    if run_status == "failed":
        err = (zustand or {}).get("fehler") or getattr(run, "error_message", None) or "Wiki-Worker fehlgeschlagen"
        project.wiki_status = "error"
        project.wiki_last_error = str(err)[:500]
    else:
        project.wiki_status = "idle"
        project.wiki_last_error = None
        project.wiki_last_updated_at = _now()
        try:
            ws = ai_project_service.ensure_project_workspace(project)
            sha = _current_git_head(ws)
            if sha:
                project.wiki_last_indexed_commit = sha
        except Exception:
            pass
    db.commit()
