FROM debian:bookworm-slim

ARG FIVEM_BUILD=38435-5c3065c261fb3ba82032fee6803f247198fec221
ARG FIVEM_SHA256=1b58507f68086ca3578c187f31e7b4a2259b7192d76b0c80cfc1af682fdf2be9

LABEL org.opencontainers.image.source="https://github.com/mauntingstudios/maunting-service-manager" \
      org.opencontainers.image.description="Pinned FiveM / RedM FXServer Linux runtime for MSM" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        libgcc-s1 \
        libstdc++6 \
        tini \
        xz-utils \
        zlib1g \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --gid 1000 container \
    && useradd --uid 1000 --gid 1000 --create-home --home-dir /home/container --shell /bin/bash container \
    && mkdir -p /opt/cfx-server \
    && curl -fsSL "https://runtime.fivem.net/artifacts/fivem/build_proot_linux/master/${FIVEM_BUILD}/fx.tar.xz" -o /tmp/fx.tar.xz \
    && echo "${FIVEM_SHA256}  /tmp/fx.tar.xz" | sha256sum --check - \
    && tar -xf /tmp/fx.tar.xz -C /opt/cfx-server \
    && rm -f /tmp/fx.tar.xz \
    && chmod -R a+rX /opt/cfx-server

COPY msm-fivem-server /usr/local/bin/msm-fivem-server
RUN sed -i 's/\r$//' /usr/local/bin/msm-fivem-server && chmod 0755 /usr/local/bin/msm-fivem-server

ENV TXHOST_DATA_PATH=/home/container/txData \
    HOME=/home/container

USER container
WORKDIR /home/container
ENTRYPOINT ["/usr/bin/tini", "-g", "--"]
