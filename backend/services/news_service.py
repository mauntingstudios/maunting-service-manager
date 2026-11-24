from __future__ import annotations

import ipaddress
import json
import re
import secrets
import socket
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import HTTPException, status
from sqlalchemy import desc, func, or_
from sqlalchemy.orm import Session

from config import settings
from models import NewsPost, User
from schemas.news import (
    MAX_NEWS_SOURCES,
    NEWS_CATEGORIES,
    NewsPostAdminResponse,
    NewsPostCreate,
    NewsPostPublicResponse,
    NewsPostUpdate,
    NewsSourceItem,
    NewsSummaryResponse,
    validate_https_source_url,
)
from services import audit_service, permission_service, wallpaper_service
from services.media_gallery_service import MediaValidationError, resolve_scoped_dir

_UMLAUT_MAP = str.maketrans({
    "ä": "ae",
    "ö": "oe",
    "ü": "ue",
    "ß": "ss",
})

_NON_SLUG_RE = re.compile(r"[^a-z0-9]+")


def covers_dir() -> Path:
    if (
        settings.news_covers_dir == "/opt/msm/news-covers"
        and settings.wallpaper_dir != "/opt/msm/wallpapers"
    ):
        return Path(settings.wallpaper_dir).parent / "news-covers"
    return Path(settings.news_covers_dir)


def has_news_manage_permission(db: Session, user: User) -> bool:
    return any(
        permission_service.has_global_permission(db, user, key)
        for key in ("panel.news.manage", "panel.settings.write", "shop.write")
    )


def require_news_manage_permission(db: Session, user: User) -> None:
    if not has_news_manage_permission(db, user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Fehlende Berechtigung für Neuigkeiten",
        )


def slugify_news_title(text: str) -> str:
    lowered = (text or "").strip().lower().translate(_UMLAUT_MAP)
    cleaned = _NON_SLUG_RE.sub("-", lowered).strip("-")
    if not cleaned:
        return "news"
    return cleaned[:120].rstrip("-") or "news"


def ensure_unique_slug(
    db: Session,
    base_slug: str,
    *,
    exclude_id: int | None = None,
) -> str:
    candidate_base = slugify_news_title(base_slug)
    suffix = 1
    while True:
        candidate = (
            candidate_base
            if suffix == 1
            else f"{candidate_base[:110].rstrip('-')}-{suffix}"
        )
        query = db.query(NewsPost.id).filter(NewsPost.slug == candidate)
        if exclude_id is not None:
            query = query.filter(NewsPost.id != exclude_id)
        if query.first() is None:
            return candidate
        suffix += 1


def parse_sources(raw_json: str | None) -> list[NewsSourceItem]:
    if not raw_json:
        return []
    try:
        data = json.loads(raw_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, list):
        return []
    items: list[NewsSourceItem] = []
    for entry in data[:MAX_NEWS_SOURCES]:
        if not isinstance(entry, dict):
            continue
        title = str(entry.get("title") or "").strip()
        url_raw = str(entry.get("url") or "").strip()
        if not title or not url_raw:
            continue
        try:
            url = validate_https_source_url(url_raw)
        except ValueError:
            continue
        items.append(NewsSourceItem(title=title[:160], url=url))
    return items


def serialize_sources(items: list[NewsSourceItem] | list[dict] | None) -> str | None:
    if not items:
        return None
    normalized: list[dict[str, str]] = []
    for entry in items[:MAX_NEWS_SOURCES]:
        if isinstance(entry, NewsSourceItem):
            normalized.append({"title": entry.title, "url": entry.url})
        elif isinstance(entry, dict):
            parsed = NewsSourceItem(
                title=str(entry.get("title") or ""),
                url=str(entry.get("url") or ""),
            )
            normalized.append({"title": parsed.title, "url": parsed.url})
    return json.dumps(normalized, ensure_ascii=False) if normalized else None


def cover_url_for(post: NewsPost, *, admin: bool = False) -> str | None:
    if not post.cover_image_filename:
        return None
    base = (
        f"/api/news/admin/{post.id}/cover"
        if admin
        else f"/api/news/{post.slug}/cover"
    )
    if post.cover_version:
        return f"{base}?v={post.cover_version}"
    return base


