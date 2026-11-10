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
    rezept: { emojis: ['🔥', '🐱'], hintergrund: 'amber', sterne: true },
  },
  {
    id: 'party',
    nameKey: 'messenger.mixer.presets.party',
    rezept: { emojis: ['🥳', '🎉', '✨'], hintergrund: 'purple', sterne: true },
  },
  {
    id: 'laessig',
    nameKey: 'messenger.mixer.presets.laessig',
    rezept: { emojis: ['😎', '👍'], hintergrund: 'emerald', sterne: false },
  },
  {
    id: 'totlachen',
    nameKey: 'messenger.mixer.presets.totlachen',
    rezept: { emojis: ['💀', '😂'], hintergrund: 'cyan', sterne: false },
  },
  {
    id: 'liebe',
    nameKey: 'messenger.mixer.presets.liebe',
    rezept: { emojis: ['❤️', '✨'], hintergrund: 'rose', sterne: true },
  },
  {
    id: 'abflug',
    nameKey: 'messenger.mixer.presets.abflug',
    rezept: { emojis: ['🚀', '🔥'], hintergrund: 'primary', sterne: true },
  },
]
