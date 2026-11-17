# Architektur- und Implementierungsplan (v3): Spiel-Hintergründe & sicherer Custom-Upload

## Ziel & Leitprinzip

In **Maunting Server Manager (MSM)** zeigt `/servers/:id` ein atmosphärisches Spiel-Titelbild statt nur des statischen Tageszeit-Panoramas. Visuell bleibt alles wie heute: gleicher CSS-Ablauf (`AUSLAUF`-Maske + `msm-tageszeit-verlauf`), keine Zusatzfilter (`frontend/src/components/layout/TageszeitHintergrund.tsx`, gespeist über `Shell.tsx` → `useTageszeitMotiv()` aus `frontend/src/lib/tageszeit.ts`).

**Leitprinzip (SSOT + KISS):** Das **Blueprint ist die einzige Wahrheit** für die Artwork-Quelle. Kein zweites Mapping, keine hartcodierte Tabelle, keine Pflege an zwei Stellen. Und: Es ist nur ein Wallpaper — minimaler Footprint (1 optionales Feld, 1 kleine Tabelle, 1 Dialog, 1 Berechtigungs-Key), kein neuer Service, keine Verschlüsselung.

- **Blueprint deklariert das Was** (welches Steam-Artwork, welche Server-IDs).
- **Runtime macht das Wie** (Upload, Cache, Fallback, Berechtigung).
- **Custom-Upload verändert das Blueprint nicht.** Wer ein Bild auf einen laufenden Server hochlädt, fasst kein Blueprint an.

## Fehler in V1/V2 (in V3 korrigiert)

1. **Zentrale Mapping-Tabellen (`steamGameIds.ts`, `steam_store_service.py`) sind gestrichen.** Sie würden IDs duplizieren, die bereits im Blueprint stehen, und bei jedem neuen Spiel doppelte Pflege erzwingen.
2. **`meta.game` existiert — aber als reines Gruppenlabel.** V2 behauptete fälschlich, es existiere nicht. Richtig (`backend/blueprints/schema.py`, `BlueprintMeta.game`, z. B. `minecraft_paper.json: "game": "Minecraft"`, Gruppierung in `frontend/src/utils/blueprintGroups.ts`): optionales Display-Label ohne Steam-ID, daher **keine** Artwork-Rolle. Vererbung funktioniert ohne Sonderlogik, weil `artworkAppId` mit dem Blueprint kopiert wird.
3. **`server.update` ist kein generelles Update-Recht** (V1 lag falsch): Der Key verwaltet historisch Outbound-Webhooks (`backend/services/permission_catalog.py`). Wallpaper braucht einen eigenen Key.
4. **`workshopAppId` allein genügt nicht:** Bei Rust, Valheim u. v. m. ist es `null` (verifiziert in `backend/blueprints/native/`, 50 Dateien). Daher die Kette mit `artworkAppId` an erster Stelle.
5. **Steam-CDN-Pattern ist De-facto-Konvention, keine belegte API.** Die Steamworks-Assetseite ist login-geschützt; das Pattern `/steam/apps/{id}/library_hero.jpg` wird im Implementierungstest gegen eine echte App-ID verifiziert. Das Design ist davon unabhängig robust (404 → Panorama).

## Lösungsmodell

### 1. Blueprint: `artworkAppId` (optional) — Server-ID vs. Game-ID

In `source.steam` wird **ein** optionales Feld neben der Pflicht-`appId` ergänzt:

```json
"source": {
  "type": "steam",
  "steam": {
    "appId": "380870",
    "artworkAppId": "108600"
  }
}
```

