"""Sammelrouter der Social-API.

Die Pfade bleiben unter ``/api/social`` unverändert. Jede Domäne bringt ihren
eigenen Router mit; hier werden sie in derselben Reihenfolge eingebunden, in
der die Routen zuvor in einer Datei standen.
"""

from __future__ import annotations

from fastapi import APIRouter

from . import chats, devices, friends, groups, media, messages, profiles, stories, ws, e2ee_keys

router = APIRouter(prefix="/api/social", tags=["social"])

router.include_router(chats.router)
router.include_router(messages.router)
router.include_router(e2ee_keys.router)
router.include_router(friends.router)
router.include_router(profiles.router)
router.include_router(devices.router)
router.include_router(media.router)
router.include_router(groups.router)
router.include_router(stories.router)
router.include_router(ws.router)

__all__ = ["router"]
