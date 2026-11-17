#!/usr/bin/env python3
"""Seedet die Wallpaper-Galerie fuer Nicht-Steam-Spiele (Minecraft, Hytale).

Datengetrieben, keine Codeliste: Jede Datei ``{game_type}.webp`` (auch .jpg
oder .png) in ``backend/assets/wallpaper_seeds/`` wird — nach derselben
Sanitisierung wie ein Upload — als aktives Galeriebild genau dann angelegt,
wenn das Spiel noch keine Galerieeintraege hat. Bestehende Uploads werden
nie ueberschrieben.

Offizielle Artworks liegen aus Lizenzgruenden nicht im Repo; sie werden vom
Betreiber in das Seed-Verzeichnis gelegt (siehe README dort) und einmalig mit
diesem Skript eingespielt:

    cd backend && python scripts/seed_game_wallpapers.py
"""

from __future__ import annotations

import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from sqlalchemy.orm import Session  # noqa: E402

import database as db_module  # noqa: E402
from services import wallpaper_service as ws  # noqa: E402

SEED_DIR = BACKEND / "assets" / "wallpaper_seeds"
SEED_SUFFIXES = (".webp", ".jpg", ".jpeg", ".png")


def seed_game_wallpapers(db: Session, seed_dir: Path) -> list[str]:
    """Spielt Seeds ein; gibt die geseedeten game_types zurueck."""
    geseedet: list[str] = []
    if not seed_dir.is_dir():
        return geseedet
    for datei in sorted(seed_dir.iterdir()):
        if not datei.is_file() or datei.suffix.lower() not in SEED_SUFFIXES:
            continue
        game_type = datei.stem
        if ws.get_gallery(db, game_type):
            continue
        try:
            webp = ws.sanitize_and_compress_wallpaper(datei.read_bytes())
        except ws.WallpaperValidationError as exc:
            print(f"uebersprungen ({game_type}): {exc.message}")
            continue
        ws.store_wallpaper(db, game_type, webp, "system")
        geseedet.append(game_type)
    return geseedet


def main() -> int:
    db = db_module.SessionLocal()
    try:
        geseedet = seed_game_wallpapers(db, SEED_DIR)
    finally:
        db.close()
    if geseedet:
        print("Galerie-Seeds eingespielt: " + ", ".join(geseedet))
    else:
        print("Keine neuen Seeds (Verzeichnis leer oder Galerien befuellt).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
