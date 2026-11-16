FROM ghcr.io/parkervcp/yolks:wine_10

LABEL org.opencontainers.image.source="https://github.com/mauntingstudios/maunting-service-manager" \
      org.opencontainers.image.description="Wine 10 + .NET Framework 4.8 + VC++ runtime for Space Engineers Dedicated Server" \
      org.opencontainers.image.licenses="GPL-3.0-or-later"

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/se-wineprefix \
    && WINEARCH=win64 WINEPREFIX=/opt/se-wineprefix WINEDLLOVERRIDES="" xvfb-run -a winetricks -q vcrun2013 vcrun2017 dotnet48 \
    && rm -rf /root/.cache/winetricks /tmp/.X* \
    && chown -R container:container /opt/se-wineprefix

COPY entrypoint.sh /usr/local/bin/msm-se-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/msm-se-entrypoint && chmod 0755 /usr/local/bin/msm-se-entrypoint

ENV HOME=/home/container \
    WINEPREFIX=/home/container/.wine-se \
    WINEDLLOVERRIDES="" \
    WINEDEBUG=-all \
    WINEESYNC=1 \
    WINEFSYNC=1

USER container
WORKDIR /home/container
ENTRYPOINT ["/usr/bin/tini", "-g", "--", "/usr/local/bin/msm-se-entrypoint"]
