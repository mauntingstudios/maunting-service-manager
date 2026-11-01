# Patchnotes — Integrierter Zero-Knowledge Passwort-Manager & 2FA Authenticator

**Branch:** `feature/password-manager`  
**Datum:** 2. September 2026  
**Status:** Abgeschlossen & Verifiziert  

---

## 1. Übersicht

Der Maunting Server Manager erhält einen integrierten, hochsicheren Passwort-Manager samt RFC-6238-konformem TOTP-Authenticator. 

Gemäß den Sicherheitsprinzipien von Maunting Studios („Schutz braucht Vertrauen“) ist das System so konzipiert, dass der Server-Betreiber oder Angreifer zu keinem Zeitpunkt Einsicht in Passwörter, Servicenamen, URLs oder Benutzernamen nehmen kann.

---

## 2. Architektur & Sicherheitsgarantien

### 2.1 Plattform-Isolation (Tauri Desktop & Mobile APK Only)
- **Kein Web-Tresor:** Der Passwort-Manager ist bewusst ausschließlich in der nativen Tauri-Desktop-App und der Android-APK aktiv. Web-Browser besitzen prinzipbedingt eine größere Angriffsfläche (XSS, bösartige Erweiterungen, unsichere Caches); daher führt die Webversion des Panels keinerlei Vault-Entschlüsselungs- oder Schlüsselableitungs-Code aus.
- **KI-Isolation:** Sämtliche KI-Systeme (Chat, Voice-Bridge, Autonomous Actions, Tools) besitzen weder Endpunkte noch Berechtigungen oder Kenntnis über Tresor-Inhalte. Es gibt kein KI-Tool für den Tresor.

### 2.2 Echte Anonymisierung & Zero-Metadata in der Datenbank
- **Keine Metadaten-Spalten:** Die PostgreSQL-Tabelle `vault_entries` speichert ausschließlich:
  - `bucket_id`: Ein 64-Zeichen Hex-Hash, der auf dem Endgerät blind abgeleitet wird (`SHA-256(bucketSeed)`, wobei `bucketSeed` die zweiten 32 Bytes der Argon2id-Ausgabe sind). Er enthält keinen Verweis auf die User-ID oder Kontonamen.
  - `ciphertext`: Authentifizierter AES-256-GCM Ciphertext im standardisierten DIS-Umschlagformat `sv-vault-v1:<iv || ciphertext || tag>`.
  - `revision`: Monotoner Revisionszähler für konfliktfreie Synchronisation.
  - `is_deleted`: Tombstone-Flag für geräteübergreifendes Löschen.
- **Keine Plaintext-Informationen:** Servicenamen, Benutzernamen, Passwörter, URLs, Notizen und 2FA-Secrets befinden sich ausnahmslos innerhalb des verschlüsselten JSON-Objekts.

### 2.3 DIS Sidecar & Memory Hygiene
- **Kryptographisches Primitiv:** AES-256-GCM mit 96-Bit Zufalls-IVs und zusätzlicher Datenbindung (AAD) an die `entryId`.
- **Schlüsselableitung:** Speicherhartes **Argon2id** via `@msdis/shield` — 64 MiB Speicher, 3 Durchgänge, Parallelität 4, 64 Bytes Ausgabe (32 Bytes UserKey + 32 Bytes Bucket-Seed), 256-Bit Salt.
- **Mindestlänge des Master-Passworts:** 12 Zeichen (`MASTER_PASSWORT_MINDESTLAENGE`). Siehe 2.4 — es ist die einzige Schranke gegen den Offline-Angriff.
- **Memory Hygiene:** Schlüsselmaterial wird in `SecureBuffer`-Instanzen gekapselt. Nach Abschluss kryptographischer Operationen werden die Puffer per `.destroy()` im Arbeitsspeicher überschrieben.

### 2.4 Was Zero-Knowledge hier heißt — und was nicht

Ergebnis des Sicherheitsaudits vom 22. September 2026. Diese Abgrenzung stand vorher nirgends, und ihr Fehlen war der gemeinsame Nenner mehrerer Lücken.