- `source.steam.appId` = Dedicated-Server-/Tool-ID (**Pflicht** bei Steam, numerisch, `backend/blueprints/schema.py`).
- `source.steam.artworkAppId` = Game-ID für das offizielle `library_hero.jpg` (**optional**). Ist die Game-ID gleich der Server-ID, bleibt das Feld leer.
- **„Ist das ein Steam-Spiel?“** beantwortet das System ohne jede Liste: Blueprint per `game_type` aus der Registry laden und `source.type == "steam"` prüfen. Nicht-Spiele (postgres, Backends, Web) fallen natürlich auf Panorama.
- **Auflösung (Backend, exakt diese Reihenfolge):** `artworkAppId` → `mods.workshopAppId` → `source.steam.appId`. Verifiziert sinnvoll: Zomboid (380870/108600), DayZ (223350/221100), Conan (443030/440900), ARK, Arma 3 liefern heute schon die Game-ID über `workshopAppId`; Rust (252490) und Valheim (892970) brauchen `artworkAppId`.
- **Keine neue ID-Liste.** Der Wert steht je Blueprint genau einmal im Blueprint. Neues Spiel = Blueprint-Datei anlegen, nichts weiter pflegen.
- **Editor + Doku:** `frontend/src/features/blueprints/contract.ts` (Typ + Validierung `^\d{1,10}$` + cleanup, Muster Zeile 102/315), `BlueprintBuilder.tsx` / `BlueprintBuilderEditors.tsx` (Feld „Steam Game-ID (Artwork, optional)“ mit Hilfetext und Beispiel Zomboid `380870` → `108600`), Beispiel-Snippets in `schema.py` (DE/EN), Doku in `docs/blueprints.md`, `docs/de-docs/blueprints.md` und in-app `BlueprintsDocs.tsx`.
- **Native Blueprints befüllen (datengetriebene Regel statt fester Spieleliste):** Per Prüfskript über alle Steam-Blueprints `artworkAppId` überall nachtragen, wo die Kette sonst auf eine Server-Tool-ID ohne `library_hero` fällt.
- **Abgeleitete Blueprints:** Wer ein Blueprint dupliziert, kopiert `source.steam` mit — `artworkAppId` erbt sich mit. Keine Sonderfälle.

### 2. Backend-Resolver: einzige Autorität, Frontend rendert nur

Ein einziger Backend-Dienst (`wallpaper_service.py`) entscheidet pro Server:

```text
server.game_type (= Blueprint-ID)
  → Custom-Bild in Galerie aktiv? → ja: liefern
  → nein: Blueprint laden → source.type == "steam"? → artworkAppId-Kette → Steam-Cache
  → sonst: Panorama-Deskriptor
```

- **Frontend enthält keine ID-Tabelle.** `ServerDetail.tsx` setzt nur ein `activeWallpaper`-Motiv in den Zustand; `Shell.tsx` nutzt `activeWallpaper ?? useTageszeitMotiv()` (`Shell.tsx:129`, Klassen/Maske/Höhen unverändert). Die Quelle kommt aus der API (`has_custom_wallpaper`, `wallpaper_url`, `wallpaper_source: custom | steam | panorama`).
- **Keine nativen Assets im Code.** Minecraft-/Hytale-Bilder werden **Galerie-Seeds** (Migrationsdaten, `uploaded_by="system"`), kein Asset-Verzeichnis, kein Code-Pfad. Neue Spiele brauchen nie einen Seed.

### 3. Custom Wallpaper: Laufzeit-Upload pro Spiel, keine Blueprint-Änderung

**1 Klick im Panel, Bild hochladen, fertig.**

