//! Biometrische Bestätigung und das Schlüsselfach des Betriebssystems.
//!
//! Zwei Plattformen, ein Vertrag. Was oben aufruft — Tresor wie Messenger —
//! sieht nur die Funktionen dieser Datei und muss nicht wissen, worauf es läuft:
//!
//! - **Windows**: `UserConsentVerifier` fragt (Windows Hello), der Credential
//!   Store verwahrt. Zwei getrennte Schritte: erst bestätigen, dann lesen.
//! - **Android**: der Hardware-Keystore verwahrt **und** fragt in einem Zug. Der
//!   Schlüssel liegt dort so, dass ihn kein Prozess auslesen kann, und die
//!   Hardware gibt ihn erst nach einem erfolgreichen `BiometricPrompt` frei.
//!   Der Weg dorthin geht über das Kotlin-Plugin `SchluesselfachPlugin`.
//! - **Alles andere** (Web, Linux ohne Keyring): keins von beidem, ehrlich
//!   gemeldet statt still fehlgeschlagen.
//!
//! Der Unterschied „fragt selbst" ist kein Detail, sondern sichtbar: siehe
//! [`speicher_fragt_selbst`].

use tauri::AppHandle;
#[cfg(any(windows, target_os = "android"))]
use tauri::Manager;

#[cfg(windows)]
use windows::{
    core::{factory, HSTRING},
    Security::Credentials::{
        KeyCredential, KeyCredentialCreationOption, KeyCredentialManager, KeyCredentialStatus,
    },
    Security::Credentials::UI::{
        UserConsentVerificationResult, UserConsentVerifier, UserConsentVerifierAvailability,
    },
    Security::Cryptography::CryptographicBuffer,
    Security::Cryptography::Core::{
        CryptographicEngine, HashAlgorithmNames, HashAlgorithmProvider, SymmetricAlgorithmNames,
        SymmetricKeyAlgorithmProvider,
    },
    Storage::Streams::IBuffer,
    Win32::{
        Foundation::HWND,
        System::WinRT::IUserConsentVerifierInterop,
    },
};

#[cfg(not(target_os = "android"))]
use keyring::Entry;

/// Dienstname der App im Schlüsselbund, siehe [`crate::einrichten`].
#[cfg(not(target_os = "android"))]
fn dienst_name() -> Result<&'static str, String> {
    crate::dienst().map(|d| d.name)
}

/// Das Fach des Tresors.
///
/// Es hieß immer schon so und muss weiter so heißen: wer den biometrischen
/// Schnelleinstieg vor diesem Update eingerichtet hat, hat sein Geheimnis unter
/// diesem Namen liegen. Ein umbenanntes Fach wäre für den Credential Store ein
/// leeres Fach, und der Tresor fragte plötzlich wieder nach dem Master-Passwort.
pub const FACH_TRESOR: &str = "vault_biometric_key";

/// Das Fach des Messengers. Eigener PIN, eigenes Fach.
pub const FACH_MESSENGER: &str = "messenger_biometric_key";

/// Das Fach für das Gerätegeheimnis des Messengers.
///
/// Darin liegen 32 Zufallsbytes, die in die Schlüsselableitung des PIN
/// einfließen. Sie sind **die eine Hälfte** und ohne PIN wertlos — deshalb
/// braucht das Lesen hier, anders als bei den beiden Fächern oben, keine
/// Abfrage. Eine solche Abfrage würde das reine PIN-Entsperren unmöglich machen,
/// und genau das muss auf jedem Gerät ohne Biometrie gehen.
///
/// Der Zweck ist ein anderer: eine kopierte Festplatte ist auf einem fremden
/// Gerät wertlos, weil dieses Geheimnis dort fehlt.
pub const FACH_MESSENGER_GERAET: &str = "messenger_device_secret";

