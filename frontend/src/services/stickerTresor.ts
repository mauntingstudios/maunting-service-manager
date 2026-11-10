/**
 * Der Weg vom Foto-Sticker in den Tresor und zurück.
 *
 * Der Tresor wird nicht im Messenger entsperrt: Seine Karte (Smartcard),
 * Biometrie und die automatische Sperre hängen an der Tresor-Seite. Der
 * Messenger merkt sich nur, wohin er zurückkehren soll.
 */

export const STICKER_TRESOR_PARAM = 'fotoSticker'
export const STICKER_TRESOR_WERT = 'tresor'

/** Der Chat-Pfad mit dem Merker, der nach dem Entsperren den Editor öffnet. */
export function zurueckZumSticker(pfad: string, suche: string): string {
  const basis = `${pfad}${suche}`
  const trenner = suche ? '&' : '?'
  return `${basis}${trenner}${STICKER_TRESOR_PARAM}=${STICKER_TRESOR_WERT}`
}

export function tresorRoute(zurueck: string): string {
  return `/tresor?zurueck=${encodeURIComponent(zurueck)}`
}

/**
 * Nur der eigene Chat ist ein gültiges Rückziel. Eine Adresse aus der
 * Abfrage ist eine Angabe von außen; `//host` und Backslashes würden sonst
 * als fremder Ursprung gelesen.
 */
export function sichererStickerZurueck(ziel: string | null | undefined): string | null {
  if (!ziel) return null
  if (!ziel.startsWith('/chat')) return null
  if (ziel.startsWith('//') || ziel.includes('\\')) return null
  if (/[\u0000-\u001f\u007f]/.test(ziel)) return null
  return ziel
}