- **Auslöser (Frontend):** Auf `/servers/:id` ist der Hintergrund selbst klickbar (wie bei Steam, nur mit Schreibrecht, Hover mit Kamera-Hinweis) + Menüeintrag **„Titelbild anpassen“** in den Mehr-Aktionen (`moreActionItems`, `ServerDetail.tsx:976`). Dialog `ServerWallpaperDialog.tsx`: Statuszeile der aktiven Quelle („Eigenes Bild“ / „Automatisch von Steam“ / „Standard-Panorama“), Drag-&-Drop (JPG/PNG/WebP, max. 10 MB), Vorschau, Fortschritt, **„Auf Standard zurücksetzen“**, Galerie (Miniaturen, „Aktiv“-Badge, Reaktivieren per Klick).
- **Wirkung:** Das Bild wird **für dieses Spiel (`game_type`) gespeichert**, nicht für eine Server-Instanz. Jeder Aufrufer irgendeines Servers dieses Spiels sieht sofort exakt dieses Bild. Kein Blueprint-Commit, kein Deploy, keine ID-Eingabe.
- **Speicherung:** Dateien unter `data/wallpapers/{game_type}/wallpaper_{id}.webp` (desinfiziert + komprimiert), Aktiv-Zeiger in der Tabelle `game_wallpapers` (`id`, `game_type`, `file_name`, `uploaded_by`, `created_at`, `is_active`). Panel-seitig — kein Agent-/Node-Bezug (Multi-Node-unkritisch).
- **Galerie:** Verlauf pro `game_type` zur Wiederverwendung (reaktivieren). Retention: max. 10 Bilder pro Spiel, älteste inaktive werden automatisch entfernt. Kein separater Lösch-Endpoint in V1.
- **Reset:** `DELETE` hebt nur den Aktiv-Zeiger auf (Datei bleibt in Galerie). Danach gilt wieder Steam → Panorama.

### 4. Priorität & Zurücksetzen (explizit)

```text
1. Custom (aktives Galeriebild für game_type)   → gewinnt immer
2. Steam (artworkAppId-Kette, backend-gecacht)   → wenn Blueprint Steam ist
3. Panorama (useTageszeitMotiv)                  → sonst, auch bei Fehlern
```

- Custom **überschreibt** Steam (User-Wunsch schlägt Store-Artwork).
- Reset → Schritt 2–3 werden wieder sichtbar (Steam-Artwork kehrt zurück, nichts muss neu geladen werden).
- Kein Custom-Bild ist kein Fehlerzustand, sondern Normalfall (Schritt 2).

### 5. Berechtigung: Wer darf das Bild ändern?

- **Lesen:** `server.view` genügt.
- **Schreiben (Upload, Reaktivieren, Reset):** neuer Key `server.wallpaper.manage` in `backend/services/permission_catalog.py` (Label: „Server-Titelbild verwalten“). Gate über `require_server_permission` (403 bei fehlendem Recht mit `server.view`, 404 ohne — kein Existenzorakel). UI-Button nur mit Recht rendern (Rollenvorschau-Pattern aus `ServerDetail.tsx` übernehmen).
- **Warum kein bestehender Key?** `server.update` = Webhooks, `server.config.write` = Name/Auto-Restart/Backup. Ein Bild für alle Server eines Spiels verdient einen eigenen Key.
- **Audit:** Jede Änderung (`upload`, `reactivate`, `reset`) als Audit-Event mit `game_type`, Datei-ID und Akteur.
- **Kosten:** 1 neuer Key im Katalog + Rollen-Sync (Default: Owner/Admin ja, übrige Rollen nein).

## Sicherheits- & Performance-Pipeline (schlank, eine Funktion)

1. Größe ≤ 10 MB, ≥ 32 Bytes.
2. Magic-Bytes-Check (JPEG/PNG/WebP); SVG strikt verboten (XSS).
3. Pillow `verify()` + Re-Encode auf RGB (killt EXIF, Polyglots, Schadcode).
4. Lanczos auf max. 2560 px Breite, WebP Quality 85 / Method 6 (~180–300 KB).
5. `Content-Type: image/webp`, `X-Content-Type-Options: nosniff`, `Cache-Control: public, max-age=86400`.
6. **Steam-Cache:** `data/cache/steam_wallpapers/{appId}.webp`, einmal fetchen (Timeout, kein Blockieren des Seitenaufbaus), danach lokal. Negatives Ergebnis mit TTL cachen (kein Endlos-Retry).
7. **Kein Layout Shift:** Solange geladen wird, bleibt das Panorama; Crossfade `transition-opacity duration-700`.

