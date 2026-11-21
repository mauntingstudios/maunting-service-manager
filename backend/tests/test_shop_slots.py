"""Tests fuer Phase 3.1: Blueprint-`players`, `config_wishes`-Slots & Query-Adapter."""

from __future__ import annotations

import hashlib
import json
import socket
import struct
import threading
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from blueprints.registry import reload_registry
from blueprints.schema import BlueprintValidationError, load_blueprint_dict
from models import Server, ShopPlan
from models.server_port import ServerPort
from services import (
    permission_service,
    player_query_service,
    server_config_wishes,
    server_runtime_env,
    shop_catalog_service,
    shop_slot_service,
)
from services.ai_action_errors import AiActionValidationError
from services.operation_task_service import (
    TASK_SERVER_PROVISION,
    create_or_reuse_task,
)
from services.server_provisioning_service import ProvisioningResult


def _base_blueprint() -> dict:
    return {
        "version": 1,
        "meta": {
            "id": "slot_test",
            "name": "Slot Test",
            "category": "steam_game",
            "author": "MSM",
            "description": "",
        },
        "runtime": {
            "image": "ghcr.io/parkervcp/steamcmd:debian",
            "workdir": "/data",
            "env": {"MAX_PLAYERS": "10"},
            "startup": "./server -port={GAME_PORT}",
        },
        "ports": [{"name": "game", "protocol": "udp"}],
        "source": {
            "type": "steam",
            "steam": {"appId": "12345", "platform": "linux", "compatibility": "native"},
        },
    }


def _plan_payload(game_type: str = "palworld", **overrides) -> dict:
    payload = {
        "game_type": game_type,
        "name": f"SlotPlan {game_type} {uuid4().hex[:8]}",
        "price_cents": 899,
        "currency": "EUR",
        "billing_interval": "month",
        "tax_rate_percent": 19,
        "ram_included_mb": 4096,
        "ram_max_mb": 8192,
        "ram_step_mb": 1024,
        "price_per_ram_step_cents": 100,
        "cpu_included": 2,
        "cpu_max": 4,
        "cpu_step": 1,
        "price_per_cpu_step_cents": 150,
        "slots_included": 8,
        "slots_max": 32,
        "slots_step": 1,
        "price_per_slot_step_cents": 40,
        "artwork_mode": "none",
        "active": True,
    }
    payload.update(overrides)
    return payload


def _encode_varint(value: int) -> bytes:
    out = bytearray()
    while True:
        byte = value & 0x7F
        value >>= 7
        if value:
            out.append(byte | 0x80)
        else:
            out.append(byte)
            return bytes(out)


