/** Der gemeinsame Wortschatz fuer Nachrichtenwirkungen (Bearbeiten, Loeschen, Reaktion, Anheften). */

export interface SteuerEintrag {
  typ: string
  felder: Record<string, unknown>
  ziel?: string | null
  zielId?: number | null
  ruecknahme?: unknown
}

export type SteuerAusgang = 'gesendet' | 'eingereiht'

/** Der Server hat die Wirkung endgültig abgelehnt. */
export class SteuerAbgewiesenError extends Error {
  readonly status: number | null

  constructor(status: number | null = null) {
    super('Die Wirkung wurde abgelehnt.')
    this.name = 'SteuerAbgewiesenError'
    this.status = status
  }
}

/** Die Outbox ist voll; die lokale Wirkung muss zurückgenommen werden. */
export class SteuerOutboxVollError extends Error {
  constructor() {
    super('Die Warteschlange für Änderungen ist voll.')
    this.name = 'SteuerOutboxVollError'
  }
}

/** Die logische Kennung ohne Geraetezusatz. */
export function logischeUuid(kennung: string | null | undefined): string | undefined {
  if (!kennung) return undefined
  const schnitt = kennung.indexOf('#')
  return schnitt === -1 ? kennung : kennung.slice(0, schnitt)
}

/** Nur eine endgueltige Ablehnung nimmt die lokale Wirkung zurueck. */
export function istAbweisung(fehler: unknown): boolean {
  if (fehler instanceof SteuerAbgewiesenError || fehler instanceof SteuerOutboxVollError) {
    return true
  }
  const status = (fehler as { status?: unknown } | null)?.status
  return [400, 403, 404, 410, 422].includes(Number(status))
}
