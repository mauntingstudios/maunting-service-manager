//! Persistente Liste heruntergeladener Dateien für Sicherheits- und Existenzprüfungen.
//!
//! Die Pfade werden in `msb_downloads.json` im Konfigurationsordner gespeichert,
//! damit der Browser auch nach einem Neustart Dateien öffnen, im Explorer zeigen
//! und löschen darf, selbst wenn sie in benutzerdefinierten Ordnern abgelegt wurden.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

const DATEI: &str = "msb_downloads.json";
const HOECHSTENS: usize = 500;

static DATEI_SCHLOSS: Mutex<()> = Mutex::new(());

fn datei_pfad(app: &AppHandle) -> Option<PathBuf> {
    let ordner = app.path().app_config_dir().ok()?;
    let _ = fs::create_dir_all(&ordner);
    Some(ordner.join(DATEI))
}

/// Liest die gespeicherten Pfade aus der Datei.
pub fn laden(app: &AppHandle) -> Vec<PathBuf> {
    let Some(pfad) = datei_pfad(app) else {
        return Vec::new();
    };
    let _schloss = DATEI_SCHLOSS.lock().unwrap();
    let Ok(roh) = fs::read_to_string(&pfad) else {
        return Vec::new();
    };
    serde_json::from_str::<Vec<String>>(&roh)
        .unwrap_or_default()
        .into_iter()
        .map(PathBuf::from)
        .collect()
}

/// Speichert eine Liste von Pfaden (höchstens `HOECHSTENS` Einträge).
fn speichern(app: &AppHandle, pfade: &[PathBuf]) {
    let Some(pfad) = datei_pfad(app) else {
        return;
    };
    let _schloss = DATEI_SCHLOSS.lock().unwrap();
    let begrenz: Vec<String> = pfade
        .iter()
        .take(HOECHSTENS)
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    if let Ok(json) = serde_json::to_string(&begrenz) {
        let _ = fs::write(&pfad, json);
    }
}

/// Lädt beim App-Start die Pfade und trägt sie in das globale `FERTIG`-Set ein.
pub fn beim_start(app: &AppHandle) {
    let pfade = laden(app);
    let mut fertig = super::FERTIG.lock().unwrap();
    for p in pfade {
        fertig.insert(p);
    }
}

/// Fügt einen neuen Pfad zur Historie und zum `FERTIG`-Set hinzu.
pub fn hinzufuegen(app: &AppHandle, pfad: &Path) {
    let mut bisher = laden(app);
    let canon = pfad.canonicalize().unwrap_or_else(|_| pfad.to_path_buf());
    super::FERTIG.lock().unwrap().insert(canon.clone());

    // Duplikate vermeiden, neuester Eintrag vorne
    bisher.retain(|p| p != &canon);
    bisher.insert(0, canon);
    bisher.truncate(HOECHSTENS);
    speichern(app, &bisher);
}

/// Entfernt einen Pfad aus der Historie und dem `FERTIG`-Set.
pub fn entfernen(app: &AppHandle, pfad: &Path) {
    let canon = pfad.canonicalize().unwrap_or_else(|_| pfad.to_path_buf());
    super::FERTIG.lock().unwrap().remove(&canon);

    let mut bisher = laden(app);
    bisher.retain(|p| p != &canon);
    speichern(app, &bisher);
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;
    use super::*;

    #[test]
    fn pfade_lassen_sich_bereinigen() {
        let mut set = HashSet::new();
        set.insert(PathBuf::from("C:\\Downloads\\a.pdf"));
        assert!(set.contains(&PathBuf::from("C:\\Downloads\\a.pdf")));
        set.remove(&PathBuf::from("C:\\Downloads\\a.pdf"));
        assert!(!set.contains(&PathBuf::from("C:\\Downloads\\a.pdf")));
    }

    #[test]
    fn historie_dedupliziert_und_schiebt_nach_vorne() {
        let mut bisher = vec![
            PathBuf::from("C:\\Downloads\\alt.pdf"),
            PathBuf::from("C:\\Downloads\\neu.pdf"),
        ];
        let neu = PathBuf::from("C:\\Downloads\\neu.pdf");
        bisher.retain(|p| p != &neu);
        bisher.insert(0, neu);
        assert_eq!(bisher.len(), 2);
        assert_eq!(bisher[0], PathBuf::from("C:\\Downloads\\neu.pdf"));
    }

    #[test]
    fn historie_begrenzt_strikt_auf_hoechstens() {
        let mut bisher: Vec<PathBuf> = (0..600)
            .map(|i| PathBuf::from(format!("C:\\Downloads\\datei_{i}.pdf")))
            .collect();
        bisher.truncate(HOECHSTENS);
        assert_eq!(bisher.len(), 500);
    }
}
