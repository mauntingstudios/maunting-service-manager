/**
 * Macht bewusst ignorierte Fehler im Entwicklermodus / Debug-Log sichtbar.
 * Schreibt ausschließlich per console.debug und unterbricht den Benutzer nicht.
 */
export function still(fehler: unknown, kontext: string): void {
  if (typeof console !== 'undefined' && console.debug) {
    console.debug('[still]', kontext, fehler)
  }
}
