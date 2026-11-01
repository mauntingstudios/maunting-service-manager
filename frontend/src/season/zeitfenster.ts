import { istGueltigesFenster, type SeasonId, type SeasonalSettings, type SeasonWindow } from './typen'

interface Fensterpunkt {
  monat: number
  tag: number
  stunde: number
  minute: number
}

function parseFenster(wert: string): Fensterpunkt | null {
  if (!istGueltigesFenster(wert)) return null
  const treffer = /^(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(wert)
  if (!treffer) return null
  return {
    monat: Number(treffer[1]),
    tag: Number(treffer[2]),
    stunde: Number(treffer[3]),
    minute: Number(treffer[4]),
  }
}

/** Vergleichbare Minuten seit Jahresbeginn; das Jahr selbst spielt keine Rolle. */
function alsMinuten(punkt: Fensterpunkt): number {
  return ((punkt.monat - 1) * 32 + (punkt.tag - 1)) * 1440 + punkt.stunde * 60 + punkt.minute
}

function minutenJetzt(jetzt: Date): number {
  return alsMinuten({
    monat: jetzt.getMonth() + 1,
    tag: jetzt.getDate(),
    stunde: jetzt.getHours(),
    minute: jetzt.getMinutes(),
  })
}

/**
 * Liegt `jetzt` im jaehrlichen Fenster? Ein Fenster darf ueber den Jahreswechsel
 * laufen (Weihnachten: 01.12. bis 06.01.). Beide Grenzen sind einschliesslich.
 */
export function istImFenster(start: string, end: string, jetzt: Date = new Date()): boolean {
  const von = parseFenster(start)
  const bis = parseFenster(end)
  if (!von || !bis) return false
  const jetztMinuten = minutenJetzt(jetzt)
  const vonMinuten = alsMinuten(von)
  const bisMinuten = alsMinuten(bis)
  if (vonMinuten <= bisMinuten) {
    return jetztMinuten >= vonMinuten && jetztMinuten <= bisMinuten
  }
  return jetztMinuten >= vonMinuten || jetztMinuten <= bisMinuten
}

/**
 * Welche Saison gilt gerade? Weihnachten hat Vorrang, falls sich zwei Fenster
 * einmal ueberschneiden. Die Marke ist absichtlich klein: die beiden Anlaesse
 * liegen im Kalender weit auseinander.
 */
export function aktiveSaison(
  einstellungen: SeasonalSettings,
  jetzt: Date = new Date(),
): SeasonId | null {
  if (!einstellungen.enabled) return null
  const reihenfolge: SeasonId[] = ['christmas', 'halloween', 'birthday']
  for (const id of reihenfolge) {
    const fenster = einstellungen[id]
    if (fenster.mode === 'on') return id
    if (fenster.mode === 'auto' && istImFenster(fenster.start, fenster.end, jetzt)) return id
  }
  return null
}

export type SaisonStatus = 'aus' | 'immer' | 'aktiv' | 'inaktiv'

/** Kurzer Zustand fuer die Einstellungsseite. */
export function saisonStatus(
  enabled: boolean,
  fenster: SeasonWindow,
  jetzt: Date = new Date(),
): SaisonStatus {
  if (!enabled || fenster.mode === 'off') return 'aus'
  if (fenster.mode === 'on') return 'immer'
  return istImFenster(fenster.start, fenster.end, jetzt) ? 'aktiv' : 'inaktiv'
}
