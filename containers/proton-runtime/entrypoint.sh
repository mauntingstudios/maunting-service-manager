#!/usr/bin/env bash
set -euo pipefail

mkdir -p "${HOME}/.steam/sdk32" "${HOME}/.steam/sdk64" "${HOME}/.local/share/umu"
mkdir -p "${WINEPREFIX:-${HOME}/.proton-prefix}"
ln -sfn /opt/steamcmd/linux32/steamclient.so "${HOME}/.steam/sdk32/steamclient.so"
ln -sfn /opt/steamcmd/linux64/steamclient.so "${HOME}/.steam/sdk64/steamclient.so"

exec "$@"