class TestBlueprintPlayersSchemaAndRegistry:
    def test_accepts_ini_env_and_regex_targets(self) -> None:
        for target in (
            {
                "type": "ini",
                "file": "Saved/GameUserSettings.ini",
                "section": "ServerSettings",
                "key": "MaxPlayers",
            },
            {"type": "env", "key": "MAX_PLAYERS"},
            {
                "type": "regex",
                "file": "serverconfig.xml",
                "regex": r'value="\d+"',
                "replacement": 'value="{SLOTS}"',
            },
        ):
            data = _base_blueprint()
            data["players"] = {
                "min": 2,
                "max": 64,
                "configTarget": target,
                "queryProtocol": "a2s",
                "queryPortRole": "query",
            }
            bp = load_blueprint_dict(data)
            assert bp.players is not None
            assert bp.players.configTarget.type == target["type"]

    def test_rejects_invalid_bounds_and_unsafe_targets(self) -> None:
        bad_cases = [
            {
                "min": 32,
                "max": 8,
                "configTarget": {"type": "env", "key": "MAX_PLAYERS"},
            },
            {
                "min": 2,
                "max": 16,
                "configTarget": {"type": "regex", "file": "cfg.xml", "regex": "x", "replacement": "fixed"},
            },
            {
                "min": 2,
                "max": 16,
                "configTarget": {"type": "regex", "file": "cfg.xml", "regex": "[unclosed", "replacement": "{SLOTS}"},
            },
            {
                "min": 2,
                "max": 16,
                "configTarget": {"type": "ini", "file": "../evil.ini", "section": "S", "key": "K"},
            },
            {
                "min": 2,
                "max": 16,
                "configTarget": {"type": "env", "key": "LD_PRELOAD"},
            },
            {
                "min": 2,
                "max": 16,
                "configTarget": {"type": "env", "key": "max_players"},
            },
        ]
        for players_cfg in bad_cases:
            data = _base_blueprint()
            data["players"] = players_cfg
            with pytest.raises(BlueprintValidationError):
                load_blueprint_dict(data)

    def test_native_blueprints_capability_matrix(self) -> None:
        reload_registry()
        for slot_game in (
            "palworld",
            "rust",
            "ark_ascended",
            "enshrouded",
            "project_zomboid",
            "satisfactory",
            "seven_days_to_die",
            "v_rising",
            "minecraft_fabric",
            "minecraft_paper",
        ):
            assert shop_slot_service.get_blueprint_players(slot_game) is not None

        for non_slot in ("valheim", "postgres", "node_backend", "python_backend", "web_static"):
            assert shop_slot_service.get_blueprint_players(non_slot) is None


class TestCatalogSlotCapability:
    def test_rejects_slots_on_unsupported_blueprint_and_out_of_range(
        self, client: TestClient, owner_cookies: dict, csrf_token: str
    ) -> None:
        # Negativ: Valheim hat kein players-Ziel -> Slot-Konfiguration blockieren (POST & PATCH)
        bad_valheim = client.post(
            "/api/shop/plans",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json=_plan_payload("valheim"),
        )
        assert bad_valheim.status_code == 422

        valheim_ok = client.post(
            "/api/shop/plans",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json=_plan_payload(
                "valheim",
                slots_included=None,
                slots_max=None,
                price_per_slot_step_cents=0,
            ),
        )
        assert valheim_ok.status_code == 200, valheim_ok.text
        plan_id = valheim_ok.json()["id"]

        bad_patch = client.patch(
            f"/api/shop/plans/{plan_id}",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"slots_included": 4, "slots_max": 12, "price_per_slot_step_cents": 20},
        )
        assert bad_patch.status_code == 422

        # Negativ: Palworld erlaubt max=64 -> slots_max=100 wird abgewiesen
        bad_range = client.post(
            "/api/shop/plans",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json=_plan_payload("palworld", slots_included=8, slots_max=100),
        )
        assert bad_range.status_code == 422

        # Positiv: Katalog weist supports_slots je Blueprint korrekt aus
        pal_ok = client.post(
            "/api/shop/plans",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json=_plan_payload("palworld"),
        )
        assert pal_ok.status_code == 200
        katalog = {item["id"]: item for item in client.get("/api/shop/catalog").json()}
        assert katalog[pal_ok.json()["id"]]["supports_slots"] is True
        assert katalog[valheim_ok.json()["id"]]["supports_slots"] is False


