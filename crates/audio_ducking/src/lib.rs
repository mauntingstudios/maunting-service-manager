//! Gemeinsames WASAPI-Audio-Ducking für Maunting Smart System und Pontis.
//!
//! Senkt fremde Windows-Audio-Sessions sanft um den eingestellten Prozentsatz
//! ab, solange MSM aktiv spricht — und stellt danach die gemerkten
//! Originallautstärken genauso weich wieder her.
//!
//! Arbeitsweise unter Windows: Alle Audio-Sessions des Standard-Wiedergabegeräts
//! werden über `IAudioSessionManager2` enumeriert, die eigenen Prozessbäume
//! ausgenommen und jede fremde Session über `ISimpleAudioVolume` weich gerampt.
//! COM-Objekte werden nie über den Aufruf hinaus gehalten.

use std::collections::HashMap;

/// Vorgegebene Absenkung in Prozent (60 % leiser -> 40 % Restlautstärke).
pub const PROZENT_STANDARD: u8 = 60;
/// Untergrenze der konfigurierbaren Absenkung in Prozent.
pub const PROZENT_MIN: u8 = 10;
/// Obergrenze der konfigurierbaren Absenkung in Prozent.
pub const PROZENT_MAX: u8 = 90;

/// Begrenzt einen Prozentwert auf den gültigen Bereich `10..=90`.
pub fn prozent_klemmen(prozent: u8) -> u8 {
    prozent.clamp(PROZENT_MIN, PROZENT_MAX)
}

/// Berechnet aus der gewünschten Absenkung (z. B. 60 %) den Ziel-Faktor (0.4).
pub fn ziel_faktor(prozent: u8) -> f32 {
    (100_u16.saturating_sub(u16::from(prozent_klemmen(prozent)))) as f32 / 100.0
}

/// Prüft anhand der Eltern-Kind-Tabelle, ob `pid` selbst eine der geschützten
/// Wurzel-PIDs ist oder von ihnen abstammt.
///
/// Begrenzt auf 16 Ebenen, damit Zyklen nach PID-Wiederverwendung nie hängen.
pub fn ist_ausgeschlossen(pid: u32, wurzeln: &[u32], eltern: &HashMap<u32, u32>) -> bool {
    if wurzeln.is_empty() || pid == 0 {
        return false;
    }
    let mut aktuell = pid;
    for _ in 0..16 {
        if wurzeln.contains(&aktuell) {
            return true;
        }
        match eltern.get(&aktuell) {
            Some(&vater) if vater != 0 && vater != aktuell => aktuell = vater,
            _ => return false,
        }
    }
    false
}

/// Gemerkter Ducking-Zustand (Ziel-Faktor + Session-Kennung -> Originallautstärke).
#[derive(Debug, Clone, PartialEq)]
pub struct DuckingZustand {
    pub faktor: f32,
    pub originale: HashMap<String, f32>,
}

/// Plant die nötigen Lautstärkeübergänge `(kennung, von, nach)` ohne Kaskadierung:
/// Bei laufendem Prozentwechsel wird immer gegen den gespeicherten Originalwert
/// gerechnet, bei identischem Faktor passiert nichts.
pub fn schritt_planen(
    zustand: &mut Option<DuckingZustand>,
    an: bool,
    prozent: u8,
    aktive: &[(String, f32)],
) -> Vec<(String, f32, f32)> {
    if !an {
        let Some(bestehend) = zustand.take() else {
            return Vec::new();
        };
        return aktive
            .iter()
            .filter_map(|(kennung, ist)| {
                bestehend
                    .originale
                    .get(kennung)
                    .map(|&original| (kennung.clone(), *ist, original.clamp(0.0, 1.0)))
            })
            .collect();
    }

    let neuer_faktor = ziel_faktor(prozent);
    match zustand {
        None => {
            let mut originale = HashMap::with_capacity(aktive.len());
            let mut plaene = Vec::with_capacity(aktive.len());
            for (kennung, ist) in aktive {
                let ausgang = ist.clamp(0.0, 1.0);
                originale.insert(kennung.clone(), ausgang);
                plaene.push((kennung.clone(), ausgang, (ausgang * neuer_faktor).clamp(0.0, 1.0)));
            }
            *zustand = Some(DuckingZustand {
                faktor: neuer_faktor,
                originale,
            });
            plaene
        }
        Some(bestehend) => {
            if (bestehend.faktor - neuer_faktor).abs() <= f32::EPSILON {
                return Vec::new();
            }
            let mut plaene = Vec::with_capacity(aktive.len());
            for (kennung, ist) in aktive {
                let ausgang = ist.clamp(0.0, 1.0);
                let original = *bestehend.originale.entry(kennung.clone()).or_insert(ausgang);
                plaene.push((
                    kennung.clone(),
                    ausgang,
                    (original * neuer_faktor).clamp(0.0, 1.0),
                ));
            }
            bestehend.faktor = neuer_faktor;
            plaene
        }
    }
}

