from __future__ import annotations

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.orm import Session

from database import get_db
from dependencies import get_current_user, verify_csrf
from middleware.rate_limit import shop_public_rate_limit
from models import User
from schemas.news import (
    NewsCategory,
    NewsListPublicResponse,
    NewsPostAdminResponse,
    NewsPostCreate,
    NewsPostPublicResponse,
    NewsPostUpdate,
    NewsSummaryResponse,
)
from services import news_service, wallpaper_service

router = APIRouter(prefix="/api/news", tags=["news"])


def _require_news_manage(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> User:
    news_service.require_news_manage_permission(db, user)
    return user


# ── Admin-Verwaltung ─────────────────────────────────────────────────────────
# Vor den variablen `/{slug}`-Routen registrieren, damit `/api/news/admin/...`
# niemals als Slug aufgelöst wird.


@router.get("/admin/list", response_model=list[NewsPostAdminResponse])
def list_admin_news(
    db: Session = Depends(get_db),
    _: User = Depends(_require_news_manage),
) -> list[NewsPostAdminResponse]:
    return [news_service.to_admin_response(post) for post in news_service.list_admin_news(db)]


@router.post("/admin", response_model=NewsPostAdminResponse, status_code=status.HTTP_201_CREATED)
def create_admin_news(
    req: NewsPostCreate,
    db: Session = Depends(get_db),
    user: User = Depends(_require_news_manage),
    _: None = Depends(verify_csrf),
) -> NewsPostAdminResponse:
    post = news_service.create_news_post(db, req, author=user)
    return news_service.to_admin_response(post)


@router.put("/admin/{post_id}", response_model=NewsPostAdminResponse)
def update_admin_news(
    post_id: int,
    req: NewsPostUpdate,
    db: Session = Depends(get_db),
    user: User = Depends(_require_news_manage),
    _: None = Depends(verify_csrf),
) -> NewsPostAdminResponse:
    post = news_service.get_admin_news_by_id(db, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Beitrag nicht gefunden")
    updated = news_service.update_news_post(db, post, req, actor=user)
    return news_service.to_admin_response(updated)


@router.delete(
    "/admin/{post_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
def delete_admin_news(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_require_news_manage),
    _: None = Depends(verify_csrf),
) -> Response:
    post = news_service.get_admin_news_by_id(db, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Beitrag nicht gefunden")
    news_service.delete_news_post(db, post, actor=user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/admin/{post_id}/cover", response_model=NewsPostAdminResponse)
async def upload_admin_news_cover(
    post_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: User = Depends(_require_news_manage),
    _: None = Depends(verify_csrf),
) -> NewsPostAdminResponse:
    post = news_service.get_admin_news_by_id(db, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Beitrag nicht gefunden")
    raw_bytes = await file.read(wallpaper_service.MAX_WALLPAPER_BYTES + 1)
    updated = news_service.save_cover_image(db, post, raw_bytes, actor=user)
    return news_service.to_admin_response(updated)


@router.delete("/admin/{post_id}/cover", response_model=NewsPostAdminResponse)
def delete_admin_news_cover(
    post_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(_require_news_manage),
    _: None = Depends(verify_csrf),
) -> NewsPostAdminResponse:
    post = news_service.get_admin_news_by_id(db, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Beitrag nicht gefunden")
    updated = news_service.delete_cover_image(db, post, actor=user)
    return news_service.to_admin_response(updated)


def _build_cover_response(
    post,
    *,
    v: str | None,
    if_none_match: str | None,
    scope: str,
) -> Response:
    data = news_service.read_cover_bytes(post)
    if data is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cover nicht gefunden")
    etag = f'"news-cover-{post.id}-{post.cover_version or "none"}"'
    if if_none_match in (etag, f"W/{etag}"):
        return Response(status_code=status.HTTP_304_NOT_MODIFIED)
    versioned = bool(v and post.cover_version and v == post.cover_version)
    return Response(
        content=data,
        media_type="image/webp",
        headers={
            "Cache-Control": (
                f"{scope}, max-age=31536000, immutable"
                if versioned
                else f"{scope}, no-cache"
            ),
            "X-Content-Type-Options": "nosniff",
            "ETag": etag,
        },
    )


@router.get("/admin/{post_id}/cover")
def get_admin_news_cover(
    post_id: int,
    v: str | None = Query(default=None),
    if_none_match: str | None = Header(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(_require_news_manage),
) -> Response:
    """Liefert auch das Cover unveröffentlichter Entwürfe für den Admin-Editor aus."""
    post = news_service.get_admin_news_by_id(db, post_id)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cover nicht gefunden")
    return _build_cover_response(post, v=v, if_none_match=if_none_match, scope="private")


# ── Öffentliche News-Endpunkte ────────────────────────────────────────────────


@router.get(
    "",
    response_model=NewsListPublicResponse,
    dependencies=[Depends(shop_public_rate_limit)],
)
def list_public_news(
    category: NewsCategory | None = Query(default=None),
    game_type: str | None = Query(default=None, max_length=64),
    q: str | None = Query(default=None, max_length=120),
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> NewsListPublicResponse:
    items, total = news_service.list_public_news(
        db,
        category=category,
        game_type=game_type,
        q=q,
        limit=limit,
        offset=offset,
    )
    return NewsListPublicResponse(
        items=[news_service.to_public_response(item) for item in items],
        total=total,
    )


@router.get(
    "/summary",
    response_model=NewsSummaryResponse,
    dependencies=[Depends(shop_public_rate_limit)],
)
def get_public_news_summary(
    db: Session = Depends(get_db),
) -> NewsSummaryResponse:
    return news_service.get_public_summary(db)


@router.get(
    "/{slug}",
    response_model=NewsPostPublicResponse,
    dependencies=[Depends(shop_public_rate_limit)],
)
def get_public_news_detail(
    slug: str,
    db: Session = Depends(get_db),
) -> NewsPostPublicResponse:
    post = news_service.get_public_news_by_slug(db, slug)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Beitrag nicht gefunden")
    return news_service.to_public_response(post)


@router.get(
    "/{slug}/cover",
    dependencies=[Depends(shop_public_rate_limit)],
)
def get_public_news_cover(
    slug: str,
    v: str | None = Query(default=None),
    if_none_match: str | None = Header(default=None),
    db: Session = Depends(get_db),
) -> Response:
    post = news_service.get_public_news_by_slug(db, slug)
    if post is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Cover nicht gefunden")
    return _build_cover_response(post, v=v, if_none_match=if_none_match, scope="public")
