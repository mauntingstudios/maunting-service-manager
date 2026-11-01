/**
 * Macht bewusst ignorierte Fehler im Entwicklermodus / Debug-Log sichtbar (Hardening WP2.5).
 *
 * Schreibt ausschließlich per console.debug und unterbricht den Benutzer nicht
 * (kein Toast, kein Alert). Ermöglicht die Nachverfolgung stiller Fehler in Diagnosen.
 */
export function still(fehler: unknown, kontext: string): void {
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[still]', kontext, fehler)
  }
}
