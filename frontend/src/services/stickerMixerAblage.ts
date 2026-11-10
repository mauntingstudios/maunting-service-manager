/**
 * Die Sammlung der zuletzt gesendeten Mixes.
 *
 * Sie liegt als ein Dokument im versiegelten Hintergrund-Speicher des
 * Messengers (`hintergruende`, je Konto). Damit ist sie kontogebunden, beim
 * PIN-Wechsel wird sie mit umgeschrieben, und es braucht keinen neuen Store
 * mit DB-Versionssprung. Gespeichert werden nur Rezepte, nie SVGs.
 *
 * Ist der Messenger gesperrt oder der Speicher nicht lesbar, bleibt die
 * Sammlung leer. Sie ist Komfort, kein Verlauf; eine Meldung wäre hier Lärm.
 */

import { still } from '@/lib/still'
import {
  ladeHintergrundZeile,
  loescheHintergrundZeile,
  speichereHintergrundZeile,
} from './messengerLocalStore'
import {
  normalisiereRezept,
  rezeptId,
  type MixRezept,
} from './stickerMixerTypen'

export const MIX_SAMMLUNG_SCHLUESSEL = 'mix:sammlung'
export const MIX_SAMMLUNG_MAX = 12

export interface MixSammlungEintrag {
  id: string
  rezept: MixRezept
  /** Zeitpunkt des letzten Sendens, für die Reihenfolge. */
  zuletzt: number
}

function alsEintrag(roh: unknown): MixSammlungEintrag | null {
  if (!roh || typeof roh !== 'object') return null
  const daten = roh as Record<string, unknown>
  const quelle = daten.rezept && typeof daten.rezept === 'object'
    ? (daten.rezept as Record<string, unknown>)
    : {}
  const rezept = normalisiereRezept({
    emojis: Array.isArray(quelle.emojis) ? (quelle.emojis as string[]) : [],
    hintergrund: quelle.hintergrund as MixRezept['hintergrund'],
    funken: Boolean(quelle.funken),
  })
  if (!rezept.emojis.length) return null
  const zuletzt = Number(daten.zuletzt)
  return {
    id: rezeptId(rezept),
    rezept,
    zuletzt: Number.isFinite(zuletzt) && zuletzt > 0 ? zuletzt : 0,
  }
}

export async function ladeMixSammlung(): Promise<MixSammlungEintrag[]> {
  try {
    const zeile = await ladeHintergrundZeile(MIX_SAMMLUNG_SCHLUESSEL)
    const roh = zeile?.eintraege
    if (!Array.isArray(roh)) return []
    return roh
      .map(alsEintrag)
      .filter((eintrag): eintrag is MixSammlungEintrag => eintrag !== null)
      .sort((a, b) => b.zuletzt - a.zuletzt)
      .slice(0, MIX_SAMMLUNG_MAX)
  } catch (fehler) {
    still(fehler, 'Mix-Sammlung lesen')
    return []
  }
}

/** Merkt ein gesendetes Rezept. Gleiches Rezept rückt nach oben, statt doppelt zu stehen. */
export async function merkeMix(rezept: MixRezept): Promise<void> {
  const normal = normalisiereRezept(rezept)
  if (!normal.emojis.length) return
  const id = rezeptId(normal)
  const bisher = await ladeMixSammlung()
  const eintraege: MixSammlungEintrag[] = [
    { id, rezept: normal, zuletzt: Date.now() },
    ...bisher.filter((eintrag) => eintrag.id !== id),
  ].slice(0, MIX_SAMMLUNG_MAX)
  try {
    await speichereHintergrundZeile(MIX_SAMMLUNG_SCHLUESSEL, { eintraege })
  } catch (fehler) {
    // Gesperrt oder voll: der Sticker geht trotzdem raus.
    still(fehler, 'Mix merken')
  }
}

export async function leereMixSammlung(): Promise<void> {
  try {
    await loescheHintergrundZeile(MIX_SAMMLUNG_SCHLUESSEL)
  } catch (fehler) {
    // Nichts zu löschen oder gesperrt.
    still(fehler, 'Mix-Sammlung leeren')
  }
}