/// Fächernamen, die von außen kommen dürfen.
///
/// Der Name geht in eine Ressource des Betriebssystems — in den Credential Store
/// oder in einen Keystore-Alias. Eine freie Zeichenkette aus dem Frontend hätte
/// hier nichts verloren: sie wäre ein Weg, in fremde Einträge derselben
/// Anwendung zu schreiben. Drei feste Namen, alles andere wird abgewiesen.
///
/// Die Android-Seite prüft dasselbe noch einmal in `Schluesselfach.pruefeFach`.
/// Doppelt, weil beide Seiten für sich stehen müssen.
fn pruefe_fach(fach: &str) -> Result<(), String> {
    match fach {
        FACH_TRESOR | FACH_MESSENGER | FACH_MESSENGER_GERAET => Ok(()),
        _ => Err(format!("Unbekanntes Schlüsselfach: {fach}")),
    }
}

// ── Android: die Brücke zum Kotlin-Plugin ─────────────────────────────────

#[cfg(target_os = "android")]
pub struct SchluesselfachState<R: tauri::Runtime>(pub tauri::plugin::PluginHandle<R>);

/// Meldet `SchluesselfachPlugin` bei Tauri an. Wird in `lib.rs` eingehängt.
#[cfg(target_os = "android")]
pub fn init_android_schluesselfach<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::<R>::new("schluesselfach")
        .setup(|app, api| {
            let paket = crate::dienst().map_err(|e| e.to_string())?.android_paket;
            let handle = api.register_android_plugin(paket, "SchluesselfachPlugin")?;
            app.manage(SchluesselfachState(handle));
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
pub(crate) struct WertAntwort {
    /// Fehlt, wenn nichts hinterlegt ist: `JSObject.put(key, null)` nimmt den
    /// Schlüssel drüben heraus, statt ihn auf null zu setzen.
    #[serde(default)]
    pub(crate) wert: Option<String>,
}

#[cfg(target_os = "android")]
#[derive(serde::Deserialize)]
struct JaNein {
    #[serde(default)]
    wert: bool,
}

/// Ruft das Kotlin-Plugin und wartet auf seine Antwort.
///
/// Der Aufruf hält den Faden auf, bis drüben `resolve` oder `reject` fällt — bei
/// einer Abfrage also so lange, wie der Mensch braucht. Deshalb darf ihn nur ein
/// `#[tauri::command(async)]` auslösen: auf dem Hauptthread stünde die Anwendung
/// und der Prompt käme gar nicht erst auf den Bildschirm.
#[cfg(target_os = "android")]
pub(crate) fn android_ruf<T: serde::de::DeserializeOwned>(
    app: &AppHandle,
    befehl: &str,
    daten: serde_json::Value,
) -> Result<T, String> {
    let fach = app
        .try_state::<SchluesselfachState<tauri::Wry>>()
        .ok_or_else(|| "Das Schlüsselfach dieses Geräts ist nicht erreichbar.".to_string())?;
    fach.0
        .run_mobile_plugin::<T>(befehl, daten)
        .map_err(|e| format!("Schlüsselfach: {e}"))
}

// ── Der gemeinsame Vertrag ────────────────────────────────────────────────

/// Kann sich der Mensch auf diesem Gerät biometrisch bestätigen?
pub async fn pruefe_verfuegbarkeit(app: &AppHandle) -> bool {
    #[cfg(windows)]
    {
        let _ = app;
        match UserConsentVerifier::CheckAvailabilityAsync() {
            Ok(op) => match op.await {
                Ok(availability) => availability == UserConsentVerifierAvailability::Available,
                Err(_) => false,
            },
            Err(_) => false,
        }
    }
    #[cfg(target_os = "android")]
    {
        // Bewusst nicht `tauri-plugin-biometric::status()`: das prüft
        // `BIOMETRIC_WEAK`, während die Schlüssel hier an `BIOMETRIC_STRONG`
        // oder die Bildschirmsperre gebunden sind. Ein Gerät mit nur schwacher
        // Gesichtserkennung bekäme sonst ein „ja" und scheiterte danach beim
        // Anlegen des Schlüssels.
        android_ruf::<JaNein>(app, "moeglich", serde_json::json!({}))
            .map(|a| a.wert)
            .unwrap_or(false)
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = app;
        false
    }
}

#[cfg(windows)]
fn aktives_fenster_hwnd(app: &AppHandle) -> Option<HWND> {
    app.webview_windows()
        .into_values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| app.get_webview_window("main"))
        .and_then(|w| w.hwnd().ok())
        .map(|h| HWND(h.0))
}

#[cfg(windows)]
async fn verifiziere_windows(
    app: &AppHandle,
    nachricht: &str,
) -> Result<UserConsentVerificationResult, String> {
    let msg = HSTRING::from(nachricht);
    let hwnd = aktives_fenster_hwnd(app);

    let op = if let Some(h) = hwnd {
        if let Ok(interop) = factory::<UserConsentVerifier, IUserConsentVerifierInterop>() {
            unsafe { interop.RequestVerificationForWindowAsync(h, &msg) }
                .map_err(|e| format!("Windows Hello Interop Fehler: {e}"))?
        } else {
            UserConsentVerifier::RequestVerificationAsync(&msg)
                .map_err(|e| format!("Windows Hello konnte nicht gestartet werden: {e}"))?
        }
    } else {
        UserConsentVerifier::RequestVerificationAsync(&msg)
            .map_err(|e| format!("Windows Hello konnte nicht gestartet werden: {e}"))?
    };

    op.await.map_err(|e| format!("Windows Hello Fehler: {e}"))
}
/// Fragt nach einer Bestätigung, ohne dabei ein Geheimnis anzufassen.
pub async fn verifiziere_benutzer(app: &AppHandle, nachricht: &str) -> Result<bool, String> {
    #[cfg(windows)]
    {
        match verifiziere_windows(app, nachricht).await {
            Ok(result) => Ok(result == UserConsentVerificationResult::Verified),
            Err(e) => Err(e),
        }
    }
    #[cfg(target_os = "android")]
    {
        // Die reine Bestätigung kann `tauri-plugin-biometric` schon, und es ist
        // ohnehin eingehängt. Ein zweites Stück Kotlin für dieselbe Aufgabe wäre
        // eine Kopie, die irgendwann auseinanderläuft.
        use tauri_plugin_biometric::{AuthOptions, BiometricExt};
        let optionen = AuthOptions {
            allow_device_credential: true,
            ..Default::default()
        };
        match app.biometric().authenticate(nachricht.to_string(), optionen) {
            Ok(()) => Ok(true),
            Err(e) => Err(format!("Bestätigung fehlgeschlagen: {e}")),
        }
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = (app, nachricht);
        Err("Biometrie wird auf diesem Betriebssystem nativ noch nicht unterstützt.".to_string())
    }
}

/// Fragt der Schlüsselspeicher dieser Plattform beim **Ablegen** von sich aus
/// nach einer Bestätigung?
///
/// Windows (`KeyCredentialManager`) und Android (`BiometricPrompt`/Keystore)
/// fragen beide selbst — eine zusätzliche App-Abfrage davor wäre doppelt.
pub fn speicher_fragt_selbst() -> bool {
    cfg!(any(windows, target_os = "android"))
}

/// Meldet, ob auf dieser Plattform überhaupt ein Geheimnis hardware-/Hello-geschützt verwahrt werden kann.
pub async fn geheimnisspeicher_verfuegbar(app: &AppHandle) -> bool {
    #[cfg(windows)]
    {
        let _ = app;
        let kcm_ok = match KeyCredentialManager::IsSupportedAsync() {
            Ok(op) => op.await.unwrap_or(false),
            Err(_) => false,
        };
        let cred_ok = dienst_name()
            .and_then(|d| Entry::new(d, FACH_MESSENGER_GERAET).map_err(|e| e.to_string()))
            .is_ok();
        kcm_ok && cred_ok
    }
    #[cfg(all(not(windows), not(target_os = "android")))]
    {
        let _ = app;
        dienst_name()
            .and_then(|d| Entry::new(d, FACH_MESSENGER_GERAET).map_err(|e| e.to_string()))
            .is_ok()
    }
    #[cfg(target_os = "android")]
    {
        app.try_state::<SchluesselfachState<tauri::Wry>>().is_some()
    }
}

const HELLO_ENVELOPE_PREFIX: &str = "msm-hello-v1:";
const HELLO_NONCE_LEN: usize = 12;
const HELLO_TAG_LEN: usize = 16;

fn b64_encode(input: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        out.push(if chunk.len() > 1 { TABLE[((triple >> 6) & 0x3F) as usize] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[(triple & 0x3F) as usize] as char } else { '=' });
    }
    out
}