**Der Betreiber kann nicht lesen.** Klartext existiert ausschließlich auf dem entsperrten Endgerät. Der Server sieht Ciphertext, eine blinde `bucket_id` und einen Besitznachweis — nie einen Schlüssel.

**Der Betreiber kann aber schreiben** — er hält die Datenbank in Händen. Verschwiegen wird dadurch nichts, aber Manipulation war bis zum Audit unbemerkt möglich. Dagegen stehen jetzt drei Zusagen, alle clientseitig geprüft:

- **Löschungen tragen ihren Beweis.** `is_deleted` steht neben dem Umschlag, nicht darin. Der Client befolgt es nur noch, wenn der zugehörige Ciphertext einen mit dem UserKey verschlüsselten, an dieselbe `entryId` gebundenen Tombstone enthält (`mss-vault-tombstone-v1`). Ein erfundenes `is_deleted` bleibt folgenlos.
- **Revisionen gehen nicht zurück.** Ein Eintrag mit kleinerer Revision als der lokal bekannten wird verworfen. Sonst ließe sich ein längst ersetztes Passwort mit gültigem Tag zurückspielen.
- **Der Canary wird geprüft, bevor er übernommen wird.** Ein untergeschobener Prüfblock hätte den Besitzer beim nächsten Entsperren mit „falsches Master-Passwort" aus seinem eigenen Tresor ausgesperrt.

**Offline-Angriff auf das Master-Passwort bleibt möglich.** Der Server hält den KDF-Salt (`/api/vault/salt`) und die Ciphertexte; wer beides hat, kann auf eigener Hardware Kandidaten durchprobieren — ohne Rate-Limit, denn es geschieht bei ihm. Argon2id mit 64 MiB macht jeden Versuch teuer, aber nicht beliebig teuer. Die Mindestlänge von 12 Zeichen ist hier die tragende Schranke, nicht eine Bedienfreundlichkeits-Einstellung.

### 2.5 Bucket-Autorisierung: zwei Pfade, eine Regel

Der Tresor synchronisiert über zwei Endpunkte — `/api/vault/sync` (angemeldet, Cookie + CSRF) und `/api/vault/blind-sync` (ohne Konto, nur Besitznachweis). Beide gehorchen derselben Regel:

> Ein Bucket, der bereits Daten trägt, darf niemals von einem neuen Prinzipal beansprucht werden.

- `/blind-sync` registriert per Trust-On-First-Use **nur** einen jungfräulichen Bucket: ohne Eintrag und ohne Kontokopplung. Alles andere ist 401 — mit derselben Meldung wie ein falscher Token, damit die Antwort kein Orakel über belegte Buckets ist.
- `/blind-register` ist der authentifizierte Übergang für bestehende Tresore: der angemeldete Besitzer hinterlegt den Verifier für seinen eigenen Bucket. Ein bereits hinterlegter Verifier wird nie überschrieben — sonst wäre ein übernommenes Panel-Konto ein Generalschlüssel für den Tresor.
- `/blind-check` (seit 5.0.1) bestätigt `bucket_id` und Besitznachweis, ohne je einen Bucket anzulegen. Ein neues Gerät eines blinden Tresors hat weder Canary noch Server-Bucket und prüft das Master-Passwort darüber. `/blind-sync` wäre dafür falsch: für ein falsches Passwort registrierte es einen leeren Bucket. Seit 5.0.2 bestätigt er nur einen Bucket mit mindestens einem Eintrag: jeder echte Tresor trägt seinen Canary, leere blinde Buckets sind Überbleibsel falsch getippter Passwörter aus der Zeit vor dem 11.09.2026. Unbekannter, leerer Bucket und falscher Nachweis antworten gleich mit 401.
- `/reset` (seit 5.0.2, angemeldet; Nachweise wie beim Löschen des Kontos: Passwort, wenn vorhanden, bei 2FA zusätzlich ein Faktor, immer das Wort `delete`) löst Salz, Kontokopplung und Hinweis vom Konto. Ciphertexte bleiben: ein blinder Bucket gehört keinem Konto, und ein gekoppelter lebt womöglich auf einem anderen Gerät weiter. Die lokale Kopie eines Geräts löscht nur das Gerät selbst, nie der Server.
- `/sync` weist Buckets ab, die an einen blinden Besitznachweis gebunden und nicht dem aufrufenden Konto zugeordnet sind, und beansprucht keinen Bucket mehr, in dem bereits Ciphertext liegt.

