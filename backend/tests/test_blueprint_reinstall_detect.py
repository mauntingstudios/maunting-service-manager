"""Reinstall detection for Steam HTTP install paths."""
from pathlib import Path

from games.blueprint_plugin import _steam_install_is_reinstall


def test_steam_reinstall_detects_manifest(tmp_path):
    root = tmp_path / "srv"
    (root / "steamapps").mkdir(parents=True)
    (root / "steamapps" / "appmanifest_443030.acf").write_text('"AppState"\n{\n}\n')
    assert _steam_install_is_reinstall(str(root), "443030") is True


def test_steam_reinstall_empty_dir_false(tmp_path):
    root = tmp_path / "empty"
    root.mkdir()
    assert _steam_install_is_reinstall(str(root), "443030") is False


def test_steam_install_is_reinstall_handles_permission_error(monkeypatch, tmp_path) -> None:
    root = tmp_path / "srv"
    root.mkdir()
    monkeypatch.setattr(
        "games.blueprint_plugin.Path.is_dir",
        lambda self: (_ for _ in ()).throw(PermissionError("denied")),
    )
    assert _steam_install_is_reinstall(str(root), "443030") is False


def test_steam_install_is_reinstall_delegates_to_agent(monkeypatch) -> None:
    from types import SimpleNamespace

    calls: list[tuple[str | int, str]] = []

    class FakeClient:
        def files_list(self, server_id, path=""):
            calls.append((server_id, path))
            if path == "":
                return [{"name": "steamapps", "is_dir": True}]
            if path == "steamapps":
                return [{"name": "appmanifest_380870.acf", "is_dir": False}]
            return []

    node = SimpleNamespace(is_local=False)
    server = SimpleNamespace(id=138, install_dir="/opt/msm/servers/138", node=node)
    monkeypatch.setattr("services.node_capacity.should_delegate_node_fs_to_agent", lambda n: n is node)
    monkeypatch.setattr("services.node_client.NodeClient.from_node", lambda n: FakeClient())

    assert _steam_install_is_reinstall("/opt/msm/servers/138", "380870", server=server) is True
    assert calls[0] == ("138", "")