def _as_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def to_public_response(post: NewsPost) -> NewsPostPublicResponse:
    return NewsPostPublicResponse(
        slug=post.slug,
        title=post.title,
        summary=post.summary or "",
        content_markdown=post.content_markdown,
        category=post.category,
        related_game_type=post.related_game_type,
        sources=parse_sources(post.sources_json),
        cover_url=cover_url_for(post),
        is_pinned=bool(post.is_pinned),
        published_at=_as_utc(post.published_at),
        author_display_name=post.author_display_name,
        created_at=_as_utc(post.created_at) or datetime.now(timezone.utc),
        updated_at=_as_utc(post.updated_at) or datetime.now(timezone.utc),
    )


def to_admin_response(post: NewsPost) -> NewsPostAdminResponse:
    public = to_public_response(post).model_dump()
    public["cover_url"] = cover_url_for(post, admin=True)
    return NewsPostAdminResponse(
        **public,
        id=post.id,
        is_published=bool(post.is_published),
        cover_version=post.cover_version,
    )


def _public_news_query(db: Session, *, now: datetime | None = None):
    aktuell = now or datetime.now(timezone.utc)
    return db.query(NewsPost).filter(
        NewsPost.is_published.is_(True),
        or_(NewsPost.published_at.is_(None), NewsPost.published_at <= aktuell),
    )


def list_public_news(
    db: Session,
    *,
    category: str | None = None,
    game_type: str | None = None,
    q: str | None = None,
    limit: int = 20,
    offset: int = 0,
) -> tuple[list[NewsPost], int]:
    query = _public_news_query(db)
    if category and category in NEWS_CATEGORIES:
        query = query.filter(NewsPost.category == category)
    if game_type:
        query = query.filter(NewsPost.related_game_type == game_type.strip().lower())
    if q and q.strip():
        needle = f"%{q.strip()}%"
        query = query.filter(
            or_(
                NewsPost.title.ilike(needle),
                NewsPost.summary.ilike(needle),
                NewsPost.content_markdown.ilike(needle),
            )
        )
    total = int(query.count())
    items = (
        query.order_by(
            desc(NewsPost.is_pinned),
            desc(func.coalesce(NewsPost.published_at, NewsPost.created_at)),
            desc(NewsPost.id),
        )
        .offset(max(0, offset))
        .limit(max(1, min(limit, 100)))
        .all()
    )
    return items, total


def get_public_summary(db: Session) -> NewsSummaryResponse:
    base = _public_news_query(db)
    count = int(base.count())
    latest = (
        base.order_by(
            desc(func.coalesce(NewsPost.published_at, NewsPost.created_at)),
            desc(NewsPost.id),
        )
        .first()
    )
    latest_dt = (
        _as_utc(latest.published_at or latest.created_at) if latest is not None else None
    )
    return NewsSummaryResponse(published_count=count, latest_published_at=latest_dt)


def get_public_news_by_slug(db: Session, slug: str) -> NewsPost | None:
    clean = (slug or "").strip().lower()
    if not clean:
        return None
    return _public_news_query(db).filter(NewsPost.slug == clean).first()


def list_admin_news(db: Session) -> list[NewsPost]:
    return (
        db.query(NewsPost)
        .order_by(desc(NewsPost.is_pinned), desc(NewsPost.updated_at), desc(NewsPost.id))
        .all()
    )


def get_admin_news_by_id(db: Session, post_id: int) -> NewsPost | None:
    return db.query(NewsPost).filter(NewsPost.id == post_id).first()


def _audit_news(
    db: Session,
    *,
    actor_id: int | None,
    action: str,
    post: NewsPost,
    details: dict | None = None,
) -> None:
    if actor_id is None:
        return
    audit_service.record_privileged_action(
        db,
        user_id=actor_id,
        action=action,
        target_type="news_post",
        target_id=post.id,
        details={"slug": post.slug, "title": post.title, **(details or {})},
        commit=False,
    )


def create_news_post(
    db: Session,
    data: NewsPostCreate,
    *,
    author: User | None = None,
) -> NewsPost:
    now = datetime.now(timezone.utc)
    slug = ensure_unique_slug(db, data.slug or data.title)
    published_at = _as_utc(data.published_at)
    if data.is_published and published_at is None:
        published_at = now
    display_name = data.author_display_name
    if not display_name and author is not None:
        display_name = (author.username or "").strip()[:120] or None

    post = NewsPost(
        slug=slug,
        title=data.title,
        summary=data.summary,
        content_markdown=data.content_markdown,
        category=data.category,
        related_game_type=data.related_game_type,
        sources_json=serialize_sources(data.sources),
        is_published=bool(data.is_published),
        is_pinned=bool(data.is_pinned),
        published_at=published_at,
        author_user_id=author.id if author is not None else None,
        author_display_name=display_name,
        created_at=now,
        updated_at=now,
    )
    db.add(post)
    db.flush()
    _audit_news(
        db,
        actor_id=author.id if author is not None else None,
        action="news.post.created",
        post=post,
        details={"is_published": post.is_published, "category": post.category},
    )
    db.commit()
    db.refresh(post)
    return post


