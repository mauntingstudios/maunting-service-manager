/**
 * Rezept, Grenzen und Palette des Sticker-Mixers — ohne Grafikmarkup.
 *
 * Der Picker hält den Entwurf und öffnet nur den Dialog. Läge das Markup in
 * diesem Modul, zöge der Picker alle Emoji-Assets in den Messenger-Chunk und
 * der Mixer wäre nicht mehr lazy. Deshalb steht das Markup in
 * `assets/twemoji` und wird nur von `stickerMixer` geladen.
 */

import { FARB_PALETTE } from '@/config/farbpalette'

export const MAX_MIX_EMOJI = 3

/**
 * Die Hintergründe sind die sechs Grundtöne der Rollen- und Kalenderpalette
 * (`FARB_PALETTE`, dieselben Werte wie `ROLE_COLOR_PRESETS`). So gibt es keine
 * eigene Farbliste im Mixer, und ein neuer Ton kommt an einer Stelle dazu.
 */
export type MixHintergrundId =
  | 'ohne'
  | 'primary'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'purple'
  | 'cyan'

export interface MixHintergrund {
  id: MixHintergrundId
  labelKey: string
  /** Der kräftige Grundton; leer bei `ohne`. */
  ton: string
}

const MIX_FARBEN: Exclude<MixHintergrundId, 'ohne'>[] = [
  'primary',
  'emerald',
  'amber',
  'rose',
  'purple',
  'cyan',
]

export const MIX_HINTERGRUENDE: MixHintergrund[] = [
  { id: 'ohne', labelKey: 'messenger.mixer.backgrounds.ohne', ton: '' },
  ...MIX_FARBEN.flatMap((id) => {
    const farbe = FARB_PALETTE.find((eintrag) => eintrag.id === id)
    return farbe ? [{ id, labelKey: farbe.labelKey, ton: farbe.ton }] : []
  }),
]

export interface MixRezept {
  /** 1 bis 3 Emoji; Duplikate sind erlaubt. */
  emojis: string[]
  hintergrund: MixHintergrundId
  /** Kleine Sterne um das Motiv. */
  sterne: boolean
}

export interface MixSticker {
  id: string
  label: string
  svg: string
  mix: true
}

export const STANDARD_REZEPT: MixRezept = { emojis: [], hintergrund: 'ohne', sterne: false }

export type MixKategorieId = 'gesichter' | 'tiere' | 'symbole' | 'essen'

export interface MixKategorie {
  id: MixKategorieId
  labelKey: string
  emojis: string[]
}

/**
 * Dieselben Emoji wie in den generierten Asset-Modulen. `stickerMixerAssets`
 * prüft, dass beide Listen deckungsgleich sind.
 */
export const MIX_KATEGORIEN: MixKategorie[] = [
  {
    id: 'gesichter',
    labelKey: 'messenger.mixer.categories.gesichter',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
      '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😜',
      '🤪', '😎', '🤩', '🥳', '😏', '😒', '😞', '🥺',
      '😢', '😭', '😡', '🤯', '😱', '🤔',
    ],
  },
  {
    id: 'tiere',
    labelKey: 'messenger.mixer.categories.tiere',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
      '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
      '🐧', '🐦', '🦄', '🐝', '🦋', '🐙', '🦖', '🐉',
      '🐢', '🐳', '🦈', '🐊', '🦉', '🦕',
    ],
  },
  {
    id: 'symbole',
    labelKey: 'messenger.mixer.categories.symbole',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '💔',
      '💯', '🔥', '✨', '⭐', '🌟', '💫', '💥', '⚡',
      '💀', '☠️', '👻', '👽', '🤖', '💩', '🎉', '🎊',
      '🎁', '🏆', '👑', '💎', '👍', '👏',
      '🚀',
    ],
  },
  {
    id: 'essen',
    labelKey: 'messenger.mixer.categories.essen',
    emojis: [
      '☕', '🍵', '🍕', '🍔', '🍟', '🌭', '🍿', '🍺',
      '🍻', '🥂', '🍷', '🍰', '🎂', '🍩', '🍪', '🍫',
      '🍓', '🍉', '🍌', '🍎', '🌮', '🍣', '🍜', '🍦',
      '🎈', '🎆', '🎇', '🎵', '🎶', '🎮',
    ],
  },
]

const BEKANNTE_EMOJI = new Set(MIX_KATEGORIEN.flatMap((kategorie) => kategorie.emojis))

export function istBekanntesEmoji(emoji: string): boolean {
  return BEKANNTE_EMOJI.has(emoji)
}

/**
 * Macht aus einer beliebigen Angabe ein sendbares Rezept.
 *
 * Unbekannte Emoji und Hintergründe fallen weg, statt den ganzen Sticker zu
 * verwerfen: eine Sammlung von einem älteren Stand soll weiter benutzbar sein,
 * auch wenn eine Grafik inzwischen fehlt. Ohne gültiges Emoji bleibt das Rezept
 * leer und ist damit nicht sendbar.
 */
export function normalisiereRezept(rezept: Partial<MixRezept> | null | undefined): MixRezept {
  const emojis = Array.isArray(rezept?.emojis)
    ? rezept.emojis.filter((emoji): emoji is string => typeof emoji === 'string' && istBekanntesEmoji(emoji))
    : []
  const hintergrund = MIX_HINTERGRUENDE.some((h) => h.id === rezept?.hintergrund)
    ? (rezept?.hintergrund as MixHintergrundId)
    : 'ohne'
  return {
    emojis: emojis.slice(0, MAX_MIX_EMOJI),
    hintergrund,
    sterne: Boolean(rezept?.sterne),
  }
}

/** FNV-1a über das normalisierte Rezept: gleicher Mix, gleiche Kennung. */
export function mischerHash(rezept: MixRezept): string {
  const normal = normalisiereRezept(rezept)
  const text = `${normal.emojis.join('')}|${normal.hintergrund}|${normal.sterne ? '1' : '0'}`
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function rezeptId(rezept: MixRezept): string {
  return `mix-${mischerHash(rezept)}`
}
