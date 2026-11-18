import io
from PIL import Image
import pytest
from fastapi.testclient import TestClient
from models import User


def _make_valid_png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", (8, 8), (40, 120, 220, 255)).save(buf, format="PNG")
    return buf.getvalue()


def test_avatar_upload_and_delete(client: TestClient, owner_user: User, owner_cookies: dict, csrf_token: str):
    png_bytes = _make_valid_png_bytes()

    files = {"file": ("test.png", io.BytesIO(png_bytes), "image/png")}
    headers = {"X-CSRF-Token": csrf_token}
    res = client.post("/api/auth/me/avatar", files=files, headers=headers, cookies=owner_cookies)
    assert res.status_code == 200
    data = res.json()
    assert data["avatar_url"] is not None
    assert "/api/auth/avatar/avatar_" in data["avatar_url"]

    # Get avatar image (automatisch auf WebP normalisiert & nosniff gesetzt)
    avatar_path = data["avatar_url"]
    assert avatar_path.endswith(".webp")
    get_res = client.get(avatar_path)
    assert get_res.status_code == 200
    assert get_res.content[:4] == b"RIFF" and get_res.content[8:12] == b"WEBP"
    assert get_res.headers.get("access-control-allow-origin") == "*"
    assert get_res.headers.get("x-content-type-options") == "nosniff"
    # Der eigene Kopf der Route gilt, nicht die Vorgabe für die API.
    assert get_res.headers["cache-control"] == "public, max-age=86400"

    # Delete avatar
    del_res = client.delete("/api/auth/me/avatar", headers=headers, cookies=owner_cookies)
    assert del_res.status_code == 200
    assert del_res.json()["avatar_url"] is None

    # Get deleted avatar returns 404
    get_res_after = client.get(avatar_path)
    assert get_res_after.status_code == 404
    assert get_res_after.headers["cache-control"] == "no-store"


def test_avatar_invalid_format(client: TestClient, owner_user: User, owner_cookies: dict, csrf_token: str):
    files = {"file": ("bad.exe", io.BytesIO(b"MZ\x90\x00notanimage"), "application/octet-stream")}
    headers = {"X-CSRF-Token": csrf_token}
    res = client.post("/api/auth/me/avatar", files=files, headers=headers, cookies=owner_cookies)
    assert res.status_code == 400


def test_avatar_corrupted_png(client: TestClient, owner_user: User, owner_cookies: dict, csrf_token: str):
    files = {"file": ("corrupt.png", io.BytesIO(b"fake png data"), "image/png")}
    headers = {"X-CSRF-Token": csrf_token}
    res = client.post("/api/auth/me/avatar", files=files, headers=headers, cookies=owner_cookies)
    assert res.status_code == 400


def test_avatar_too_large(client: TestClient, owner_user: User, owner_cookies: dict, csrf_token: str):
    oversized = _make_valid_png_bytes() + (b"\x00" * (5 * 1024 * 1024 + 1024))
    files = {"file": ("huge.png", io.BytesIO(oversized), "image/png")}
    headers = {"X-CSRF-Token": csrf_token}
    res = client.post("/api/auth/me/avatar", files=files, headers=headers, cookies=owner_cookies)
    assert res.status_code == 400