def update_news_post(
    db: Session,
    post: NewsPost,
    data: NewsPostUpdate,
    *,
    actor: User | None = None,
) -> NewsPost:
    fields = data.model_fields_set
    if "title" in fields and data.title is not None:
        post.title = data.title
    if "slug" in fields:
        if data.slug:
            post.slug = ensure_unique_slug(db, data.slug, exclude_id=post.id)
        elif "title" in fields and data.title is not None:
            post.slug = ensure_unique_slug(db, data.title, exclude_id=post.id)
    if "summary" in fields and data.summary is not None:
        post.summary = data.summary
    if "content_markdown" in fields and data.content_markdown is not None:
        post.content_markdown = data.content_markdown
    if "category" in fields and data.category is not None:
        post.category = data.category
    if "related_game_type" in fields:
        post.related_game_type = data.related_game_type
    if "sources" in fields:
        post.sources_json = serialize_sources(data.sources or [])
    if "is_pinned" in fields and data.is_pinned is not None:
        post.is_pinned = bool(data.is_pinned)
    if "author_display_name" in fields:
        post.author_display_name = data.author_display_name
    if "published_at" in fields:
        post.published_at = _as_utc(data.published_at)
    if "is_published" in fields and data.is_published is not None:
        post.is_published = bool(data.is_published)
        if post.is_published and post.published_at is None:
            post.published_at = datetime.now(timezone.utc)

    post.updated_at = datetime.now(timezone.utc)
    _audit_news(
        db,
        actor_id=actor.id if actor is not None else None,
        action="news.post.updated",
        post=post,
        details={"is_published": post.is_published, "category": post.category},
    )
    db.commit()
    db.refresh(post)
    return post


def _delete_cover_file_only(filename: str | None) -> None:
    if not filename:
        return
    try:
        path = resolve_scoped_dir(covers_dir(), filename)
        path.unlink(missing_ok=True)
    except (MediaValidationError, OSError):
        pass


def delete_news_post(db: Session, post: NewsPost, *, actor: User | None = None) -> None:
    filename = post.cover_image_filename
    _audit_news(
        db,
        actor_id=actor.id if actor is not None else None,
        action="news.post.deleted",
        post=post,
    )
    db.delete(post)
    db.commit()
    _delete_cover_file_only(filename)


def save_cover_image(
    db: Session,
    post: NewsPost,
    raw_bytes: bytes,
    *,
    actor: User | None = None,
) -> NewsPost:
    try:
        webp = wallpaper_service.sanitize_and_compress_wallpaper(raw_bytes)
    except MediaValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message
        ) from None

    root = covers_dir()
    root.mkdir(parents=True, exist_ok=True)
    version = secrets.token_hex(6)
    filename = f"post_{post.id}_{version}.webp"
    target = resolve_scoped_dir(root, filename)
    target.write_bytes(webp)

    old_filename = post.cover_image_filename
    post.cover_image_filename = filename
    post.cover_version = version
    post.updated_at = datetime.now(timezone.utc)
    _audit_news(
        db,
        actor_id=actor.id if actor is not None else None,
        action="news.cover.uploaded",
        post=post,
        details={"version": version},
    )
    db.commit()
    db.refresh(post)
    if old_filename and old_filename != filename:
        _delete_cover_file_only(old_filename)
    return post


def delete_cover_image(
    db: Session,
    post: NewsPost,
    *,
    actor: User | None = None,
) -> NewsPost:
    old_filename = post.cover_image_filename
    post.cover_image_filename = None
    post.cover_version = None
    post.updated_at = datetime.now(timezone.utc)
    _audit_news(
        db,
        actor_id=actor.id if actor is not None else None,
        action="news.cover.deleted",
        post=post,
    )
    db.commit()
    db.refresh(post)
    _delete_cover_file_only(old_filename)
    return post


def read_cover_bytes(post: NewsPost) -> bytes | None:
    if not post.cover_image_filename:
        return None
    try:
        path = resolve_scoped_dir(covers_dir(), post.cover_image_filename)
        if not path.is_file():
            return None
        return path.read_bytes()
    except (MediaValidationError, OSError):
        return None


MAX_COVER_DOWNLOAD_BYTES = 10 * 1024 * 1024