fn b64_decode(input: &str) -> Result<Vec<u8>, String> {
    let bytes = input.as_bytes();
    if bytes.is_empty() || bytes.len() % 4 != 0 {
        return Err("Ungültige Base64-Länge im Schlüsselfach-Envelope.".to_string());
    }
    let val = |c: u8| -> Result<u8, String> {
        match c {
            b'A'..=b'Z' => Ok(c - b'A'),
            b'a'..=b'z' => Ok(c - b'a' + 26),
            b'0'..=b'9' => Ok(c - b'0' + 52),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err("Ungültiges Base64-Zeichen im Schlüsselfach-Envelope.".to_string()),
        }
    };
    let mut out = Vec::with_capacity((bytes.len() / 4) * 3);
    for chunk in bytes.chunks_exact(4) {
        let a = val(chunk[0])?;
        let b = val(chunk[1])?;
        let pad1 = chunk[2] == b'=';
        let pad2 = chunk[3] == b'=';
        if pad1 && !pad2 {
            return Err("Ungültiges Base64-Padding im Schlüsselfach-Envelope.".to_string());
        }
        let c = if pad1 { 0 } else { val(chunk[2])? };
        let d = if pad2 { 0 } else { val(chunk[3])? };
        out.push((a << 2) | (b >> 4));
        if !pad1 {
            out.push((b << 4) | (c >> 2));
        }
        if !pad2 {
            out.push((c << 6) | d);
        }
    }
    Ok(out)
}

