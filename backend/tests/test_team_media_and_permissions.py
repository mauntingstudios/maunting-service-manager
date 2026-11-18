"""Tests fuer Team-Medien (Profilbilder & Banner), Isolation, Rechte und Echtzeit-Sync."""

from __future__ import annotations

import io
from unittest.mock import patch

import pytest
from PIL import Image
from sqlalchemy.orm import Session

from config import settings
from models import (
    Server,
    ServerPermission,
    Team,
    TeamMember,
    TeamMemberRole,
    TeamRole,
    TeamRolePermission,
    User,
)
from services import team_media_service, team_service
from services.media_gallery_service import MediaValidationError


def _image_bytes(fmt: str = "JPEG", size: tuple[int, int] = (128, 96), color=(20, 90, 180)) -> bytes:
    mode = "RGBA" if fmt == "PNG" else "RGB"
    img = Image.new(mode, size, color=color)
    buf = io.BytesIO()
    img.save(buf, format=fmt)
    return buf.getvalue()


@pytest.fixture
def media_dirs(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "wallpaper_dir", str(tmp_path / "wallpapers"))
    monkeypatch.setattr(settings, "team_media_dir", str(tmp_path / "team_media"))
    return tmp_path


def _create_team_with_member(db: Session, owner: User, member_user: User) -> tuple[Team, TeamMember]:
    team = team_service.create_team(
        db,
        user=owner,
        name="Alpha",
        category="projekt",
        description="Team Beschreibung",
        avatar_preset="holiday",
        banner_preset="server",
    )
    default_role = (
        db.query(TeamRole)
        .filter(TeamRole.team_id == team.id, TeamRole.is_default.is_(True))
        .first()
    )
    m = TeamMember(team_id=team.id, user_id=member_user.id, role="member", team_role_id=default_role.id if default_role else None)
    db.add(m)
    db.flush()
    if default_role is not None:
        db.add(TeamMemberRole(team_member_id=m.id, team_role_id=default_role.id))
    db.commit()
    return team, m


