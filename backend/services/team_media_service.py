"""Team-Medien: streng isolierte Profilbilder (`avatar`) und Banner (`banner`).

Nutzt dieselbe zentrale Upload-Sanitisierung, Retention-Logik und ETag-/Cache-
Strategie wie Server-Wallpapers (`services.media_gallery_service`), haelt die
Speicherpfade und Datenbankzeilen jedoch strikt je ``(team_id, kind)`` getrennt,
sodass weder Server-Wallpapers noch Bilder fremder Teams oder Typen gemischt
werden koennen.
"""

from __future__ import annotations

import re
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from fastapi import HTTPException
from sqlalchemy.orm import Session

from config import settings
from models.team import Team
from models.team_media import TeamMedia
from services.media_gallery_service import (
    AVATAR_MAX_WIDTH,
    DEFAULT_MAX_WIDTH,
    GALLERY_RETENTION,
    MAX_MEDIA_BYTES,
    WEBP_QUALITY,
    MediaValidationError,
    apply_gallery_retention,
    resolve_scoped_dir,
    sanitize_and_compress_image,
)

TeamMediaKind = Literal["avatar", "banner"]
VALID_KINDS: frozenset[str] = frozenset(("avatar", "banner"))
_VERSION_RE = re.compile(r"^custom-(\d{1,10})$")
_PRESET_RE = re.compile(r"^[a-z0-9_-]{1,64}$")


@dataclass(frozen=True)
class TeamMediaDescriptor:
    source: str  # "custom" | "preset" | "panorama"
    url: str | None
    preset: str | None = None
    version: str | None = None


def validate_kind(kind: str) -> TeamMediaKind:
    normalized = (kind or "").strip().lower()
    if normalized not in VALID_KINDS:
        raise HTTPException(status_code=400, detail="Ungueltiger Medientyp.")
    return normalized  # type: ignore[return-value]


def validate_preset(preset: str | None) -> str | None:
    if preset is None:
        return None
    clean = preset.strip().lower()
    if not clean:
        return None
    if not _PRESET_RE.fullmatch(clean):
        raise HTTPException(status_code=422, detail="Ungueltiges Preset.")
    return clean


def team_media_root() -> Path:
    return Path(settings.team_media_dir)


def _scope_dir(team_id: int, kind: TeamMediaKind) -> Path:
    return resolve_scoped_dir(team_media_root(), str(int(team_id)), kind)


def sanitize_team_image(kind: TeamMediaKind, raw_bytes: bytes) -> bytes:
    """Prueft, desinfiziert und komprimiert hochgeladene Team-Bilder zu WebP."""
    max_width = AVATAR_MAX_WIDTH if kind == "avatar" else DEFAULT_MAX_WIDTH
    return sanitize_and_compress_image(raw_bytes, max_width=max_width, quality=WEBP_QUALITY)


def get_active_media(db: Session, team_id: int, kind: TeamMediaKind) -> TeamMedia | None:
    return (
        db.query(TeamMedia)
        .filter(
            TeamMedia.team_id == team_id,
            TeamMedia.kind == kind,
            TeamMedia.is_active.is_(True),
        )
        .order_by(TeamMedia.id.desc())
        .first()
    )


def get_active_media_map(
    db: Session, team_ids: list[int]
) -> dict[tuple[int, str], TeamMedia]:
    """Laedt aktive Medien fuer mehrere Teams in einer Abfrage."""
    if not team_ids:
        return {}
    rows = (
        db.query(TeamMedia)
        .filter(TeamMedia.team_id.in_(team_ids), TeamMedia.is_active.is_(True))
        .order_by(TeamMedia.id.desc())
        .all()
    )
    result: dict[tuple[int, str], TeamMedia] = {}
    for row in rows:
        key = (row.team_id, row.kind)
        if key not in result:
            result[key] = row
    return result


def get_gallery(db: Session, team_id: int, kind: TeamMediaKind) -> list[TeamMedia]:
    return (
        db.query(TeamMedia)
        .filter(TeamMedia.team_id == team_id, TeamMedia.kind == kind)
        .order_by(TeamMedia.created_at.desc(), TeamMedia.id.desc())
        .all()
    )


def _deactivate_all(db: Session, team_id: int, kind: TeamMediaKind) -> None:
    (
        db.query(TeamMedia)
        .filter(
            TeamMedia.team_id == team_id,
            TeamMedia.kind == kind,
            TeamMedia.is_active.is_(True),
        )
        .update({"is_active": False})
    )