## Was-wenn-Matrix

| Was, wenn … | Verhalten |
|---|---|
| Steam-Artwork 404 / offline / Steam down | Panorama, Fehler ruhig ignoriert (kein 500), Negativ-Cache mit TTL |
| `artworkAppId` fehlt | Kette → `workshopAppId` → `appId` (ggf. 404 → Panorama). Kein harter Fehler |
| `artworkAppId` == `appId` | Erlaubt, keine Sonderbehandlung (Kette liefert dieselbe ID) |
| `artworkAppId` falsch | 404 → Panorama. ID im Blueprint korrigieren, kein Code-Deploy |
| Custom + Steam beide da | Custom gewinnt. Reset stellt Steam wieder her |
| `artworkAppId` nachträglich geändert | Resolver liest zur Laufzeit. Alter Steam-Cache verwaist, Cleanup optional per Job |
| Server gelöscht | Spiel-Bild bleibt (gehört zum Spiel, nicht zur Instanz) |
| Blueprint am Server gewechselt | Server zeigt Galeriebild des **neuen** Spiels — Warntext im Dialog |
| Blueprint dupliziert (neue ID) | Eigene leere Galerie; Steam via kopierter `artworkAppId` sofort da |
| `game_type` ohne Blueprint | Panorama; Upload-Endpunkt 404. Kein Absturz |
| Upload-Race (2 User gleichzeitig) | Last-write-wins pro `game_type`, beide Uploads in Galerie, Audit zeigt beide |
| Galerie voll (> 10) | Älteste inaktive Bilder werden automatisch entfernt |
| Zu großes/falsches Bild | HTTP 400 mit klarer Meldung, Alt-Bild bleibt aktiv |
| Kein Schreibrecht | Button/Klickziel ausgeblendet, API 403 (mit `server.view`) bzw. 404 (ohne) |
| Mehrere Server, dasselbe Spiel | Alle sehen sofort denselben Status. Kein Sync-Bug möglich |
| Nicht-Steam (Minecraft/Hytale) | Seed-Bild aus Galerie oder Panorama (kein Steam-Schritt) |
| Galerie-Bild + Server-Backup | Bilder sind Panel-Daten, nicht Teil des Server-Backups |

## Frontend-Design: Auszug

- **Ziel:** Der Hintergrund ist ein Objekt, das man anklickt wie bei Steam. Kein separates Admin-Formular.
- **Ästhetik:** Zurückhaltend und nativ: kein neues Theme, keine Bild-Overlays außer Bestand (`AUSLAUF`, `msm-tageszeit-verlauf`). Glassmorphism-Kopfzeile bleibt.
- **Dialog:** Statuszeile → Drag-&-Drop-Zone (Hinweis 10 MB) → Vorschau + Fortschritt → Aktionen (Hochladen, Auf Standard zurücksetzen) → Galerie (nach `created_at`, „Aktiv“-Badge, Reaktivieren per Klick).
- **Mikrointeraktionen:** Klickziel nur mit Schreibrecht (Hover: dezente Kamera-Indikation). Erfolg: Dialog schließt, Crossfade. Fehler: Inline-Meldung, Alt-Bild bleibt.
- **Zugänglichkeit:** Dialog-Fokusrücksprung, Tastaturbedienung der Galerie, `alt`-Text, reduzierte Bewegung respektieren.

## Geplante Änderungen

### Backend