class TestTeamMediaSecurityAndIsolation:
    def test_sanitizes_svg_and_broken_uploads(self):
        with pytest.raises(MediaValidationError):
            team_media_service.sanitize_team_image("avatar", b"<svg onload=alert(1)></svg>")
        with pytest.raises(MediaValidationError):
            team_media_service.sanitize_team_image("banner", b"too short")
        with pytest.raises(MediaValidationError):
            team_media_service.sanitize_team_image("banner", b"\xff\xd8\xff" + b"garbage-bytes" * 10)

        webp_avatar = team_media_service.sanitize_team_image("avatar", _image_bytes("PNG", (2200, 2200)))
        assert webp_avatar[:4] == b"RIFF" and webp_avatar[8:12] == b"WEBP"
        with Image.open(io.BytesIO(webp_avatar)) as out:
            assert out.width <= 1024

    def test_strict_isolation_between_avatar_banner_and_server_wallpapers(
        self, db: Session, client, owner_user: User, owner_cookies: dict, regular_user: User, test_server: Server, csrf_token: str, media_dirs
    ):
        team, _ = _create_team_with_member(db, owner_user, regular_user)
        other_team = team_service.create_team(db, user=owner_user, name="Beta")

        srv = test_server
        db.add(ServerPermission(user_id=owner_user.id, server_id=srv.id, permission_key="server.view"))
        db.add(ServerPermission(user_id=owner_user.id, server_id=srv.id, permission_key="server.wallpaper.manage"))
        db.commit()

        res_srv = client.post(
            f"/api/servers/{srv.id}/wallpaper",
            files={"file": ("srv.jpg", _image_bytes("JPEG", (120, 80), (200, 10, 10)), "image/jpeg")},
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert res_srv.status_code == 200

        res_av = client.post(
            f"/api/teams/{team.id}/media/avatar",
            files={"file": ("av.png", _image_bytes("PNG", (100, 100), (10, 200, 10)), "image/png")},
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert res_av.status_code == 200
        av_id = res_av.json()["id"]

        res_bn = client.post(
            f"/api/teams/{team.id}/media/banner",
            files={"file": ("bn.jpg", _image_bytes("JPEG", (320, 180), (10, 10, 200)), "image/jpeg")},
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert res_bn.status_code == 200
        bn_id = res_bn.json()["id"]

        # Galerien sind vollstaendig getrennt
        assert len(client.get(f"/api/teams/{team.id}/media/avatar/gallery", cookies=owner_cookies).json()) == 1
        assert len(client.get(f"/api/teams/{team.id}/media/banner/gallery", cookies=owner_cookies).json()) == 1
        assert len(client.get(f"/api/teams/{other_team.id}/media/avatar/gallery", cookies=owner_cookies).json()) == 0

        # Cross-Kind und Cross-Team Zugriff wird abgewiesen (404)
        assert client.post(
            f"/api/teams/{team.id}/media/banner/{av_id}/activate",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        ).status_code == 404
        assert client.post(
            f"/api/teams/{other_team.id}/media/avatar/{av_id}/activate",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        ).status_code == 404
        assert client.delete(
            f"/api/teams/{team.id}/media/avatar/gallery/{bn_id}",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        ).status_code == 404

        # Verzeichnisse sind sauber getrennt auf dem Dateisystem
        assert (media_dirs / "team_media" / str(team.id) / "avatar").is_dir()
        assert (media_dirs / "team_media" / str(team.id) / "banner").is_dir()
        assert (media_dirs / "wallpapers" / "dayz").is_dir()


def _csrf_headers(cookies: dict) -> dict[str, str]:
    token = cookies.get("__Secure-csrf_token") or cookies.get("csrf_token") or ""
    return {"X-CSRF-Token": token}


class TestTeamMediaPermissionsAndSync:
    def test_granular_avatar_and_banner_permissions(
        self, db: Session, client, owner_user: User, regular_user: User, user_cookies: dict, media_dirs
    ):
        team, member = _create_team_with_member(db, owner_user, regular_user)
        user_hdrs = _csrf_headers(user_cookies)

        # Standardmitglied hat weder avatar noch banner manage
        assert client.post(
            f"/api/teams/{team.id}/media/avatar",
            files={"file": ("av.jpg", _image_bytes(), "image/jpeg")},
            cookies=user_cookies,
            headers=user_hdrs,
        ).status_code == 403
        assert client.post(
            f"/api/teams/{team.id}/media/banner",
            files={"file": ("bn.jpg", _image_bytes(), "image/jpeg")},
            cookies=user_cookies,
            headers=user_hdrs,
        ).status_code == 403

        # Rolle nur mit team.avatar.manage zuweisen -> avatar ok, banner weiter 403
        avatar_role = TeamRole(team_id=team.id, name="Designer")
        db.add(avatar_role)
        db.flush()
        db.add(TeamRolePermission(role_id=avatar_role.id, permission_key="team.avatar.manage"))
        db.add(TeamMemberRole(team_member_id=member.id, team_role_id=avatar_role.id))
        db.commit()

        ok_resp = client.post(
            f"/api/teams/{team.id}/media/avatar",
            files={"file": ("av.jpg", _image_bytes(), "image/jpeg")},
            cookies=user_cookies,
            headers=user_hdrs,
        )
        assert ok_resp.status_code == 200
        assert client.post(
            f"/api/teams/{team.id}/media/banner",
            files={"file": ("bn.jpg", _image_bytes(), "image/jpeg")},
            cookies=user_cookies,
            headers=user_hdrs,
        ).status_code == 403

        detail = client.get(f"/api/teams/{team.id}", cookies=user_cookies).json()
        assert detail["can_manage_avatar"] is True
        assert detail["can_manage_banner"] is False
        assert detail["avatar_source"] == "custom"
        assert detail["avatar_version"].startswith("custom-")

    def test_media_and_metadata_changes_publish_realtime_sync(
        self, db: Session, client, owner_user: User, owner_cookies: dict, regular_user: User, csrf_token: str, media_dirs
    ):
        team, _ = _create_team_with_member(db, owner_user, regular_user)
        published: list[tuple[dict, dict]] = []

        def fake_publish(event_data, **kwargs):
            published.append((event_data, kwargs))
            return 1

        with patch("services.team_service.SyncEventService.publish", side_effect=fake_publish):
            r_meta = client.put(
                f"/api/teams/{team.id}",
                json={"name": "Alpha Renamed", "category": "entwicklung", "description": "Sync Test"},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
            assert r_meta.status_code == 200
            assert r_meta.json()["category"] == "entwicklung"
            assert r_meta.json()["description"] == "Sync Test"

            r_upload = client.post(
                f"/api/teams/{team.id}/media/banner",
                files={"file": ("bn.jpg", _image_bytes(), "image/jpeg")},
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
            )
            assert r_upload.status_code == 200

        scopes = [evt["scope"] for evt, kw in published if kw.get("team_id") == team.id]
        assert "metadata" in scopes
        assert "media:banner" in scopes

    def test_legacy_member_switch_route_removed_and_learning_teams_role_based(
        self, db: Session, client, owner_user: User, regular_user: User, owner_cookies: dict, csrf_token: str
    ):
        team, member = _create_team_with_member(db, owner_user, regular_user)
        assert not hasattr(member, "can_manage_skills")
        assert not hasattr(member, "can_manage_memory")
        assert not hasattr(member, "can_access_vault")

        # PUT /api/teams/{team_id}/members/{user_id} existiert nicht mehr (405 Method Not Allowed oder 404)
        res = client.put(
            f"/api/teams/{team.id}/members/{regular_user.id}",
            json={"can_manage_skills": True, "can_manage_memory": True},
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
        )
        assert res.status_code in (404, 405)

        assert team_service.learning_teams(db, regular_user, schalter="skills") == []

        skill_role = TeamRole(team_id=team.id, name="SkillMaster")
        db.add(skill_role)
        db.flush()
        db.add(TeamRolePermission(role_id=skill_role.id, permission_key="ai.skills.manage"))
        db.add(TeamMemberRole(team_member_id=member.id, team_role_id=skill_role.id))
        db.commit()

        assert [t.id for t in team_service.learning_teams(db, regular_user, schalter="skills")] == [team.id]
        assert team_service.learning_teams(db, regular_user, schalter="memory") == []
