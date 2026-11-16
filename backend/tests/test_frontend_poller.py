"""Tests fuer den 30-Sekunden-Fallback-Poller."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

from sqlalchemy.orm import Session

from models import Server
from services import frontend_deploy_service, frontend_poller


def test_poller_skips_when_recent_webhook_and_triggers_on_new_sha(
    db: Session, tmp_path: Path
) -> None:
    srv = Server(
        name="PolledApp",
        game_type="web_frontend_github",
        install_dir=str(tmp_path / "srv-poll"),
        status="running",
        desired_power_state="running",
        game_port=28080,
    )
    db.add(srv)
    db.commit()
    db.refresh(srv)
    fs = frontend_deploy_service.get_or_create_settings(db, srv)
    fs.last_webhook_at = datetime.now(timezone.utc)
    db.commit()

    with patch("services.frontend_poller.remote_branch_sha", return_value="sha-1"), patch(
        "services.frontend_deploy_service.trigger_async_build"
    ) as mock_trigger:
        assert frontend_poller.poll_once(db) == 0
        assert mock_trigger.call_count == 0

        fs.last_webhook_at = datetime.now(timezone.utc) - timedelta(minutes=15)
        db.commit()
        assert frontend_poller.poll_once(db) == 1
        assert mock_trigger.call_count == 1

        # Zweiter Lauf mit derselben SHA triggert nicht erneut
        assert frontend_poller.poll_once(db) == 0
        assert mock_trigger.call_count == 1
