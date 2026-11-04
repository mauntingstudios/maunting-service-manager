//! Die äußere Form der beiden Hauptfenster.
//!
//! Die Fenster sind rahmenlos (`decorations: false`) und sollen trotzdem wie
//! ein eigener Arbeitsbereich wirken, nicht wie ein Systemfenster. Windows
//! zeichnet die Rundung selbst, sobald es sie kennt; die Oberfläche schneidet
//! ihren Inhalt passend zu. Auf allen anderen Plattformen bleibt die Funktion
//! ein No-op, damit beide Apps überall bauen.

/// Setzt runde Ecken, die dunkle Rahmenfarbe und den dunklen Fensterrahmen.
///
/// `hwnd` ist der rohe Fensterzeiger (`WebviewWindow::hwnd().0`). Ein Fehler
/// wird bewusst verschluckt: unter Windows 10 gibt es die Attribute nicht, und
/// ein eckiges, aber funktionierendes Fenster ist besser als ein Startabbruch.
pub fn runde_ecken(hwnd: *mut core::ffi::c_void) {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Dwm::{
            DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_USE_IMMERSIVE_DARK_MODE,
            DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_ROUND,
        };

        let fenster = HWND(hwnd);
        let ecke = DWMWCP_ROUND;
        let _ = DwmSetWindowAttribute(
            fenster,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &ecke as *const _ as _,
            std::mem::size_of_val(&ecke) as u32,
        );

        let dunkel: i32 = 1;
        let _ = DwmSetWindowAttribute(
            fenster,
            DWMWA_USE_IMMERSIVE_DARK_MODE,
            &dunkel as *const _ as _,
            std::mem::size_of_val(&dunkel) as u32,
        );

        // COLORREF ist 0x00BBGGRR: ein dunkles Graphit mit einem Hauch Teal.
        let linie: u32 = 0x0026_1A_1A;
        let _ = DwmSetWindowAttribute(
            fenster,
            DWMWA_BORDER_COLOR,
            &linie as *const _ as _,
            std::mem::size_of_val(&linie) as u32,
        );
    }

    #[cfg(not(windows))]
    let _ = hwnd;
}
