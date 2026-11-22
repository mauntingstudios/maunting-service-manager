"""Tests fuer Blueprint-Variablen, DIS-verschluesselte Overrides & neue Blueprints."""

from __future__ import annotations

import copy
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from blueprints.registry import get_registry
from blueprints.renderer import render_argv
from blueprints.schema import BlueprintValidationError, load_blueprint_dict
from games import get_plugin
from models import AuditLog, Server, ServerPermission, ServerRuntimeEnv, User
from services import server_variables_service
from services.server_runtime_env import get_runtime_env, set_runtime_env


def _base_blueprint_dict() -> dict:
    return {
        "version": 1,
        "meta": {
            "id": "var_test",
            "name": "Variable Test",
            "category": "bot",
            "author": "Test",
        },
        "runtime": {
            "image": "node:22-bookworm-slim",
            "workdir": "/data",
            "env": {"PORT": "{WEB_PORT}", "CUSTOM_FLAG": "on"},
            "startup": "node index.js",
        },
        "ports": [{"name": "web", "protocol": "tcp"}],
        "source": {"type": "dockerOnly"},
    }


class TestBlueprintVariableSchemaAndCatalog:
    @pytest.mark.parametrize(
        "forbidden_key",
        ["PATH", "LD_PRELOAD", "DOCKER_HOST", "DOCKER_SOCKET", "MSM_MASTER_KEY", "HOME", "SHELL"],
    )
    def test_rejects_forbidden_variable_keys(self, forbidden_key: str):
        data = _base_blueprint_dict()
        data["variables"] = [{"key": forbidden_key, "label": "Bad", "type": "string"}]
        with pytest.raises(BlueprintValidationError):
            load_blueprint_dict(data)

    def test_rejects_collision_with_port_bound_env_key(self):
        data = _base_blueprint_dict()
        data["variables"] = [{"key": "PORT", "label": "Port Override", "type": "number"}]
        with pytest.raises(BlueprintValidationError):
            load_blueprint_dict(data)

    def test_rejects_duplicate_variable_keys(self):
        data = _base_blueprint_dict()
        data["variables"] = [
            {"key": "LOG_LEVEL", "label": "A", "type": "string"},
            {"key": "LOG_LEVEL", "label": "B", "type": "string"},
        ]
        with pytest.raises(BlueprintValidationError):
            load_blueprint_dict(data)

    def test_new_and_updated_native_blueprints_load_and_render(self):
        registry = get_registry()
        expected_ids = [
            "discord_bot_node",
            "discord_bot_python",
            "teamspeak3",
            "teamspeak6",
            "mumble",
            "lavalink",
            "minecraft_vanilla",
            "minecraft_paper",
            "minecraft_purpur",
            "minecraft_fabric",
            "minecraft_forge",
            "minecraft_neoforge",
            "minecraft_spigot",
            "minecraft_sponge",
            "node_backend",
            "python_backend",
            "web_frontend_github",
            "web_static",
        ]
        for bp_id in expected_ids:
            entry = registry.get(bp_id)
            assert entry is not None, f"{bp_id} fehlt im BlueprintRegistry"
            assert len(entry.blueprint.variables) >= 2, f"{bp_id} hat zu wenige Variablen"
            argv = render_argv(
                entry.blueprint,
                install_dir="/data",
                ports={"game": 25565, "query": 10011, "voice": 9987, "web": 8080, "custom": 30033},
                extra_env={"VERSION": "1.21.4"},
            )
            assert len(argv) >= 1

        ts3 = registry.get("teamspeak3").blueprint
        assert ts3.meta.category.value == "voice_server"
        ts6 = registry.get("teamspeak6").blueprint
        assert ts6.meta.category.value == "voice_server"
        mumble = registry.get("mumble").blueprint
        assert mumble.meta.category.value == "voice_server"
        lavalink = registry.get("lavalink").blueprint
        assert lavalink.meta.category.value == "bot"
        assert all(v.key != "SERVER_PORT" for v in lavalink.variables)

        mc_paper = registry.get("minecraft_paper").blueprint
        ver_var = next(v for v in mc_paper.variables if v.key == "VERSION")
        assert ver_var.allowCustom is True
        assert any(o.value == "1.21.10" for o in ver_var.options)


