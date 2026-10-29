//! Automatische Bereinigung und Migration verwaister NSIS-Reste nach dem Wechsel auf Velopack.
//!
//! Bis Oktober 2026 wurde die Windows-App per NSIS in `%LOCALAPPDATA%\Maunting Smart System`
//! installiert und trug dort den Autostart-Eintrag `"Maunting Smart System"` ein.
//! Bei der Migration auf Velopack liegt die App unter `%LOCALAPPDATA%\MauntingSmartSystem\current`.
//!
//! Ohne diese Bereinigung rief der Autostart nach dem Hochfahren weiterhin die alte
//! NSIS-Programmdatei (v5.5.1) auf, welche den Velopack-Installer startete und den
//! Reparatur-Dialog anzeigte.

#[cfg(windows)]
use std::path::PathBuf;

#[cfg(windows)]
use windows::core::w;
#[cfg(windows)]
use windows::Win32::System::Registry::{
    RegCloseKey, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER,
    KEY_READ, KEY_WRITE, REG_SZ, REG_VALUE_TYPE,
};

/// Führt die Migration auf Windows aus. Scheitert nie mit einem harten Fehler,
/// damit ein Berechtigungs- oder Dateisystemproblem den App-Start nicht blockiert.
#[cfg(windows)]
pub fn bereinige_nsis_reste() {
    migriere_autostart();
    entferne_alten_nsis_ordner();
    entferne_alte_verknuepfungen();
}

#[cfg(not(windows))]
pub fn bereinige_nsis_reste() {}

#[cfg(windows)]
fn migriere_autostart() {
    unsafe {
        let mut hkey = HKEY::default();
        let subkey = w!(r"Software\Microsoft\Windows\CurrentVersion\Run");
        if RegOpenKeyExW(HKEY_CURRENT_USER, subkey, None, KEY_READ | KEY_WRITE, &mut hkey).is_err() {
            return;
        }

        let value_name = w!("Maunting Smart System");
        let mut buffer = [0u16; 1024];
        let mut size = (buffer.len() * std::mem::size_of::<u16>()) as u32;
        let mut val_type = REG_VALUE_TYPE::default();

        let query_res = RegQueryValueExW(
            hkey,
            value_name,
            None,
            Some(&mut val_type),
            Some(buffer.as_mut_ptr() as *mut u8),
            Some(&mut size),
        );

        if query_res.is_ok() && val_type == REG_SZ {
            let len = (size as usize / std::mem::size_of::<u16>()).saturating_sub(1);
            let current_val = String::from_utf16_lossy(&buffer[..len]);

            // Zeigt der Wert auf den alten Ordner mit Leerzeichen oder fehlt das Quoting?
            if current_val.contains(r"\Maunting Smart System\")
                || (current_val.starts_with(r"C:\Users\") && !current_val.starts_with('"'))
            {
                if let Ok(current_exe) = std::env::current_exe() {
                    let exe_str = current_exe.to_string_lossy();
                    // Nur aktualisieren, wenn wir tatsächlich aus dem neuen Pfad laufen
                    if exe_str.contains("MauntingSmartSystem") {
                        let new_cmd = format!("\"{}\" --autostart", current_exe.display());
                        let daten: Vec<u8> = new_cmd
                            .encode_utf16()
                            .chain(std::iter::once(0))
                            .flat_map(u16::to_le_bytes)
                            .collect();

                        let _ = RegSetValueExW(
                            hkey,
                            value_name,
                            None,
                            REG_SZ,
                            Some(daten.as_slice()),
                        );
                    }
                }
            }
        }

        let _ = RegCloseKey(hkey);
    }
}

#[cfg(windows)]
fn entferne_alten_nsis_ordner() {
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        let old_dir = PathBuf::from(local_app_data).join("Maunting Smart System");
        if old_dir.is_dir() {
            // Prüfen, ob es sich um die alte Installation handelt
            let uninstall_exe = old_dir.join("uninstall.exe");
            let old_mss_exe = old_dir.join("MauntingSmartSystem.exe");
            if uninstall_exe.exists() || old_mss_exe.exists() {
                let _ = std::fs::remove_file(&uninstall_exe);
                let _ = std::fs::remove_file(&old_mss_exe);
                let _ = std::fs::remove_dir_all(&old_dir);
            }
        }
    }
}

#[cfg(windows)]
fn entferne_alte_verknuepfungen() {
    // 1. Desktop
    if let Some(user_profile) = std::env::var_os("USERPROFILE") {
        let desktop_link = PathBuf::from(user_profile)
            .join("Desktop")
            .join("Maunting Smart System.lnk");
        if desktop_link.is_file() {
            let _ = std::fs::remove_file(desktop_link);
        }
    }

    // 2. Startmenü
    if let Some(app_data) = std::env::var_os("APPDATA") {
        let start_link = PathBuf::from(app_data)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs")
            .join("Maunting Smart System.lnk");
        if start_link.is_file() {
            let _ = std::fs::remove_file(start_link);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migration_laeuft_ohne_panik() {
        // Stellt sicher, dass bereinige_nsis_reste auf jeder Plattform aufgerufen werden kann
        bereinige_nsis_reste();
    }
}
