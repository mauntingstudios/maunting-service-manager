/**
 * Eigene Sticker-Packs: Typen und Regeln, ohne Ablage und ohne React.
 *
 * Die Bilder selbst liegen getrennt von den Zeilen (siehe
 * `messengerLocalStore`), damit das Raster nur Miniaturen liest und ein
 * gesendeter Foto-Sticker erst beim Öffnen das Vollbild braucht.
 */

import type { MixRezept } from './stickerMixerTypen'

export type BildStickerStil = 'fett' | 'handschrift' | 'elegant' | 'digital'

export interface StickerPack {
  id: string
  name: string
  /** Sticker, der als Cover dient; leer: der erste im Pack. */
  coverId: string | null
  createdAt: number
  updatedAt: number
}

export interface MixStickerEintrag {
  id: string
  packId: string
  art: 'mix'
  rezept: MixRezept
  /** Das fertig gebaute SVG fürs Raster; fehlt bei der alten Sammlung. */
  miniatur?: string
  createdAt: number
}

export interface BildStickerEintrag {
  id: string
  packId: string
  art: 'bild'
  /** Der eingetippte Text, nur für Anzeige und Suche; im Bild ist er eingebrannt. */
  text: string
  stil: BildStickerStil
  /** Kleine Vorschau fürs Raster, als data:image/webp. */
  miniatur: string
  createdAt: number
}

export type EigenSticker = MixStickerEintrag | BildStickerEintrag

export const STICKER_PACKS_MAX = 30
export const STICKER_MAX = 300
/** Obergrenze für ein eingebettetes Bild; es reist später im Chiffrat mit. */
export const STICKER_BILD_MAX_ZEICHEN = 400_000

export class StickerAblageFehler extends Error {
  readonly code: 'limit' | 'leer' | 'unbekannt'

  constructor(code: 'limit' | 'leer' | 'unbekannt', nachricht: string) {
    super(nachricht)
    this.name = 'StickerAblageFehler'
    this.code = code
  }
}

/** Ein Name bleibt ein Name: getrimmt, nicht leer, nicht endlos. */
export function normalisierePackName(name: string, ersatz: string): string {
  const sauber = name.trim().replace(/\s+/g, ' ').slice(0, 40)
  return sauber || ersatz
}

/**
 * Das Cover eines Packs. Ist die gemerkte Kennung weg (gelöscht, aus einem
 * älteren Stand), gilt der erste Sticker; ohne Sticker gibt es keins.
 */
export function effektivesCover(
  pack: StickerPack,
  sticker: readonly EigenSticker[],
): EigenSticker | undefined {
  if (pack.coverId) {
    const gemerkt = sticker.find((eintrag) => eintrag.id === pack.coverId)
    if (gemerkt) return gemerkt
  }
  return [...sticker].sort((a, b) => a.createdAt - b.createdAt)[0]
}

/** Der Text, den Zitat, Vorlesen und Suche von einem eigenen Sticker kennen. */
export function stickerLabel(sticker: EigenSticker): string {
  if (sticker.art === 'mix') return sticker.rezept.emojis.join('')
  return sticker.text.trim() || 'Foto'
}
