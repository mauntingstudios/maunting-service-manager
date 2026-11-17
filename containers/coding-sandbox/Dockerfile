FROM node:22-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    GIT_TERMINAL_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false

# Nur reine Entwicklungs-Laufzeiten und Testwerkzeuge (kein sudo, kein curl/wget, kein netcat).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    git \
    python3 \
    python3-pip \
    python3-pytest \
    python3-venv \
    ripgrep \
  && rm -rf /var/lib/apt/lists/* \
  && ln -sf /usr/bin/python3 /usr/local/bin/python \
  && npm install -g typescript@5.8.3 \
  && npm cache clean --force \
  && git config --system core.hooksPath /dev/null \
  && git config --system protocol.file.allow never \
  && git config --system submodule.recurse false \
  && mkdir -p /workspace /tmp/sandbox_home \
  && chown -R 1000:1000 /workspace /tmp/sandbox_home

ENV HOME=/tmp/sandbox_home \
    npm_config_cache=/tmp/npm_cache \
    PIP_CACHE_DIR=/tmp/pip_cache

USER 1000:1000
WORKDIR /workspace
