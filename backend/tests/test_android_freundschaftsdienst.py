"""Beide Android-Dienste melden eine Freundschaftsanfrage gleich.

MSS und Pontis haben je eine eigene Kopie des Vordergrunddienstes. Der Zweig
fuer Freundschaftsanfragen darf in einer davon nicht fehlen; sonst bleibt die
App bei geschlossenem Fenster auf genau einer Plattform stumm.
"""

from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

DIENSTE = (
    ROOT / "smart-system" / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "java"
    / "com" / "mauntingstudios" / "smart_system" / "Hintergrunddienst.kt",
    ROOT / "browser" / "src-tauri" / "gen" / "android" / "app" / "src" / "main" / "java"
    / "com" / "mauntingstudios" / "secure_browser" / "Hintergrunddienst.kt",
)


def test_beide_dienste_melden_freundschaftsanfragen() -> None:
    for pfad in DIENSTE:
        text = pfad.read_text(encoding="utf-8")
        assert 'type == "friend_request_received"' in text, pfad
        assert 'optBoolean("melden", true)' in text, pfad
        assert 'json.optString("ereignis", "")' in text, pfad
        assert "Neue Freundschaftsanfrage" in text, pfad
        assert "schonGesehen(kennung)" in text, pfad
