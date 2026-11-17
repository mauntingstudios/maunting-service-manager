#!/usr/bin/env python3
"""Prueft die Wallpaper-Artwork-Abdeckung aller nativen Steam-Blueprints.

Ohne Argumente: Tabelle mit der Aufloesungskette
(artworkAppId -> workshopAppId -> appId) je Steam-Blueprint.

--check-steam: Holt zusaetzlich je Ketten-Ergebnis das library_hero.jpg vom
    Steam-CDN und meldet fehlende Artworks (Exit 1). Netz-Zugriff noetig.
--verify BP=ID[,BP=ID...]: Prueft Kandidaten-Game-IDs (Hero vorhanden? Name
    aus der Store-API?) — z. B. beim Anlegen eines neuen Blueprints.

Beispiele:
    cd backend && python scripts/check_artwork_app_ids.py
    cd backend && python scripts/check_artwork_app_ids.py --check-steam
    cd backend && python scripts/check_artwork_app_ids.py --verify rust=252490
"""

from __future__ import annotations

import argparse
import json
import sys
import urllib.request
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from blueprints.schema import load_blueprint_file  # noqa: E402

NATIVE_DIR = BACKEND / "blueprints" / "native"
STEAM_HERO = "https://cdn.cloudflare.steamstatic.com/steam/apps/{}/library_hero.jpg"


def _alle_steam_blueprints() -> list:
    bps = []
    for datei in sorted(NATIVE_DIR.glob("*.blueprint.json")):
        try:
            bp = load_blueprint_file(datei)
        except Exception as exc:  # noqa: BLE001
            print(f"WARNUNG: {datei.name} ungueltig: {exc}")
            continue
        if bp.source.type.value != "steam":
            continue
        bps.append(bp)
    return bps


def _kette(bp) -> tuple[str, str]:
    """Gibt (ketten_id, quelle) zurueck."""
    steam = bp.source.steam
    if steam.artworkAppId:
        return steam.artworkAppId, "artworkAppId"
    if bp.mods is not None and bp.mods.workshopAppId:
        return bp.mods.workshopAppId, "workshopAppId"
    return steam.appId, "appId (Server-Tool)"


def _hero_status(app_id: str) -> tuple[bool, str]:
    req = urllib.request.Request(
        STEAM_HERO.format(app_id), method="GET", headers={"User-Agent": "MSM-artwork-check"}
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            typ = (resp.headers.get("content-type") or "").lower()
            if resp.status == 200 and "image" in typ:
                return True, "ok"
            return False, f"status={resp.status} type={typ}"
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)[:70]


def _store_name(app_id: str) -> str:
    url = f"https://store.steampowered.com/api/appdetails?appids={app_id}"
    req = urllib.request.Request(url, headers={"User-Agent": "MSM-artwork-check"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            daten = json.load(resp)
        info = daten.get(str(app_id), {})
        if info.get("success"):
            return info["data"].get("name", "?")
        return "(kein Store-Eintrag)"
    except Exception as exc:  # noqa: BLE001
        return f"(Fehler: {exc})"[:60]


def bericht(check_steam: bool) -> int:
    fehler = 0
    print(f"{'Blueprint':28} {'Kette':10} {'Quelle':20} Hero")
    for bp in _alle_steam_blueprints():
        ketten_id, quelle = _kette(bp)
        hero = "-"
        if check_steam:
            ok, detail = _hero_status(ketten_id)
            hero = "ok" if ok else f"FEHLT ({detail})"
            if not ok:
                fehler += 1
        flag = ""
        if quelle == "appId (Server-Tool)" and (not check_steam or hero != "ok"):
            flag = "  <-- braucht artworkAppId?"
        print(f"{bp.meta.id:28} {ketten_id:10} {quelle:20} {hero}{flag}")
    return 1 if fehler else 0


def verifiziere(paare: str) -> int:
    fehler = 0
    for paar in paare.split(","):
        if "=" not in paar:
            print(f"IGNORIERT (kein BP=ID): {paar}")
            continue
        bp_id, kandidat = (p.strip() for p in paar.split("=", 1))
        ok, detail = _hero_status(kandidat)
        name = _store_name(kandidat)
        status = "OK " if ok else "FEHLT"
        if not ok:
            fehler += 1
        print(f"{status} {bp_id} = {kandidat}  hero={detail}  name={name}")
    return 1 if fehler else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check-steam", action="store_true")
    parser.add_argument("--verify", default="")
    args = parser.parse_args(argv)
    if args.verify:
        return verifiziere(args.verify)
    return bericht(args.check_steam)


if __name__ == "__main__":
    raise SystemExit(main())