### 2.6 Zwei-Phasen-Rotation & Sicherheitsnetz (Master-Passwort-Änderung)

Das Ändern des Master-Passworts in einem Zero-Knowledge-System erfordert das vollständige Umschlüsseln aller Daten auf dem Endgerät. Scheitert dieser Prozess vorzeitig (Netzwerkabbruch, Absturz, Verbindungsverlust), führt ein direktes Überschreiben des bestehenden Buckets zu irreparabler Datenbeschädigung. Daher nutzt der Passwort-Manager ein atomares Zwei-Phasen-Verfahren:

1. **Lokales Notfall-Backup:** Vor Beginn der Umschlüsselung wird im geschützten AppData-Verzeichnis (`desktop/vault/tresorBackup.ts`) ein verschlüsseltes Backup des aktuellen Bestands angelegt.
2. **Phase 1 — Prepare (`/rotation/prepare`):** Der Server reserviert einen neuen Staging-Bucket (`vault_staging_bucket_id`) und hinterlegt das neue KDF-Salz. Die bestehenden Daten im aktiven Bucket bleiben unberührt.
3. **Client-Staging:** Der Client entschlüsselt alle Einträge mit dem bisherigen Schlüssel, verschlüsselt sie mit dem neu abgeleiteten Schlüssel und überträgt sie in den Staging-Bucket.
4. **Client-Verifikation:** Der Client liest und verifiziert den Staging-Bestand, bevor er den Abschluss anfordert.
5. **Phase 2 — Commit (`/rotation/commit`):** Der Server vertauscht atomar die Zeiger: Der Staging-Bucket wird zum aktiven Bucket (`vault_bucket_id`), der bisherige Bucket wird zu `vault_previous_bucket_id`, und `vault_rotated_at` wird auf den aktuellen Zeitstempel gesetzt.
6. **Abbruch & Rollback:**
   - Tritt während des Stagings ein Fehler auf, verwirft `/rotation/abort` den Staging-Bucket restlos; der alte Zustand bleibt aktiv.
   - Tritt nach dem Commit ein Problem auf, stellt `/rotation/rollback` den vorherigen Bucket wieder als aktiv her.
7. **7-Tage-Haltefrist & automatisierte Bereinigung:** Der bisherige Bucket (`vault_previous_bucket_id`) wird für 7 Tage aufbewahrt (`ROTATION_HALTEFRIST = timedelta(days=7)`). Erst nach Ablauf dieser Frist löscht der periodische Hintergrund-Dienst `bereinige_faellige_rotationen(db)` die veralteten Daten endgültig.
8. **Schutz vor Bucket-Übernahme:** Die Funktion `_pruefe_bucket_nicht_vergeben(db, ...)` stellt sicher, dass weder aktive noch Staging- oder alte Buckets von fremden Konten oder Teams beansprucht werden können.

#### Wichtiger Sicherheitshinweis: Rotation ist beratend (`needs_rotation`) und optional

- **Keine Blockade:** Wenn ein Mitglied ein Team verlässt oder entfernt wird, setzt das Backend die Markierung `needs_rotation = True`. Dies dient als Empfehlung für den Team-Inhaber, blockiert den Tresor aber zu keinem Zeitpunkt.
- **Kryptographische Grenzen:** Das Rotieren des Master-Passworts oder des Tresor-Schlüssels kann bereits kopierte Daten nicht ungeschehen machen. Hat ein ausscheidendes Mitglied Einträge vor seinem Austritt lokal kopiert oder exportiert, verbleiben diese Daten in seinem Besitz. Die Rotation stellt sicher, dass künftige Einträge und Änderungen für frühere Mitglieder nicht mehr lesbar sind.

---

## 3. Benutzeroberfläche & Bedienkomfort

