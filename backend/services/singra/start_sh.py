"""Generierung deterministischer start.sh-Startskripte für Container."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def generate_start_sh(files: dict[str, str] | list[str] | Path) -> str:
    """Erzeugt ein ausführbares start.sh-Skript basierend auf Projektdateien.

    Invarianten:
    - Setzt immer PORT=${PORT:-${API_PORT:-${SERVER_PORT:-3001}}}
    - Setzt HOST=0.0.0.0
    - Priorisiert saubere Ausführung per exec, damit Signale (SIGTERM)
      direkt an den Prozess gehen.
    """
    file_map: dict[str, str] = {}
    file_keys: set[str] = set()

    if isinstance(files, Path):
        if files.is_dir():
            for p in files.rglob("*"):
                if p.is_file():
                    rel = p.relative_to(files).as_posix()
                    file_keys.add(rel)
                    try:
                        file_map[rel] = p.read_text(encoding="utf-8", errors="ignore")
                    except Exception:
                        pass
    elif isinstance(files, dict):
        file_map = files
        file_keys = set(files.keys())
    elif isinstance(files, (list, tuple, set)):
        file_keys = set(files)

    header = """#!/bin/sh
set -e

# Port- und Host-Binding für Container
export PORT="${PORT:-${API_PORT:-${SERVER_PORT:-3001}}}"
export HOST="${HOST:-0.0.0.0}"
"""

    # 1. Node.js Projekt
    is_node = (
        "package.json" in file_keys
        or any(k.endswith("package.json") for k in file_keys)
        or any(k in file_keys for k in ("server.js", "index.js", "main.js", "backend/server.js", "backend/index.js", "server/index.js"))
    )
    if is_node:
        pkg_key = "package.json" if "package.json" in file_keys else next((k for k in file_keys if k.endswith("package.json")), None)
        scripts: dict[str, str] = {}
        main_entry = ""
        if pkg_key:
            try:
                raw_pkg = file_map.get(pkg_key, "")
                if raw_pkg:
                    data = json.loads(raw_pkg)
                    scripts = data.get("scripts", {})
                    main_entry = data.get("main", "")
            except Exception:
                pass

        if "start" in scripts:
            exec_cmd = "exec npm start"
        elif "server" in scripts:
            exec_cmd = "exec npm run server"
        elif main_entry:
            exec_cmd = f"exec node {main_entry}"
        elif "server.js" in file_keys:
            exec_cmd = "exec node server.js"
        elif "backend/server.js" in file_keys:
            exec_cmd = "exec node backend/server.js"
        elif "backend/index.js" in file_keys:
            exec_cmd = "exec node backend/index.js"
        elif "server/index.js" in file_keys:
            exec_cmd = "exec node server/index.js"
        elif "index.js" in file_keys:
            exec_cmd = "exec node index.js"
        elif "main.js" in file_keys:
            exec_cmd = "exec node main.js"
        else:
            exec_cmd = "exec npm start"

        return f"{header}\necho \"[MSM] Starte Node.js Backend auf Port $PORT...\"\n{exec_cmd}\n"

    # 2. Python Projekt
    if "requirements.txt" in file_keys or "main.py" in file_keys or "app.py" in file_keys:
        main_file = "main.py" if "main.py" in file_keys else ("app.py" if "app.py" in file_keys else "main.py")
        mod_name = Path(main_file).stem
        content = file_map.get(main_file, "")
        is_fastapi_or_flask = "FastAPI" in content or "app =" in content or "Flask" in content or "uvicorn" in content

        if is_fastapi_or_flask:
            return f"""{header}
echo "[MSM] Starte Python Backend via Uvicorn auf Port $PORT..."
if [ -f .venv/bin/uvicorn ]; then
  exec .venv/bin/uvicorn {mod_name}:app --host 0.0.0.0 --port "$PORT"
else
  exec python -m uvicorn {mod_name}:app --host 0.0.0.0 --port "$PORT"
fi
"""
        return f"""{header}
echo "[MSM] Starte Python Backend ({main_file}) auf Port $PORT..."
if [ -f .venv/bin/python ]; then
  exec .venv/bin/python {main_file}
else
  exec python {main_file}
fi
"""

    # Standard-Fallback
    return f"""{header}
if [ -f package.json ]; then
  exec npm start
elif [ -f main.py ]; then
  exec python main.py
else
  echo "[MSM Error] Kein bekannter Startbefehl gefunden." >&2
  exit 1
fi
"""
