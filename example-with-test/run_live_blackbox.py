"""Live Black-Box Harness for Phase 8.

Boots a clean MSM backend on WSL2 PostgreSQL (port 15499), creates a Sandbox
Hoster Integration via the documented Admin API, and runs the external test-shop
E2E suite strictly over HTTP.
"""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = ROOT / "backend"
SHOP_PYTHON = ROOT / "example-with-test" / ".venv" / "Scripts" / "python.exe"
TEST_FILE = ROOT / "example-with-test" / "test_phase8_e2e.py"

DB_NAME = "msm_phase8_blackbox"
ADMIN_PG_URL = "postgresql://postgres@127.0.0.1:15499/postgres"
TEST_PG_URL = f"postgresql://postgres@127.0.0.1:15499/{DB_NAME}"
PANEL_URL = "http://127.0.0.1:18099"


def _psql_recreate_db() -> None:
    from sqlalchemy import create_engine, text

    eng = create_engine(ADMIN_PG_URL, isolation_level="AUTOCOMMIT")
    with eng.connect() as conn:
        conn.execute(
            text(
                f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{DB_NAME}' AND pid <> pg_backend_pid()"
            )
        )
        conn.execute(text(f"DROP DATABASE IF EXISTS {DB_NAME}"))
        conn.execute(text(f"CREATE DATABASE {DB_NAME}"))
    eng.dispose()


def _psql_drop_db() -> None:
    from sqlalchemy import create_engine, text

    eng = create_engine(ADMIN_PG_URL, isolation_level="AUTOCOMMIT")
    with eng.connect() as conn:
        conn.execute(
            text(
                f"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{DB_NAME}' AND pid <> pg_backend_pid()"
            )
        )
        conn.execute(text(f"DROP DATABASE IF EXISTS {DB_NAME}"))
    eng.dispose()


def _seed_base_entities() -> tuple[str, str, int]:
    """Create owner, service user (servers.create + servers.delete), node, and active ShopPlan."""
    sys.path.insert(0, str(BACKEND_DIR))
    os.environ["MSM_DATABASE_URL"] = TEST_PG_URL
    os.environ["MSM_DATABASE_URL_ASYNC"] = TEST_PG_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
    os.environ.setdefault("MSM_SECRET_KEY", "phase8-blackbox-secret-key-minimum-32-chars-ok")
    os.environ.setdefault("MSM_PANEL_URL", PANEL_URL)

    from database import SessionLocal
    from models.node import Node
    from models.role import Role
    from models.role_permission import RolePermission
    from models.shop import ShopAddon, ShopPlan
    from models.user import User
    from models.user_role import UserRole
    from services.auth_service import AuthService

    owner_pw = "Phase8Owner!12345"
    svc_pw = "Phase8Service!12345"

    with SessionLocal() as db:
        owner = User(
            username="phase8_owner",
            password_hash=AuthService.hash_password(owner_pw),
            is_owner=True,
            is_active=True,
        )
        svc_role = Role(name="phase8_hoster_service", is_system=False)
        svc_user = User(
            username="phase8_service",
            password_hash=AuthService.hash_password(svc_pw),
            is_owner=False,
            is_active=True,
        )
        db.add_all([owner, svc_role, svc_user])
        db.flush()
        for perm in ("servers.create", "servers.delete", "servers.view"):
            db.add(RolePermission(role_id=svc_role.id, permission_key=perm))
        db.add(UserRole(user_id=svc_user.id, role_id=svc_role.id))

        node = Node(
            name="phase8-de-fra1",
            host="127.0.0.1",
            auth_token_enc="phase8-dummy-agent-token",
            is_local=False,
            status="online",
            ram_total=32768 * 1024 * 1024,
            cpu_total=8.0,
            disk_total=500 * 1024 * 1024 * 1024,
            ddos_provider="Hetzner / Voxility",
            ddos_profile="Game-Aware L3/L4",
            ddos_game_aware=True,
        )
        db.add(node)
        db.flush()

        plan = ShopPlan(
            name="Phase 8 Palworld 8GB",
            game_type="palworld",
            price_cents=990,
            currency="EUR",
            ram_included_mb=4096,
            ram_max_mb=16384,
            ram_step_mb=1024,
            cpu_included=200,
            cpu_max=400,
            slots_included=16,
            slots_max=64,
            node_id=node.id,
            active=True,
        )
        addon = ShopAddon(
            slug="phase8-ai-plus",
            name="Phase 8 KI Plus",
            category="ai_quota",
            price_cents=299,
            currency="EUR",
            extra_ai_tokens=10000,
            active=True,
        )
        db.add_all([plan, addon])
        db.commit()
        import uuid

        owner_token = AuthService.create_access_token(
            {
                "sub": owner.username,
                "user_id": owner.id,
                "jti": str(uuid.uuid4()),
                "familie": "phase8-blackbox",
            }
        )
        csrf_token = AuthService.create_csrf_token()
        return owner.username, owner_token, csrf_token, svc_user.id