### 3.1 Blitzschnelle Passworterstellung (<= 2 Klicks)
- Mit einem Klick auf „Neuer Eintrag“ wird automatisch ein hochsicheres, zufälliges Passwort nach NIST-Empfehlungen generiert.
- Nach Eingabe des Dienstnamens (z. B. „Gmail“) speichert ein Klick auf „Speichern“ den Eintrag sofort verschlüsselt ab.

### 3.2 Lokaler SVG-Markenkatalog
- Integrierte Vektorgrafiken für bekannte Dienste (Google, Discord, GitHub, Steam, Microsoft, Apple, Netflix, Spotify, Amazon, Reddit, Proton).
- Vollständig lokal und modular eingebettet: Keine externen Netzwerkanfragen oder Tracking-Aufrufe zum Abrufen von Favicons.

### 3.3 Integrierter 2FA Authenticator (RFC 6238)
- Automatische Berechnung von 6-stelligen Zeittakt-Codes (HMAC-SHA-1, 30 Sekunden Intervall).
- Visuelle, animierte Countdown-Anzeige für die Restgültigkeit.
- Unterstützung für manuelle Secret-Eingabe (Base32) sowie `otpauth://totp/`-URIs (z. B. aus QR-Codes).

### 3.4 Offline-First Synchronisation
- Einträge werden im lokalen, geschützten Speicher zwischengespeichert.
- Offline erstellte, geänderte oder gelöschte Einträge werden in einer lokalen Warteschlange vorgehalten und automatisch im Hintergrund mit dem MSM-Backend synchronisiert, sobald wieder Netzwerkempfang besteht.

### 3.5 Ersteinrichtungs-Assistent & Verifikations-Canary
- **Automatischer Einrichtungs-Modus:** Erkennt das System, dass auf dem Endgerät noch kein Master-Passwort hinterlegt wurde, öffnet sich direkt der Einrichtungs-Dialog („Passwort-Manager einrichten“) mit doppelter Passworteingabe zur Bestätigung.
- **Validierung:** Direkte Rückmeldung zu Mindestlänge (>= 12 Zeichen, siehe 2.4) und Übereinstimmung der beiden Passwörter.
- **Kryptographischer Canary:** Beim Einrichten wird ein verschlüsselter Prüfblock (`mss:vault_canary_<bucket_id>`) erzeugt. Beim späteren Entsperren prüft das System damit sofort, ob das eingegebene Master-Passwort korrekt ist, und weist Falscheingaben direkt mit einer klaren Meldung ab.
- **Flexibles Wechseln:** Über einen einfachen Link kann jederzeit zwischen Ersteinrichtung und Entsperren eines bereits bestehenden Tresors gewechselt werden.

### 3.6 Echter QR-Code-Scan & Dedizierter Authenticator-Modus
- **Kamera- und Bild-Upload:** Integrierter Scanner (`jsqr`) zur Erkennung von `otpauth://`-QR-Codes live per Webcam oder über Screenshot-/Datei-Upload.
- **2FA-Cockpit:** Eigener Tab für Authenticator-Tokens mit großen, gut ablesbaren Codes, Live-Countdown-Kreis und 1-Klick-Kopieren.

### 3.7 Kategorisierung, Favoriten & Zuletzt verwendet
- **Favoriten:** Wichtige Zugänge lassen sich per Stern als Favorit markieren und werden dauerhaft oben angeheftet.
- **Zuletzt verwendet:** Direkter Schnellfilter für kürzlich genutzte oder kopierte Zugangsdaten.
- **Kategorien:** Saubere Trennung zwischen Logins, Authenticators und sicheren Notizen.

### 3.8 Datenschutzfreundlicher Leak-Check (K-Anonymität)
- **Leaked-Password-Prüfung:** Ermittelt sekundenschnell, ob ein Passwort in bekannten Datenlecks auftaucht.
- **K-Anonymität:** Nur die ersten 5 Zeichen des SHA-1-Hashes verlassen das Gerät. Weder das Klartext-Passwort noch der vollständige Hash werden jemals übertragen.