pub(crate) fn encode_hello_envelope(nonce: &[u8], ciphertext: &[u8], tag: &[u8]) -> Result<String, String> {
    if nonce.len() != HELLO_NONCE_LEN || tag.len() != HELLO_TAG_LEN {
        return Err("Ungültige Nonce- oder Tag-Länge für Hello-Envelope.".to_string());
    }
    let mut raw = Vec::with_capacity(HELLO_NONCE_LEN + ciphertext.len() + HELLO_TAG_LEN);
    raw.extend_from_slice(nonce);
    raw.extend_from_slice(ciphertext);
    raw.extend_from_slice(tag);
    Ok(format!("{HELLO_ENVELOPE_PREFIX}{}", b64_encode(&raw)))
}

pub(crate) fn parse_hello_envelope(encoded: &str) -> Result<(Vec<u8>, Vec<u8>, Vec<u8>), String> {
    let b64 = encoded
        .strip_prefix(HELLO_ENVELOPE_PREFIX)
        .ok_or_else(|| "Kein msm-hello-v1-Envelope.".to_string())?;
    let raw = b64_decode(b64)?;
    if raw.len() < HELLO_NONCE_LEN + HELLO_TAG_LEN {
        return Err("Beschädigter msm-hello-v1-Envelope.".to_string());
    }
    let nonce = raw[..HELLO_NONCE_LEN].to_vec();
    let split_tag = raw.len() - HELLO_TAG_LEN;
    let ciphertext = raw[HELLO_NONCE_LEN..split_tag].to_vec();
    let tag = raw[split_tag..].to_vec();
    Ok((nonce, ciphertext, tag))
}

#[cfg(windows)]
fn kcm_key_name(dienst: &str, fach: &str) -> HSTRING {
    HSTRING::from(format!("msm-hello:{dienst}:{fach}"))
}

#[cfg(windows)]
fn kcm_challenge_bytes(dienst: &str, fach: &str) -> Vec<u8> {
    format!("msm-hello-v1:challenge:{dienst}:{fach}").into_bytes()
}

#[cfg(windows)]
fn kcm_aad_bytes(dienst: &str, fach: &str) -> Vec<u8> {
    format!("msm-hello-v1:aad:{dienst}:{fach}").into_bytes()
}

