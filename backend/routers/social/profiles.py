from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from dependencies import (
    get_current_user,
    verify_csrf,
)
from models import User
from schemas.social import (
    AchievementClaimRequest,
    AchievementClaimResponse,
    AchievementResponse,
    AchievementsOverviewResponse,
    ActivityPingRequest,
    PresenceInfo,
    PresenceSessionRequest,
    PresenceStatusRequest,
    PresenceUpdateRequest,
    UserInfoResponse,
    UserInfoUpdateRequest,
    PrivacyUpdateRequest,
    SocialProfileResponse,
    UserStatsResponse,
)
from services.achievement_service import SELBST_GEMELDET, AchievementService
from services.social_service import SocialService
from routers.social.basis import _check_social_enabled

logger = logging.getLogger(__name__)

router = APIRouter()



@router.get("/presence/me", response_model=PresenceInfo, dependencies=[Depends(_check_social_enabled)])
def get_own_presence(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return SocialService.get_presence(db, user.id)


@router.post("/presence", response_model=PresenceInfo, dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)])
def update_presence(
    req: PresenceUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Altweg: ein Client, der noch eine Zeile je Konto kennt.

    Wird auf eine Sitzung und die manuelle Wahl abgebildet. Neue Clients nutzen
    `/presence/session` und `/presence/status`.
    """
    return SocialService.update_presence(db, user.id, req.model_dump(exclude_none=True))


@router.patch(
    "/presence/status",
    response_model=PresenceInfo,
    dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)],
)
def set_presence_status(
    req: PresenceStatusRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Die Wahl des Menschen: automatisch, online, abwesend oder unsichtbar."""
    return SocialService.set_manual_status(db, user.id, req.manual_status)


@router.post(
    "/presence/session",
    response_model=PresenceInfo,
    dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)],
)
def presence_session(
    req: PresenceSessionRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Das Lebenszeichen eines Geräts. Dieselbe Zeile je Gerät, alle 45 s."""
    return SocialService.upsert_session(
        db,
        user.id,
        geraet=req.geraet,
        client=req.client,
        plattform=req.plattform,
        zustand=req.zustand,
        activity_key=req.activity_key,
        vorn=req.vorn,
    )


@router.delete(
    "/presence/session/{geraet}",
    response_model=PresenceInfo,
    dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)],
)
def presence_session_beenden(
    geraet: str,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Ein Gerät meldet sich ab; ohne das wartet die Anzeige nur die Frist ab."""
    return SocialService.delete_session(db, user.id, geraet)


@router.get(
    "/info",
    response_model=UserInfoResponse | None,
    dependencies=[Depends(_check_social_enabled)],
)
def get_own_info(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict | None:
    """Der eigene Info-Text; abgelaufene zaehlen nicht."""
    return SocialService.get_own_info(db, user.id)


@router.put(
    "/info",
    response_model=UserInfoResponse | None,
    dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)],
)
def set_own_info(
    req: UserInfoUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict | None:
    """Setzt oder loescht die Info. Leerer Text loescht sie."""
    return SocialService.set_info(
        db,
        user.id,
        text=req.text,
        visibility=req.visibility,
        dauer_sekunden=req.dauer_sekunden,
    )


@router.post("/activity/ping", dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)])
@router.post("/activity-time", dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)])
def record_activity_ping(
    req: ActivityPingRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return AchievementService.record_activity_time(
        db, user.id, category=req.category, seconds=req.seconds
    )


@router.patch("/privacy", dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)])
def update_privacy_setting(
    req: PrivacyUpdateRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    updated = SocialService.update_privacy(db, user.id, req.privacy)
    return {"ok": True, "social_privacy": updated}


@router.get("/achievements", response_model=AchievementsOverviewResponse, dependencies=[Depends(_check_social_enabled)])
def get_own_achievements(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return AchievementService.get_achievements_overview(db, user.id)


@router.get("/achievements/list", response_model=list[AchievementResponse], dependencies=[Depends(_check_social_enabled)])
def get_own_achievements_list(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> list[dict]:
    return AchievementService.get_user_achievements(db, user.id)


@router.post(
    "/achievements/claim",
    response_model=AchievementClaimResponse,
    dependencies=[Depends(_check_social_enabled), Depends(verify_csrf)],
)
def claim_own_achievement(
    req: AchievementClaimRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    """Schaltet eine Errungenschaft frei, die nur der Client feststellen kann.

    Nur die Kennungen aus `SELBST_GEMELDET` — die Funken-Meilensteine. Die
    Anfrage nennt keinen Kontakt und keinen Stand; es gibt nichts, woran der
    Server eine Beziehung ablesen könnte, und nichts, was er prüfen könnte.
    """
    if req.achievement_id not in SELBST_GEMELDET:
        raise HTTPException(status_code=400, detail="Diese Errungenschaft lässt sich nicht selbst melden")
    return {"unlocked": AchievementService.unlock_achievement(db, user.id, req.achievement_id)}


@router.get("/stats", response_model=UserStatsResponse, dependencies=[Depends(_check_social_enabled)])
def get_own_stats(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> dict:
    return AchievementService.get_user_stats(db, user.id)


def _sichtbares_profil(db: Session, betrachter: User, ziel: User | None) -> dict:
    """Ein Profil, das der Betrachter nicht sehen darf, gibt es für ihn nicht.

    Privat, nur für Freunde oder blockiert: dieselbe 404 wie für ein Konto,
    das nie existierte. Sonst verriete die Antwort, dass hinter der ID oder dem
    Namen jemand steht — auch über einen kopierten Link.
    """
    if not ziel or not ziel.is_active:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    profil = SocialService.get_profile(db, betrachter.id, ziel)
    if profil["restricted"]:
        raise HTTPException(status_code=404, detail="Benutzer nicht gefunden")
    return profil


@router.get("/profile/user/{target_user_id}", response_model=SocialProfileResponse, dependencies=[Depends(_check_social_enabled)])
@router.get("/profile/{target_user_id}", response_model=SocialProfileResponse, dependencies=[Depends(_check_social_enabled)])
def get_user_profile(
    target_user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    target = db.query(User).filter_by(id=target_user_id).first()
    return _sichtbares_profil(db, current_user, target)


@router.get("/profiles/public", response_model=list[SocialProfileResponse], dependencies=[Depends(_check_social_enabled)])
def list_public_profiles(
    search: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    viewer_id = current_user.id
    return SocialService.get_public_profiles(
        db, viewer_user_id=viewer_id, search=search, limit=min(max(limit, 1), 100), offset=max(offset, 0)
    )


@router.get("/profile/public/{username}", response_model=SocialProfileResponse, dependencies=[Depends(_check_social_enabled)])
def get_public_profile(
    username: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    target = db.query(User).filter(User.username.ilike(username.strip())).first()
    return _sichtbares_profil(db, current_user, target)
