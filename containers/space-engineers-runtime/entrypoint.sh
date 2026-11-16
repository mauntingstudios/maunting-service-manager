#!/usr/bin/env bash
set -euo pipefail

prefix_dir="${WINEPREFIX:-/home/container/.wine-se}"

if [[ ! -f "${prefix_dir}/system.reg" ]]; then
  printf '%s\n' '[MSM SE] Initialisiere .NET 4.8 Wine-Prefix...'
  mkdir -p "${prefix_dir}"
  cp -a /opt/se-wineprefix/. "${prefix_dir}/"
fi

exec "$@"
