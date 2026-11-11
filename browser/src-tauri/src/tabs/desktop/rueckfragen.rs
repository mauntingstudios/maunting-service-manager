//! Was eine Seite fragt, fragt die Oberfläche.
//!
//! Für Rechtsklick, `alert`/`confirm`/`prompt`, Rechte (Kamera, Standort, …)
//! und die HTTP-Anmeldung zeigte WebView2 eigene Fenster im Stil von Edge. Der
//! Browser nimmt jede dieser Anfragen an sich (`Handled`, Aufschub), meldet sie
//! als [`TabEreignis`] und hält sie hier, bis die Oberfläche mit
//! [`erledigen`] antwortet.
//!
//! Alles läuft auf dem UI-Faden der WebView2; die offenen Anfragen liegen
//! deshalb in einem `thread_local`.

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Emitter, Manager};
use webview2_com::Microsoft::Web::WebView2::Win32::*;
use webview2_com::{
    BasicAuthenticationRequestedEventHandler, ContextMenuRequestedEventHandler, CustomItemSelectedEventHandler,
    PermissionRequestedEventHandler, ScriptDialogOpeningEventHandler, SetPermissionStateCompletedHandler,
};
use windows::core::{Interface, BOOL, HSTRING};
use windows::Win32::Foundation::POINT;
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromPoint, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

use super::webview2::text;
use crate::tabs::{melden, Antwort, TabEreignis};

enum Anfrage {
    Dialog(ICoreWebView2ScriptDialogOpeningEventArgs),
    Recht {
        args: ICoreWebView2PermissionRequestedEventArgs,
        art: COREWEBVIEW2_PERMISSION_KIND,
        herkunft: String,
        /// Nur bei ausdrücklicher Antwort speichern; private Profile nie.
        profil: Option<ICoreWebView2Profile4>,
    },
    Anmeldung(ICoreWebView2BasicAuthenticationRequestedEventArgs),
}

/// `Some`: ausdrücklich erlaubt/blockiert und dauerhaft merken.
/// `None`: Dialog geschlossen; nur für diese eine Anfrage ablehnen.
fn recht_zustand(erlauben: Option<bool>) -> (COREWEBVIEW2_PERMISSION_STATE, bool) {
    match erlauben {
        Some(true) => (COREWEBVIEW2_PERMISSION_STATE_ALLOW, true),
        Some(false) => (COREWEBVIEW2_PERMISSION_STATE_DENY, true),
        None => (COREWEBVIEW2_PERMISSION_STATE_DENY, false),
    }
}

struct Offen {
    tab: String,
    anfrage: Anfrage,
    aufschub: ICoreWebView2Deferral,
}

thread_local! {
    static OFFEN: RefCell<HashMap<u64, Offen>> = RefCell::new(HashMap::new());
}
static NAECHSTE: AtomicU64 = AtomicU64::new(1);

fn ablegen(tab: &str, anfrage: Anfrage, aufschub: ICoreWebView2Deferral) -> u64 {
    let nr = NAECHSTE.fetch_add(1, Ordering::Relaxed);
    OFFEN.with(|o| o.borrow_mut().insert(nr, Offen { tab: tab.to_string(), anfrage, aufschub }));
    nr
}

/// Läuft auf dem UI-Faden (`run_on_main_thread`). Eine unbekannte Nummer ist
/// schon erledigt (Tab geschlossen) und wird übergangen.
pub fn erledigen(nr: u64, antwort: Antwort) {
    let Some(offen) = OFFEN.with(|o| o.borrow_mut().remove(&nr)) else { return };
    unsafe {
        let _ = match (offen.anfrage, antwort) {
            (Anfrage::Dialog(args), Antwort::Dialog { ok: true, text }) => {
                if let Some(text) = text {
                    let _ = args.SetResultText(&HSTRING::from(text));
                }
                args.Accept()
            }
            (Anfrage::Recht { args, art, herkunft, profil }, Antwort::Recht { erlauben }) => {
                let (zustand, dauerhaft) = recht_zustand(erlauben);
                let _ = args.SetState(zustand);
                if dauerhaft {
                    if let Some(profil) = profil {
                        let _ = profil.SetPermissionState(
                            art,
                            &HSTRING::from(herkunft),
                            zustand,
                            &SetPermissionStateCompletedHandler::create(Box::new(|_| Ok(()))),
                        );
                    }
                }
                Ok(())
            }
            (Anfrage::Anmeldung(args), Antwort::Anmeldung { benutzer: Some(benutzer), passwort }) => {
                args.Response().and_then(|r| {
                    r.SetUserName(&HSTRING::from(benutzer))?;
                    r.SetPassword(&HSTRING::from(passwort.unwrap_or_default()))
                })
            }
            (Anfrage::Recht { args, .. }, _) => args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY),
            (Anfrage::Anmeldung(args), _) => args.SetCancel(true),
            // Dialog abgelehnt: nichts setzen heißt abbrechen.
            _ => Ok(()),
        };
        let _ = offen.aufschub.Complete();
    }
}