#[cfg(windows)]
mod wasapi {
    use std::collections::HashMap;
    use std::sync::Mutex;

    use windows::core::Interface;
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
        ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_ALL,
        COINIT_MULTITHREADED,
    };
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    use super::{ist_ausgeschlossen, schritt_planen, DuckingZustand, PROZENT_STANDARD};

    /// Weiche Überblendung statt Lautstärkesprung (~200 ms).
    const RAMPEN_SCHRITTE: u32 = 8;
    const RAMPEN_PAUSE_MS: u64 = 25;

    static ORIGINALE: Mutex<Option<DuckingZustand>> = Mutex::new(None);

    struct ComGast {
        freigeben: bool,
    }

    impl ComGast {
        fn betreten() -> Result<Self, String> {
            let hr = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
            if hr.is_ok() {
                return Ok(Self { freigeben: true });
            }
            // RPC_E_CHANGED_MODE: Thread gehört bereits einem anderen Apartment.
            if hr.0 == 0x8001_0106_u32 as i32 {
                return Ok(Self { freigeben: false });
            }
            Err(format!("COM-Initialisierung fehlgeschlagen: {hr}"))
        }
    }

    impl Drop for ComGast {
        fn drop(&mut self) {
            if self.freigeben {
                unsafe { CoUninitialize() };
            }
        }
    }

    struct FremdeSession {
        kennung: String,
        regler: ISimpleAudioVolume,
        lautstaerke: f32,
    }

    struct Rampe {
        regler: ISimpleAudioVolume,
        von: f32,
        nach: f32,
    }

    fn prozess_eltern() -> HashMap<u32, u32> {
        let mut karte = HashMap::new();
        unsafe {
            let Ok(schnappschuss) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else {
                return karte;
            };
            let mut eintrag = PROCESSENTRY32W {
                dwSize: size_of::<PROCESSENTRY32W>() as u32,
                ..Default::default()
            };
            let mut weiter = Process32FirstW(schnappschuss, &mut eintrag).is_ok();
            while weiter {
                karte.insert(eintrag.th32ProcessID, eintrag.th32ParentProcessID);
                weiter = Process32NextW(schnappschuss, &mut eintrag).is_ok();
            }
            let _ = CloseHandle(schnappschuss);
        }
        karte
    }

    fn fremde_sessions(ausgeschlossene_wurzeln: &[u32]) -> Result<Vec<FremdeSession>, String> {
        let eltern = if ausgeschlossene_wurzeln.is_empty() {
            HashMap::new()
        } else {
            prozess_eltern()
        };
        let mut ergebnis = Vec::new();
        unsafe {
            let geraete: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("Audiogeräte nicht erreichbar: {e}"))?;
            let standard = geraete
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .map_err(|e| format!("Kein Standard-Wiedergabegerät: {e}"))?;
            let manager: IAudioSessionManager2 = standard
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("Session-Manager nicht aktivierbar: {e}"))?;
            let sessions = manager
                .GetSessionEnumerator()
                .map_err(|e| format!("Sessions nicht auflistbar: {e}"))?;
            let anzahl = sessions.GetCount().map_err(|e| e.to_string())?;

            for i in 0..anzahl {
                let Ok(session) = sessions.GetSession(i) else {
                    continue;
                };
                let Ok(details) = session.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                let Ok(pid) = details.GetProcessId() else {
                    continue;
                };
                if ist_ausgeschlossen(pid, ausgeschlossene_wurzeln, &eltern) {
                    continue;
                }
                let Ok(regler) = session.cast::<ISimpleAudioVolume>() else {
                    continue;
                };
                let Ok(lautstaerke) = regler.GetMasterVolume() else {
                    continue;
                };
                let Ok(roh) = details.GetSessionInstanceIdentifier() else {
                    continue;
                };
                let kennung = roh.to_string().unwrap_or_default();
                CoTaskMemFree(Some(roh.as_ptr() as *const _));
                if kennung.is_empty() {
                    continue;
                }
                ergebnis.push(FremdeSession {
                    kennung,
                    regler,
                    lautstaerke,
                });
            }
        }
        Ok(ergebnis)
    }

    fn rampen_fahren(rampen: &[Rampe]) {
        if rampen.is_empty() {
            return;
        }
        for schritt in 1..=RAMPEN_SCHRITTE {
            let anteil = schritt as f32 / RAMPEN_SCHRITTE as f32;
            for r in rampen {
                let wert = (r.von + (r.nach - r.von) * anteil).clamp(0.0, 1.0);
                unsafe {
                    let _ = r.regler.SetMasterVolume(wert, std::ptr::null());
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(RAMPEN_PAUSE_MS));
        }
    }

    pub fn setzen(
        an: bool,
        prozent: u8,
        ausgeschlossene_wurzeln: &[u32],
    ) -> Result<(), String> {
        let mut guard = ORIGINALE
            .lock()
            .map_err(|_| "Ducking-Zustand vergiftet".to_string())?;

        if !an && guard.is_none() {
            return Ok(());
        }

        if an {
            if let Some(bestehend) = guard.as_ref() {
                if (bestehend.faktor - super::ziel_faktor(prozent)).abs() <= f32::EPSILON {
                    return Ok(());
                }
            }
        }

        // Scheitert COM oder WASAPI (z. B. Bluetooth-Headset abgezogen), bleibt
        // `guard` bis zur erfolgreichen Planung unverändert erhalten.
        let _com = ComGast::betreten()?;
        let ausschluss = if an { ausgeschlossene_wurzeln } else { &[] };
        let sessions = fremde_sessions(ausschluss)?;

        let mut regler_je_kennung = HashMap::with_capacity(sessions.len());
        let mut aktive = Vec::with_capacity(sessions.len());
        for s in sessions {
            regler_je_kennung.insert(s.kennung.clone(), s.regler);
            aktive.push((s.kennung, s.lautstaerke));
        }

        let mut naechster = guard.clone();
        let plaene: Vec<Rampe> = schritt_planen(&mut naechster, an, prozent, &aktive)
            .into_iter()
            .filter_map(|(kennung, von, nach)| {
                let regler = regler_je_kennung.get(&kennung)?.clone();
                Some(Rampe { regler, von, nach })
            })
            .collect();

        rampen_fahren(&plaene);
        *guard = naechster;
        Ok(())
    }

    pub fn stoppen() -> Result<(), String> {
        setzen(false, PROZENT_STANDARD, &[])
    }
}

