/**
 * Sechs fertige Mixes für den Schnellstart.
 *
 * Antippen sendet sofort, wie eine Kachel im Sticker-Raster. Die Namen stehen
 * über i18n, gespeichert wird nur das Rezept.
 */

import type { MixRezept } from './stickerMixerTypen'

export interface MixPreset {
  id: string
  nameKey: string
  rezept: MixRezept
}

export const MIX_PRESETS: MixPreset[] = [
  {
    id: 'feuerkatze',
    nameKey: 'messenger.mixer.presets.feuerkatze',
    rezept: { emojis: ['🔥', '🐱'], hintergrund: 'sonne', funken: true },
  },
  {
    id: 'party',
    nameKey: 'messenger.mixer.presets.party',
    rezept: { emojis: ['🥳', '🎉', '✨'], hintergrund: 'beere', funken: true },
  },
  {
    id: 'laessig',
    nameKey: 'messenger.mixer.presets.laessig',
    rezept: { emojis: ['😎', '👍'], hintergrund: 'minze', funken: false },
  },
  {
    id: 'totlachen',
    nameKey: 'messenger.mixer.presets.totlachen',
    rezept: { emojis: ['💀', '😂'], hintergrund: 'nacht', funken: false },
  },
  {
    id: 'liebe',
    nameKey: 'messenger.mixer.presets.liebe',
    rezept: { emojis: ['❤️', '✨'], hintergrund: 'pfirsich', funken: true },
  },
  {
    id: 'abflug',
    nameKey: 'messenger.mixer.presets.abflug',
    rezept: { emojis: ['🚀', '🔥'], hintergrund: 'nacht', funken: true },
  },
]