#[cfg(windows)]
fn ibuffer_to_vec(buf: &IBuffer) -> Result<Vec<u8>, String> {
    let reader = windows::Storage::Streams::DataReader::FromBuffer(buf)
        .map_err(|e| format!("DataReader-Fehler: {e}"))?;
    let len = buf.Length().map_err(|e| format!("Buffer-Länge Fehler: {e}"))? as usize;
    let mut out = vec![0u8; len];
    reader
        .ReadBytes(&mut out)
        .map_err(|e| format!("Buffer-Lesefehler: {e}"))?;
    Ok(out)
}

#[cfg(windows)]
async fn kcm_open_or_create(dienst: &str, fach: &str, allow_create: bool) -> Result<KeyCredential, String> {
    let supported = KeyCredentialManager::IsSupportedAsync()
        .map_err(|e| format!("Windows Hello KCM Prüfung fehlgeschlagen: {e}"))?
        .await
        .map_err(|e| format!("Windows Hello KCM nicht verfügbar: {e}"))?;
    if !supported {
        return Err("Windows Hello Schlüsselspeicher (KCM) ist auf diesem Gerät nicht verfügbar.".to_string());
    }

    let name = kcm_key_name(dienst, fach);
    let open_res = KeyCredentialManager::OpenAsync(&name)
        .map_err(|e| format!("Windows Hello Schlüssel konnte nicht geöffnet werden: {e}"))?
        .await
        .map_err(|e| format!("Windows Hello Schlüssel-Abfrage fehlgeschlagen: {e}"))?;

    let status = open_res.Status().map_err(|e| format!("KCM Status-Fehler: {e}"))?;
    if status == KeyCredentialStatus::Success {
        return open_res
            .Credential()
            .map_err(|e| format!("KCM Credential-Fehler: {e}"));
    }

    if !allow_create {
        return Err("Kein Windows Hello Schlüssel für dieses Fach hinterlegt.".to_string());
    }

    let create_res = KeyCredentialManager::RequestCreateAsync(&name, KeyCredentialCreationOption::ReplaceExisting)
        .map_err(|e| format!("Windows Hello Schlüsselerstellung fehlgeschlagen: {e}"))?
        .await
        .map_err(|e| format!("Windows Hello Schlüsselerstellung abgebrochen: {e}"))?;
    let create_status = create_res.Status().map_err(|e| format!("KCM Create-Status-Fehler: {e}"))?;
    if create_status != KeyCredentialStatus::Success {
        return Err(format!("Windows Hello Schlüsselerstellung verweigert ({create_status:?})."));
    }
    create_res
        .Credential()
        .map_err(|e| format!("KCM Credential nach Erstellung fehlgeschlagen: {e}"))
}

/// Sign-then-Derive über Windows Hello `KeyCredentialManager`.
///
/// Ehrliches Restrisiko: KCM-Einträge sind auf Win32/WinUI3 pro Windows-**Benutzer**
/// isoliert, nicht pro App. Jeder Prozess desselben Nutzers kann `OpenAsync` +
/// `RequestSignAsync` aufrufen, löst dabei aber eine sichtbare OS-Hello-Abfrage aus;
/// stilles Auslesen per `CredRead` ist ausgeschlossen.
#[cfg(windows)]
async fn kcm_derive_aes_key(dienst: &str, fach: &str, allow_create: bool) -> Result<Vec<u8>, String> {
    let cred = kcm_open_or_create(dienst, fach, allow_create).await?;
    let sign_op = {
        let challenge = kcm_challenge_bytes(dienst, fach);
        let challenge_buf = CryptographicBuffer::CreateFromByteArray(&challenge)
            .map_err(|e| format!("Challenge-Buffer Fehler: {e}"))?;
        cred.RequestSignAsync(&challenge_buf)
            .map_err(|e| format!("Windows Hello Signatur fehlgeschlagen: {e}"))?
    };
    drop(cred);
    let sign_res = sign_op
        .await
        .map_err(|e| format!("Windows Hello Signatur abgebrochen: {e}"))?;
    let sign_status = sign_res.Status().map_err(|e| format!("KCM Sign-Status-Fehler: {e}"))?;
    if sign_status != KeyCredentialStatus::Success {
        return Err(format!("Windows Hello Signatur verweigert ({sign_status:?})."));
    }
    let sig_buf = sign_res.Result().map_err(|e| format!("Signatur-Ergebnis Fehler: {e}"))?;
    let sha256_name = HashAlgorithmNames::Sha256().map_err(|e| format!("SHA-256 Name Fehler: {e}"))?;
    let hasher = HashAlgorithmProvider::OpenAlgorithm(&sha256_name)
        .map_err(|e| format!("SHA-256 Provider Fehler: {e}"))?;
    let hash_buf = hasher
        .HashData(&sig_buf)
        .map_err(|e| format!("SHA-256 Hash Fehler: {e}"))?;
    ibuffer_to_vec(&hash_buf)
}

