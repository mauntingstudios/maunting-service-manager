"""Globales API-Rate-Limit (slowapi Limiter).

Das Default-Limit pro IP kommt dynamisch aus panel_settings
(rate_limit_global), Default 100/minute. Auth-spezifische Limits
liegen separat in main.auth_rate_limit. Enrollment- und Webhook-Limits
bleiben fest in den jeweiligen Routern.
"""
from __future__ import annotations

import os

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address

from config import settings
from services.rate_limit_settings import dynamic_global_limit_provider

# Im Testlauf zaehlt jeder Prozess fuer sich. Ein gemeinsamer Redis-Zaehler
# teilte sich sonst zwischen xdist-Workern, und `limiter.reset()` des einen
# loeschte die Zaehler, waehrend der andere gerade ein Limit prueft — die
# Grenze griff dann scheinbar nicht. In Produktion bleibt Redis der Speicher.
_storage_uri = None if os.getenv("MSM_TESTING") else (settings.redis_url or None)

# default_limits als Callable: slowapi wertet den String pro Request neu aus,
# sodass gespeicherte Admin-Werte ohne Restart greifen. Bei Lesefehler/ungültig
# liefert dynamic_global_limit_provider den Default 100 (fail-closed).
# key_style="endpoint" zählt pro Routenfunktion statt pro URL-Pfad. Ohne das
# bekommt jeder parametrisierte Pfad (/api/servers/{id}/status) einen eigenen
# Zähler, und das Limit lässt sich durch Variieren der ID beliebig umgehen.
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[dynamic_global_limit_provider],
    storage_uri=_storage_uri,
    in_memory_fallback_enabled=True,
    key_style="endpoint",
)


def auth_rate_limit(request: Request) -> None:
    """Strenges Rate-Limit für Login/2FA/Passwort-Reset/Setup pro IP.

    Liest rate_limit_auth aus den Panel-Settings (3–50, Default 10).
    Bei ungültigen/fehlenden Werten fail-closed auf Default — nie unlimitiert.
    """
    from limits import parse
    from fastapi import HTTPException
    from services.rate_limit_settings import current_auth_limit_from_settings

    key = get_remote_address(request)
    try:
        per_minute = current_auth_limit_from_settings()
    except Exception:
        # DB/Cache-Fehler dürfen Auth nie ungeschützt lassen
        per_minute = 10
    limit_item = parse(f"{per_minute}/minute")
    if not limiter.limiter.hit(limit_item, key):
        raise HTTPException(
            status_code=429,
            detail="Zu viele Anfragen. Bitte warten Sie einen Moment.",
            headers={"Retry-After": "60"},
        )

