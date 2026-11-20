import { PANEL_HOME } from './panelWege'

/**
 * Wohin es nach Anmeldung oder Registrierung geht: nur auf einen Pfad dieses
 * Panels, sonst auf die Panel-Startseite.
 *
 * Geprüft wird die aufgelöste Adresse, nicht der Text. `/\fremd.example`
 * beginnt mit einem Schrägstrich und nicht mit zweien, der Browser liest den
 * Backslash aber als Schrägstrich und landet auf `//fremd.example`. React
 * Router fällt bei einer fremden Herkunft auf `location.assign` zurück, und
 * ein präparierter Link schickte neue Nutzer auf eine fremde Seite.
 */
export function sicheresZiel(roh: string | null | undefined): string {
  if (!roh || !roh.startsWith('/')) return PANEL_HOME
  let ziel: URL
  try {
    ziel = new URL(roh, window.location.origin)
  } catch {
    return PANEL_HOME
  }
  if (ziel.origin !== window.location.origin) return PANEL_HOME
  if (ziel.pathname === '/') return PANEL_HOME
  return ziel.pathname + ziel.search + ziel.hash
}