#[cfg(windows)]
async fn speichere_hello_geheimnis(dienst: &str, fach: &str, geheimnis: &str) -> Result<(), String> {
    let key_bytes = kcm_derive_aes_key(dienst, fach, true).await?;
    let key_material = CryptographicBuffer::CreateFromByteArray(&key_bytes)
        .map_err(|e| format!("Key-Buffer Fehler: {e}"))?;

    let aes_gcm_name = SymmetricAlgorithmNames::AesGcm().map_err(|e| format!("AES-GCM Name Fehler: {e}"))?;
    let sym = SymmetricKeyAlgorithmProvider::OpenAlgorithm(&aes_gcm_name)
        .map_err(|e| format!("AES-GCM Provider Fehler: {e}"))?;
    let sym_key = sym
        .CreateSymmetricKey(&key_material)
        .map_err(|e| format!("AES-GCM Key Fehler: {e}"))?;

    let nonce_buf = CryptographicBuffer::GenerateRandom(HELLO_NONCE_LEN as u32)
        .map_err(|e| format!("Nonce-Erzeugung Fehler: {e}"))?;
    let nonce = ibuffer_to_vec(&nonce_buf)?;
    let pt_buf = CryptographicBuffer::CreateFromByteArray(geheimnis.as_bytes())
        .map_err(|e| format!("Klartext-Buffer Fehler: {e}"))?;
    let aad = kcm_aad_bytes(dienst, fach);
    let aad_buf = CryptographicBuffer::CreateFromByteArray(&aad)
        .map_err(|e| format!("AAD-Buffer Fehler: {e}"))?;

    let enc = CryptographicEngine::EncryptAndAuthenticate(&sym_key, &pt_buf, &nonce_buf, &aad_buf)
        .map_err(|e| format!("AES-GCM Verschlüsselung Fehler: {e}"))?;
    let ct_buf = enc.EncryptedData().map_err(|e| format!("Ciphertext-Buffer Fehler: {e}"))?;
    let tag_buf = enc.AuthenticationTag().map_err(|e| format!("Tag-Buffer Fehler: {e}"))?;
    let ct = ibuffer_to_vec(&ct_buf)?;
    let tag = ibuffer_to_vec(&tag_buf)?;

    let envelope = encode_hello_envelope(&nonce, &ct, &tag)?;
    let eintrag = Entry::new(dienst, fach)
        .map_err(|e| format!("Fehler beim Zugriff auf Windows Credential Store: {e}"))?;
    eintrag
        .set_password(&envelope)
        .map_err(|e| format!("Fehler beim Speichern im Windows Credential Store: {e}"))?;
    Ok(())
}