/// Ein Tab geht zu: was er noch fragt, wird abgelehnt.
pub fn vergessen(tab: &str) {
    let nummern: Vec<u64> =
        OFFEN.with(|o| o.borrow().iter().filter(|(_, v)| v.tab == tab).map(|(nr, _)| *nr).collect());
    for nr in nummern {
        erledigen(nr, Antwort::Dialog { ok: false, text: None });
    }
}

/// Eine neue Seite im selben Tab: offene Rechte gelten nicht mehr, Menüs und
/// Dialoge der alten Seite können dagegen noch beantwortet werden.
pub fn rechte_vergessen(tab: &str) {
    let nummern: Vec<u64> = OFFEN.with(|o| {
        o.borrow()
            .iter()
            .filter(|(_, v)| v.tab == tab && matches!(v.anfrage, Anfrage::Recht { .. }))
            .map(|(nr, _)| *nr)
            .collect()
    });
    for nr in nummern {
        erledigen(nr, Antwort::Recht { erlauben: None });
    }
}

/// Die Rechte, die eine Seite erfragen kann, mit ihrem Namen in der Oberfläche.
const RECHTE: &[(COREWEBVIEW2_PERMISSION_KIND, &str)] = &[
    (COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, "mikrofon"),
    (COREWEBVIEW2_PERMISSION_KIND_CAMERA, "kamera"),
    (COREWEBVIEW2_PERMISSION_KIND_GEOLOCATION, "standort"),
    (COREWEBVIEW2_PERMISSION_KIND_NOTIFICATIONS, "benachrichtigungen"),
    (COREWEBVIEW2_PERMISSION_KIND_CLIPBOARD_READ, "zwischenablage"),
    (COREWEBVIEW2_PERMISSION_KIND_MULTIPLE_AUTOMATIC_DOWNLOADS, "downloads"),
    (COREWEBVIEW2_PERMISSION_KIND_FILE_READ_WRITE, "dateien"),
    (COREWEBVIEW2_PERMISSION_KIND_OTHER_SENSORS, "sensoren"),
    (COREWEBVIEW2_PERMISSION_KIND_MIDI_SYSTEM_EXCLUSIVE_MESSAGES, "midi"),
    (COREWEBVIEW2_PERMISSION_KIND_WINDOW_MANAGEMENT, "fenster"),
    (COREWEBVIEW2_PERMISSION_KIND_LOCAL_FONTS, "schriften"),
];

pub(crate) fn recht_name(art: COREWEBVIEW2_PERMISSION_KIND) -> &'static str {
    RECHTE.iter().find(|(a, _)| *a == art).map_or("sonstiges", |(_, n)| n)
}

pub(crate) fn recht_art(name: &str) -> Option<COREWEBVIEW2_PERMISSION_KIND> {
    RECHTE.iter().find(|(_, n)| *n == name).map(|(a, _)| *a)
}

/// Das Profil, in dem eine ausdrückliche Entscheidung gespeichert werden darf.
/// Private Tabs haben kein dauerhaftes Profil.
unsafe fn profil_von(core: &ICoreWebView2) -> Option<ICoreWebView2Profile4> {
    let profil = core.cast::<ICoreWebView2_13>().ok()?.Profile().ok()?;
    let mut privat = BOOL::default();
    profil.IsInPrivateModeEnabled(&mut privat).ok()?;
    if privat.as_bool() {
        return None;
    }
    profil.cast::<ICoreWebView2Profile4>().ok()
}

#[allow(dead_code)]
fn ist_unerwuenscht(name: &str) -> bool {
    let n = name.to_ascii_lowercase();
    n == "back"
        || n == "forward"
        || n == "reload"
        || n.contains("capture")
        || n.contains("share")
        || n.contains("readaloud")
        || n.contains("smartscreen")
        || n.contains("collection")
        || n.contains("math")
        || n.contains("sidebar")
        || n.contains("copilot")
        || n.contains("bing")
        || n.contains("devices")
        || n.contains("qrcode")
        || n.contains("cast")
        || n.contains("visualsearch")
        || n == "searchwebfor"
}

