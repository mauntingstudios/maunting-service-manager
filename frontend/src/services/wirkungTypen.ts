/** Der gemeinsame Wortschatz fuer Nachrichtenwirkungen (Bearbeiten, Loeschen, Reaktion, Anheften). */

export interface SteuerEintrag {
  typ: string
  felder: Record<string, unknown>
  ziel?: string | null
  zielId?: number | null
  ruecknahme?: unknown
}

export type SteuerAusgang = 'gesendet' | 'eingereiht'

/** Die logische Kennung ohne Geraetezusatz. */
export function logischeUuid(kennung: string | null | undefined): string | undefined {
  if (!kennung) return undefined
  const schnitt = kennung.indexOf('#')
  return schnitt === -1 ? kennung : kennung.slice(0, schnitt)
}

/** Nur eine endgueltige Ablehnung nimmt die lokale Wirkung zurueck. */
export function istAbweisung(fehler: unknown): boolean {
  const status = (fehler as { status?: unknown } | null)?.status
  return [400, 403, 404, 410, 422].includes(Number(status))
}
