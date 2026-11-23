"""Tests fuer /api/permissions/catalog und /api/permissions/me."""
from fastapi.testclient import TestClient

from models import RolePermission, ServerPermission, Team, TeamMember, User
from services import team_service
from services.permission_catalog import GLOBAL_KEYS, SERVER_KEYS
from services.role_service import get_role_by_name


class TestCatalog:
    def test_catalog_lists_all_keys(self, client: TestClient, owner_cookies: dict):
        r = client.get("/api/permissions/catalog", cookies=owner_cookies)
        assert r.status_code == 200
        body = r.json()
        got_global = {p["key"] for p in body["global_permissions"]}
        got_server = {p["key"] for p in body["server_permissions"]}
        assert got_global == GLOBAL_KEYS
        assert got_server == SERVER_KEYS

    def test_catalog_requires_auth(self, client: TestClient):
        r = client.get("/api/permissions/catalog")
        assert r.status_code == 401


class TestMe:
    def test_owner_me(self, client: TestClient, owner_cookies: dict):
        r = client.get("/api/permissions/me", cookies=owner_cookies)
        assert r.status_code == 200
        body = r.json()
        assert body["is_owner"] is True

    def test_user_me_with_role_and_delegation(
        self, client: TestClient, db, regular_user: User, user_cookies: dict, test_server,
    ):
        admin = get_role_by_name(db, "admin")
        regular_user.role_id = admin.id
        db.add(ServerPermission(user_id=regular_user.id, server_id=test_server.id, permission_key="server.start"))
        db.commit()
        r = client.get("/api/permissions/me", cookies=user_cookies)
        assert r.status_code == 200
        body = r.json()
        assert body["is_owner"] is False
        assert body["role_name"] == "admin"
        # Admin hat alle globalen Keys via Rolle.
        assert "servers.delete" in body["global_keys"]
        # Server-Delegation drin
        assert str(test_server.id) in body["server_keys"] or test_server.id in body["server_keys"]
        assert body["has_team_membership"] is False

    def test_has_team_membership_ignores_personal_team_and_tracks_shared_team(
        self,
        client: TestClient,
        db,
        owner_user: User,
        regular_user: User,
        user_cookies: dict,
    ):
        before = client.get("/api/permissions/me", cookies=user_cookies)
        assert before.status_code == 200
        assert before.json()["has_team_membership"] is False

        # Persoenliches Ein-Mann-KI-Team zaehlt nicht als geteiltes Team.
        team_service.personal_team(db, regular_user)
        db.commit()
        after_personal = client.get("/api/permissions/me", cookies=user_cookies)
        assert after_personal.status_code == 200
        assert after_personal.json()["has_team_membership"] is False

        # Erst eine geteilte Team-Mitgliedschaft aktiviert das Flag.
        team = Team(name="SharedSquad", owner_user_id=owner_user.id)
        db.add(team)
        db.flush()
        db.add(TeamMember(team_id=team.id, user_id=regular_user.id, role="member"))
        db.commit()

        after_join = client.get("/api/permissions/me", cookies=user_cookies)
        assert after_join.status_code == 200
        assert after_join.json()["has_team_membership"] is True
