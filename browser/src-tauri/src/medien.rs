//! Medienrechte der eigenen Oberfläche.
//!
//! WebView2 beantwortet `getUserMedia` auf `tauri.localhost` nicht von selbst:
//! Die Anfrage bleibt offen, und die lokale Sprachsuche meldet „Mikrofon
//! verweigert“. Wie im Smart System erlaubt dieser Handler Mikrofon **und
//! Kamera** — ausschließlich der eigenen Oberfläche; Seiten-Tabs haben ihren
//! eigenen Dialog (`tabs/desktop/rueckfragen.rs`).
//!
//! Die Kamera fehlte bis 27.10.2026. Ein Videoanruf verband sich dann ohne
//! Bild, und die Oberfläche behauptete trotzdem, die Kamera sei an.

use tauri::{AppHandle, Manager};

/// Nur die gebaute Oberfläche und der Vite-Dev-Server.
pub(crate) fn eigene_oberflaeche(uri: &str) -> bool {
    const EIGENE: [&str; 4] = [
        "http://tauri.localhost",
        "https://tauri.localhost",
        "http://localhost:1450",
        "http://127.0.0.1:1450",
    ];
    EIGENE
        .iter()
        .any(|basis| uri == *basis || uri.starts_with(&format!("{basis}/")))
}

/// Was die eigene Oberfläche vom Gerät bekommen darf.
///
/// Standort, Zwischenablage, Benachrichtigungen und alles Weitere bleiben
/// außen vor: was hier steht, wird ohne Rückfrage erlaubt.
fn art_erlaubt(
    art: webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_KIND,
) -> bool {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
    };
    art == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE || art == COREWEBVIEW2_PERMISSION_KIND_CAMERA
}

pub fn freigeben(app: &AppHandle) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::{take_pwstr, PermissionRequestedEventHandler};
    use windows::core::PWSTR;

    let Some(fenster) = app.get_webview_window("main") else { return };
    let _ = fenster.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let mut merkzettel = 0_i64;
        let _ = core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(|_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut art = COREWEBVIEW2_PERMISSION_KIND::default();
                args.PermissionKind(&mut art)?;
                if !art_erlaubt(art) {
                    return Ok(());
                }
                let mut uri = PWSTR::null();
                args.Uri(&mut uri)?;
                if eigene_oberflaeche(&take_pwstr(uri)) {
                    args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
                }
                Ok(())
            })),
            &mut merkzettel,
        );
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mikrofon_und_kamera_sind_erlaubt_sonst_nichts() {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PERMISSION_KIND_CAMERA, COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ,
            COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE,
            COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS,
        };
        // Der Videoanruf braucht beides; ohne die Kamera verband er sich stumm
        // und die Oberfläche behauptete trotzdem ein Bild.
        assert!(art_erlaubt(COREWEBVIEW2_PERMISSION_KIND_MICROPHONE));
        assert!(art_erlaubt(COREWEBVIEW2_PERMISSION_KIND_CAMERA));
        assert!(!art_erlaubt(COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION));
        assert!(!art_erlaubt(COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS));
        assert!(!art_erlaubt(COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ));
    }

    #[test]
    fn nur_die_eigene_oberflaeche_und_der_dev_server() {
        for gut in [
            "http://tauri.localhost",
            "https://tauri.localhost/index.html",
            "http://localhost:1450/",
            "http://127.0.0.1:1450/browser.html",
        ] {
            assert!(eigene_oberflaeche(gut), "{gut}");
        }
        for fremd in [
            "https://example.org",
            "https://tauri.localhost.evil.example/",
            "http://localhost:1451/",
            "http://localhost:1450.evil.example/",
            "https://localhost:1450/",
        ] {
            assert!(!eigene_oberflaeche(fremd), "{fremd}");
        }
    }
}