class TestConfigWishesRegexAndSlotApplication:
    def test_setze_regex_enforces_local_file_and_agent_patches(self, tmp_path: Path) -> None:
        cfg = tmp_path / "serverconfig.xml"
        cfg.write_text('<ServerSettings><property name="ServerMaxPlayerCount" value="8"/></ServerSettings>', encoding="utf-8")

        roh = server_config_wishes.setze_regex(
            None,
            datei="serverconfig.xml",
            muster=r'name="ServerMaxPlayerCount"\s+value="\d+"',
            ersatz='name="ServerMaxPlayerCount" value="24"',
        )
        # Zweites Setzen ersetzt vorhandenen Regex-Wunsch statt zu doppeln
        roh = server_config_wishes.setze_regex(
            roh,
            datei="serverconfig.xml",
            muster=r'name="ServerMaxPlayerCount"\s+value="\d+"',
            ersatz='name="ServerMaxPlayerCount" value="16"',
        )
        wuensche = server_config_wishes.lese(roh)
        assert len(wuensche) == 1
        assert wuensche[0].art == server_config_wishes.ART_REGEX

        srv = SimpleNamespace(
            id=901,
            install_dir=str(tmp_path),
            config_wishes_json=roh,
            node=None,
        )
        server_config_wishes.wuensche_durchsetzen(srv)
        assert 'value="16"' in cfg.read_text(encoding="utf-8")

        patches = server_config_wishes.als_patches(wuensche)
        assert patches == [
            {
                "type": "regex",
                "file": "serverconfig.xml",
                "section": None,
                "key": None,
                "regex": r'name="ServerMaxPlayerCount"\s+value="\d+"',
                "value": 'name="ServerMaxPlayerCount" value="16"',
            }
        ]

        # Negativ: unsichere Pfade, kaputtes Regex, moegliches Passwort-Secret
        with pytest.raises(AiActionValidationError):
            server_config_wishes.setze_regex(None, datei="../escape.xml", muster="a", ersatz="b")
        with pytest.raises(AiActionValidationError):
            server_config_wishes.setze_regex(None, datei="a.xml", muster="[", ersatz="b")
        with pytest.raises(AiActionValidationError):
            server_config_wishes.setze_regex(
                None, datei="a.xml", muster="k", ersatz="ghp_" + "a" * 36
            )

    def test_apply_server_slots_supports_ini_regex_and_env(
        self, db: Session, tmp_path: Path
    ) -> None:
        # 1. INI (Palworld)
        srv_ini = Server(
            name="Pal Slots",
            game_type="palworld",
            install_dir=str(tmp_path / "pal"),
            status="stopped",
        )
        # 2. Regex (7 Days to Die)
        srv_rx = Server(
            name="7D2D Slots",
            game_type="seven_days_to_die",
            install_dir=str(tmp_path / "7d2d"),
            status="running",
        )
        # 3. ENV (Rust -> ServerRuntimeEnv)
        srv_env = Server(
            name="Rust Slots",
            game_type="rust",
            install_dir=str(tmp_path / "rust"),
            status="stopped",
        )
        # 4. Nicht-slotfaehig (Valheim)
        srv_no = Server(
            name="Valheim Fixed",
            game_type="valheim",
            install_dir=str(tmp_path / "valheim"),
            status="stopped",
        )
        db.add_all([srv_ini, srv_rx, srv_env, srv_no])
        db.commit()

        r_ini = shop_slot_service.apply_server_slots(db, srv_ini, 24)
        assert r_ini["target_type"] == "ini"
        assert r_ini["downgrade_warning"] is False
        assert r_ini["restart_required"] is False
        assert shop_slot_service.read_configured_slots(db, srv_ini) == 24

        r_down = shop_slot_service.apply_server_slots(db, srv_ini, 12)
        assert r_down["previous_slots"] == 24
        assert r_down["downgrade_warning"] is True

        r_rx = shop_slot_service.apply_server_slots(db, srv_rx, 20)
        assert r_rx["target_type"] == "regex"
        assert r_rx["restart_required"] is True
        assert shop_slot_service.read_configured_slots(db, srv_rx) == 20

        r_env = shop_slot_service.apply_server_slots(db, srv_env, 120)
        assert r_env["target_type"] == "env"
        assert server_runtime_env.get_runtime_env(srv_env.id, db=db)["MAX_PLAYERS"] == "120"

        with pytest.raises(shop_slot_service.SlotConfigurationError):
            shop_slot_service.apply_server_slots(db, srv_no, 10)
        with pytest.raises(shop_slot_service.SlotConfigurationError):
            shop_slot_service.apply_server_slots(db, srv_ini, 999)

    def test_paid_order_provisioning_writes_booked_slots(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        user_cookies: dict,
        user_csrf_token: str,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        from services import server_provisioning_service

        def _fake_provision(session: Session, request, actor, *, idempotency_key=None, retry_of_id=None):
            task, _created = create_or_reuse_task(
                session,
                actor=actor,
                task_type=TASK_SERVER_PROVISION,
                request_hash=hashlib.sha256(
                    f"slot-{request.name}-{uuid4().hex}".encode("utf-8")
                ).hexdigest(),
                idempotency_key=idempotency_key,
                retry_of_id=retry_of_id,
            )
            server = Server(
                name=request.name,
                game_type=request.game_type,
                install_dir=f"/tmp/shop-{uuid4().hex[:8]}",
                container_name=f"msm-shop-{uuid4().hex[:8]}",
                status="stopped",
            )
            session.add(server)
            session.flush()
            task.server_id = server.id
            task.status = "succeeded"
            task.phase = "completed"
            session.commit()
            session.refresh(server)
            return ProvisioningResult(server=server, task=task, postgres_credentials=[])

        monkeypatch.setattr(server_provisioning_service, "provision_server", _fake_provision)

        plan_res = client.post(
            "/api/shop/plans",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json=_plan_payload("palworld", slots_included=8, slots_max=32, slots_step=4),
        )
        assert plan_res.status_code == 200
        order_res = client.post(
            "/api/shop/orders",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
            json={
                "plan_id": plan_res.json()["id"],
                "months": 1,
                "slots": 16,
                "buyer_name": "Max",
                "buyer_street": "Strasse 1",
                "buyer_postal_code": "12345",
                "buyer_city": "Berlin",
                "buyer_country": "DE",
                "buyer_email": "max@example.invalid",
            },
        )
        assert order_res.status_code == 200, order_res.text
        pay_res = client.post(
            f"/api/shop/orders/{order_res.json()['id']}/demo-pay",
            cookies=user_cookies,
            headers={"X-CSRF-Token": user_csrf_token},
        )
        assert pay_res.status_code == 200, pay_res.text

        abos = client.get("/api/shop/entitlements", cookies=user_cookies).json()
        srv_ent = next(e for e in abos if e["kind"] == "server")
        assert srv_ent["server_id"] is not None
        server = db.query(Server).filter(Server.id == srv_ent["server_id"]).first()
        assert server is not None
        assert shop_slot_service.read_configured_slots(db, server) == 16


class TestPlayerQueryAdapters:
    def test_query_a2s_with_challenge_and_bad_packet(self) -> None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]

        def serve() -> None:
            sock.settimeout(2.0)
            data, addr = sock.recvfrom(1024)
            assert data.startswith(b"\xff\xff\xff\xffTSource Engine Query\x00")
            sock.sendto(b"\xff\xff\xff\xff\x41\x11\x22\x33\x44", addr)
            data2, addr2 = sock.recvfrom(1024)
            assert data2.endswith(b"\x11\x22\x33\x44")
            payload = (
                b"\xff\xff\xff\xff\x49\x11"
                + b"Test A2S\x00world\x00rust\x00Rust\x00"
                + struct.pack("<H", 258550 & 0xFFFF)
                + bytes([14, 32])
            )
            sock.sendto(payload, addr2)
            sock.close()

        t = threading.Thread(target=serve, daemon=True)
        t.start()
        res = player_query_service.query_a2s("127.0.0.1", port, timeout=1.5)
        t.join(timeout=2.0)
        assert res.online is True
        assert res.protocol == "a2s"
        assert res.players == 14
        assert res.max_players == 32
        assert res.server_name == "Test A2S"

        # Negativ: geschlossener Port liefert online=False ohne Exception
        bad = player_query_service.query_a2s("127.0.0.1", port, timeout=0.2)
        assert bad.online is False

    def test_query_minecraft_slp(self) -> None:
        srv_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        srv_sock.bind(("127.0.0.1", 0))
        srv_sock.listen(1)
        port = srv_sock.getsockname()[1]

        def serve() -> None:
            srv_sock.settimeout(2.0)
            conn, _ = srv_sock.accept()
            conn.recv(1024)
            body_json = json.dumps(
                {"players": {"online": 7, "max": 20}, "description": {"text": "MC Server"}}
            ).encode("utf-8")
            pkt = b"\x00" + _encode_varint(len(body_json)) + body_json
            conn.sendall(_encode_varint(len(pkt)) + pkt)
            conn.close()
            srv_sock.close()

        t = threading.Thread(target=serve, daemon=True)
        t.start()
        res = player_query_service.query_minecraft_slp("127.0.0.1", port, timeout=1.5)
        t.join(timeout=2.0)
        assert res.online is True
        assert res.protocol == "minecraft_slp"
        assert res.players == 7
        assert res.max_players == 20
        assert res.server_name == "MC Server"

    def test_query_gamespy_and_rcon(self) -> None:
        # GameSpy UDP
        gs_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        gs_sock.bind(("127.0.0.1", 0))
        gs_port = gs_sock.getsockname()[1]

        def serve_gs() -> None:
            gs_sock.settimeout(2.0)
            req1, addr = gs_sock.recvfrom(512)
            sid = req1[3:7]
            gs_sock.sendto(b"\x09" + sid + b"4242\x00", addr)
            _req2, addr2 = gs_sock.recvfrom(512)
            body = b"GS Server\x00ctf\x00map1\x009\x0016\x0027015\x00"
            gs_sock.sendto(b"\x00" + sid + body, addr2)
            gs_sock.close()

        t_gs = threading.Thread(target=serve_gs, daemon=True)
        t_gs.start()
        res_gs = player_query_service.query_gamespy("127.0.0.1", gs_port, timeout=1.5)
        t_gs.join(timeout=2.0)
        assert res_gs.online is True
        assert res_gs.players == 9
        assert res_gs.max_players == 16

        # RCON TCP
        rc_sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        rc_sock.bind(("127.0.0.1", 0))
        rc_sock.listen(1)
        rc_port = rc_sock.getsockname()[1]

        def _send_rcon(conn: socket.socket, req_id: int, ptype: int, text: str) -> None:
            payload = struct.pack("<ii", req_id, ptype) + text.encode("utf-8") + b"\x00\x00"
            conn.sendall(struct.pack("<i", len(payload)) + payload)

        def serve_rc() -> None:
            rc_sock.settimeout(2.0)
            conn, _ = rc_sock.accept()
            conn.recv(512)  # Auth
            _send_rcon(conn, 1, 2, "")
            conn.recv(512)  # status
            _send_rcon(conn, 2, 0, "hostname: test\nplayers : 5 humans, 0 bots\n")
            conn.close()
            rc_sock.close()

        t_rc = threading.Thread(target=serve_rc, daemon=True)
        t_rc.start()
        res_rc = player_query_service.query_rcon_fallback("127.0.0.1", rc_port, "secret", timeout=1.5)
        t_rc.join(timeout=2.0)
        assert res_rc.online is True
        assert res_rc.players == 5

        assert player_query_service.query_rcon_fallback("127.0.0.1", rc_port, None).online is False

    def test_slot_exceeded_warns_without_killing_server(
        self, db: Session, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        srv = Server(
            name="Rust Warn",
            game_type="rust",
            install_dir="/tmp/rust-warn",
            status="running",
            ports=[
                ServerPort(role="game", port=28015, protocol="udp"),
                ServerPort(role="query", port=28016, protocol="udp"),
            ],
        )
        db.add(srv)
        db.commit()
        shop_slot_service.apply_server_slots(db, srv, 10)

        monkeypatch.setattr(
            player_query_service,
            "query_a2s",
            lambda host, port, timeout=2.0: player_query_service.PlayerQueryResult(
                protocol="a2s", online=True, players=15, max_players=50, server_name="Rust"
            ),
        )
        res = player_query_service.query_server_players(db, srv)
        assert res.online is True
        assert res.players == 15
        assert res.booked_slots == 10
        assert res.slot_exceeded is True
        assert res.warning is not None and "15" in res.warning
        assert srv.status == "running"


class TestServerSlotsAndPlayersApi:
    def test_players_and_slots_endpoints_rbac_and_warnings(
        self,
        client: TestClient,
        owner_cookies: dict,
        csrf_token: str,
        regular_user,
        user_cookies: dict,
        user_csrf_token: str,
        db: Session,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        srv = Server(
            name="Palworld API",
            game_type="palworld",
            install_dir="/tmp/pal-api",
            status="running",
        )
        fixed_srv = Server(
            name="Valheim API",
            game_type="valheim",
            install_dir="/tmp/valheim-api",
            status="stopped",
        )
        db.add_all([srv, fixed_srv])
        db.commit()

        # Fremder Nutzer ohne Recht erhaelt 404 (kein Enum-Leak)
        assert (
            client.get(f"/api/shop/servers/{srv.id}/players", cookies=user_cookies).status_code
            == 404
        )
        # Mit server.view darf der Nutzer abfragen
        permission_service.set_user_server_permissions(
            db, regular_user.id, srv.id, ["server.view"], granted_by=None
        )
        db.commit()

        monkeypatch.setattr(
            player_query_service,
            "query_server_players",
            lambda _db, _srv: player_query_service.PlayerQueryResult(
                protocol="a2s",
                online=True,
                players=14,
                max_players=32,
                booked_slots=16,
                slot_exceeded=False,
            ),
        )
        res_players = client.get(f"/api/shop/servers/{srv.id}/players", cookies=user_cookies)
        assert res_players.status_code == 200
        assert res_players.json()["players"] == 14

        # Kunde darf Slots nicht direkt per Admin-Endpunkt ueberschreiben (403)
        assert (
            client.post(
                f"/api/shop/servers/{srv.id}/slots",
                cookies=user_cookies,
                headers={"X-CSRF-Token": user_csrf_token},
                json={"slots": 20},
            ).status_code
            == 403
        )
        # Ohne CSRF -> 403
        assert (
            client.post(
                f"/api/shop/servers/{srv.id}/slots",
                cookies=owner_cookies,
                json={"slots": 20},
            ).status_code
            == 403
        )

        # Admin setzt Slots auf 20 -> Upgrade
        res_up = client.post(
            f"/api/shop/servers/{srv.id}/slots",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"slots": 20},
        )
        assert res_up.status_code == 200, res_up.text
        assert res_up.json()["slots"] == 20
        assert res_up.json()["downgrade_warning"] is False
        assert res_up.json()["restart_required"] is True

        # Downgrade auf 10 (unter previous=20 und live=14) -> downgrade_warning=True
        res_down = client.post(
            f"/api/shop/servers/{srv.id}/slots",
            cookies=owner_cookies,
            headers={"X-CSRF-Token": csrf_token},
            json={"slots": 10},
        )
        assert res_down.status_code == 200
        assert res_down.json()["downgrade_warning"] is True
        assert res_down.json()["live_players"] == 14

        # Out-of-range oder nicht-slotfaehiger Blueprint -> 422
        assert (
            client.post(
                f"/api/shop/servers/{srv.id}/slots",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={"slots": 999},
            ).status_code
            == 422
        )
        assert (
            client.post(
                f"/api/shop/servers/{fixed_srv.id}/slots",
                cookies=owner_cookies,
                headers={"X-CSRF-Token": csrf_token},
                json={"slots": 10},
            ).status_code
            == 422
        )