#[allow(dead_code)]
unsafe fn liste_separatoren_bereinigen(liste: &ICoreWebView2ContextMenuItemCollection) {
    let mut anzahl = 0u32;
    if liste.Count(&mut anzahl).is_err() || anzahl == 0 {
        return;
    }
    let mut vorher_war_separator = false;
    for i in (0..anzahl).rev() {
        if let Ok(eintrag) = liste.GetValueAtIndex(i) {
            let mut art = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND;
            if eintrag.Kind(&mut art).is_ok() {
                if art == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
                    if vorher_war_separator {
                        let _ = liste.RemoveValueAtIndex(i);
                    } else {
                        vorher_war_separator = true;
                    }
                } else {
                    vorher_war_separator = false;
                }
            }
        }
    }
    let mut anzahl = 0u32;
    if liste.Count(&mut anzahl).is_ok() && anzahl > 0 {
        if let Ok(letzter) = liste.GetValueAtIndex(anzahl - 1) {
            let mut art = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND;
            if letzter.Kind(&mut art).is_ok() && art == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
                let _ = liste.RemoveValueAtIndex(anzahl - 1);
            }
        }
    }
    let mut anzahl = 0u32;
    if liste.Count(&mut anzahl).is_ok() && anzahl > 0 {
        if let Ok(erster) = liste.GetValueAtIndex(0) {
            let mut art = COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND;
            if erster.Kind(&mut art).is_ok() && art == COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR {
                let _ = liste.RemoveValueAtIndex(0);
            }
        }
    }
}

#[allow(dead_code)]
unsafe fn kontextmenue_aufbereiten(
    app: &AppHandle,
    id: &str,
    core: &ICoreWebView2,
    args: &ICoreWebView2ContextMenuRequestedEventArgs,
    umgebung: &ICoreWebView2Environment,
) -> windows::core::Result<()> {
    let liste = args.MenuItems()?;
    let mut anzahl = 0u32;
    liste.Count(&mut anzahl)?;

    // 1. Edge-Bloatware herausfiltern
    for i in (0..anzahl).rev() {
        if let Ok(eintrag) = liste.GetValueAtIndex(i) {
            let name = text(|p| eintrag.Name(p));
            if ist_unerwuenscht(&name) {
                let _ = liste.RemoveValueAtIndex(i);
            }
        }
    }

    // 2. Doppelte und unpassende Trenner bereinigen
    liste_separatoren_bereinigen(&liste);

    // 3. Eigene Menüeinträge ergänzen
    if let Ok(u9) = umgebung.cast::<ICoreWebView2Environment9>() {
        let ziel = args.ContextMenuTarget()?;
        let ja = |lesen: &dyn Fn(*mut BOOL) -> windows::core::Result<()>| {
            let mut wert = BOOL::default();
            lesen(&mut wert).is_ok() && wert.as_bool()
        };
        let link = ja(&|p| ziel.HasLinkUri(p)).then(|| text(|p| ziel.LinkUri(p)));
        let bild = ja(&|p| ziel.HasSourceUri(p));
        let auswahl = ja(&|p| ziel.HasSelection(p));
        let bearbeitbar = ja(&|p| ziel.IsEditable(p));

        if let Some(link_url) = link {
            if !link_url.is_empty() {
                let privater_tab = u9.CreateContextMenuItem(
                    &HSTRING::from("Link in privatem Tab öffnen"),
                    None::<&windows::Win32::System::Com::IStream>,
                    COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
                )?;
                let app_p = app.clone();
                let mut token_privat = 0i64;
                privater_tab.add_CustomItemSelected(
                    &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                        let _ = app_p.emit_to(
                            "main",
                            "msb:neuer-tab",
                            serde_json::json!({ "url": link_url, "privat": true }),
                        );
                        Ok(())
                    })),
                    &mut token_privat,
                )?;
                let mut akt_anzahl = 0u32;
                let _ = liste.Count(&mut akt_anzahl);
                let _ = liste.InsertValueAtIndex(1.min(akt_anzahl), &privater_tab);
            }
        } else if !bild && !auswahl && !bearbeitbar {
            let mut kann_zurueck = BOOL::default();
            let _ = core.CanGoBack(&mut kann_zurueck);
            if kann_zurueck.as_bool() {
                let zurueck = u9.CreateContextMenuItem(
                    &HSTRING::from("Zurück"),
                    None::<&windows::Win32::System::Com::IStream>,
                    COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
                )?;
                let core_z = core.clone();
                let mut token_z = 0i64;
                zurueck.add_CustomItemSelected(
                    &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                        let _ = core_z.GoBack();
                        Ok(())
                    })),
                    &mut token_z,
                )?;
                let _ = liste.InsertValueAtIndex(0, &zurueck);
            }
            let mut akt_anzahl = 0u32;
            let _ = liste.Count(&mut akt_anzahl);
            let neu_laden = u9.CreateContextMenuItem(
                &HSTRING::from("Neu laden"),
                None::<&windows::Win32::System::Com::IStream>,
                COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
            )?;
            let core_r = core.clone();
            let mut token_r = 0i64;
            neu_laden.add_CustomItemSelected(
                &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                    let _ = core_r.Reload();
                    Ok(())
                })),
                &mut token_r,
            )?;
            let _ = liste.InsertValueAtIndex(1.min(akt_anzahl), &neu_laden);
        }

        let mut ort = POINT::default();
        let _ = args.Location(&mut ort);
        let mut akt_anzahl = 0u32;
        let _ = liste.Count(&mut akt_anzahl);

        let trenner = u9.CreateContextMenuItem(
            &HSTRING::new(),
            None::<&windows::Win32::System::Com::IStream>,
            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_SEPARATOR,
        )?;
        let _ = liste.InsertValueAtIndex(akt_anzahl, &trenner);
        akt_anzahl += 1;

        let untersuchen = u9.CreateContextMenuItem(
            &HSTRING::from("Untersuchen"),
            None::<&windows::Win32::System::Com::IStream>,
            COREWEBVIEW2_CONTEXT_MENU_ITEM_KIND_COMMAND,
        )?;
        let app_u = app.clone();
        let id_u = id.to_string();
        let mut token_u = 0i64;
        untersuchen.add_CustomItemSelected(
            &CustomItemSelectedEventHandler::create(Box::new(move |_, _| {
                let _ = app_u.emit_to(
                    "main",
                    "msb:untersuchen",
                    serde_json::json!({ "tab": id_u, "x": ort.x, "y": ort.y }),
                );
                Ok(())
            })),
            &mut token_u,
        )?;
        let _ = liste.InsertValueAtIndex(akt_anzahl, &untersuchen);
    }

    Ok(())
}

