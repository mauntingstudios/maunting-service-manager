# Maunting Tresor-Architektur & Souveränes Galerie-Protokoll

## 1. Leitgedanke & Vision

Der **Maunting Tresor** ist ein kryptografischer Zero-Knowledge-Datenspeicher mit Ende-zu-Ende-Verschlüsselung (E2EE), der fest in den Maunting Server Manager (MSM) integriert ist. Er führt zwei Systembereiche zusammen, die in der Softwareentwicklung bisher getrennt waren:

1. **Sichere Geheimnisverwaltung:** Schutz für Master-Passwörter, Server-Zugangsdaten, Datenbank-Kennwörter, API-Schlüssel, Wiederherstellungsschlüssel und vertrauliche Notizen.
2. **Souveräne Medien-Galerie:** Eine visuelle Foto- und Video-Ablage mit dem Bedienkomfort von Google Fotos oder Apple Fotos, die vollständig auf eigener Infrastruktur läuft.

Im digitalen Alltag stehen Anwender oft vor einem Widerspruch: Während Passwörter in spezialisierten Passwort-Managern mit clientseitiger Verschlüsselung verwaltet werden, landen persönliche Familienfotos, private Videoaufnahmen, Ausweisscans und Steuerunterlagen unverschlüsselt in den Rechenzentren großer Plattformbetreiber (Google Fotos, Apple iCloud, Dropbox).

