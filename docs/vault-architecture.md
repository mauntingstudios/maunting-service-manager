# Maunting Vault Architecture & Sovereign Gallery Protocol

## 1. Executive Summary & Vision

The **Maunting Vault** (*Tresor*) is a zero-knowledge, end-to-end encrypted (E2EE) data repository embedded in Maunting Server Manager (MSM). It bridges two paradigms that are historically kept separate in software architecture:

1. **Enterprise Secret Management:** Zero-knowledge cryptographic storage for master passwords, server credentials, database secrets, API tokens, and private notes.
2. **Sovereign Personal Media Gallery:** A responsive, privacy-preserving photo and video hub reminiscent of Google Photos or Apple Photos, running 100% on self-hosted infrastructure.

In conventional digital ecosystems, users face an uncomfortable compromise. While technical users protect passwords using client-side encrypted password vaults, they simultaneously upload family photo archives, personal video recordings, identity documents, and sensitive scans in cleartext to commercial cloud providers (Google Photos, Apple iCloud, Dropbox). 

The Maunting Vault eliminates this compromise. Built on top of the Defensive Integration Shield ([`@msdis/shield`](file:///e:/Github-Projekte/dis/src/index.ts)), the system pairs the cryptographic guarantees of modern zero-knowledge architectures ([Argon2id](file:///e:/Github-Projekte/dis/src/kdf/index.ts), [AES-256-GCM](file:///e:/Github-Projekte/dis/src/aead/aes-gcm.ts), [ML-KEM-768](file:///e:/Github-Projekte/dis/src/post-quantum/hybrid.ts), blind HMAC indexing, and client-side memory wiping via [`SecureBuffer`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts)) with a media streaming pipeline: 4 MiB chunked streaming, client-side thumbnail generation, responsive lightbox browsing, perceptual similarity clustering, an in-vault non-destructive image editor, and automated smartphone background camera ingestion.

---

## 2. History & Motivation: From Password Manager to Private Media Hub

### Phase 1: The Zero-Knowledge Password Vault
The project began as an internal, self-hosted password manager. The original objective was focused: allow system administrators and teams operating Maunting Server Manager to store server credentials, database passwords, SSL certificates, and SSH access keys securely on their own nodes without reliance on external cloud services.

Security requirements were strict from day one:
* Passwords never reach the server in cleartext.
* Symmetric master keys are derived client-side via memory-hard Argon2id hashing.
* The server operates strictly as an untrusted blind ciphertext bucket.

### Phase 2: The Architectural Pivot
Once the cryptographic foundation was established, a fundamental realization emerged:
> Passwords represent only a minute fraction of personal confidential data. The files users value most (family memories, personal photos, private video recordings, official notices, and medical scans) are routinely uploaded in cleartext to centralized cloud monopolies.

Commercial platforms like Google Photos provide great daily convenience: automatic background camera synchronization, smooth timeline scrolling, and quick photo retrieval. However, that convenience comes at significant architectural trade-offs:
* Cloud operators retain server-side access to all uploaded media.
* Automated machine learning pipelines analyze photos for faces, locations, objects, and OCR text.
* Algorithmic false positives or automated account suspensions can abruptly sever users from decades of family archives.

### Phase 3: Architecture of the Sovereign Media Gallery
The vault was re-architected into a universal encrypted storage engine capable of hosting large media while maintaining zero-knowledge guarantees:
1. **Size and Traffic Analysis Defense:** Normalization via the Padmé algorithm and power-of-two size classes prevents file types or contents from leaking through ciphertext length analysis ([`gepolsterteGroesse`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L62-L70)).
2. **Chunked Streaming Storage:** Large files are partitioned into 4 MiB chunks encrypted via AES-256-GCM ([`DEFAULT_CHUNK_SIZE`](file:///e:/Github-Projekte/dis/src/file-encryption/file-encryption.ts#L43)). This allows fluid video playback and image previews without loading multi-gigabyte files into client RAM.
3. **Triple Representation Pipeline:** Miniature thumbnails (256 px WebP, max 32 KiB) and high-resolution previews (1600 px WebP, max 512 KiB) are generated client-side prior to encryption ([`bildAngaben`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorBilder.ts#L82-L115)).
4. **The Gallery UI ([`TresorGalerie.tsx`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx)):** Month-grouped timelines, "On This Day" anniversary recalls ([`anDiesemTag`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx#L131-L145)), duplicate and burst clustering ([`gruppieren`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts#L65-L88)), and camera model filters.
5. **The Asymmetric Inbox Protocol:** Solves background mobile ingestion through post-quantum hybrid encryption ([ML-KEM-768](file:///e:/Github-Projekte/dis/src/post-quantum/hybrid.ts) + RSA-4096) and hardware-backed Android Keystore signatures ([`KameraArbeit.kt`](file:///e:/Github-Projekte/maunting-server-manager/smart-system/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/smart_system/KameraArbeit.kt), [`tresorEingang.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorEingang.ts)).

---

## 3. Comparative Architecture Matrix

| Architectural Dimension | Traditional Password Vaults (e.g., Bitwarden, 1Password) | Commercial Photo Clouds (e.g., Google Photos, Apple iCloud) | Self-Hosted Media Servers (e.g., Immich, PhotoPrism, Nextcloud) | MSM Vault & Private Gallery ([`@msdis/shield`](file:///e:/Github-Projekte/dis/src/index.ts)) |
| :--- | :--- | :--- | :--- | :--- |
| **Zero-Knowledge Encryption** | Strong for text strings; limited or absent for multi-gigabyte media. | None or provider-managed keys; server can inspect media contents. | None; media stored in cleartext on disk and database. | **Strict Zero-Knowledge:** Server never possesses keys, filenames, image data, or EXIF metadata. |
| **Server Compromise Impact** | Encrypted password blobs secure; file attachments often unpadded. | Total exposure of personal photos, videos, and AI metadata. | Total exposure; anyone with server root access reads all cleartext files. | **Zero Data Breach:** Database and storage hold only blind HMACs, blind tokens, and encrypted chunks. |
| **Media Browsing UX** | Static attachment lists; full download required before viewing; no gallery. | Fast timeline, responsive thumbnails, adaptive video streaming. | Fast timeline, rich UI, facial recognition, web and mobile apps. | **Fluid Gallery:** Virtualized 60 FPS timeline, 256 px thumbnails, 1600 px lightbox preview, video seek. |
| **Mobile Camera Synchronization** | Manual upload only; no automatic camera roll background ingestion. | Continuous background sync from `DCIM/Camera`. | Background sync via mobile app to cleartext server endpoint. | **Asymmetric Hybrid Inbox:** Android WorkManager job syncs new camera shots using public key cryptography. |
| **Master Secret on Mobile Device** | Master key kept in phone memory/storage to decrypt vault. | User auth token stored on device; provider holds encryption keys. | Auth token stored on device; server stores cleartext media. | **Zero Master Key Exposure:** Locked phone holds only the vault's PUBLIC key; cannot read previously stored data. |
| **Metadata & EXIF Privacy** | N/A (metadata flat or unindexed). | EXIF, GPS coordinates, faces, and timestamps parsed server-side. | EXIF and GPS indexed in cleartext database tables on server. | **Client-Side Extraction:** Dates and camera models read locally; GPS tags sealed inside encrypted original. |
| **Post-Quantum Security** | Classical symmetric / asymmetric encryption (AES, RSA, ECC). | Standard TLS; server-side encryption with provider keys. | Standard TLS; unencrypted storage at rest unless whole-disk LUKS. | **Hybrid Post-Quantum Ready:** Ingestion protocol combines ML-KEM-768 with classical RSA-4096. |
| **Memory Hygiene** | Standard runtime garbage collection. | Not applicable (client-side keys not managed). | Not applicable (server-side media processing). | **[`SecureBuffer`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts) RAM Wiping:** Keys and intermediate buffers zeroed explicitly immediately upon use. |

---

## 4. Cryptographic Foundation & Security Model

The security model of the MSM Vault assumes that the host server, its databases, and all network routes are completely untrusted. Even with root access to the PostgreSQL database or physical storage disks, an attacker cannot decrypt entries, reconstruct file structures, or correlate data buckets with user accounts.

```
+-----------------------------------------------------------------------------------+
|                                  CLIENT DEVICE                                    |
|                                                                                   |
|  Master Password (>= 12 chars) + Salt (/api/vault/salt)                           |
|                             |                                                     |
|                             v                                                     |
|                 Argon2id (64 MiB RAM, 3 iterations, 4 parallelism)                |
|                             |                                                     |
|               +-------------+-------------+                                       |
|               |                           |                                       |
|               v                           v                                       |
|      userKey (32 Bytes)         bucketSeed (32 Bytes)                             |
|      AES-256-GCM                |                                                 |
|      (in SecureBuffer)          +-----------------------+                         |
|               |                 |                       |                         |
|               v                 v                       v                         |
|      E2EE Payload (sv-vault-v2) bucketId = SHA256(...)  bucketAuthToken = SHA256(...)
+---------------+-----------------+-----------------------+-------------------------+
                |                 |                       |
                | AES-256-GCM     | Bucket ID             | Blind Proof of Possession
                v                 v                       v
+-----------------------------------------------------------------------------------+
|                                   MSM SERVER                                      |
|                                                                                   |
|  - Validates bucketAuthToken against stored blind verifier (VaultBlindBucket).    |
|  - Has NO access to master passwords or userKey.                                  |
|  - Stores blind blobs and HMAC account indexes (konto_index via DIS sidecar).     |
|  - Unable to correlate bucket IDs with real user accounts on disk.                |
+-----------------------------------------------------------------------------------+
```

### A. Key Derivation Function ([`deriveVaultKeys`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L145-L194))
Key derivation relies on memory-hard Argon2id implemented in [`@msdis/shield/kdf`](file:///e:/Github-Projekte/dis/src/kdf/index.ts):
* **Memory Cost:** 65,536 KiB (64 MiB).
* **Iterations:** 3 passes.
* **Parallelism:** 4 threads.
* **Derived Length:** 64 raw bytes.

The 64 derived bytes are split into two independent 32-byte cryptographic secrets:
1. **`userKey` (Bytes 0 to 31):** The primary symmetric master key. It is imported directly into WebCrypto as a non-extractable AES-256-GCM `CryptoKey`.
2. **`bucketSeed` (Bytes 32 to 63):** The blind bucket entropy source.
   * `bucketId = sha256Hex(bucketSeed)`: A 64-character hexadecimal identifier serving as the client's blind storage partition ([`VaultBlindBucket`](file:///e:/Github-Projekte/maunting-server-manager/backend/models/vault_blind_bucket.py#L15)).
   * `bucketAuthToken = sha256Hex(bucketSeed || ':msm-vault-auth-v1')`: A deterministic blind proof of possession.

### B. Memory Hygiene via [`SecureBuffer`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts)
Sensitive binary keys never linger in regular garbage-collected JavaScript memory. They are managed through [`SecureBuffer`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts):
* Allocated memory is isolated from standard object inspection.
* Key operations execute within synchronous or asynchronous scopes: `.use((bytes) => { ... })` or `.useAsync()`.
* Immediately following key derivation or WebCrypto import, the underlying memory buffer is explicitly overwritten with zeroes ([`.destroy()`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts#L111)).

### C. Password Entropy Enforcement ([`MASTER_PASSWORT_MINDESTLAENGE`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L51))
Zero-knowledge architectures have one fundamental boundary: if an attacker captures both the server database (ciphertexts) and the salt from `/api/vault/salt`, they can conduct an offline dictionary attack without triggering network rate limits. To guarantee mathematical infeasibility, MSM enforces a strict minimum master password length of **12 characters** ([`MASTER_PASSWORT_MINDESTLAENGE`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L51)). Combined with 64 MiB Argon2id, offline candidate testing becomes computationally prohibitive.

### D. Envelope Encryption & Anti-Tampering ([`padPayload`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L93-L121))
Every entry payload (passwords, notes, file metadata manifests) is sealed in a versioned envelope:
* **Envelope Format:** `sv-vault-v2:<base64(IV || ciphertext || authTag)>` ([`VAULT_ENVELOPE_V2_PREFIX`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L34)).
* **Authenticated Additional Data (AAD):** Bound to `sv-vault-v2:<entryId>`. This prevents ciphertext-swapping attacks where an attacker substitutes one entry's encrypted blob for another.
* **Traffic Analysis Padding ([`padPayload`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultCrypto.ts#L93-L121)):** Metadata payloads are padded to fixed 4,096-byte boundaries with pseudorandom noise before encryption. An observer inspecting network traffic cannot determine whether an entry stores a 12-character password or a comprehensive private note.

### E. Blind Account Indexing ([`konto_index`](file:///e:/Github-Projekte/maunting-server-manager/backend/models/vault_user_setting.py))
In standard architectures, the `vault_entries` table directly links to a `user_id` foreign key. In MSM, database entries are decoupled from user identities:
* The server computes a blind HMAC of the user identifier (`konto_index`) exclusively inside the isolated DIS sidecar.
* A physical dump of the database reveals only pseudorandom hash values. It is impossible to correlate user accounts with bucket IDs or stored file counts.

---

## 5. Binary Media Storage Engine: Blobs, Chunks & Lifecycle

Handling large media under zero-knowledge constraints requires a dedicated streaming architecture. Loading a 4K video or a 50 MB RAW image entirely into browser RAM to encrypt it in one pass would crash the tab. MSM solves this with a **chunked streaming storage architecture** implemented in [tresorDatei.ts](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts) and [tresorDateien.ts](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDateien.ts).

```
                           ORIGINAL MEDIA FILE
                                    |
          +-------------------------+-------------------------+
          |                         |                         |
          v                         v                         v
     Original File            Preview Image            Thumbnail Image
   (Padmé / Pow-of-2)       (1600 px WebP max)        (256 px WebP max)
   Max 4 MiB Chunks          Fixed 512 KiB Box         Fixed 32 KiB Box
          |                         |                         |
     AES-256-GCM               AES-256-GCM               AES-256-GCM
    (Per-Blob Key)            (Per-Blob Key)            (Per-Blob Key)
          |                         |                         |
          +-------------------------+-------------------------+
                                    |
                    Keys wrapped with userKey
                                    |
                                    v
                     Sealed in Vault Entry Manifest
                     (sv-vault-v2 envelope)
```

### A. The Triple-Blob Representation
When an image or video is added to the vault, the client generates three separate cryptographic blobs prior to encryption ([`bildAngaben`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorBilder.ts#L82-L115)):
1. **Original Blob:** The unmodified media file, preserving full sensor resolution and audio/video streams.
2. **Preview Blob ([`VORSCHAU_GROESSE`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L40)):** Scaled to a maximum bounding box of 1,600 pixels (WebP) with adaptive compression targeting at most 512 KiB. This blob powers the responsive lightbox.
3. **Thumbnail Blob ([`MINIATUR_GROESSE`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L39)):** Scaled to 256 pixels (WebP) with adaptive compression fitting inside 32 KiB. This blob feeds the virtualized gallery grid.

Non-media files (PDFs, ZIP archives, configuration backups) use empty preview and thumbnail blobs of identical fixed dimensions so file categories cannot be deduced from blob structures.

### B. Size Obfuscation ([`gepolsterteGroesse`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L62-L70))
Network observers can frequently identify files by exact byte counts. To counter this, [`gepolsterteGroesse`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L62-L70) normalizes blob sizes:
* **Files < 4 MiB:** Padded to the next power of two (minimum 64 KiB).
* **Files >= 4 MiB:** Padded according to the **Padmé algorithm** (at most ~12% overhead), collapsing arbitrary file lengths into a compact set of size classes.

### C. Chunking & Streaming Protocol
* Files are partitioned into chunks of 4 MiB ([`DEFAULT_CHUNK_SIZE`](file:///e:/Github-Projekte/dis/src/file-encryption/file-encryption.ts#L43) = 4,194,304 Bytes).
* Each chunk is encrypted independently via AES-256-GCM with a 12-byte IV and 16-byte authentication tag ([`CHUNK_UEBERHANG`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L37) = 28 Bytes).
* **Cryptographic Binding:** Each chunk incorporates deterministic AAD containing the attachment context ([`TRESOR_BLOB_BESITZER`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L34) = `"msm-tresor-v1"`, `vaultItemId`, `fileId`, and chunk index). Chunks cannot be reordered, omitted, or transplanted into other files.
* **Direct Binary Wire Format:** Chunks are transmitted and stored as raw binary buffers rather than Base64 strings, eliminating the 33% serialization bloat and preventing CPU bottlenecks in web worker threads.

### D. Blob Encryption & Key Wrapping ([`blobSchluesselWickeln`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L144-L152))
Each blob has its own randomly generated 256-bit symmetric key. This key is wrapped (encrypted) with the user's `userKey` and stored within the vault item's sealed manifest ([`BlobKopf`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L44-L55)).

When a user updates their master password:
1. Only the 32-byte blob keys inside the metadata envelope need to be re-wrapped with the new `userKey` ([`blobSchluesselNeuWickeln`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L155-L167)).
2. The encrypted media chunks stored on the server remain completely untouched.

### E. Deletion Authorization Tokens ([`loeschPruefwert`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L107-L109))
To prevent unauthorized users or corrupted clients from wiping remote storage, deletion requires a cryptographic token:
* When a blob is created, the client picks a 32-byte random hex secret (`loeschen`).
* The client sends `sha256(loeschen)` to the server during blob reservation ([`VaultBlob.delete_verifier`](file:///e:/Github-Projekte/maunting-server-manager/backend/models/vault_blob.py#L38)).
* To delete a blob, the client must present the raw `loeschen` secret. The server verifies the hash before deleting any chunks from disk.

---

## 6. The Gallery Experience: Sovereign Media Hub

The gallery component ([`TresorGalerie.tsx`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx)) provides a fluid visual interface designed to handle tens of thousands of personal media files seamlessly.

```
+-----------------------------------------------------------------------------------+
|  MSM Vault: Photos                                    [Search] [Filter] [Upload]  |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  * ON THIS DAY (Anniversary Memories)                                             |
|    +-------------------+  +-------------------+                                   |
|    | 2 Years Ago Today |  | 4 Years Ago Today |                                   |
|    | [Decrypted Photo] |  | [Decrypted Photo] |                                   |
|    +-------------------+  +-------------------+                                   |
|                                                                                   |
|  * October 2026 (48 items)                                                        |
|    [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail]       |
|    [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail]       |
|                                                                                   |
|  * September 2026 (112 items)                                                     |
|    [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail]       |
|    [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail] [Thumbnail]       |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

### A. Performance & Virtualized Month Grouping
Rendering thousands of encrypted media tiles in a web browser can cause DOM thrashing. The gallery solves this through three coordinated techniques:
1. **CSS `content-visibility: auto`:** Offscreen month groups are skipped by the browser layout engine until scrolled into view.
2. **Coordinated Intersection Observers ([`useBeobachter`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx#L151-L173)):** Thumbnails are fetched and decrypted on demand only when a tile approaches the visible viewport.
3. **Decrypted Thumbnail Cache ([`tresorMiniaturen.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorMiniaturen.ts)):** In-memory object URLs are cached in a pool and revoked when components unmount, avoiding browser memory leaks.

### B. "On This Day" ([`anDiesemTag`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx#L131-L145))
The gallery automatically calculates anniversary memories:
* It matches the current calendar day and month against capture timestamps extracted from EXIF headers (1 year ago, 2 years ago, etc.).
* Calculations run entirely client-side using Wall Clock / UTC time normalization to ensure that photos taken at 14:00 remain pegged to 14:00 regardless of the viewer's current time zone.
* The server never learns which dates represent anniversaries or milestones.

### C. Client-Side EXIF & Source Detection ([`exifLesen`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorBilder.ts#L130-L175))
Unlike cloud photo services that parse EXIF metadata on remote servers, MSM extracts metadata exclusively inside the client's local execution environment before encryption:
* **Capture Date & Camera Model:** Extracted directly from JPEG headers ([`exifLesen`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorBilder.ts#L130-L175)).
* **Location Privacy:** GPS tags remain untouched inside the encrypted original file. They are never indexed, exposed in API routes, or visible to the server.
* **Automatic Source Classification ([`quelleVon`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorGalerie.tsx#L94-L102)):** Analyzes file attributes and names to categorize items into filters:
  * Camera captures (`kamera` / model-specific tag).
  * Screenshots (`screenshot`).
  * Instant messaging forwards (`whatsapp`).
  * AI-generated imagery (`ki`: Midjourney, DALL-E, Stable Diffusion).

### D. Perceptual Similarity & Burst Clustering ([`tresorAehnlich.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts))
To organize large photo collections without sending photos to cloud computer vision models:
* The client computes a 64-bit perceptual difference hash ([`dHash`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts#L26-L42)) locally on decrypted thumbnails (9x8 grayscale pixels plus average color channel matching).
* Consecutive bursts and near-identical shots within a Hamming distance bound ([`ABSTAND`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts#L18) = 6, [`FARBE`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts#L20) = 24) are automatically clustered via disjoint-set union ([`gruppieren`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorAehnlich.ts#L65-L88)).
* Hashes exist exclusively in ephemeral memory during the active session and are never synced to the server.

### E. Integrated Client-Side Image Editor ([`TresorBildeditor.tsx`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorBildeditor.tsx))
Users can edit images directly within the vault:
* Crop, rotate, flip, and adjust framing ([`rahmenZiehen`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorBildeditor.tsx#L43-L60)).
* Supported formats: JPEG, PNG, WebP ([`BEARBEITBAR`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/TresorBildeditor.tsx#L22)).
* Edits produce a new encrypted version while preserving previous iterations in a non-destructive history stack (`frueher`).

---

## 7. Smartphone Camera Synchronization: The Vault Inbox Protocol

The most demanding architectural challenge in zero-knowledge photo storage is **automated background mobile backup**:
> When an Android smartphone takes a photo with the screen off or the app closed, the MSM app cannot ask the user for their 12-character master password. If the master password or `userKey` were saved in plaintext on the phone's flash storage, the entire zero-knowledge guarantee would be destroyed.

MSM resolves this dilemma through a novel **Asymmetric Post-Quantum Hybrid Inbox Protocol** ([`eingangFormat.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/eingangFormat.ts), [`tresorEingang.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorEingang.ts), [`kameraSicherung.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/kameraSicherung.ts), and [`KameraArbeit.kt`](file:///e:/Github-Projekte/maunting-server-manager/smart-system/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/smart_system/KameraArbeit.kt)).

```
+-----------------------------------------------------------------------------------+
|                        ANDROID SMARTPHONE (App Closed / Phone Locked)             |
|                                                                                   |
|  1. Camera writes new photo to DCIM/Camera.                                       |
|  2. WorkManager background worker (KameraArbeit.kt) detects file.                 |
|  3. Phone generates ephemeral symmetric blob keys and encrypts file chunks via    |
|     native Rust engine (kamera_krypto.rs / KameraKrypto.kt).                      |
|  4. Phone bundles metadata & blob keys into an inbox payload.                     |
|  5. Hybrid encryption with Vault PUBLIC KEY:                                      |
|     - ML-KEM-768 + RSA-4096 (Post-Quantum Hybrid via KameraKrypto.hybrid)         |
|  6. Hardware signature:                                                           |
|     - Signed with device ECDSA P-256 key from Android Keystore.                   |
|  7. Uploads encrypted blobs and sealed envelope to server inbox (/api/vault/inbox)|
+-----------------------------------------------------------------------------------+
                                          |
                                          | Server cannot decrypt payload!
                                          v
+-----------------------------------------------------------------------------------+
|                                  MSM SERVER                                       |
|                                                                                   |
|  - Holds blind blobs in temporary staging (VaultBlob, state='offen').             |
|  - Holds sealed envelope in user's blind inbox table (VaultEingang).              |
|  - Server has NO private key and CANNOT read image or metadata.                   |
+-----------------------------------------------------------------------------------+
                                          |
                                          | Client opens vault
                                          v
+-----------------------------------------------------------------------------------+
|                  AUTHORIZED CLIENT (Desktop / Unlocked Smartphone)                |
|                                                                                   |
|  1. User unlocks vault with Master Password / Smartcard (userKey present).        |
|  2. Client fetches pending inbox envelopes from /api/vault/inbox.                 |
|  3. Client verifies device ECDSA hardware signature (verifyEcdsaP256).            |
|  4. Client decrypts envelope using Vault PRIVATE KEY (hybridDecrypt).             |
|  5. Client re-wraps blob keys with userKey (blobSchluesselWickeln).               |
|  6. Commits permanent vault entry (sv-vault-v2 envelope).                         |
|  7. Deletes temporary inbox envelope from server.                                 |
|  8. Phone safely reclaims local storage ("Speicher freigeben").                   |
+-----------------------------------------------------------------------------------+
```

### Detailed Protocol Flow:
1. **Vault Public Key Registration:** When the user configures camera backup ([`kameraEinschalten`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/kameraSicherung.ts#L83-L119)), the vault generates an asymmetric hybrid key pair ([`generateHybridKeyPair`](file:///e:/Github-Projekte/dis/src/post-quantum/hybrid.ts)): ML-KEM-768 for post-quantum resistance and RSA-4096 for classical security. The private key is sealed inside the vault like any standard entry. The **public key** is transferred to the smartphone and stored in local application preferences ([`KameraAblage.kt`](file:///e:/Github-Projekte/maunting-server-manager/smart-system/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/smart_system/KameraAblage.kt)).
2. **Device Hardware Identity:** The smartphone generates an ECDSA P-256 key pair inside the hardware-backed **Android Keystore**. The public key of the device is registered inside the vault as an authorized ingest device ([`Geraet`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorEingang.ts#L67)).
3. **Background Capture & Ingestion:**
   * When a photo is taken, the phone's background worker ([`KameraArbeit.kt`](file:///e:/Github-Projekte/maunting-server-manager/smart-system/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/smart_system/KameraArbeit.kt)) runs without needing the master password.
   * It encrypts photo chunks using ephemeral AES-256-GCM keys via native Rust ([`KameraKrypto.kt`](file:///e:/Github-Projekte/maunting-server-manager/smart-system/src-tauri/gen/android/app/src/main/java/com/mauntingstudios/smart_system/KameraKrypto.kt)) and uploads the blind chunks to `/api/vault/blobs/{id}/chunks/{index}`.
   * It packages file metadata, capture time, EXIF details, and raw blob keys into an inbox envelope.
   * It hybrid-encrypts the envelope using the vault's **public key** and signs the package using the device's **Android Keystore hardware key**.
   * It transmits the sealed envelope to `/api/vault/inbox` ([`VaultEingang`](file:///e:/Github-Projekte/maunting-server-manager/backend/models/vault_eingang.py#L15)).
4. **Zero-Knowledge Quarantine:** At this stage, neither the server nor an attacker possessing the smartphone can decrypt the photo. The phone lacks the vault's private key; the server possesses no keys whatsoever.
5. **Reconciliation on Unlock ([`eingangOeffnen`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorEingang.ts#L121-L157)):** The next time the user opens MSM on their desktop or smartphone:
   * The client fetches pending items from the inbox.
   * It verifies the hardware signature against registered devices ([`verifyEcdsaP256`](file:///e:/Github-Projekte/dis/src/signing/index.ts)).
   * It decrypts the inbox payload using the vault's hybrid private key ([`hybridDecrypt`](file:///e:/Github-Projekte/dis/src/post-quantum/hybrid.ts)).
   * It wraps the blob keys with the active `userKey` ([`blobSchluesselWickeln`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L144-L152)) and commits the photos as permanent vault items.
   * It instructs the server to delete the temporary inbox envelope.
6. **Safe Storage Reclamation ([`freigebbar`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/kameraSicherung.ts#L235-L260) & [`speicherFreigeben`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/kameraSicherung.ts#L263-L266)):** The user can safely reclaim storage on their smartphone. To ensure data safety, the app does not blindly trust the server's completion flag:
   * It checks that the blob state on the server is `fertig`.
   * It actively downloads and test-decrypts the *final chunk* of the remote original blob ([`letzterChunkOeffnetSich`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDateien.ts#L380-L395)).
   * It calculates the local SHA-256 checksum on disk ([`medienPruefsumme`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/tauri.ts)) and verifies that it exactly matches `q.sha256`.
   * Only after all cryptographic checks succeed does Android move the local media file into the trash ([`medienPapierkorb`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/tauri.ts)).

---

## 8. Multi-User & Enterprise Capabilities

### A. Team Vaults & Key Slots ([`teamVaultKeys.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/teamVaultKeys.ts))
MSM extends zero-knowledge guarantees to organizations and multi-user environments:
* A team vault possesses its own random 256-bit symmetric key (`TeamVaultKey`).
* For every authorized team member, the team key is wrapped into an individual **keyslot** encrypted with that member's public key or personal credentials.
* Team members can read, add, and organize shared media files and credentials without the server ever obtaining access to the shared key.
* When a team member is removed, the remaining administrators rotate the team key and re-wrap it only for the remaining active keyslots.

### B. Smartcard Hardware & Visual Token Metaphor
The vault integrates with the **Maunting Smartcard** architecture:
* Users can unlock their desktop vault sessions through their smartphone camera by scanning a short-lived QR code.
* The smartphone transfers the derived session key via an ephemeral end-to-end encrypted relay, completely bypassing manual password entry on public or untrusted workstations.

### C. Quotas & Storage Management ([`RoleVaultQuota`](file:///e:/Github-Projekte/maunting-server-manager/backend/models/role_vault_quota.py))
Administrators can allocate storage quotas per user role (e.g., 20 GB for standard users, 200 GB for team leads):
* Quotas are enforced based on the server's blind accounting of chunk bytes.
* Even though the server cannot inspect what is stored, it accurately tracks aggregate allocated bytes per bucket index (`konto_index`).

### D. Cryptographic Recycle Bin & Key Rotation ([`vaultRotation.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultRotation.ts))
* **Recycle Bin (`Papierkorb`):** Deleted items enter a tombstone state. They remain encrypted and can be restored until explicitly purged.
* **Master Password & Key Rotation ([`vaultRotation.ts`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/vaultRotation.ts)):** Changing the master password re-derives `userKey`, re-wraps entry manifests, and updates keyslots without requiring large media blobs to be downloaded or re-encrypted.

---

## 9. Security Audit & Threat Modeling

| Attack Vector | Attacker Capability | System Defense |
| :--- | :--- | :--- |
| **Complete Server Compromise** | Attacker dumps entire PostgreSQL database and disk storage. | **Zero Data Breach:** Database contains only blind HMAC indexes, blind bucket tokens, and encrypted chunks. No plaintext, no filenames, no image previews, and no user associations are recoverable. |
| **Offline Dictionary Attack** | Attacker captures ciphertexts and user salt from `/api/vault/salt`. | **High Resistance:** 12-character minimum password combined with 64 MiB Argon2id (3 iterations, 4 parallelism) makes offline candidate evaluation computationally expensive. |
| **Ciphertext Swap Attack** | Attacker modifies database to replace one user's file blob with another. | **Defeated by AAD:** All entry envelopes and file chunks enforce strict AAD binding ([`kontext`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L92-L94) with owner ID, item ID, and chunk index). Tampered chunks fail AEAD authentication and are discarded. |
| **Traffic & Length Analysis** | Attacker monitors network bandwidth to identify specific photo or document types. | **Defeated by Padding:** Metadata envelopes are padded to 4,096-byte boundaries. Binary blobs are padded using Padmé or power-of-two classes ([`gepolsterteGroesse`](file:///e:/Github-Projekte/maunting-server-manager/frontend/src/desktop/vault/tresorDatei.ts#L62-L70)). |
| **Stolen Smartphone (Phone Locked)** | Attacker steals phone while background camera backup is active. | **Zero Vault Exposure:** The phone stores only the vault's PUBLIC key. The attacker cannot decrypt the user's existing vault entries or previously backed-up photos. |
| **Malicious Server Ingestion** | Compromised server attempts to inject rogue files into the vault inbox. | **Defeated by Hardware Signatures:** The vault client rejects any inbox payload that lacks a valid ECDSA P-256 signature from a hardware-registered device. |
| **Client Memory Inspection** | Other processes or memory dump tools attempt to inspect client RAM. | **Defeated by [`SecureBuffer`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts):** Keys and intermediate buffers are explicitly overwritten with zeroes ([`.destroy()`](file:///e:/Github-Projekte/dis/src/secure-memory/secure-buffer.ts#L111)) immediately after cryptographic processing. |

---

## 10. Summary

The Maunting Vault architecture resolves the historical contradiction between zero-knowledge cryptographic security and fluid, rich media management. By anchoring all operations in [`@msdis/shield`](file:///e:/Github-Projekte/dis/src/index.ts) primitives and building a specialized streaming and asymmetric inbox pipeline, MSM demonstrates that private, sovereign media hosting can match the user experience of commercial clouds without sacrificing mathematical integrity.
