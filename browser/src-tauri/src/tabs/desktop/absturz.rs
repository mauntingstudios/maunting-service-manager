//! Welche Prozessfehler einer WebView2 den Tab treffen.
//!
//! `ProcessFailed` kommt für jeden Prozess, den die Seite benutzt: Rahmen
//! fremder Herkunft, GPU, Netzwerk- und andere Hilfsprozesse, auch für einen
//! Renderer, der nur kurz hängt. Bis 09.10.2026 galt jeder davon als Absturz,
//! und der Tab zeigte die Absturzseite über einer Seite, die weiterlief.
//!
//! - Seitenprozess weg: nur dieser Tab zeigt die Absturzseite; WebView2
//!   startet den Prozess beim Neuladen neu.
//! - Browserprozess weg: alle Webviews sind tot. Dann wird nichts einzeln
//!   gemeldet, sondern Umgebung und Controller werden verworfen und neu
//!   aufgebaut (`desktop::browserprozess_beendet`).
//! - Alles andere startet WebView2 selbst neu; ein Rahmen zeigt seinen
//!   eigenen Fehler.

use webview2_com::Microsoft::Web::WebView2::Win32::*;
use windows::core::Interface;

use crate::tabs::{melden, TabEreignis};

/// Was eine Prozessmeldung auslöst.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Folge {
    /// Nur die Seite dieses Tabs ist abgestürzt.
    Tab,
    /// Der Browserprozess ist beendet; alle Tabs verlieren ihre Webview.
    Browserprozess,
    /// Ein Hilfsprozess; WebView2 fängt das selbst.
    Nichts,
}

fn folge(art: COREWEBVIEW2_PROCESS_FAILED_KIND) -> Folge {
    if art == COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED {
        Folge::Browserprozess
    } else if art == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED {
        Folge::Tab
    } else {
        Folge::Nichts
    }
}

pub(super) unsafe fn verarbeiten(app: &tauri::AppHandle, id: &str, args: &ICoreWebView2ProcessFailedEventArgs, generation: u64) {
    // Eine späte Meldung aus einer verworfenen Umgebung betrifft die Webview
    // dieses Tabs nicht mehr (etwa nach einem Neuaufbau).
    if !super::ist_aktuelle_generation(id, generation) {
        eprintln!("[MSB] Prozessmeldung einer verworfenen Webview übergangen");
        return;
    }
    let mut art = COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED;
    let gelesen = args.ProcessFailedKind(&mut art);
    let mut grund = COREWEBVIEW2_PROCESS_FAILED_REASON_UNEXPECTED;
    let mut code = 0i32;
    if let Ok(args2) = args.cast::<ICoreWebView2ProcessFailedEventArgs2>() {
        let _ = args2.Reason(&mut grund);
        let _ = args2.ExitCode(&mut code);
    }
    match if gelesen.is_err() { Folge::Tab } else { folge(art) } {
        Folge::Browserprozess => {
            // Die übrigen Webviews desselben Absturzes melden dasselbe; nur
            // der erste Bericht räumt auf.
            if super::browserprozess_beendet(app) {
                eprintln!("[MSB] Browserprozess der Seiten beendet (Grund {}, Code {code:#x}); die Tabs werden neu aufgebaut", grund.0);
            }
        }
        Folge::Tab => {
            eprintln!("[MSB] Seite eines Tabs abgestürzt (Art {}, Grund {}, Code {code:#x})", art.0, grund.0);
            melden(app, TabEreignis::Absturz { id: id.to_string() });
        }
        Folge::Nichts => {
            eprintln!("[MSB] Hilfsprozess eines Tabs beendet (Art {}, Grund {}, Code {code:#x}); der Tab läuft weiter", art.0, grund.0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn der_browserprozess_ist_kein_tababsturz() {
        assert_eq!(folge(COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED), Folge::Tab);
        assert_eq!(folge(COREWEBVIEW2_PROCESS_FAILED_KIND_BROWSER_PROCESS_EXITED), Folge::Browserprozess);
        for art in [
            COREWEBVIEW2_PROCESS_FAILED_KIND_FRAME_RENDER_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_UNRESPONSIVE,
            COREWEBVIEW2_PROCESS_FAILED_KIND_GPU_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_UTILITY_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_SANDBOX_HELPER_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_PPAPI_PLUGIN_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_PPAPI_BROKER_PROCESS_EXITED,
            COREWEBVIEW2_PROCESS_FAILED_KIND_UNKNOWN_PROCESS_EXITED,
        ] {
            assert_eq!(folge(art), Folge::Nichts, "Art {} trifft den Tab nicht", art.0);
        }
    }
}