Der Maunting Tresor löst dieses Dilemma. Auf Basis des Defensive Integration Shield ([`@msdis/shield`](file:///e:/Github-Projekte/dis/src/index.ts)) verbindet das System mathematisch geprüfte kryptografische Primitive ([Argon2id](file:///e:/Github-Projekte/dis/src/kdf/index.ts), [AES-256-GCM](file:///e:/Github-Projekte/dis/src/aead/aes-gcm.ts), [ML-KEM-768](file:///e:/Github-Projekte/dis/src/post-quantum/hybrid.ts), blinde HMAC-Indizierung und RAM-Nullung via [`SecureBuffer`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts)) mit einer performanten Medien-Pipeline: 4-MiB-Streaming-Chunks, clientseitige Miniatur-Erzeugung, reaktive Lichtbox, Duplikaterkennung via dHash, ein integrierter zerstörungsfreier Bildeditor und eine vollautomatische Hintergrund-Kamerasicherung für Mobiltelefone.

---

## 2. Entstehungsgeschichte & Motivation: Vom Passwort-Manager zur privaten Galerie

### Phase 1: Der klassische Zero-Knowledge-Passwortspeicher
Zu Beginn war der Tresor als klassischer, selbstgehosteter Passwort-Manager konzipiert. Ziel war es, Administratoren und Teams die Möglichkeit zu geben, Serverzugänge, Datenbank-Kennwörter, SSL-Zertifikate und API-Tokens sicher auf den eigenen MSM-Knoten zu verwalten, ohne auf externe SaaS-Dienste angewiesen zu sein.

Die Sicherheitsvorgaben waren von Anfang an verbindlich:
* Kein Klartextpasswort verlässt jemals das Endgerät des Nutzers.
* Symmetrische Schlüssel werden ausschließlich lokal über ein speicherhartes Argon2id-Verfahren abgeleitet.
* Der Server fungiert als unprivilegierter, blinder Speicher für Ciphertexte.

### Phase 2: Der Wendepunkt
Nach Fertigstellung des kryptografischen Kerns drängte sich eine zentrale Erkenntnis auf:
> Passwörter machen nur einen winzigen Bruchteil der vertraulichen Daten eines Menschen aus. Die persönlichsten und wertvollsten Dokumente (Familienfotos, Schnappschüsse, Urlaubsaufnahmen, Ausweise, Verträge und Notizen) liegen meist unverschlüsselt bei zentralen Cloud-Konzernen.

Dienste wie Google Fotos sind im Alltag praktisch: Fotos vom Telefon synchronisieren sich im Hintergrund, die Galerie scrollt flüssig, und Alben lassen sich im Handumdrehen durchsuchen. Dieser Komfort wird jedoch mit gravierenden Nachteilen bezahlt:
* Plattformbetreiber besitzen uneingeschränkten Zugriff auf alle gespeicherten Bildinhalte.
* Maschinelle Lernmodelle scannen Bilder automatisiert nach Gesichtern, Orten, Gegenständen und Texten.
* Automatisierte Kontosperren oder fehlerhafte Erkennungsalgorithmen können Nutzer von einem Moment auf den anderen von ihren langjährigen Erinnerungen abschneiden.

### Phase 3: Die Entstehung der souveränen Galerie
Aus dieser Motivation heraus wurde der Tresor zu einer universellen Speicher- und Medienplattform ausgebaut:
1. **Längen- und Verkehrsschutz (Padmé und Zweierpotenzen):** Verhindert, dass Dateigrößen oder Medientypen anhand der Ciphertext-Länge erraten werden können ([`gepolsterteGroesse`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L62-L70)).
2. **Streaming-Chunk-Verschlüsselung:** Große Dateien werden in Blöcke von jeweils 4 MiB zerlegt und per AES-256-GCM verschlüsselt ([`DEFAULT_CHUNK_SIZE`](file:///e:/Github-Projekte/dis/src/file-encryption/file-encryption.ts#L43)). Dadurch lassen sich Videos und hochauflösende Bilder abspielen, ohne den Arbeitsspeicher des Browsers zu überlasten.
3. **Dreistufige Medien-Repräsentation:** Miniaturansichten (256 px WebP, max. 32 KiB) und hochauflösende Vorschauen (1600 px WebP, max. 512 KiB) werden vor dem Upload lokal im Client erzeugt und separat verschlüsselt ([`bildAngaben`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorBilder.ts#L82-L115)).
4. **Die Galerie-Oberfläche ([`TresorGalerie.tsx`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx)):** Monatsraster, „An diesem Tag"-Jahresrückblicke ([`anDiesemTag`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx#L131-L145)), Gruppierung ähnlicher Aufnahmen ([`gruppieren`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts#L65-L88)) und Filter nach Kameramodellen.
5. **Das asymmetrische Posteingang-Protokoll:** Löst das Problem der Kamerasicherung auf Mobilgeräten. Über Post-Quantum-Hybridverschlüsselung ([ML-KEM-768](file:///e:/Github-Projekte/dis/src/post-quantum/hybrid.ts) + RSA-4096) und Hardware-Signaturen können Telefone neue Fotos im Hintergrund sichern, selbst wenn die App geschlossen und der Tresor gesperrt ist ([`KameraArbeit.kt`](file:///e:/Github-Projekte/maunting-server-manager/smart-system/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/smart_system/KameraArbeit.kt), [`tresorEingang.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorEingang.ts)).

---

## 3. Systemvergleich: Vier Architektur-Ansätze

| Kriterium | Klassische Passwort-Manager (z. B. Bitwarden, 1Password) | Kommerzielle Foto-Clouds (z. B. Google Fotos, iCloud) | Selbstgehostete Medienserver (z. B. Immich, PhotoPrism, Nextcloud) | MSM Tresor & Galerie ([`@msdis/shield`](file:///e:/Github-Projekte/dis/src/index.ts)) |
| :--- | :--- | :--- | :--- | :--- |
| **Zero-Knowledge-Verschlüsselung** | Stark für Textdaten; stark eingeschränkt oder ungeeignet für Mediendateien. | Keine oder serverseitig verwaltete Schlüssel; Bildanalyse und Telemetrie aktiv. | Keine; Mediendateien und Metadaten liegen im Klartext auf Server und Festplatte. | **Strikte Zero-Knowledge-Architektur:** Der Server erfährt weder Schlüssel, Dateinamen, Bildinhalte noch EXIF-Metadaten. |
| **Folgen einer Server-Kompromittierung** | Verschlüsselte Passwörter sicher; Dateianhänge oft ohne Größenpolsterung. | Vollständiger Abfluss aller privaten Fotos, Videos und KI-Metadaten. | Vollständiger Klartext-Zugriff; wer Server-Zugang hat, liest sämtliche Originalbilder. | **Kein Datenabfluss:** Datenbank und Speicher halten nur blinde HMACs, Prüftokens und Chiffrat-Chunks. |
| **Galerie-Bedienung** | Statische Dateilisten; zeitraubender Download vor der Anzeige; keine Zeitleiste. | Flüssige Zeitleiste, reaktive Miniaturen, integrierte Medienwiedergabe. | Schnelle Zeitleiste, Alben, Gesichtserkennung, mobile Apps. | **Volles Galerie-Erlebnis:** Virtuelles 60-FPS-Raster, 256-px-Miniaturen, 1600-px-Lichtbox, stufenloser Zoom. |
| **Handy-Kamerasicherung** | Nur manueller Einzelupload; kein automatischer Hintergrundabgleich. | Automatischer Hintergrund-Upload neuer Bilder aus dem DCIM-Verzeichnis. | Hintergrund-Sync der Mobil-App an unverschlüsselte Server-Schnittstelle. | **Asynchroner Hybrid-Posteingang:** Android-WorkManager-Job sichert neue Fotos per Public-Key-Kryptografie. |
| **Hauptschlüssel auf dem Smartphone** | Master-Passwort verbleibt im Gerätespeicher zum Entschlüsseln. | Auth-Token auf dem Gerät; Server hält Entschlüsselungsschlüssel. | Auth-Token auf dem Gerät; Server speichert Klartextmedien. | **Kein Master-Schlüssel auf dem Telefon:** Gesperrtes Gerät hält nur den ÖFFENTLICHEN Schlüssel des Tresors. |
| **Schutz der Metadaten** | Nicht relevant (Metadaten flach oder unstrukturiert). | EXIF, GPS-Koordinaten, Gesichter und Zeitstempel werden serverseitig ausgewertet. | EXIF- und Standortdaten werden im Klartext in der Server-Datenbank indexiert. | **Lokale Metadaten-Extraktion:** Aufnahmezeit und Kameramodell clientseitig ermittelt; GPS bleibt im Chiffrat versiegelt. |
| **Post-Quantum-Sicherheit** | Klassische asymmetrische Verfahren (RSA, ECC). | Standard-TLS; serverseitige Speicherung mit Anbieterschlüsseln. | Standard-TLS; unverschlüsselte Speicherung im Ruhezustand. | **Post-Quantum-Hybrid:** Der mobile Posteingang nutzt ML-KEM-768 kombiniert mit klassischem RSA-4096. |
| **Speicherhygiene im RAM** | Standard-Speicherverwaltung der JavaScript-Laufzeitumgebung. | Nicht zutreffend (keine lokalen Hauptschlüssel). | Nicht zutreffend (serverseitige Verarbeitung). | **[`SecureBuffer`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts)-Nullung:** Sensible Schlüssel und Puffer werden unmittelbar nach Gebrauch mit Nullen überschrieben. |

---

## 4. Kryptografischer Kern & Sicherheitsmodell

Das Sicherheitsmodell des MSM Tresors stuft den Server, die Datenbank und das Übertragungsnetzwerk als grundsätzlich nicht vertrauenswürdig ein. Selbst bei vollständigem Zugriff auf den Datenbankserver kann ein Angreifer weder Daten entschlüsseln noch die Zuordnung von Buckets zu Benutzerkonten nachvollziehen.

```
+-----------------------------------------------------------------------------------+
|                                     ENDGERÄT                                      |
|                                                                                   |
|  Master-Passwort (>= 12 Zeichen) + Salz (/api/vault/salt)                         |
|                             |                                                     |
|                             v                                                     |
|                 Argon2id (64 MiB RAM, 3 Durchläufe, 4 Threads)                    |
|                             |                                                     |
|               +-------------+-------------+                                       |
|               |                           |                                       |
|               v                           v                                       |
|      userKey (32 Bytes)         bucketSeed (32 Bytes)                             |
|      AES-256-GCM                |                                                 |
|      (im SecureBuffer)          +-----------------------+                         |
|               |                 |                       |                         |
|               v                 v                       v                         |
|      E2EE-Umschlag (sv-vault-v2)bucketId = SHA256(...)  bucketAuthToken = SHA256(...)
+---------------+-----------------+-----------------------+-------------------------+
                |                 |                       |
                | AES-256-GCM     | Bucket-ID             | Blinder Besitznachweis
                v                 v                       v
+-----------------------------------------------------------------------------------+
|                                    MSM-SERVER                                     |
|                                                                                   |
|  - Prüft bucketAuthToken gegen den hinterlegten Prüfwert (VaultBlindBucket).      |
|  - Besitzt KEIN Passwort und KEINEN userKey.                                      |
|  - Verwaltet blinde Blobs und HMAC-Kontoindizes (konto_index via DIS-Sidecar).    |
|  - Kann Bucket-IDs auf der Festplatte keinem Klarnutzer zuordnen.                 |
+-----------------------------------------------------------------------------------+
```

### A. Schlüsselableitung ([`deriveVaultKeys`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L145-L194))
Die Schlüsselableitung basiert auf speicherhartem Argon2id aus [`@msdis/shield/kdf`](file:///e:/Github-Projekte/dis/src/kdf/index.ts):
* **Speicherbedarf:** 65.536 KiB (64 MiB).
* **Durchläufe:** 3 Iterationen.
* **Parallelität:** 4 Threads.
* **Ausgabelänge:** 64 Rohbytes.

Die 64 abgeleiteten Bytes werden in zwei separate 32-Byte-Geheimnisse aufgeteilt:
1. **`userKey` (Bytes 0 bis 31):** Der symmetrische Hauptschlüssel. Er wird umgehend als nicht-extrahierbarer AES-256-GCM `CryptoKey` in die WebCrypto-Schnittstelle importiert.
2. **`bucketSeed` (Bytes 32 bis 63):** Das Ausgangsmaterial für den blinden Bucket.
   * `bucketId = sha256Hex(bucketSeed)`: Eine 64 Zeichen lange Hexadezimal-Kennung, die als isolierter Speicherbereich auf dem Server dient ([`VaultBlindBucket`](file:///e:/Github-Projekte/maunting-server-manager/backend/models/vault_blind_bucket.py#L15)).
   * `bucketAuthToken = sha256Hex(bucketSeed || ':msm-vault-auth-v1')`: Ein deterministischer blinder Besitznachweis.

### B. Speicherhygiene mit [`SecureBuffer`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts)
Sensible Schlüsselbytes verbleiben nicht unkontrolliert im RAM. Sie werden über die Klasse [`SecureBuffer`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts) verwaltet:
* Die Puffer werden außerhalb regulärer Garbage-Collection-Routinen allokiert.
* Zugriffe erfolgen synchron über `.use((bytes) => { ... })` oder `.useAsync()`.
* Direkt nach der Verwendung wird der Speicherbereich per [`.destroy()`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts#L111) explizit mit Nullen überschrieben.

### C. Schutz vor Wörterbuchangriffen ([`MASTER_PASSWORT_MINDESTLAENGE`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L51))
In einer Zero-Knowledge-Architektur bleibt ein prinzipielles Restrisiko: Erbeutet ein Angreifer die Datenbank (Ciphertexte) und das KDF-Salz aus `/api/vault/salt`, kann er offline Wörterbuchangriffe durchführen. Um dem vorzubeugen, erzwingt MSM eine Mindestlänge des Master-Passworts von **12 Zeichen** ([`MASTER_PASSWORT_MINDESTLAENGE`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L51)). In Kombination mit 64 MiB Argon2id sind Offline-Angriffe technisch und wirtschaftlich unrentabel.

### D. Umschlagverschlüsselung & Schutz vor Vertauschung ([`padPayload`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L93-L121))
Jeder Datensatz (Passwörter, Notizen, Dateieinträge) wird in einem versionierten Umschlag versiegelt:
* **Format:** `sv-vault-v2:<base64(IV || ciphertext || authTag)>` ([`VAULT_ENVELOPE_V2_PREFIX`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L34)).
* **Zusatzdaten (AAD):** Verbindlich an `sv-vault-v2:<entryId>` gekoppelt. Dadurch wird verhindert, dass manipulierte Ciphertexte unter fremden IDs eingespielt werden.
* **Verkehrsschutz ([`padPayload`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L93-L121)):** Metadaten werden vor der Verschlüsselung mit kryptografischem Zufall auf ein Vielfaches von 4.096 Bytes aufgefüllt. Externe Beobachter können anhand der Paketgröße nicht erkennen, ob ein kurzes Kennwort oder eine mehrseitige Notiz gespeichert ist.

### E. Blinder Kontoindex ([`konto_index`](file:///e:/Github-Projekte/maunting-server-manager/backend/models/vault_user_setting.py))
Klassische Datenbankschemata verknüpfen Tresoreinträge über einen Fremdschlüssel direkt mit der `user_id`. In MSM sind die Tabellen vollständig entkoppelt:
* Der Server errechnet einen blinden HMAC der Kontonummer (`konto_index`) ausschließlich über den isolierten DIS-Sidecar.
* Ein Auszug der Datenbank zeigt lediglich pseudozufällige Hashwerte. Es existiert keine direkte Verbindung zwischen Benutzerkonto, Bucket-ID und Dateianzahl.

---

## 5. Speicher-Engine: Blobs, Chunks & Dateilebenszyklus

Das Speichern von Fotos und Videos unter Zero-Knowledge-Bedingungen erfordert eine Streaming-Architektur. Das vollständige Laden eines 4K-Videos mit mehreren Gigabyte in den Arbeitsspeicher des Browsers würde den Tab zum Absturz bringen. MSM setzt daher auf **Chunked Streaming Storage** in [tresorDatei.ts](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts) und [tresorDateien.ts](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDateien.ts).

```
                           ORIGINALE MEDIENDATEI
                                    |
          +-------------------------+-------------------------+
          |                         |                         |
          v                         v                         v
    Originaldatei             Vorschaubild              Miniaturbild
  (Padmé / 2er-Potenz)      (1600 px WebP max)        (256 px WebP max)
   4-MiB-Chunks              Feste 512-KiB-Box         Feste 32-KiB-Box
          |                         |                         |
     AES-256-GCM               AES-256-GCM               AES-256-GCM
    (Blob-Schlüssel)          (Blob-Schlüssel)          (Blob-Schlüssel)
          |                         |                         |
          +-------------------------+-------------------------+
                                    |
                  Schlüssel gewickelt mit userKey
                                    |
                                    v
                      Versiegelt im Tresoreintrag
                      (sv-vault-v2 Umschlag)
```

### A. Dreistufige Repräsentation
Wird ein Bild oder Video im Tresor abgelegt, erzeugt der Client vor der Übertragung drei separate Blobs ([`bildAngaben`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorBilder.ts#L82-L115)):
1. **Original-Blob:** Die unveränderte Datei in voller Kameraauflösung inklusive Original-Audiotrack.
2. **Vorschau-Blob ([`VORSCHAU_GROESSE`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L40)):** Auf maximal 1.600 Pixel Kantenlänge herunterskaliert (WebP), komprimiert auf höchstens 512 KiB. Dient der schnellen Darstellung in der Lichtbox.
3. **Miniatur-Blob ([`MINIATUR_GROESSE`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L39)):** Auf 256 Pixel Kantenlänge herunterskaliert (WebP), komprimiert auf höchstens 32 KiB. Speist das Raster der Galerieansicht.

Dateien ohne Bildinhalt (PDF-Dokumente oder ZIP-Archive) erhalten leere Miniatur- und Vorschaublobs identischer Zielgröße, damit die Dateikategorie nicht an der Blob-Struktur ablesbar ist.

### B. Größenpolsterung ([`gepolsterteGroesse`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L62-L70))
Netzwerkbeobachter können Dateien oft anhand exakter Bytezahlen identifizieren. [`gepolsterteGroesse`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L62-L70) gleicht Dateigrößen deshalb gezielt an:
* **Dateien unter 4 MiB:** Werden auf die nächste Zweierpotenz aufgerundet (mindestens 64 KiB).
* **Dateien ab 4 MiB:** Werden nach dem **Padmé-Verfahren** gepolstert (maximal rund 12 % Größenaufschlag), wodurch beliebige Längen in feste Klassen fallen.

### C. Chunks & Übertragungsprotokoll
* Große Dateien werden in Chunks von je 4 MiB unterteilt ([`DEFAULT_CHUNK_SIZE`](file:///e:/Github-Projekte/dis/src/file-encryption/file-encryption.ts#L43) = 4.194.304 Bytes).
* Jeder Chunk wird eigenständig mit AES-256-GCM verschlüsselt (12 Bytes IV + 16 Bytes Auth-Tag, [`CHUNK_UEBERHANG`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L37) = 28 Bytes).
* **Kontextbindung (AAD):** Jeder Chunk bindet den Kontext ([`TRESOR_BLOB_BESITZER`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L34) = `"msm-tresor-v1"`, `vaultItemId`, `fileId` und Chunk-Index) in die Authentifizierung ein. Vertauschen, Weglassen oder Einfügen fremder Chunks wird sofort erkannt.
* **Binäres Drahtformat:** Die Chunks werden als reine Binärdaten übertragen. Gegenüber Base64 spart dies rund ein Drittel an Bandbreite und schont die Rechenleistung auf Mobilgeräten.

### D. Schlüssel-Verschachtelung ([`blobSchluesselWickeln`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L144-L152))
Jeder Blob erhält einen eigenen, zufällig generierten 256-Bit-Schlüssel. Dieser wird mit dem `userKey` des Nutzers verschlüsselt und im Manifest des Eintrags ([`BlobKopf`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L44-L55)) hinterlegt.

Ändert der Anwender sein Master-Passwort:
1. Müssen lediglich die 32-Byte-Schlüssel im verschlüsselten Metadaten-Umschlag neu gewickelt werden ([`blobSchluesselNeuWickeln`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L155-L167)).
2. Die auf dem Server lagernden Gigabyte an verschlüsselten Chunks bleiben unverändert.

### E. Löschnachweise mit Prüfwert ([`loeschPruefwert`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L107-L109))
Damit Unbefugte keine fremden Dateien vom Server löschen können, gilt ein Prüfwertverfahren:
* Bei der Erzeugung wählt der Client ein 32-Byte-Zufallsgeheimnis (`loeschen`).
* Beim Reservieren des Speicherplatzes erhält der Server lediglich `sha256(loeschen)` ([`VaultBlob.delete_verifier`](file:///e:/Github-Projekte/maunting-server-manager/backend/models/vault_blob.py#L38)).
* Erst beim Löschen übermittelt der Client das Klartextgeheimnis. Der Server prüft den Hash und gibt die Chunks auf der Festplatte frei.

---

## 6. Das Galerie-Erlebnis: Souveräne Foto- und Videozentrale

Die Galerie ([`TresorGalerie.tsx`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx)) bietet eine flüssige Oberfläche für zehntausende persönliche Medien.

```
+-----------------------------------------------------------------------------------+
|  MSM Tresor: Fotos                                    [Suche] [Filter] [Hochladen]|
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  * AN DIESEM TAG (Erinnerungen)                                                   |
|    +-------------------+  +-------------------+                                   |
|    | Vor 2 Jahren      |  | Vor 5 Jahren      |                                   |
|    | [Foto entschlüsselt] [Foto entschlüsselt]|                                   |
|    +-------------------+  +-------------------+                                   |
|                                                                                   |
|  * Oktober 2026 (48 Aufnahmen)                                                    |
|    [Miniatur] [Miniatur] [Miniatur] [Miniatur] [Miniatur] [Miniatur]              |
|    [Miniatur] [Miniatur] [Miniatur] [Miniatur] [Miniatur] [Miniatur]              |
|                                                                                   |
|  * September 2026 (112 Aufnahmen)                                                 |
|    [Miniatur] [Miniatur] [Miniatur] [Miniatur] [Miniatur] [Miniatur]              |
|    [Miniatur] [Miniatur] [Miniatur] [Miniatur] [Miniatur] [Miniatur]              |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

### A. Performance & Monatsraster
Das Rendern tausender verschlüsselter Kacheln im Browser wird durch drei Optimierungen stabil gehalten:
1. **CSS `content-visibility: auto`:** Monatsgruppen außerhalb des sichtbaren Bereichs werden von der Rendering-Engine des Browsers übersprungen.
2. **Gemeinsamer IntersectionObserver ([`useBeobachter`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx#L151-L173)):** Miniaturen werden erst heruntergeladen und entschlüsselt, wenn sich die jeweilige Kachel dem Bildschirmausschnitt nähert.
3. **Lokaler LRU-Objekt-Cache ([`tresorMiniaturen.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorMiniaturen.ts)):** Entschlüsselte Miniaturen werden temporär im Arbeitsspeicher gehalten und beim Verlassen der Ansicht freigegeben, um Speicherlecks zu verhindern.

### B. „An diesem Tag" ([`anDiesemTag`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx#L131-L145))
Die Galerie berechnet historische Erinnerungen lokal:
* Aufnahmen, die an diesem Kalendertag in früheren Jahren entstanden sind (vor 1 Jahr, vor 2 Jahren usw.), werden hervorgehoben.
* Die Berechnung erfolgt vollständig auf dem Endgerät unter Berücksichtigung der UTC-Wanduhrzeit, damit ein um 14:00 Uhr aufgenommenes Foto zeitlich stabil bleibt.
* Der Server erfährt zu keinem Zeitpunkt, welche Daten persönliche Jahrestage darstellen.

### C. Lokale EXIF-Auswertung & Quellenfilter ([`exifLesen`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorBilder.ts#L130-L175))
Während herkömmliche Anbieter EXIF-Daten auf ihren Servern analysieren, geschieht dies in MSM ausschließlich auf dem Endgerät:
* **Aufnahmedatum & Kameramodell:** Werden direkt aus dem JPEG-Header ausgelesen ([`exifLesen`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorBilder.ts#L130-L175)).
* **Standortschutz:** GPS-Koordinaten verbleiben unangetastet im verschlüsselten Original. Sie werden serverseitig weder indiziert noch in Klartext-Schnittstellen offengelegt.
* **Automatische Quellenfilter ([`quelleVon`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx#L94-L102)):** Erkennt anhand von Dateinamensmustern und Kopfdaten verschiedene Quellen:
  * Echte Kamera-Aufnahmen (`kamera` inklusive Kameramodell).
  * Bildschirmfotos (`screenshot`).
  * Messenger-Weiterleitungen (`whatsapp`).
  * KI-generierte Bilder (`ki`: Midjourney, DALL-E, Stable Diffusion).

### D. Ähnlichkeitserkennung & Serienbilder ([`tresorAehnlich.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts))
Zur Bereinigung und Organisation von Fotosammlungen:
* Berechnet der Client lokale 64-Bit-Differenz-Hashes ([`dHash`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts#L26-L42)) auf den entschlüsselten Miniaturen (9x8 Grauwertpunkte plus mittlere Kanalfarben).
* Nahezu identische Aufnahmen und Serienbilder innerhalb definierter Hamming-Distanzschranken ([`ABSTAND`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts#L18) = 6, [`FARBE`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts#L20) = 24) werden automatisch gruppiert ([`gruppieren`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts#L65-L88)).
* Die Hashes existieren ausschließlich im flüchtigen Sitzungsspeicher und werden nicht an den Server übertragen.

### E. Integrierter Bildeditor ([`TresorBildeditor.tsx`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorBildeditor.tsx))
Bilder können direkt im Tresor bearbeitet werden:
* Zuschneiden, Drehen, Spiegeln und Anpassen des Bildausschnitts ([`rahmenZiehen`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorBildeditor.tsx#L43-L60)).
* Unterstützte Formate: JPEG, PNG, WebP ([`BEARBEITBAR`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorBildeditor.tsx#L22)).
* Änderungen erzeugen eine neue Version im Tresor, während frühere Fassungen in der Versionshistorie (`frueher`) erhalten bleiben.

---

## 7. Kamerasicherung vom Mobiltelefon: Das Posteingang-Protokoll

Die anspruchsvollste Aufgabe bei der Entwicklung einer Zero-Knowledge-Galerie ist die **automatische Kamerasicherung im Hintergrund**:
> Nimmt ein Smartphone bei gesperrtem Bildschirm ein Foto auf, darf die App den Nutzer nicht jedes Mal nach seinem 12-stelligen Master-Passwort fragen. Würde das Passwort oder der `userKey` jedoch dauerhaft im Flash-Speicher des Telefons abgelegt, wäre der Zero-Knowledge-Schutz des Tresors ausgehebelt.

MSM löst diesen Konflikt über ein **asymmetrisches Post-Quantum-Hybrid-Protokoll** ([`eingangFormat.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/eingangFormat.ts), [`tresorEingang.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorEingang.ts), [`kameraSicherung.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/kameraSicherung.ts) und [`KameraArbeit.kt`](file:///e:/Github-Projekte/maunting-server-manager/smart-system/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/smart_system/KameraArbeit.kt)).

```
+-----------------------------------------------------------------------------------+
|                  ANDROID-SMARTPHONE (App geschlossen / Display aus)               |
|                                                                                   |
|  1. Kamera speichert neues Bild in DCIM/Camera.                                   |
|  2. WorkManager-Job (KameraArbeit.kt) registriert die Aufnahme.                   |
|  3. Telefon erzeugt Einmalschlüssel und verschlüsselt Chunks über native Rust-    |
|     Engine (kamera_krypto.rs / KameraKrypto.kt).                                  |
|  4. Metadaten und Chunkschlüssel werden in ein Paket gepackt.                     |
|  5. Hybrid-Verschlüsselung mit dem ÖFFENTLICHEN Schlüssel des Tresors:            |
|     - ML-KEM-768 + RSA-4096 (Post-Quantum-Hybrid via KameraKrypto.hybrid)         |
|  6. Hardware-Signatur:                                                            |
|     - Signiert mit ECDSA P-256 aus dem Android Keystore.                          |
|  7. Upload der Chunks und des Umschlags in den Posteingang (/api/vault/inbox).    |
+-----------------------------------------------------------------------------------+
                                          |
                                          | Server kann Inhalt nicht lesen!
                                          v
+-----------------------------------------------------------------------------------+
|                                    MSM-SERVER                                     |
|                                                                                   |
|  - Hält unfertige Chunks im temporären Speicher (VaultBlob, state='offen').       |
|  - Verwaltet versiegelte Umschläge in der Tabelle VaultEingang.                   |
|  - Besitzt KEINEN privaten Schlüssel und kann keine Metadaten einsehen.           |
+-----------------------------------------------------------------------------------+
                                          |
                                          | Nutzer öffnet Tresor
                                          v
+-----------------------------------------------------------------------------------+
|                  AUTORISIERTES GERÄT (Desktop / entsperrte App)                   |
|                                                                                   |
|  1. Tresor wird mit Master-Passwort oder Smartcard entsperrt (userKey im RAM).    |
|  2. Client ruft ausstehende Umschläge aus /api/vault/inbox ab.                    |
|  3. Hardware-Signatur des Mobiltelefons wird verifiziert (verifyEcdsaP256).       |
|  4. Umschlag wird mit dem PRIVATEN Hybridschlüssel des Tresors entschlüsselt.     |
|  5. Chunkschlüssel werden mit dem regulären userKey gewickelt (blobSchluessel...). |
|  6. Datensatz wird dauerhaft als Tresoreintrag (sv-vault-v2) gespeichert.         |
|  7. Temporärer Umschlag im Posteingang wird gelöscht.                             |
|  8. Telefon kann lokalen Speicher freigeben („Speicher freigeben").               |
+-----------------------------------------------------------------------------------+
```

### Der Protokollablauf im Detail:
1. **Einrichtung des Schlüsselpaars:** Beim Aktivieren der Kamerasicherung ([`kameraEinschalten`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/kameraSicherung.ts#L83-L119)) erzeugt der Tresor ein asymmetrisches Hybrid-Schlüsselpaar ([`generateHybridKeyPair`](file:///e:/Github-Projekte/dis/src/post-quantum/hybrid.ts)): ML-KEM-768 für Post-Quantum-Schutz und RSA-4096 für klassische Härtung. Der private Schlüssel wird sicher im Tresor verschlüsselt. Der **öffentliche Schlüssel** wird auf das Smartphone übertragen und dort gespeichert ([`KameraAblage.kt`](file:///e:/Github-Projekte/maunting-server-manager/smart-system/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/smart_system/KameraAblage.kt)).
2. **Geräte-Identität im Hardware-Keystore:** Das Telefon generiert einen ECDSA-P-256-Schlüssel im hardwaregestützten **Android Keystore**. Der öffentliche Schlüssel dieses Geräts wird als autorisierter Zuspieler im Tresor registriert ([`Geraet`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorEingang.ts#L67)).
3. **Aufnahme und Upload im Hintergrund:**
   * Entsteht ein Foto, startet der Hintergrund-Job ([`KameraArbeit.kt`](file:///e:/Github-Projekte/maunting-server-manager/smart-system/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/smart_system/KameraArbeit.kt)) ohne Master-Passwort.
   * Er verschlüsselt die Chunks mit flüchtigen AES-256-GCM-Schlüsseln über die native Rust-Bibliothek ([`KameraKrypto.kt`](file:///e:/Github-Projekte/maunting-server-manager/smart-system/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/smart_system/KameraKrypto.kt)) und überträgt die Blöcke zum Server unter `/api/vault/blobs/{id}/chunks/{index}`.
   * Die Metadaten, EXIF-Werte und Chunk-Schlüssel werden in einen Umschlag gelegt.
   * Der Umschlag wird mit dem **öffentlichen Schlüssel** des Tresors hybrid-verschlüsselt und mit dem **Hardware-Schlüssel** des Telefons signiert.
   * Das Paket geht an die Schnittstelle `/api/vault/inbox` ([`VaultEingang`](file:///e:/Github-Projekte/maunting-server-manager/backend/models/vault_eingang.py#L15)).
4. **Isolierte Zwischenablage:** Zu diesem Zeitpunkt kann weder der Server noch ein Dieb des Smartphones die Datei lesen. Dem Telefon fehlt der private Schlüssel des Tresors; der Server besitzt überhaupt keine Schlüssel.
5. **Übernahme beim nächsten Entsperren ([`eingangOeffnen`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorEingang.ts#L121-L157)):** Sobald der Nutzer den Tresor am PC oder Telefon öffnet:
   * Lädt der Client ausstehende Datensätze aus dem Posteingang.
   * Prüft die Hardware-Signatur des absendenden Telefons ([`verifyEcdsaP256`](file:///e:/Github-Projekte/dis/src/signing/index.ts)).
   * Entschlüsselt die Nutzlast mit dem privaten Hybridschlüssel ([`hybridDecrypt`](file:///e:/Github-Projekte/dis/src/post-quantum/hybrid.ts)).
   * Wickelt die Blob-Schlüssel mit dem `userKey` ([`blobSchluesselWickeln`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L144-L152)) und legt die Fotos als reguläre Tresoreinträge an.
   * Löscht den Zwischeneintrag auf dem Server.
6. **Sichere Speicherbereinigung ([`freigebbar`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/kameraSicherung.ts#L235-L260) & [`speicherFreigeben`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/kameraSicherung.ts#L263-L266)):** Auf dem Mobiltelefon kann lokaler Speicherplatz freigegeben werden. Das Telefon vertraut dabei keiner reinen Statusmeldung des Servers:
   * Es prüft, ob der Blob-Status auf dem Server `fertig` lautet.
   * Es lädt den *letzten Chunk* des Originals vom Server herunter und entschlüsselt ihn zur Probe ([`letzterChunkOeffnetSich`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDateien.ts#L380-L395)).
   * Es berechnet den lokalen SHA-256-Hash auf dem Flash-Speicher ([`medienPruefsumme`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/tauri.ts)) und vergleicht ihn mit `q.sha256`.
   * Erst wenn alle kryptografischen Prüfungen erfolgreich sind, wird die lokale Datei in den Papierkorb der Galerie verschoben ([`medienPapierkorb`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/tauri.ts)).

---

## 8. Teamfunktionen & Unternehmensbetrieb

### A. Team-Tresore & Schlüsselfächer ([`teamVaultKeys.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/teamVaultKeys.ts))
MSM erweitert das Zero-Knowledge-Prinzip auf Arbeitsgruppen:
* Ein Team-Tresor besitzt einen eigenen 256-Bit-Schlüssel (`TeamVaultKey`).
* Für jedes berechtigte Teammitglied wird dieser Schlüssel in ein persönliches **Schlüsselfach** (Keyslot) gelegt, verschlüsselt mit dessen individuellem Schlüssel.
* Mitglieder können Dokumente und Medien gemeinschaftlich verwalten, ohne dass der Server Betreibereinblick erhält.
* Verlässt ein Mitglied das Team, rotieren die Administratoren den Teamschlüssel und aktualisieren ausschließlich die verbleibenden Schlüsselfächer.

### B. Smartcard-Integration & Fernentsperrung
Der Tresor ist mit der **Maunting Smartcard** verzahnt:
* Arbeitsplatz-Sitzungen können per Smartphone-Kamera über einen kurzlebigen QR-Code freigeschaltet werden.
* Das Smartphone überträgt den abgeleiteten Sitzungsschlüssel über ein Ende-zu-Ende verschlüsseltes Relay. Eine manuelle Passworteingabe auf fremden Rechnern entfällt.

### C. Speicher-Quoten ([`RoleVaultQuota`](file:///e:/Github-Projekte/maunting-server-manager/backend/models/role_vault_quota.py))
Administratoren können Speicherlimits rollenbasiert festlegen (z. B. 20 GB für Standardbenutzer, 500 GB für Projektleitungen):
* Die Quotenberechnung erfolgt auf Basis der serverseitig verwalteten Chunk-Bytezahlen.
* Der Server verwaltet die Quoten zuverlässig über den blinden Index (`konto_index`), ohne Einsicht in Dateiinhalte nehmen zu müssen.

### D. Papierkorb & Schlüsselrotation ([`vaultRotation.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultRotation.ts))
* **Papierkorb:** Gelöschte Einträge werden in einen Tombstone-Zustand überführt und können bis zur endgültigen Bereinigung wiederhergestellt werden.
* **Schlüsselrotation ([`vaultRotation.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultRotation.ts)):** Bei einem Wechsel des Master-Passworts wird der `userKey` neu berechnet und die Eintragsmetadaten werden neu gewickelt, ohne dass große Mediendateien erneut übertragen werden müssen.

---

## 9. Bedrohungsmodell & Sicherheitsanalyse

| Angriffsszenario | Angreifer-Voraussetzung | Schutzmechanismus |
| :--- | :--- | :--- |
| **Vollständige Server-Übernahme** | Angreifer erbeutet PostgreSQL-Datenbank und Dateisystem. | **Kein Datenabfluss:** Die Datenbank enthält ausschließlich blinde HMAC-Indizes, Prüftokens und Ciphertext-Chunks. Dateinamen, Klartexte, Vorschaubilder und Nutzerzuordnungen sind nicht rekonstruierbar. |
| **Offline-Wörterbuchangriff** | Angreifer besitzt Ciphertexte und das KDF-Salz. | **Hohe Hürde:** 12 Zeichen Mindestlänge in Verbindung mit 64 MiB Argon2id (3 Durchläufe, 4 Threads) machen automatisierte Wörterbuchangriffe extrem zeit- und kostenintensiv. |
| **Ciphertext-Vertauschung** | Angreifer manipuliert Datenbankzeilen und tauscht Blobs aus. | **Schutz durch AAD:** Alle Chunks und Umschläge sind kryptografisch an ihren Kontext gebunden ([`kontext`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L92-L94) mit Eigentümer, Eintrags-ID und Chunk-Index). Manipulierte Chunks schlagen bei der Authentifizierung fehl. |
| **Längen- & Verkehrsanalyse** | Angreifer überwacht Netzwerkverkehr zur Identifikation von Dateitypen. | **Polsterung:** Metadaten werden auf 4.096 Bytes aufgefüllt; Mediendateien werden nach Padmé oder auf feste Zweierpotenzen gerundet ([`gepolsterteGroesse`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L62-L70)). |
| **Diebstahl des Smartphones (gesperrt)** | Angreifer stiehlt das Telefon während aktiver Kamerasicherung. | **Keine Tresorgefährdung:** Auf dem Gerät liegt lediglich der ÖFFENTLICHE Schlüssel des Tresors. Bereits gesicherte Fotos oder Passwörter im Tresor können nicht entschlüsselt werden. |
| **Einschleusung durch den Server** | Ein kompromittierter Server versucht, manipulierte Dateien in den Posteingang zu legen. | **Hardware-Signaturprüfung:** Der Tresor-Client verwirft jeden Posteingang-Datensatz, der keine gültige ECDSA-P-256-Signatur eines registrierten Endgeräts trägt. |
| **Arbeitsspeicher-Inspektion** | Fremdprozesse versuchen, Speicherbereiche der Anwendung auszulesen. | **[`SecureBuffer`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts):** Sensible Puffer werden nach der kryptografischen Verarbeitung umgehend explizit mit Nullen überschrieben. |

---

## 10. Zusammenfassung

Die Architektur des Maunting Tresors löst den Widerspruch zwischen kryptografischer Zero-Knowledge-Sicherheit und flüssiger Medienverwaltung auf. Durch die Verankerung aller Datenflüsse in den primitiven Funktionen von [`@msdis/shield`](file:///e:/Github-Projekte/dis/src/index.ts) sowie das zweistufige asymmetrische Posteingang-Verfahren zeigt MSM, dass private Mediengalerien auf eigener Hardware denselben Bedienkomfort wie kommerzielle Cloud-Plattformen bieten können, ohne Zugeständnisse bei der Datenhoheit zu machen.