#[cfg(windows)]
async fn entsperre_hello_geheimnis(dienst: &str, fach: &str, envelope: &str) -> Result<String, String> {
    let (nonce, ciphertext, tag) = parse_hello_envelope(envelope)?;
    let key_bytes = kcm_derive_aes_key(dienst, fach, false).await?;
    let key_material = CryptographicBuffer::CreateFromByteArray(&key_bytes)
        .map_err(|e| format!("Key-Buffer Fehler: {e}"))?;

    let aes_gcm_name = SymmetricAlgorithmNames::AesGcm().map_err(|e| format!("AES-GCM Name Fehler: {e}"))?;
    let sym = SymmetricKeyAlgorithmProvider::OpenAlgorithm(&aes_gcm_name)
        .map_err(|e| format!("AES-GCM Provider Fehler: {e}"))?;
    let sym_key = sym
        .CreateSymmetricKey(&key_material)
        .map_err(|e| format!("AES-GCM Key Fehler: {e}"))?;

    let nonce_buf = CryptographicBuffer::CreateFromByteArray(&nonce)
        .map_err(|e| format!("Nonce-Buffer Fehler: {e}"))?;
    let ct_buf = CryptographicBuffer::CreateFromByteArray(&ciphertext)
        .map_err(|e| format!("Ciphertext-Buffer Fehler: {e}"))?;
    let tag_buf = CryptographicBuffer::CreateFromByteArray(&tag)
        .map_err(|e| format!("Tag-Buffer Fehler: {e}"))?;
    let aad = kcm_aad_bytes(dienst, fach);
    let aad_buf = CryptographicBuffer::CreateFromByteArray(&aad)
        .map_err(|e| format!("AAD-Buffer Fehler: {e}"))?;

    let pt_buf = CryptographicEngine::DecryptAndAuthenticate(&sym_key, &ct_buf, &nonce_buf, &tag_buf, &aad_buf)
        .map_err(|e| format!("AES-GCM Entschlüsselung fehlgeschlagen: {e}"))?;
    let pt_bytes = ibuffer_to_vec(&pt_buf)?;
    String::from_utf8(pt_bytes).map_err(|_| "Entschlüsseltes Geheimnis ist kein gültiges UTF-8.".to_string())
}

pub async fn speichere_biometrie_geheimnis(
    app: &AppHandle,
    fach: &str,
    geheimnis: &str,
) -> Result<(), String> {
    pruefe_fach(fach)?;
    #[cfg(windows)]
    {
        let _ = app;
        if fach == FACH_MESSENGER_GERAET {
            let eintrag = Entry::new(dienst_name()?, fach)
                .map_err(|e| format!("Fehler beim Zugriff auf Windows Credential Store: {e}"))?;
            return eintrag
                .set_password(geheimnis)
                .map_err(|e| format!("Fehler beim Speichern im Windows Credential Store: {e}"));
        }
        speichere_hello_geheimnis(dienst_name()?, fach, geheimnis).await
    }
    #[cfg(all(not(windows), not(target_os = "android")))]
    {
        let _ = app;
        let eintrag = Entry::new(dienst_name()?, fach)
            .map_err(|e| format!("Fehler beim Zugriff auf Credential Store: {e}"))?;
        eintrag
            .set_password(geheimnis)
            .map_err(|e| format!("Fehler beim Speichern im Credential Store: {e}"))?;
        Ok(())
    }
    #[cfg(target_os = "android")]
    {
        android_ruf::<()>(
            app,
            "speichern",
            serde_json::json!({ "fach": fach, "geheimnis": geheimnis }),
        )
    }
}

pub fn loesche_biometrie_geheimnis(app: &AppHandle, fach: &str) -> Result<(), String> {
    pruefe_fach(fach)?;
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        let dienst = dienst_name()?;
        #[cfg(windows)]
        if fach != FACH_MESSENGER_GERAET {
            let key_name = kcm_key_name(dienst, fach);
            let _ = KeyCredentialManager::DeleteAsync(&key_name);
        }
        if let Ok(eintrag) = Entry::new(dienst, fach) {
            match eintrag.delete_credential() {
                Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
                Err(e) => Err(format!("Fehler beim Löschen des biometrischen Schlüssels: {e}")),
            }
        } else {
            Ok(())
        }
    }
    #[cfg(target_os = "android")]
    {
        android_ruf::<()>(app, "loeschen", serde_json::json!({ "fach": fach }))
    }
}

/// Liest ein Fach **ohne** Abfrage. Nur für [`FACH_MESSENGER_GERAET`].
///
/// Die Einschränkung steht hier und nicht beim Aufrufer: ein Geheimnis, das
/// allein entsperrt, darf diesen Weg nie nehmen.
pub fn lies_geraetegeheimnis(app: &AppHandle) -> Result<Option<String>, String> {
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        let eintrag = Entry::new(dienst_name()?, FACH_MESSENGER_GERAET)
            .map_err(|e| format!("Schlüssel-Tresor nicht erreichbar: {e}"))?;
        match eintrag.get_password() {
            Ok(geheim) => Ok(Some(geheim)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(format!("Gerätegeheimnis nicht lesbar: {e}")),
        }
    }
    #[cfg(target_os = "android")]
    {
        android_ruf::<WertAntwort>(
            app,
            "lesen",
            serde_json::json!({ "fach": FACH_MESSENGER_GERAET }),
        )
        .map(|a| a.wert)
    }
}

