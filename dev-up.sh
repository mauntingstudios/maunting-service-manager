#!/usr/bin/env bash
# dev-up.sh - startet den lokalen Dev-Stack (docker-compose.dev.yml).
#
# Der Dev-Stack verlangt echte Geheimnisse und kennt keine Defaults mehr.
# Aufruf: `bash dev-up.sh [-d] [Dienste...]`.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_DEV="$ROOT/.env.dev"

python3 "$ROOT/scripts/setup-dev-env.py"

exec docker compose --env-file "$ENV_DEV" -f "$ROOT/docker-compose.dev.yml" up "$@"
