"""Generierung deterministischer Runtime-Umgebungsvariablen für Singra-Deployments."""

from __future__ import annotations

import logging
from typing import Any
from urllib.parse import quote_plus

from services import postgres_service

logger = logging.getLogger(__name__)


def build_runtime_env(
    *,
    port: int,
    db_credentials: dict[str, Any] | None = None,
    server: Any | None = None,
    environment: str = "prod",
    extra_env: dict[str, str] | None = None,
) -> dict[str, str]:
    """Baut das vollständige, standardisierte Runtime-Environment für ein Singra-Backend.

    Invarianten:
    - Verwendet immer internal_address (z. B. msm-postgres:5432) statt 127.0.0.1
    - Setzt konsistente Port-Variablen (PORT, API_PORT, SERVER_PORT)
    - Setzt HOST=0.0.0.0
    - Setzt NODE_ENV entsprechend (production oder development)
    """
    env: dict[str, str] = {
        "PORT": str(port),
        "API_PORT": str(port),
        "SERVER_PORT": str(port),
        "HOST": "0.0.0.0",
        "NODE_ENV": "development" if environment.lower() == "dev" else "production",
    }

    if db_credentials:
        db_user = str(db_credentials.get("user") or db_credentials.get("username") or "postgres")
        db_pass = str(db_credentials.get("password") or "")
        db_name = str(db_credentials.get("database") or db_credentials.get("name") or "postgres")

        host, db_port = postgres_service.internal_address(server)

        # Wenn db_credentials einen expliziten Host enthalten, der nicht 127.0.0.1/localhost ist
        cred_host = db_credentials.get("host")
        if cred_host and cred_host not in ("127.0.0.1", "localhost", "::1"):
            host = cred_host
            db_port = int(db_credentials.get("port") or db_port)

        encoded_user = quote_plus(db_user)
        encoded_pass = quote_plus(db_pass)
        database_url = f"postgresql://{encoded_user}:{encoded_pass}@{host}:{db_port}/{db_name}"

        env.update({
            "DATABASE_URL": database_url,
            "PGHOST": host,
            "PGPORT": str(db_port),
            "PGDATABASE": db_name,
            "PGUSER": db_user,
            "PGPASSWORD": db_pass,
        })

    if extra_env:
        for k, v in extra_env.items():
            if v is not None:
                env[str(k)] = str(v)

    return env
