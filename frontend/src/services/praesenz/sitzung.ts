/**
 * Wer meldet — und als was.
 *
 * Der Server unterscheidet drei Oberflächen: Web-Panel, Pontis und MSS. Bis
 * 27.10.2026 meldeten beide Tauri-Apps dieselbe Plattform („desktop“), ein
 * schmales Browserfenster meldete „mobile“. Der Bau sagt jetzt, wer er ist
 * (`__MSM_APP__`), die Plattform folgt daraus.
 *
 * Die Gerätekennung liegt je Konto in der Ablage: dasselbe Gerät schreibt
 * immer dieselbe Sitzungszeile, mehrere Tabs teilen sie sich.
 */

import type { PraesenzClient } from '@/api/social'

export type PraesenzPlattform = 'web' | 'desktop' | 'mobile'

declare const __MSM_APP__: string | undefined

const KENNUNG = /^[A-Za-z0-9_-]{8,64}$/
const MOBIL = /Android|iPhone|iPad|iPod|Mobile/i

export function clientErkennen(): PraesenzClient {
  const gebaut = typeof __MSM_APP__ === 'string' ? __MSM_APP__ : ''
  if (gebaut === 'mss' || gebaut === 'pontis') return gebaut
  if (typeof window !== 'undefined' && ('__TAURI_INTERNALS__' in window || '__TAURI__' in window)) {
    // Ältere Builds kennen den Schalter nicht; sie sind die Desktop-App.
    return 'mss'
  }
  return 'web'
}

export function plattformErkennen(client: PraesenzClient): PraesenzPlattform {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : ''
  if (client !== 'web') return MOBIL.test(ua) ? 'mobile' : 'desktop'
  if (typeof window === 'undefined') return 'web'
  return MOBIL.test(ua) || window.innerWidth < 768 ? 'mobile' : 'web'
}

/** Eine Kennung je Konto und Browser; sie bleibt über Neustarts dieselbe. */
export function geraeteKennung(kontoId: number): string {
  const schluessel = `msm:praesenz_geraet:${kontoId}`
  let wert: string | null = null
  try {
    wert = localStorage.getItem(schluessel)
  } catch {
    wert = null
  }
  if (wert && KENNUNG.test(wert)) return wert

  const roh =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
  const neu = `g-${roh}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
  try {
    localStorage.setItem(schluessel, neu)
  } catch {
    // Ohne Ablage gilt die Kennung nur für diese Sitzung.
  }
  return neu
}
