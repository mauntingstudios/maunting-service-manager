/**
 * Schalter für die Fensterarchitektur der beiden Desktop-Apps.
 *
 * Das Experiment lebt vollständig in `fenster.css`: jede Regel dort hängt an
 * `html[data-fenster="einheit"]`. Diese Datei setzt die Marke beim Start.
 * Fehlt sie, ist die Oberfläche unverändert — die Bauteile tragen nur stabile
 * Haken (`mui-fensterkopf`, `msb-randleiste`), die ohne Marke nichts tun.
 *
 * Es gilt nur für echte Fenster: auf Android gibt es keinen Fensterrahmen,
 * dort bleibt die bisherige Darstellung.
 *
 * Rückkehr zur bisherigen Darstellung: `FENSTER_STIL` auf `'klassisch'`
 * stellen. Es genügt dieser eine Wert; kein Bauteil muss angefasst werden.
 */
export const FENSTER_STIL: 'einheit' | 'klassisch' = 'einheit'

export function fensterStilAnwenden(): void {
  if (typeof document === 'undefined') return
  const keinFenster = typeof navigator !== 'undefined' && /android/i.test(navigator.userAgent)
  if (FENSTER_STIL === 'einheit' && !keinFenster) document.documentElement.dataset.fenster = 'einheit'
  else delete document.documentElement.dataset.fenster
}