### 3.9 Verschlüsselte Notizen & Dateianhänge
- **Sichere Notizen:** Geschützter Freitextbereich für sensible Dokumentationen, Wiederherstellungsschlüssel und Backup-Codes.
- **Verschlüsselte Dateien:** Sicheres lokales Anhängen und Entschlüsseln vertraulicher Dateien, integriert in den AES-256-GCM Blob. Grenze ist `MAX_VAULT_ATTACHMENT_SIZE_BYTES` = 500 KB je Anhang **und** in Summe (SEC-08) — ein Eintrag wandert bei jeder Änderung vollständig über die Leitung.

### 3.10 Windows Computer-Use KI-Schutz (Human Error Guard)
- **Hardware- & Software-Schutz:** Verhindert das versehentliche Erfassen des Passwort-Managers durch Bildschirmaufnahmen der KI bei Computer-Use.
- **Doppelte Schutzschicht:**
  - OS-Ebene: `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)` schließt das Fenster auf DWM-Ebene aus allen Screen-Captures aus.
  - Software-Ebene: `bildschirm.rs` maskiert das Anwendungsfenster im Capture automatisch mit solidem Schwarz, falls der Passwort-Manager geöffnet ist.

### 3.11 Passwort-Hinweis per E-Mail (10-Minuten-Schutz) & UX-Entschlackung
- **Master-Passwort-Hinweis:** Beim Einrichten oder in den Einstellungen kann optional eine persönliche Gedankenstütze hinterlegt werden.
- **E-Mail-Zustellung:** Im Sperrbildschirm kann der Hinweis mit 1 Klick an die verknüpfte E-Mail-Adresse des Kontos gesendet werden.
- **10-Minuten-Missbrauchsschutz:** Ein Server-seitiges Rate-Limit blockiert mehrfaches Anfordern innerhalb von 10 Minuten.
- **UX-Korrektur (Datenverlust-Schutz):** Wurde ein Master-Passwort bereits eingerichtet, ist der Link zur Neueinrichtung im Sperrbildschirm permanent ausgeblendet.
- **Unterdrückung doppelter Passwort-Augen:** Native Browser-/Windows-Augen-Symbole (`::-ms-reveal`) sind neutralisiert; es wird exakt ein einheitliches Icon angezeigt.
- **Radikale Textreduktion:** Sämtliche langen Textpassagen, Beipackzettel und Infoboxen wurden entfernt. Das UI ist minimalistisch, selbsterklärend und sauber.

### 3.12 Team-Datei-Cloud & Blob-Pipeline
- **Dateigrößenunabhängige Verschlüsselung:** Team-Tresore nutzen dieselbe DIS-Chunk-Verschlüsselung wie persönliche Tresore (`@msdis/shield/file-encryption`).
- **Eigentümer-basiertes Quota-Modell:** Der Speicherplatz für Team-Dateien wird vollständig dem Kontingent des jeweiligen Team-Owners (`quote_fuer(db, owner)`) zugerechnet. Verfügt der Team-Owner über keine Rolle mit Tresorspeicher, wird der Upload mit dem Fehler `"Der Team-Owner hat keinen Tresorspeicher (Rolle ohne Speicher in den Panel-Einstellungen)."` (HTTP 507) abgewiesen.
- **Team-Blob-Endpunkte:** Eigene REST-Endpunkte unter `/api/teams/{id}/vault/blobs...` wickeln Reservierung, Chunks, Fertigstellung und Löschung isoliert ab.
- **Dynamisches Client-Routing:** Über `blobBasisSetzen(teamId)` wird der Dateizugriff im Frontend transparent zwischen persönlichem Tresor und dem jeweiligen Team-Tresor gesteuert.
- **Automatische Lazy-Migration:** Ältere Team-Dateianhänge im Inline-Base64-Format werden beim ersten Betrachten (`TresorDateiAnsicht`) automatisch in die Chunk-Blob-Pipeline überführt (`migriereBase64Datei`).
- **Medien- und Datei-Integration:** Bildbetrachter, Bildeditor, Texteditor und Mediengalerie unterstützen Team-Tresore vollständig über das `isTeam`-Attribut.
- **Tombstone- und Revisions-Integrität:** Gelöschte Team-Einträge müssen zwingend einen kryptographischen `mss-vault-tombstone-v1`-Nachweis im Ciphertext tragen; Revisions-Rückschritte werden abgewiesen.