def _unwrap_ip(
    ip: ipaddress.IPv4Address | ipaddress.IPv6Address,
) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def _is_public_ip(raw_ip: str) -> bool:
    try:
        ip = _unwrap_ip(ipaddress.ip_address(raw_ip.split("%", 1)[0]))
    except ValueError:
        return False
    return bool(
        ip.is_global
        and not ip.is_private
        and not ip.is_loopback
        and not ip.is_link_local
        and not ip.is_multicast
        and not ip.is_reserved
        and not ip.is_unspecified
    )


def validate_cover_image_url(raw_url: str) -> str:
    canonical = validate_https_source_url(raw_url)
    parsed = urllib.parse.urlparse(canonical)
    if (
        parsed.username is not None
        or parsed.password is not None
        or "@" in (parsed.netloc or "")
    ):
        raise ValueError("Titelbild-URL darf keine Zugangsdaten enthalten")
    hostname = (parsed.hostname or "").strip().lower()
    if not hostname:
        raise ValueError("Titelbild-URL enthält keinen gültigen Hostnamen")
    if hostname in ("localhost", "127.0.0.1", "::1", "0.0.0.0") or hostname.endswith(
        (".local", ".localhost", ".internal", ".lan", ".home")
    ):
        raise ValueError(
            "Lokale oder interne Adressen sind für Titelbilder nicht zulässig"
        )
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        if not _is_public_ip(hostname):
            raise ValueError(
                "Private oder lokale IP-Adressen sind für Titelbilder nicht zulässig"
            )
        return canonical

    try:
        addr_info = socket.getaddrinfo(
            hostname, None, socket.AF_UNSPEC, socket.SOCK_STREAM
        )
    except socket.gaierror:
        return canonical
    for _fam, _st, _proto, _canon, sockaddr in addr_info:
        if not _is_public_ip(str(sockaddr[0])):
            raise ValueError(
                "Titelbild-URL löst auf eine nicht-öffentliche IP-Adresse auf"
            )
    return canonical


def save_cover_from_url(
    db: Session,
    post: NewsPost,
    raw_url: str,
    *,
    actor: User | None = None,
) -> NewsPost:
    try:
        current_url = validate_cover_image_url(raw_url)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
        ) from None

    raw_bytes: bytes | None = None
    try:
        with httpx.Client(follow_redirects=False, timeout=10.0) as client:
            for _hop in range(3):
                try:
                    current_url = validate_cover_image_url(current_url)
                except ValueError as exc:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)
                    ) from None
                resp = client.get(
                    current_url,
                    headers={
                        "User-Agent": "MauntingNewsBot/1.0 (+https://mauntingstudios.com)",
                        "Accept": "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
                    },
                )
                if resp.is_redirect:
                    location = resp.headers.get("location")
                    if not location:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Ungültige Weiterleitung beim Laden des Titelbilds",
                        )
                    current_url = urllib.parse.urljoin(current_url, location)
                    continue
                if resp.status_code != 200:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Titelbild konnte nicht geladen werden (HTTP {resp.status_code})",
                    )
                content_type = (resp.headers.get("content-type") or "").lower()
                mime = content_type.split(";", 1)[0].strip()
                if mime and not mime.startswith("image/"):
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Die URL liefert kein unterstütztes Bildformat",
                    )
                content_len = resp.headers.get("content-length")
                if content_len:
                    try:
                        if int(content_len) > MAX_COVER_DOWNLOAD_BYTES:
                            raise HTTPException(
                                status_code=status.HTTP_400_BAD_REQUEST,
                                detail="Titelbild überschreitet das Limit von 10 MB",
                            )
                    except ValueError:
                        pass
                if len(resp.content) > MAX_COVER_DOWNLOAD_BYTES:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail="Titelbild überschreitet das Limit von 10 MB",
                    )
                raw_bytes = resp.content
                break
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Titelbild konnte nicht abgerufen werden: {exc}",
        ) from None

    if raw_bytes is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Zu viele Weiterleitungen beim Laden des Titelbilds",
        )
    return save_cover_image(db, post, raw_bytes, actor=actor)


def save_cover_from_game(
    db: Session,
    post: NewsPost,
    game_type: str,
    *,
    actor: User | None = None,
) -> NewsPost | None:
    bp = wallpaper_service._blueprint_for_game_type(game_type)
    app_id = wallpaper_service.artwork_app_id_for_blueprint(bp)
    if not app_id:
        return None
    pfad = wallpaper_service.ensure_steam_cached(app_id)
    if pfad is None or not pfad.is_file():
        return None
    return save_cover_image(db, post, pfad.read_bytes(), actor=actor)