/// Fragt nach der Bestätigung und gibt das Geheimnis erst danach heraus.
pub async fn entsperre_mit_biometrie(
    app: &AppHandle,
    fach: &str,
    nachricht: &str,
) -> Result<String, String> {
    pruefe_fach(fach)?;
    if fach == FACH_MESSENGER_GERAET {
        return Err("Das Gerätegeheimnis entsperrt nichts allein.".to_string());
    }

    #[cfg(windows)]
    {
        let dienst = dienst_name()?;
        let eintrag = Entry::new(dienst, fach)
            .map_err(|e| format!("Schlüssel-Tresor nicht erreichbar: {e}"))?;
        let raw = eintrag
            .get_password()
            .map_err(|e| format!("Kein biometrischer Schlüssel hinterlegt: {e}"))?;

        if raw.starts_with(HELLO_ENVELOPE_PREFIX) {
            return entsperre_hello_geheimnis(dienst, fach, &raw).await;
        }

        // Legacy-Eintrag ohne msm-hello-v1: niemals still im Klartext belassen.
        let kcm_supported = KeyCredentialManager::IsSupportedAsync()
            .map_err(|e| format!("Windows Hello KCM Prüfung fehlgeschlagen: {e}"))?
            .await
            .unwrap_or(false);
        if !kcm_supported {
            let _ = eintrag.delete_credential();
            return Err("Windows Hello-Schlüsselspeicher (KCM) ist nicht verfügbar. Der ungeschützte Schnelleinstieg wurde aus Sicherheitsgründen entfernt; bitte entsperre mit deinem Master-Passwort.".to_string());
        }

        let verif_result = verifiziere_windows(app, nachricht).await?;
        if verif_result != UserConsentVerificationResult::Verified {
            return Err("Biometrische Authentifizierung verweigert oder abgebrochen.".to_string());
        }

        speichere_hello_geheimnis(dienst, fach, &raw).await?;
        Ok(raw)
    }
    #[cfg(target_os = "android")]
    {
        // Hier fallen die beiden Schritte zusammen: der Keystore rückt den
        // Schlüssel erst nach der Bestätigung heraus. Das ist die härtere
        // Variante — auf Windows trennt die Anwendung Abfrage und Lesen, hier
        // trennt sie die Hardware.
        android_ruf::<WertAntwort>(
            app,
            "lesen",
            serde_json::json!({ "fach": fach, "nachricht": nachricht }),
        )?
        .wert
        .ok_or_else(|| "Kein biometrischer Schlüssel hinterlegt.".to_string())
    }
    #[cfg(not(any(windows, target_os = "android")))]
    {
        let _ = (app, fach, nachricht);
        Err("Biometrische Entsperrung wird auf dieser Plattform nicht unterstützt.".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hello_envelope_roundtrip() {
        let nonce = [7u8; HELLO_NONCE_LEN];
        let ct = b"geheimes-master-passwort";
        let tag = [9u8; HELLO_TAG_LEN];

        let encoded = encode_hello_envelope(&nonce, ct, &tag).unwrap();
        assert!(encoded.starts_with(HELLO_ENVELOPE_PREFIX));

        let (dec_nonce, dec_ct, dec_tag) = parse_hello_envelope(&encoded).unwrap();
        assert_eq!(dec_nonce, nonce);
        assert_eq!(dec_ct, ct);
        assert_eq!(dec_tag, tag);
    }

    #[test]
    fn hello_envelope_rejects_tampered_or_short() {
        assert!(parse_hello_envelope("plain-legacy-secret").is_err());
        assert!(parse_hello_envelope("msm-hello-v1:AAAA").is_err());
        assert!(parse_hello_envelope("msm-hello-v1:!!!").is_err());
    }
}