### 3.13 Standalone Recovery-App Tresor-Modus
- **Notfall-Wiederherstellung ohne Backend:** Die Recovery-App (`recovery/`) bietet einen eigenständigen Wiederherstellungsmodus für exportierte Tresor-Backups.
- **Header-Erkennung:** Tresor-Backups beginnen mit der Kennung `MSS-VAULT-BACKUP-V1`, gefolgt von KDF-Salz, Erstellungszeitpunkt und verschlüsselten Frames.
- **Rahmenformat & KDF:** Entschlüsselt das Standard-Backup-Format (`[4-Byte Länge][12-Byte Nonce][Ciphertext + 16-Byte Tag]`) mit speicherhartem Argon2id (128 MiB, 3 Durchgänge, Parallelität 4).
- **Vollständig offline:** Läuft im Browser oder in der Tauri-App ohne Netzwerkverbindung.
- **Ansicht und Export:** Übersichtliche Anzeige der entschlüsselten Zugangsdaten und Notizen sowie JSON-Export.

---

## 4. Zentrale Panel-Verwaltung & KISS-Architektur

- Der Passwort-Manager arbeitet nach dem **KISS-Prinzip (Keep It Simple, Stupid)**: Anstatt unnötiger Multi-Node-Verbindungsüberbauten läuft der verschlüsselte Zero-Knowledge-Sync direkt, stabil und schlank über die zentrale Panel-Datenbank.
- Im Panel unter **Einstellungen → Allgemein** können Administratoren den Passwort-Manager panelweit aktivieren oder deaktivieren (`vault_enabled`).
- Dadurch werden sämtliche Tresor-Datensätze automatisch von den regulären Panel-Backups erfasst – ohne Datenverlustrisiko oder verwaiste Node-Tabellen.

---

## 5. Geänderte und neue Dateien

### Backend
- `backend/models/vault_entry.py`: Schlankes PostgreSQL-Datenmodell für anonyme Tresoreinträge (ohne Node-Spalten).
- `backend/models/vault_user_setting.py`: Modell für Tresoreinstellungen inklusive Rotations-Spalten (`vault_staging_bucket_id`, `vault_previous_bucket_id`, `vault_rotated_at`).
- `backend/models/team.py`: Team-Modell mit denselben Rotations-Spalten für Team-Tresore.
- `backend/models/__init__.py`: Registrierung der Modelle.
- `backend/migrations/versions/20260902_02_vault_entries.py`: Alembic-Migration für `vault_entries` und Indizes.
- `backend/migrations/versions/20260905_01_drop_vault_entries_node_id.py`: Bereinigungs-Migration zur Entfernung verwaister Node-Spalten.
- `backend/migrations/versions/20261102_01_vault_rotation.py`: Alembic-Migration für Zwei-Phasen-Rotation (Staging, Previous, Rotated-At).
- `backend/schemas/vault.py`: Pydantic-Validierungs- und Datenübertragungsmodelle inklusive Rotations-Schemas (`VaultRotationPrepareRequest`).
- `backend/services/vault_service.py`: Revisionsverwaltung, Zwei-Phasen-Rotationslogik (`rotation_vorbereiten_*`, `rotation_commit_*`, `rotation_abbrechen_*`, `rotation_rollback_*`), Bucket-Claim-Schutz (`_pruefe_bucket_nicht_vergeben`) und 7-Tage-Bereinigung (`bereinige_faellige_rotationen`).
- `backend/services/vault_blob_service.py`: Quota- und Belegungs-Berechnung über `quota_override` und `belegt_override`.
- `backend/routers/vault.py`: REST-Endpunkte für Sync und Zwei-Phasen-Rotation (`/rotation/prepare`, `/commit`, `/abort`, `/rollback`).
- `backend/routers/teams.py`: REST-Endpunkte für Team-Tresor-Sync, Zwei-Phasen-Rotation und Team-Blobs (`/api/teams/{id}/vault/blobs...`).
- `backend/routers/__init__.py`: Router-Export.
- `backend/main.py`: Einbindung des Vault-Routers unter `/api/vault` und Scheduler-Job für Rotations-Bereinigung.
- `backend/tests/test_vault_router.py`: Pytest-Suite für Authentifizierung, Validierung und Synchronisation.
- `backend/tests/test_vault_rotation.py`: Pytest-Suite für Vorbereitung, Commit, Rollback, Abort und 7-Tage-Bereinigung.
- `backend/tests/test_team_vault.py`: Pytest-Suite für Team-Tresor, Tombstone-Prüfung, Revisionsschutz, Fremdbucket-Abweisung und Team-Blob-Lifecycle mit Owner-Quota.

