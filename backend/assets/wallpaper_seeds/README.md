# Wallpaper-Seeds (Nicht-Steam-Spiele)

Dieses Verzeichnis nimmt die **offiziellen Titelbilder** fuer Spiele ohne
Steam-Quelle auf. Sie werden einmalig per

    cd backend && python scripts/seed_game_wallpapers.py

in die Wallpaper-Galerie eingespielt (`uploaded_by="system"`, sofort aktiv).

## Dateinamen (datengetrieben, keine Codeliste)

Jede Datei heisst `{game_type}.webp` (auch `.jpg`/`.png` erlaubt):

- `minecraft_fabric.webp`
- `minecraft_forge.webp`
- `minecraft_neoforge.webp`
- `minecraft_paper.webp`
- `minecraft_purpur.webp`
- `minecraft_spigot.webp`
- `minecraft_sponge.webp`
- `minecraft_vanilla.webp`
- `hytale.webp`

## Regeln

- Die Bilder liegen aus Lizenzgruenden **nicht** im Repo — sie werden vom
  Betreiber hier abgelegt.
- Das Skript sanitisiert wie ein Upload (WebP, max. 2560 px, max. 10 MB).
- Ein Spiel mit bestehenden Galerieeinträgen wird **nie** ueberschrieben.
- Fehlt eine Datei, bleibt es beim Panorama — kein Fehler, kein Pflegeort.