def store_team_media(
    db: Session,
    *,
    team_id: int,
    kind: TeamMediaKind,
    webp_bytes: bytes,
    uploaded_by: str,
) -> TeamMedia:
    scope_dir = _scope_dir(team_id, kind)
    scope_dir.mkdir(parents=True, exist_ok=True)
    row = TeamMedia(
        team_id=team_id,
        kind=kind,
        file_name="",
        uploaded_by=(uploaded_by or "system")[:128],
        is_active=False,
    )
    db.add(row)
    db.flush()
    row.file_name = f"{kind}_{row.id}.webp"
    resolve_scoped_dir(scope_dir, row.file_name).write_bytes(webp_bytes)
    _deactivate_all(db, team_id, kind)
    row.is_active = True
    db.commit()
    apply_gallery_retention(
        db,
        rows=get_gallery(db, team_id, kind),
        scope_dir=scope_dir,
        retention=GALLERY_RETENTION,
    )
    db.refresh(row)
    return row


def set_active_media(
    db: Session, *, team_id: int, kind: TeamMediaKind, media_id: int
) -> TeamMedia:
    row = (
        db.query(TeamMedia)
        .filter(
            TeamMedia.id == media_id,
            TeamMedia.team_id == team_id,
            TeamMedia.kind == kind,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Bild nicht gefunden")
    _deactivate_all(db, team_id, kind)
    row.is_active = True
    db.commit()
    db.refresh(row)
    return row


def activate_preset(
    db: Session, *, team: Team, kind: TeamMediaKind, preset_key: str | None
) -> Team:
    validated = validate_preset(preset_key)
    _deactivate_all(db, team.id, kind)
    if kind == "avatar":
        team.avatar_preset = validated
    else:
        team.banner_preset = validated
    db.commit()
    db.refresh(team)
    return team


def reset_media(db: Session, *, team: Team, kind: TeamMediaKind) -> None:
    _deactivate_all(db, team.id, kind)
    if kind == "avatar":
        team.avatar_preset = None
    else:
        team.banner_preset = None
    db.commit()


def delete_media(
    db: Session, *, team_id: int, kind: TeamMediaKind, media_id: int
) -> bool:
    row = (
        db.query(TeamMedia)
        .filter(
            TeamMedia.id == media_id,
            TeamMedia.team_id == team_id,
            TeamMedia.kind == kind,
        )
        .first()
    )
    if row is None:
        raise HTTPException(status_code=404, detail="Bild nicht gefunden")
    was_active = bool(row.is_active)
    try:
        resolve_scoped_dir(_scope_dir(team_id, kind), row.file_name).unlink(missing_ok=True)
    except (MediaValidationError, OSError):
        pass
    db.delete(row)
    db.commit()
    return was_active


def gallery_image_bytes(
    db: Session, *, team_id: int, kind: TeamMediaKind, media_id: int
) -> bytes | None:
    row = (
        db.query(TeamMedia)
        .filter(
            TeamMedia.id == media_id,
            TeamMedia.team_id == team_id,
            TeamMedia.kind == kind,
        )
        .first()
    )
    if row is None:
        return None
    try:
        return resolve_scoped_dir(_scope_dir(team_id, kind), row.file_name).read_bytes()
    except (MediaValidationError, OSError):
        return None


def resolve_team_media(
    db: Session,
    team: Team,
    kind: TeamMediaKind,
    *,
    active_item: TeamMedia | None = None,
    active_provided: bool = False,
) -> TeamMediaDescriptor:
    active = active_item if active_provided else get_active_media(db, team.id, kind)
    if active is not None:
        return TeamMediaDescriptor(
            source="custom",
            url=f"/api/teams/{team.id}/media/{kind}/image",
            preset=None,
            version=f"custom-{active.id}",
        )
    preset = team.avatar_preset if kind == "avatar" else team.banner_preset
    if preset:
        return TeamMediaDescriptor(source="preset", url=None, preset=preset, version=None)
    fallback_source = "preset" if kind == "avatar" else "panorama"
    return TeamMediaDescriptor(source=fallback_source, url=None, preset=None, version=None)


def media_bytes_for_team(
    db: Session, *, team_id: int, kind: TeamMediaKind, version: str | None = None
) -> tuple[bytes, str] | None:
    if version is not None:
        match = _VERSION_RE.fullmatch(version or "")
        if match is None:
            raise MediaValidationError("Ungueltige Bildversion.")
        media_id = int(match.group(1))
        data = gallery_image_bytes(db, team_id=team_id, kind=kind, media_id=media_id)
        if not data:
            return None
        return data, f'"custom-{media_id}"'

    active = get_active_media(db, team_id, kind)
    if active is None:
        return None
    try:
        data = resolve_scoped_dir(_scope_dir(team_id, kind), active.file_name).read_bytes()
    except (MediaValidationError, OSError):
        return None
    if not data:
        return None
    return data, f'"custom-{active.id}"'


def cleanup_team_media_files(team_id: int) -> None:
    """Entfernt alle gespeicherten Dateien eines geloeschten Teams."""
    try:
        target = resolve_scoped_dir(team_media_root(), str(int(team_id)))
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
    except Exception:
        pass