unsafe fn zeige_kontext_overlay(
    app: &AppHandle,
    id: &str,
    core: &ICoreWebView2,
    args: &ICoreWebView2ContextMenuRequestedEventArgs,
) -> windows::core::Result<()> {
    let ziel = args.ContextMenuTarget()?;
    let ja = |lesen: &dyn Fn(*mut BOOL) -> windows::core::Result<()>| {
        let mut wert = BOOL::default();
        lesen(&mut wert).is_ok() && wert.as_bool()
    };
    let link = ja(&|p| ziel.HasLinkUri(p)).then(|| text(|p| ziel.LinkUri(p)));
    let bild = ja(&|p| ziel.HasSourceUri(p)).then(|| text(|p| ziel.SourceUri(p)));
    let text_auswahl = ja(&|p| ziel.HasSelection(p)).then(|| text(|p| ziel.SelectionText(p)));
    let ist_editierbar = ja(&|p| ziel.IsEditable(p));

    let mut kann_zurueck = BOOL::default();
    let _ = core.CanGoBack(&mut kann_zurueck);
    let mut kann_vor = BOOL::default();
    let _ = core.CanGoForward(&mut kann_vor);

    let uri = text(|p| core.Source(p));
    let titel = text(|p| core.DocumentTitle(p));

    let mut cursor = POINT::default();
    let (px_x, px_y) = if GetCursorPos(&mut cursor).is_ok() {
        (cursor.x, cursor.y)
    } else {
        let mut ort = POINT::default();
        let _ = args.Location(&mut ort);
        (ort.x, ort.y)
    };

    if let Some(popup) = app.get_webview_window("kontextmenue") {
        let monitor = MonitorFromPoint(POINT { x: px_x, y: px_y }, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        let mut final_x = px_x;
        let mut final_y = px_y;
        let popup_breite = 270;
        let popup_hoehe = 380;
        if GetMonitorInfoW(monitor, &mut info).as_bool() {
            if final_x + popup_breite > info.rcWork.right {
                final_x = info.rcWork.right - popup_breite;
            }
            if final_y + popup_hoehe > info.rcWork.bottom {
                final_y = info.rcWork.bottom - popup_hoehe;
            }
            if final_x < info.rcWork.left {
                final_x = info.rcWork.left;
            }
            if final_y < info.rcWork.top {
                final_y = info.rcWork.top;
            }
        }

        let _ = popup.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(final_x, final_y)));
        let _ = popup.show();
        let _ = popup.set_focus();
        let _ = popup.emit(
            "msb:kontext-daten",
            serde_json::json!({
                "tab": id,
                "x": px_x,
                "y": px_y,
                "link": link,
                "bild": bild,
                "auswahl": text_auswahl,
                "editierbar": ist_editierbar,
                "kann_zurueck": kann_zurueck.as_bool(),
                "kann_vor": kann_vor.as_bool(),
                "url": uri,
                "titel": titel
            }),
        );
    }

    Ok(())
}

