/**
 * Wo eine Einladung gilt: die kanonische Panel-Adresse statt der WebView-Origin.
 *
 * In der Tauri-App ist `window.location.origin` `tauri.localhost`. Ein Link
 * darauf ist fuer jeden anderen unbrauchbar. Die Panel-Adresse kommt aus den
 * oeffentlichen Einstellungen; sie ist die Adresse, unter der Menschen das
 * Panel erreichen.
 */
import { getEffectiveApiUrl } from '@/config/api'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

function ohneSchraegstrich(url: string): string {
  return url.replace(/\/+$/, '')
}

/** Eine echte HTTP(S)-Origin, ohne Pfad und ohne Schraegstrich. */
function alsOrigin(wert: string | null | undefined): string {
  const roh = (wert ?? '').trim()
  if (!roh) return ''
  try {
    const url = new URL(roh)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return ''
    return ohneSchraegstrich(`${url.protocol}//${url.host}`)
  } catch {
    return ''
  }
}

/**
 * Die Adresse, die in einem neuen Einladungslink stehen darf.
 *
 * `tauri.localhost` ist nie eine Antwort: sie zeigt auf die WebView, nicht auf
 * das Panel. Fehlt die Panel-Adresse, bleibt die API-Origin als letzter
 * brauchbarer Hinweis (bei einer All-in-one-Installation ist das dieselbe
 * Adresse).
 */
export function oeffentlicheBasisUrl(): string {
  const panel = alsOrigin(usePublicSettingsStore.getState().panel_url)
  if (panel && !panel.includes('tauri.localhost')) return panel
  const api = alsOrigin(getEffectiveApiUrl())
  if (api && !api.includes('tauri.localhost')) return api
  return ''
}

/**
 * Origins, unter denen ein Einladungslink als Karte erkannt wird.
 *
 * Die eigene Origin bleibt dabei: alte Links aus der App zeigen auf
 * `tauri.localhost` und sollen auf genau diesem Geraet weiter funktionieren.
 * Neue Links tragen dagegen immer die Panel-Adresse.
 */
export function erlaubteEinladungsUrsprunge(): string[] {
  const ursprunge = new Set<string>()
  const eigen = alsOrigin(typeof window !== 'undefined' ? window.location.origin : '')
  if (eigen) ursprunge.add(eigen)
  const basis = oeffentlicheBasisUrl()
  if (basis) ursprunge.add(basis)
  return [...ursprunge]
}