- `backend/services/permission_catalog.py` (MODIFY): neuer Key `server.wallpaper.manage`. Audit-Event `server.wallpaper.changed`.
- `backend/blueprints/schema.py` (MODIFY): `artworkAppId` optional in `BlueprintSteamSource` (numerisch, nur bei `source.type = steam` wirksam) + Beispiel-Snippets (DE/EN).
- `backend/blueprints/native/*.blueprint.json` (MODIFY): `artworkAppId` per Prüfskript nachtragen (Regel aus §1, nicht per Handliste).
- `backend/models/game_wallpaper.py` (NEW): Tabelle `game_wallpapers` (`id`, `game_type`, `file_name`, `uploaded_by`, `created_at`, `is_active`) + Migration inkl. Galerie-Seeds (Minecraft-Familie, Hytale).
- `backend/services/wallpaper_service.py` (NEW): `resolve_wallpaper(server)` → Deskriptor (`source`, `url`); `sanitize_and_compress_wallpaper(raw_bytes, game_type)`; `set_active_wallpaper`, `reset_wallpaper`, `get_gallery`; Steam-Fetch + WebP-Cache inkl. Negativ-Cache (kein separates `steam_store_service`-Modul nötig — KISS).
- `backend/routers/servers.py` (MODIFY):
  - `POST /api/servers/{server_id}/wallpaper` (Upload, `server.wallpaper.manage`)
  - `GET /api/servers/{server_id}/wallpaper` (aktiv: Custom oder Steam-Cache, `nosniff`)
  - `DELETE /api/servers/{server_id}/wallpaper` (Reset → Steam/Panorama)
  - `GET /api/servers/{server_id}/wallpaper/gallery` (Verlauf pro `game_type`)
  - `GET /api/servers/{server_id}/wallpaper/gallery/{wallpaper_id}/image` (Miniatur)
  - `POST /api/servers/{server_id}/wallpaper/{wallpaper_id}/activate` (Reaktivieren)
  - `_server_response` (MODIFY): `has_custom_wallpaper`, `wallpaper_url`, `wallpaper_source`.

### Frontend

- `frontend/src/features/blueprints/contract.ts` (MODIFY): `artworkAppId?` im Steam-Typ, Validierung, cleanup.
- `frontend/src/features/blueprints/BlueprintBuilder.tsx` + `BlueprintBuilderEditors.tsx` (MODIFY): Feld „Steam Game-ID (Artwork, optional)“ mit Hilfetext.
- `frontend/src/stores/serverWallpaperStore.ts` (NEW, schlank): `activeWallpaper`, `setActiveWallpaper`. Kein ID-Mapping.
- `frontend/src/components/server/ServerWallpaperDialog.tsx` (NEW): Upload, Galerie, Reset, Status.
- `frontend/src/components/layout/Shell.tsx` (MODIFY): `activeWallpaper ?? useTageszeitMotiv()`; Klassen/Maske/Höhen unverändert.
- `frontend/src/pages/ServerDetail.tsx` (MODIFY): Dialog einbinden, Menüeintrag „Titelbild anpassen“ + klickbarer Hintergrund (nur mit Schreibrecht, Rollenvorschau beachten), `setActiveWallpaper` bei Datenänderung.
- `frontend/src/locales/de.json`, `en.json` (MODIFY): Keys für Dialog + Builder-Feld.
- `docs/blueprints.md` + `docs/de-docs/blueprints.md` + in-app `BlueprintsDocs.tsx` (MODIFY): Doku zu `artworkAppId`, Fallback-Kette, Custom-Upload & Berechtigung.

### Explizit entfernt (V1-Reste)

- `frontend/src/lib/steamGameIds.ts`, `frontend/src/lib/gameWallpapers.ts` mit ID-Listen — werden nicht gebaut.
- `meta.game`-Resolverlogik — `meta.game` bleibt reines Gruppenlabel.
- `frontend/public/assets/games/` — keine mitgelieferten Assets, Seeds liegen in der Galerie.

## Nicht-Ziele