pub unsafe fn anbinden(
    app: &AppHandle,
    id: &str,
    core: &ICoreWebView2,
    _umgebung: &ICoreWebView2Environment,
) -> windows::core::Result<()> {
    let mut token = 0i64;

    if let Ok(core11) = core.cast::<ICoreWebView2_11>() {
        let (app, id, core_ref) = (app.clone(), id.to_string(), core.clone());
        core11.add_ContextMenuRequested(
            &ContextMenuRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                // Edge-Standard-Kontextmenü unterdrücken
                let _ = args.SetHandled(true);
                // Pontis-Overlay-Kontextmenü anzeigen (Option C: absolut ruckelfrei, kein Video-Freeze)
                let _ = zeige_kontext_overlay(&app, &id, &core_ref, &args);
                Ok(())
            })),
            &mut token,
        )?;
    }

    {
        let (app, id) = (app.clone(), id.to_string());
        core.add_ScriptDialogOpening(
            &ScriptDialogOpeningEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut art = COREWEBVIEW2_SCRIPT_DIALOG_KIND_ALERT;
                args.Kind(&mut art)?;
                let art = match art {
                    COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM => "confirm",
                    COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT => "prompt",
                    COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD => "beforeunload",
                    _ => "alert",
                };
                let herkunft = text(|p| args.Uri(p));
                let nachricht = text(|p| args.Message(p));
                let vorgabe = text(|p| args.DefaultText(p));
                let nr = ablegen(&id, Anfrage::Dialog(args.clone()), args.GetDeferral()?);
                melden(
                    &app,
                    TabEreignis::Dialog { id: id.clone(), nr, dialog: art.into(), herkunft, text: nachricht, vorgabe },
                );
                Ok(())
            })),
            &mut token,
        )?;
    }

    {
        let (app, id) = (app.clone(), id.to_string());
        let core_fuer_profil = core.clone();
        core.add_PermissionRequested(
            &PermissionRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut art = COREWEBVIEW2_PERMISSION_KIND_UNKNOWN_PERMISSION;
                args.PermissionKind(&mut art)?;
                let herkunft = text(|p| args.Uri(p));
                // WebView2 würde sonst jede Entscheidung still im Profil
                // ablegen, auch ein Schließen des Dialogs. Wir speichern nur
                // eine ausdrückliche Antwort selbst (`erledigen`).
                if let Ok(args3) = args.cast::<ICoreWebView2PermissionRequestedEventArgs3>() {
                    let _ = args3.SetSavesInProfile(false);
                }
                let profil = profil_von(&core_fuer_profil);
                let nr = ablegen(
                    &id,
                    Anfrage::Recht {
                        args: args.clone(),
                        art,
                        herkunft: herkunft.clone(),
                        profil,
                    },
                    args.GetDeferral()?,
                );
                melden(&app, TabEreignis::Recht { id: id.clone(), nr, recht: recht_name(art).into(), herkunft });
                Ok(())
            })),
            &mut token,
        )?;
    }

    if let Ok(core10) = core.cast::<ICoreWebView2_10>() {
        let (app, id) = (app.clone(), id.to_string());
        core10.add_BasicAuthenticationRequested(
            &BasicAuthenticationRequestedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let herkunft = text(|p| args.Uri(p));
                let bereich = text(|p| args.Challenge(p));
                let nr = ablegen(&id, Anfrage::Anmeldung(args.clone()), args.GetDeferral()?);
                melden(&app, TabEreignis::Anmeldung { id: id.clone(), nr, herkunft, bereich });
                Ok(())
            })),
            &mut token,
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nur_eine_ausdrueckliche_antwort_wird_gespeichert() {
        assert!(recht_zustand(Some(true)).1);
        assert!(recht_zustand(Some(false)).1);
        assert!(!recht_zustand(None).1);
    }
}