### Frontend
- `frontend/src/desktop/vault/vaultCrypto.ts`: DIS-Kryptographie, `SecureBuffer`, PBKDF2 und AES-256-GCM.
- `frontend/src/desktop/vault/vaultCrypto.test.ts`: Vitest-Suite für Ver- und Entschlüsselung.
- `frontend/src/desktop/vault/totpEngine.ts`: RFC 6238 TOTP-Generator und URI-Parser.
- `frontend/src/desktop/vault/totpEngine.test.ts`: Vitest-Suite für TOTP-Zeittakt und Base32.
- `frontend/src/desktop/vault/brandCatalog.tsx`: Lokaler SVG-Markenkatalog.
- `frontend/src/desktop/vault/vaultStore.ts`: Zustand Offline-First Store mit Revisionsabgleich und Zwei-Phasen-Rotation.
- `frontend/src/desktop/vault/teamVaultStore.ts`: Team-Tresor Store mit Blob-Pipeline, Tombstone-Prüfung, Revisionsmonotonie und Lazy Migration.
- `frontend/src/desktop/vault/vaultRotation.ts`: Client-Implementierung der atomaren Zwei-Phasen-Rotation (`rotateVaultCore`).
- `frontend/src/desktop/vault/tresorBackup.ts`: Lokaler Notfall-Backup-Writer in Tauri-AppData vor Schlüsselumstellungen.
- `frontend/src/desktop/vault/tresorBlobApi.ts`: Dynamische Umschaltung der Blob-Basis-URL (`blobBasisSetzen`).
- `frontend/src/desktop/vault/tresorSammel.ts`: Archivierungs- und Papierkorb-Aktionen mit `isTeam`-Unterstützung.
- `frontend/src/desktop/vault/VaultView.tsx`: Tresor-Oberfläche mit Master-Passwort-Schutz, Team-Dateien, Mediengalerie und 2FA-Ring.
- `frontend/src/desktop/vault/TresorDateiBereich.tsx`: Datei-Verwaltung mit Team-Umschaltung.
- `frontend/src/desktop/vault/TresorGalerie.tsx`: Bild- und Video-Galerie mit Team-Unterstützung.
- `frontend/src/desktop/vault/TresorDateiAnsicht.tsx`: Detailansicht mit automatischer Migration älterer Base64-Dateien.
- `frontend/src/desktop/vault/TresorBildeditor.tsx` & `TresorTexteditor.tsx`: Editoren mit Store-Auswahl für Team- und Privattresore.
- `frontend/src/desktop/DesktopApp.tsx`: Navigation, Route `/tresor` und Drawer-Integration.
- `frontend/src/pages/settings/GeneralTab.tsx`: Panelweiter Aktivierungs-Schalter (`vault_enabled`).
- `frontend/src/locales/de.json` & `frontend/src/locales/en.json`: Übersetzungen.

### Recovery-App
- `recovery/src/lib/vaultBackup.ts`: Entschlüsselungsmodul für Tresor-Backups (`MSS-VAULT-BACKUP-V1`, Argon2id 128 MiB).
- `recovery/src/lib/vaultBackup.test.ts`: Vitest-Suite für Entschlüsselung, Kennungserkennung und Fehlertoleranz.
- `recovery/src/App.tsx`: Notfall-Wiederherstellungsansicht mit JSON-Export für Tresordaten.
