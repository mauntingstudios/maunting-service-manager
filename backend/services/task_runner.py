"""Sicherer Task-Runner für asynchrone Hintergrundaufgaben (Hardening WP1.6).

Stellt sicher, dass jede Hintergrundaufgabe einen Done-Callback besitzt,
der Ausnahmen abholt und zusammen mit der Request-ID protokolliert.
Verhindert stille Abstürze von Tasks ('Task exception was never retrieved').
"""

import asyncio
import logging
from typing import Any, Coroutine, Dict, Optional

from middleware.request_id import get_request_id

logger = logging.getLogger("msm.tasks")


def sichere_aufgabe(
    coro: Coroutine[Any, Any, Any],
    name: str = "hintergrundaufgabe",
    extra: Optional[Dict[str, Any]] = None,
    loop: Optional[asyncio.AbstractEventLoop] = None,
) -> asyncio.Task:
    """Startet eine Coroutine als Task mit automatischem Ausnahme-Protokoll."""
    active_loop = loop or asyncio.get_running_loop()
    task = active_loop.create_task(coro, name=name)
    req_id = get_request_id()

    def _done_cb(t: asyncio.Task) -> None:
        try:
            exc = t.exception()
            if exc:
                ctx = {"request_id": req_id}
                if extra:
                    ctx.update(extra)
                logger.error(
                    "Hintergrundaufgabe '%s' mit Fehler abgebrochen: %s",
                    name,
                    exc,
                    exc_info=exc,
                    extra=ctx,
                )
        except asyncio.CancelledError:
            pass
        except Exception as cb_err:
            logger.error("Fehler im Task-Done-Callback: %s", cb_err)

    task.add_done_callback(_done_cb)
    return task
