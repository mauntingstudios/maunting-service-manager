import { api } from './client'

export interface PublicLegalSettings {
  imprint_enabled: boolean
  imprint_url: string
}

/**
 * Die Antwort ist eine Eingabe von aussen. Ein leerer Body (204, Proxy,
 * halbe Antwort) wurde bis 10.11.2026 ungeprueft zurueckgegeben und landete als
 * `undefined` im Legal-Store — dann warf die Fusszeile auf jeder Seite bei
 * `legal.imprint_enabled`. Der Typ wird hier hergestellt, nicht nur behauptet.
 */
export async function getPublicLegalSettings(): Promise<PublicLegalSettings> {
  const antwort = await api<unknown>('/system/legal')
  const roh = (antwort ?? {}) as Record<string, unknown>
  return {
    imprint_enabled: roh.imprint_enabled === true,
    imprint_url: typeof roh.imprint_url === 'string' ? roh.imprint_url : '',
  }
}
