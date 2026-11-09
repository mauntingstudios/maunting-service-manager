//! Das rahmenlose Hauptfenster: Minimieren, Maximieren, Schließen. Auf
//! Android gibt es kein Fenster dazu; die Oberfläche zeigt die Knöpfe dort nicht.

use tauri::AppHandle;
#[cfg(desktop)]
use tauri::Manager;

#[derive(serde::Serialize, Clone, Debug)]
pub struct FensterStartInfo {
    pub ist_neues_fenster: bool,
    pub start_url: Option<String>,
    pub privat: bool,
}

#[derive(Clone, Debug, Default)]
pub struct StartArgumente {
    pub ist_neues_fenster: bool,
    pub start_url: Option<String>,
    pub privat: bool,
}

#[cfg(desktop)]
pub fn fenster_nach_vorn(fenster: &tauri::WebviewWindow) {
    let _ = fenster.unminimize();
    let _ = fenster.show();
    let _ = fenster.set_focus();
    #[cfg(windows)]
    if let Ok(hwnd) = fenster.hwnd() {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{
            BringWindowToTop, SetForegroundWindow, ShowWindow, SW_SHOW,
        };
        unsafe {
            let h = HWND(hwnd.0);
            let _ = ShowWindow(h, SW_SHOW);
            let _ = BringWindowToTop(h);
            let _ = SetForegroundWindow(h);
        }
    }
}

/// Informationen zum Start dieses Fensterprozesses (z. B. als ausgelagertes Einzelfenster).
#[tauri::command(async)]
pub fn fenster_start_info(app: AppHandle) -> Result<FensterStartInfo, String> {
    #[cfg(desktop)]
    {
        if let Some(start) = app.try_state::<StartArgumente>() {
            return Ok(FensterStartInfo {
                ist_neues_fenster: start.ist_neues_fenster,
                start_url: start.start_url.clone(),
                privat: start.privat,
            });
        }
    }
    Ok(FensterStartInfo {
        ist_neues_fenster: false,
        start_url: None,
        privat: false,
    })
}

#[cfg(not(desktop))]
#[tauri::command(async)]
pub fn fenster_aktion(_app: AppHandle, _aktion: String) -> Result<(), String> {
    Err("Kein Fenster auf diesem Gerät".into())
}

#[cfg(desktop)]
#[tauri::command(async)]
pub fn fenster_aktion(app: AppHandle, aktion: String) -> Result<(), String> {
    let fenster = app.get_webview_window("main").ok_or("Hauptfenster fehlt")?;
    match aktion.as_str() {
        "minimieren" => fenster.minimize(),
        "maximieren" => {
            if fenster.is_maximized().unwrap_or(false) {
                fenster.unmaximize()
            } else {
                fenster.maximize()
            }
        }
        "schliessen" => fenster.close(),
        "neustarten" => {
            tauri::process::restart(&app.env());
        }
        _ => return Err("Unbekannte Fensteraktion".into()),
    }
    .map_err(|e| e.to_string())
}

/// Öffnet eine externe Adresse im Standardbrowser.
///
/// Nötig für die Passkey-Bestätigung: Ein Passkey gilt nur unter der Adresse,
/// unter der er angelegt wurde. Die App läuft unter `tauri.localhost` und
/// findet dort keinen; die Bestätigung gehört deshalb in den Browser, der das
/// Panel unter seiner echten Adresse öffnet (`passkeyService.ts`).
#[tauri::command(async)]
pub fn oeffne_browser(app: AppHandle, url: String) -> Result<(), String> {
    let adresse = pruefe_externe_adresse(&url)?;
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(adresse, None::<&str>)
        .map_err(|e| format!("Browser konnte nicht geöffnet werden: {e}"))
}

/// Nur http und https sind Webseiten; alles andere öffnet kein Programm.
fn pruefe_externe_adresse(url: &str) -> Result<&str, String> {
    let adresse = url.trim();
    if adresse.starts_with("https://") || adresse.starts_with("http://") {
        Ok(adresse)
    } else {
        Err(format!("Nur http- und https-Adressen erlaubt: '{adresse}'"))
    }
}

#[cfg(test)]
mod tests {
    use super::pruefe_externe_adresse;

    #[test]
    fn oeffnet_nur_http_und_https() {
        assert_eq!(
            pruefe_externe_adresse(" https://panel.example/bestaetigen ").unwrap(),
            "https://panel.example/bestaetigen"
        );
        assert!(pruefe_externe_adresse("http://localhost:8000/x").is_ok());
        assert!(pruefe_externe_adresse("javascript:alert(1)").is_err());
        assert!(pruefe_externe_adresse("file:///C:/Windows").is_err());
        assert!(pruefe_externe_adresse("").is_err());
    }
}

