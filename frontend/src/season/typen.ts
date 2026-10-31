/**
 * Saisonale Akzente: zwei wiederkehrende Anlaesse, ein gemeinsames Modell.
 *
 * Die Zeitfenster gelten jaehrlich und werden auf dem Geraet in dessen
 * Ortszeit ausgewertet. Sie stehen als `MM-DDTHH:MM` in den Panel-Settings,
 * damit ein Serverwechsel oder ein anderes Geraet die Saison nicht verschiebt.
 */
export const SEASON_IDS = ['halloween', 'christmas'] as const
export type SeasonId = (typeof SEASON_IDS)[number]

export type SeasonMode = 'off' | 'auto' | 'on'

export interface SeasonWindow {
  mode: SeasonMode
  start: string
  end: string
}

export interface SeasonalSettings {
  enabled: boolean
  halloween: SeasonWindow
  christmas: SeasonWindow
}

export const DEFAULT_SEASONAL_SETTINGS: SeasonalSettings = {
  enabled: true,
  halloween: { mode: 'auto', start: '10-24T00:00', end: '11-01T06:00' },
  christmas: { mode: 'auto', start: '12-01T00:00', end: '01-06T23:59' },
}

const MODI = new Set<SeasonMode>(['off', 'auto', 'on'])
const FENSTER = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d)$/

/** Ein Fenster ist nur gueltig, wenn Monat, Tag und Uhrzeit existieren. */
export function istGueltigesFenster(wert: unknown): wert is string {
  if (typeof wert !== 'string') return false
  const treffer = FENSTER.exec(wert)
  if (!treffer) return false
  const monat = Number(treffer[1])
  const tag = Number(treffer[2])
  // 2000 ist ein Schaltjahr; der 29.02. bleibt damit erlaubt.
  const datum = new Date(Date.UTC(2000, monat - 1, tag))
  return datum.getUTCMonth() === monat - 1 && datum.getUTCDate() === tag
}

function normalisiereFenster(wert: unknown, rueckfall: SeasonWindow): SeasonWindow {
  const roh = wert && typeof wert === 'object' ? (wert as Record<string, unknown>) : {}
  return {
    mode: MODI.has(roh.mode as SeasonMode) ? (roh.mode as SeasonMode) : rueckfall.mode,
    start: istGueltigesFenster(roh.start) ? roh.start : rueckfall.start,
    end: istGueltigesFenster(roh.end) ? roh.end : rueckfall.end,
  }
}

/**
 * Macht aus einer API-Antwort oder einem Cache-Wert immer eine vollstaendige
 * Einstellung. Fehlende oder unsinnige Felder fallen einzeln auf den
 * uebergebenen Rueckfall zurueck, nicht auf die Vorgabe.
 */
export function normalisiereSaison(
  wert: unknown,
  rueckfall: SeasonalSettings = DEFAULT_SEASONAL_SETTINGS,
): SeasonalSettings {
  const roh = wert && typeof wert === 'object' ? (wert as Record<string, unknown>) : {}
  return {
    enabled: typeof roh.enabled === 'boolean' ? roh.enabled : rueckfall.enabled,
    halloween: normalisiereFenster(roh.halloween, rueckfall.halloween),
    christmas: normalisiereFenster(roh.christmas, rueckfall.christmas),
  }
}