- Kein per-Server-Wallpaper-Override (V1 = pro Spiel).
- Keine externen URL-Uploads (nur Datei-Upload).
- Kein Blueprint-Publish-Flow für Bilder (Bilder sind Laufzeitdaten).
- Kein Galerie-Lösch-Endpoint in V1 (Retention regelt das).
- Kein Bild-Editor (Zuschnitt/Skalierung übernimmt der Server).
- Keine Galerie-Seite im Vollbild, kein neues Bild-Thema.

## Validierung

### Automatisiert

- Backend `pytest`:
  - Sanitisierung: gültige JPEG/PNG/WebP → WebP ≤ 2560 px; SVG/MIME-Fälschung → 400; > 10 MB → 400; Alt-Bild bleibt bei Fehlern.
  - Resolver: `artworkAppId` schlägt `workshopAppId` schlägt `appId`; fehlendes → Panorama. Zomboid `380870 → 108600`, DayZ `223350 → 221100`, Conan `443030 → 440900`, Rust/Valheim via `artworkAppId` (ohne Code-Tabelle).
  - Steam-Pattern: Fetch gegen echte App-ID (108600) liefert Bild; ungültige ID → Panorama (belegt die De-facto-Annahme oder widerlegt sie folgenlos).
  - Galerie: Upload → `is_active`; Reset → Steam zurück; Reaktivieren wechselt aktiv; Race/Last-write-wins; Retention bei > 10.
  - Berechtigung: ohne `server.wallpaper.manage` → 403 (mit `server.view`) / 404 (ohne `server.view`).
  - Seeds: Minecraft-Familie + Hytale haben nach Migration je einen Galerie-Eintrag.
- Frontend:
  - `tsc --noEmit`, `npm run test` (Store-/Dialog-Tests), `npm run build`.
  - Builder-Test: `artworkAppId` round-trip (laden → speichern → Validierung).
  - i18n-Tests (Orphan-Keys, Schreibweise) grün.

### Manuell

1. Zomboid-/DayZ-/Rust-Server öffnen → Steam-`library_hero` verwaschen, Ablauf wie Panorama.
2. Bild hochladen (auch 15 MB) → sofort aktiv, ohne Blueprint-Änderung; zweiten Server desselben Spiels öffnen → selbes Bild.
3. „Auf Standard zurücksetzen“ → Steam-Artwork kehrt zurück.
4. Galerie: altes Bild reaktivieren → wieder aktiv.
5. Minecraft- / Hytale- / PostgreSQL- / Node-Server → Seed-Bild bzw. Panorama.
6. User ohne `server.wallpaper.manage` → kein Klickziel, kein Dialog-Upload; API 403/404 (Rollenvorschau prüfen).
7. Steam-Cache leeren / Steam blockieren → Panorama, keine Fehlermeldung, nach TTL Selbstheilung.
8. Blueprint am Server wechseln → Hinweis sichtbar, neues Spielbild aktiv.

## Risiken / offene Punkte

- **Game-scoped Wirkung:** Wer auf einem Zomboid-Server hochlädt, ändert das Bild für *alle* Zomboid-Server. Ziel (SSOT pro Spiel) — aber auditiert, berechtigt und mit Warntext beim Blueprint-Wechsel.
- **Steam-Artwork-Rechte:** `library_hero.jpg` ist offizielles Store-Artwork; Nutzung als Hintergrund im eigenen Panel, gecacht. Kein Rewrite/Weiterverkauf.
- **Verwaiste Caches/Galerien** bei Blueprint-Löschung: tolerieren + optionaler Cleanup-Job, kein Blocker.

## Annahmen

- `server.game_type` bleibt Blueprint-`meta.id` (Konvention, `backend/models/server.py` + Registry-Lookup; ohne Blueprint tolerant → Panorama).
- Klick auf Hintergrund ist primärer Einstieg; Menüeintrag bleibt zweite Route.
- Retention „max. 10 Bilder pro Spiel“ ist reversibel anpassbar.
- Galerie-Seeds nur für Minecraft-Familie und Hytale (danach entscheidet allein der Upload).