def main() -> int:
    _psql_recreate_db()
    env = os.environ.copy()
    env["MSM_DATABASE_URL"] = TEST_PG_URL
    env["MSM_DATABASE_URL_ASYNC"] = TEST_PG_URL.replace("postgresql://", "postgresql+asyncpg://", 1)
    env["MSM_PANEL_URL"] = PANEL_URL
    env["MSM_TESTING"] = "true"
    env["MSM_DISABLE_STARTUP_SIDE_EFFECTS"] = "1"
    env["MSM_SECRET_KEY"] = os.environ.get("MSM_SECRET_KEY") or secrets.token_hex(32)
    env["MSM_DIS_SALT"] = os.environ.get("MSM_DIS_SALT") or secrets.token_hex(32)
    env["MSM_DIS_SIDECAR_TOKEN"] = os.environ.get("MSM_DIS_SIDECAR_TOKEN") or secrets.token_hex(32)
    os.environ["MSM_SECRET_KEY"] = env["MSM_SECRET_KEY"]
    os.environ["MSM_DIS_SIDECAR_TOKEN"] = env["MSM_DIS_SIDECAR_TOKEN"]

    # 1. Create schema via SQLAlchemy metadata & stamp Alembic head
    init_code = (
        "import os, sys; sys.path.insert(0, '.'); "
        "from database import Base, engine; import models; "
        "Base.metadata.create_all(bind=engine)"
    )
    mig = subprocess.run(
        [sys.executable, "-c", init_code],
        cwd=str(BACKEND_DIR),
        env=env,
        capture_output=True,
        text=True,
    )
    if mig.returncode != 0:
        print("Schema init failed:", mig.stdout, mig.stderr)
        _psql_drop_db()
        return 1
    subprocess.run(
        [sys.executable, "-m", "alembic", "stamp", "head"],
        cwd=str(BACKEND_DIR),
        env=env,
        check=True,
        capture_output=True,
        text=True,
    )

    # 1b. Start dis-sidecar so AuthService.hash_password & DIS encryption work live
    dis_proc = subprocess.Popen(
        ["node", "server.mjs"],
        cwd=str(ROOT / "dis-sidecar"),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    dis_ready = False
    for _ in range(40):
        if dis_proc.poll() is not None:
            print("dis-sidecar exited early:", dis_proc.stdout.read() if dis_proc.stdout else "")
            _psql_drop_db()
            return 1
        try:
            r = httpx.get(
                "http://127.0.0.1:9100/health",
                headers={"Authorization": f"Bearer {env['MSM_DIS_SIDECAR_TOKEN']}"},
                timeout=0.5,
            )
            if r.status_code in (200, 401, 403):
                dis_ready = True
                break
        except Exception:
            time.sleep(0.25)
    if not dis_ready:
        print("dis-sidecar not ready")
        dis_proc.terminate()
        _psql_drop_db()
        return 1

    owner_user, owner_token, csrf_token, svc_user_id = _seed_base_entities()

    # 2. Start MSM backend
    proc = subprocess.Popen(
        [sys.executable, "-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "18099"],
        cwd=str(BACKEND_DIR),
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )

    try:
        ready = False
        last_err = ""
        for _ in range(40):
            if proc.poll() is not None:
                print("MSM uvicorn exited early:", proc.stdout.read() if proc.stdout else "")
                return 1
            try:
                r = httpx.get(f"{PANEL_URL}/api/hoster/v1/health", timeout=10.0, trust_env=False)
                if r.status_code in (200, 401, 404):
                    ready = True
                    break
                last_err = f"HTTP {r.status_code}"
            except Exception as exc:
                last_err = repr(exc)
            time.sleep(0.5)
        if not ready:
            proc.terminate()
            print("MSM backend did not become ready in time. Last err:", last_err)
            print("Output:", proc.stdout.read() if proc.stdout else "")
            return 1

        # 3. Use Owner session cookie + CSRF + Bearer to create Sandbox Hoster Integration via documented Admin API
        with httpx.Client(
            base_url=PANEL_URL,
            timeout=30.0,
            trust_env=False,
            cookies={"access_token": owner_token, "msm_csrf": csrf_token},
        ) as client:
            headers = {
                "Authorization": f"Bearer {owner_token}",
                "X-CSRF-Token": csrf_token,
            }

            integ = client.post(
                "/api/hoster/integrations",
                headers=headers,
                json={
                    "name": "Nordkapp Phase 8 Sandbox",
                    "slug": "nordkapp-phase8-sandbox",
                    "service_user_id": svc_user_id,
                    "is_sandbox": True,
                    "enabled": True,
                },
            )
            assert integ.status_code in (200, 201), f"Create integration failed: {integ.status_code} {integ.text}"
            integ_data = integ.json()
            api_key = (
                integ_data.get("value")
                or integ_data.get("api_key")
                or integ_data.get("plaintext_api_key")
                or integ_data.get("key")
            )
            assert api_key, f"No API key returned. keys={list(integ_data.keys())}"
            integ_list = client.get("/api/hoster/integrations", headers=headers).json()
            integ_items = integ_list if isinstance(integ_list, list) else integ_list.get("items", [])
            integ_id = integ_items[0]["id"]

            wh = client.post(
                f"/api/hoster/integrations/{integ_id}/webhook-secret",
                headers=headers,
            )
            wh_secret = wh.json().get("webhook_secret", "whsec_phase8") if wh.status_code == 200 else "whsec_phase8"

        # 4. Run external test shop Black-Box suite
        test_env = env.copy()
        test_env["MSM_PANEL_URL"] = PANEL_URL
        test_env["MSM_HOSTER_KEY"] = api_key
        test_env["MSM_WEBHOOK_SECRET"] = wh_secret

        res = subprocess.run(
            [
                str(SHOP_PYTHON),
                "-m",
                "pytest",
                "-v",
                "-s",
                str(TEST_FILE),
                "-k",
                "test_live_msm_hoster_api_full_lifecycle",
            ],
            cwd=str(ROOT),
            env=test_env,
        )
        if res.returncode != 0:
            proc.terminate()
            try:
                out, _ = proc.communicate(timeout=3)
                print("--- MSM uvicorn tail ---\n", out[-3000:])
            except Exception:
                pass
        return res.returncode
    finally:
        proc.terminate()
        dis_proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        try:
            dis_proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            dis_proc.kill()
        _psql_drop_db()


if __name__ == "__main__":
    raise SystemExit(main())