class TestServerVariablesEndpointsAndEncryption:
    def _make_server(self, db: Session, _owner: User, game_type: str) -> Server:
        srv = Server(
            name=f"srv-{uuid4().hex[:6]}",
            game_type=game_type,
            container_name=f"msm-test-{uuid4().hex[:8]}",
            install_dir=f"/tmp/msm-test-{uuid4().hex[:6]}",
            game_port=25565,
            query_port=25566,
            status="running",
        )
        db.add(srv)
        db.commit()
        db.refresh(srv)
        return srv

    def test_get_and_put_minecraft_variables_preserve_max_players_and_merge_env(
        self, client: TestClient, db: Session, owner_user: User, owner_cookies: dict, csrf_token: str
    ):
        srv = self._make_server(db, owner_user, "minecraft_paper")
        set_runtime_env(srv.id, {"MAX_PLAYERS": "24"}, db=db)

        res = client.get(f"/api/servers/{srv.id}/variables", cookies=owner_cookies)
        assert res.status_code == 200, res.text
        body = res.json()
        assert body["has_variables"] is True
        assert body["is_running"] is True
        assert any(v["key"] == "VERSION" and v["allow_custom"] is True for v in body["variables"])

        upd = client.put(
            f"/api/servers/{srv.id}/variables",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={
                "values": {
                    "VERSION": "1.21.4",
                    "DIFFICULTY": "hard",
                    "PVP": "false",
                    "VIEW_DISTANCE": "14",
                }
            },
        )
        assert upd.status_code == 200, upd.text
        upd_body = upd.json()
        assert set(upd_body["changed_keys"]) == {
            "VERSION",
            "DIFFICULTY",
            "PVP",
            "VIEW_DISTANCE",
        }
        assert upd_body["restart_recommended"] is True

        stored = get_runtime_env(srv.id, db=db)
        assert stored["MAX_PLAYERS"] == "24"
        assert stored["VERSION"] == "1.21.4"
        assert stored["DIFFICULTY"] == "hard"
        assert stored["PVP"] == "false"
        assert stored["VIEW_DISTANCE"] == "14"

        # DB row uses DIS encrypted payload (must not store plain override JSON)
        raw_row = (
            db.query(ServerRuntimeEnv)
            .filter(ServerRuntimeEnv.server_id == srv.id)
            .first()
        )
        assert raw_row is not None
        assert "1.21.4" not in raw_row.env_encrypted

        plugin = get_plugin("minecraft_paper")
        container_env = plugin.build_container_env(srv)
        assert container_env["VERSION"] == "1.21.4"
        assert container_env["MAX_PLAYERS"] == "24"

        # Reset single variable back to default
        reset_res = client.put(
            f"/api/servers/{srv.id}/variables",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"values": {"VERSION": None}},
        )
        assert reset_res.status_code == 200
        db.expire_all()
        assert "VERSION" not in get_runtime_env(srv.id, db=db)
        assert get_runtime_env(srv.id, db=db)["MAX_PLAYERS"] == "24"

    def test_secrets_are_never_returned_or_logged_and_empty_string_keeps_secret(
        self, client: TestClient, db: Session, owner_user: User, owner_cookies: dict, csrf_token: str
    ):
        srv = self._make_server(db, owner_user, "discord_bot_node")
        secret_val = "MTIzNDU2Nzg5.secret-bot-token-xyz"

        put1 = client.put(
            f"/api/servers/{srv.id}/variables",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={
                "values": {
                    "DISCORD_TOKEN": secret_val,
                    "GIT_REPO_URL": "https://github.com/example/my-bot",
                }
            },
        )
        assert put1.status_code == 200, put1.text
        tok_after = next(
            v for v in put1.json()["variables"]["variables"] if v["key"] == "DISCORD_TOKEN"
        )
        assert tok_after["value"] == ""
        assert tok_after["is_set"] is True
        assert secret_val not in put1.text

        # Audit log darf keinen Secret-Wert enthalten
        audit = (
            db.query(AuditLog)
            .filter(AuditLog.action == "server.variables.updated", AuditLog.target_id == str(srv.id))
            .order_by(AuditLog.id.desc())
            .first()
        )
        assert audit is not None
        assert secret_val not in str(audit.details)

        # Leerer String beim Teil-Save ueberschreibt gesetztes Secret NICHT
        put2 = client.put(
            f"/api/servers/{srv.id}/variables",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"values": {"DISCORD_TOKEN": "", "BOT_ENTRY_FILE": "bot.mjs"}},
        )
        assert put2.status_code == 200
        db.expire_all()
        assert get_runtime_env(srv.id, db=db)["DISCORD_TOKEN"] == secret_val
        assert get_runtime_env(srv.id, db=db)["BOT_ENTRY_FILE"] == "bot.mjs"

    def test_validation_rejects_invalid_values_and_customer_editable_false(
        self,
        client: TestClient,
        db: Session,
        owner_user: User,
        regular_user: User,
        user_cookies: dict,
        user_csrf_token: str,
        owner_cookies: dict,
        csrf_token: str,
        monkeypatch,
    ):
        srv = self._make_server(db, owner_user, "minecraft_paper")
        db.add(ServerPermission(user_id=regular_user.id, server_id=srv.id, permission_key="server.view"))
        db.add(ServerPermission(user_id=regular_user.id, server_id=srv.id, permission_key="server.config.write"))
        db.commit()

        # Unknown key rejected
        r_unknown = client.put(
            f"/api/servers/{srv.id}/variables",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"values": {"UNKNOWN_VAR": "x"}},
        )
        assert r_unknown.status_code == 422

        # Number out of range rejected
        r_range = client.put(
            f"/api/servers/{srv.id}/variables",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"values": {"VIEW_DISTANCE": "99"}},
        )
        assert r_range.status_code == 422

        # Disallowed option on strict select rejected
        r_select = client.put(
            f"/api/servers/{srv.id}/variables",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"values": {"DIFFICULTY": "nightmare"}},
        )
        assert r_select.status_code == 422

        # Non-https / credential git_url rejected
        bot_srv = self._make_server(db, owner_user, "discord_bot_python")
        r_git = client.put(
            f"/api/servers/{bot_srv.id}/variables",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"values": {"GIT_REPO_URL": "https://user:pass@github.com/org/repo"}},
        )
        assert r_git.status_code == 422

        # customerEditable=False blocks regular user with server.config.write
        real_plugin = get_plugin("minecraft_paper")
        bp_copy = copy.deepcopy(real_plugin.get_blueprint())
        for var in bp_copy.variables:
            if var.key == "MOTD":
                var.customerEditable = False
        monkeypatch.setattr(
            server_variables_service, "_resolve_blueprint", lambda _server: bp_copy
        )

        r_forbidden = client.put(
            f"/api/servers/{srv.id}/variables",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={"values": {"MOTD": "Hack"}},
        )
        assert r_forbidden.status_code == 403
