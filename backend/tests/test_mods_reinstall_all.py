"""API: reinstall-all workshop mods."""

from models import Mod


class _ModsPlugin:
    supports_mods = True

    def cleanup_mod(self, server, workshop_id):
        return {"ok": True}

    def install_mods(self, server, workshop_ids):
        return {
            "ok": True,
            "items": {wid: {"ok": True} for wid in workshop_ids},
        }

    def update_modlist(self, server):
        return None


def test_reinstall_all_marks_pending_and_queues(client, db, test_server, owner_cookies, csrf_token, monkeypatch):
    monkeypatch.setattr("routers.mods.get_plugin", lambda _gt: _ModsPlugin())
    ran: list[tuple[int, list[str]]] = []

    def _fake_bg(server_id: int, workshop_ids: list[str]) -> None:
        ran.append((server_id, list(workshop_ids)))

    monkeypatch.setattr("routers.mods.reinstall_all_mods_bg", _fake_bg)

    for i, wid in enumerate(("111", "222")):
        db.add(
            Mod(
                server_id=test_server.id,
                workshop_id=wid,
                name=f"Mod {wid}",
                load_order=i,
                install_status="installed",
                install_progress=100,
                update_status="up_to_date",
            )
        )
    db.commit()

    headers = {"X-CSRF-Token": csrf_token or ""}
    response = client.post(
        f"/api/mods/{test_server.id}/reinstall-all",
        cookies=owner_cookies,
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload) == 2
    assert all(m["install_status"] == "pending" for m in payload)
    assert all(m["install_action"] == "reinstall" for m in payload)
    assert ran == [(test_server.id, ["111", "222"])]


def test_abort_installs_stops_running_reinstall_loop_and_clears_pending_update(
    client, db, test_server, owner_cookies, csrf_token, monkeypatch
):
    from routers.mods import _run_with_mod_generation, reinstall_all_mods_bg
    from services.install_update_lock_service import reset_install_update_lock_for_tests
    from services.redis_backplane import get_mod_abort_generation

    reset_install_update_lock_for_tests()
    headers = {"X-CSRF-Token": csrf_token or ""}

    mod1 = Mod(
        server_id=test_server.id,
        workshop_id="101",
        name="Mod 101",
        load_order=0,
        install_status="pending",
        install_action="reinstall",
    )
    mod2 = Mod(
        server_id=test_server.id,
        workshop_id="202",
        name="Mod 202",
        load_order=1,
        install_status="pending",
        install_action="update",
    )
    db.add_all([mod1, mod2])
    db.commit()

    seen_calls: list[str] = []

    class _AbortingPlugin:
        supports_mods = True

        def cleanup_mod(self, server, workshop_id):
            return {"ok": True}

        def install_mod(self, server, workshop_id):
            seen_calls.append(workshop_id)
            resp = client.post(
                f"/api/mods/{test_server.id}/abort-installs",
                cookies=owner_cookies,
                headers=headers,
            )
            assert resp.status_code == 200
            return {"ok": False, "error": "aborted"}

        def update_modlist(self, server):
            raise AssertionError("update_modlist must not run after abort")

    monkeypatch.setattr("routers.mods.get_plugin", lambda _gt: _AbortingPlugin())

    gen = get_mod_abort_generation(test_server.id)
    _run_with_mod_generation(test_server.id, gen, reinstall_all_mods_bg, test_server.id, ["101", "202"])

    assert seen_calls == ["101"]

    db.expire_all()
    rows = db.query(Mod).filter(Mod.server_id == test_server.id).order_by(Mod.load_order.asc()).all()
    assert all(r.install_status not in ("pending", "installing") for r in rows)

    monkeypatch.setattr("routers.mods.reinstall_all_mods_bg", lambda sid, wids: None)
    reinstall_resp = client.post(
        f"/api/mods/{test_server.id}/reinstall-all",
        cookies=owner_cookies,
        headers=headers,
    )
    assert reinstall_resp.status_code == 200