/// Schaltet WASAPI-Audio-Ducking ein/aus oder passt die Absenkung live an.
/// Unter Nicht-Windows-Systemen ein sicherer No-Op.
pub fn setzen(an: bool, prozent: u8, ausgeschlossene_wurzeln: &[u32]) -> Result<(), String> {
    #[cfg(windows)]
    {
        wasapi::setzen(an, prozent, ausgeschlossene_wurzeln)
    }
    #[cfg(not(windows))]
    {
        let _ = (an, prozent, ausgeschlossene_wurzeln);
        Ok(())
    }
}

/// Stellt alle zuvor geduckten fremden Audio-Sessions wieder her.
pub fn stoppen() -> Result<(), String> {
    #[cfg(windows)]
    {
        wasapi::stoppen()
    }
    #[cfg(not(windows))]
    {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn prozent_wird_zwischen_10_und_90_geklemmt() {
        assert_eq!(prozent_klemmen(0), 10);
        assert_eq!(prozent_klemmen(9), 10);
        assert_eq!(prozent_klemmen(10), 10);
        assert_eq!(prozent_klemmen(60), 60);
        assert_eq!(prozent_klemmen(90), 90);
        assert_eq!(prozent_klemmen(100), 90);
        assert_eq!(prozent_klemmen(255), 90);
    }

    #[test]
    fn ziel_faktor_berechnet_restlautstaerke_aus_abgesenktem_prozent() {
        assert!((ziel_faktor(60) - 0.4).abs() < 1e-6);
        assert!((ziel_faktor(10) - 0.9).abs() < 1e-6);
        assert!((ziel_faktor(90) - 0.1).abs() < 1e-6);
        assert!((ziel_faktor(0) - 0.9).abs() < 1e-6);
        assert!((ziel_faktor(99) - 0.1).abs() < 1e-6);
    }

    #[test]
    fn prozessbaum_schliesst_wurzel_und_nachfahren_aus_aber_keine_fremd_tabs() {
        // 100 = browser.exe
        // 200 = Pontis main WebView2 (BrowserProcessId), 201 = dessen AudioService
        // 300 = Pontis Seiten-Tab WebView2, 301 = dessen AudioService (soll geduckt werden!)
        // 500 = Spotify (eigenständig), 600 = Zyklus durch PID-Wiederverwendung
        let eltern = HashMap::from([
            (200, 100),
            (201, 200),
            (300, 100),
            (301, 300),
            (600, 600),
        ]);
        let wurzeln = [200];

        assert!(ist_ausgeschlossen(200, &wurzeln, &eltern));
        assert!(ist_ausgeschlossen(201, &wurzeln, &eltern));
        assert!(!ist_ausgeschlossen(300, &wurzeln, &eltern));
        assert!(!ist_ausgeschlossen(301, &wurzeln, &eltern));
        assert!(!ist_ausgeschlossen(500, &wurzeln, &eltern));
        assert!(!ist_ausgeschlossen(600, &wurzeln, &eltern));
        assert!(!ist_ausgeschlossen(200, &[], &eltern));
    }

    #[test]
    fn live_prozentwechsel_berechnet_immer_ab_original_ohne_kaskade_und_stellt_wieder_her() {
        let mut zustand: Option<DuckingZustand> = None;

        // Start mit 60 % Absenkung (Faktor 0.4)
        let r1 = schritt_planen(&mut zustand, true, 60, &[("spotify".into(), 0.8)]);
        assert_eq!(r1.len(), 1);
        assert!((r1[0].1 - 0.8).abs() < 1e-6);
        assert!((r1[0].2 - 0.32).abs() < 1e-6);

        // Zweiter Aufruf mit gleichen 60 % duckt NICHT auf 0.128!
        let r2 = schritt_planen(&mut zustand, true, 60, &[("spotify".into(), 0.32)]);
        assert!(r2.is_empty());

        // Live-Regler auf 80 % (Faktor 0.2) -> ab Original 0.8 = 0.16, + neuer Player startet bei 1.0 -> 0.2
        let r3 = schritt_planen(
            &mut zustand,
            true,
            80,
            &[("spotify".into(), 0.32), ("vlc".into(), 1.0)],
        );
        assert_eq!(r3.len(), 2);
        assert!((r3[0].2 - 0.16).abs() < 1e-6);
        assert!((r3[1].2 - 0.20).abs() < 1e-6);

        // Beenden stellt Originalwerte 0.8 und 1.0 wieder her
        let r4 = schritt_planen(
            &mut zustand,
            false,
            80,
            &[("spotify".into(), 0.16), ("vlc".into(), 0.20)],
        );
        assert_eq!(r4.len(), 2);
        assert!((r4[0].2 - 0.8).abs() < 1e-6);
        assert!((r4[1].2 - 1.0).abs() < 1e-6);
        assert!(zustand.is_none());
    }
}
