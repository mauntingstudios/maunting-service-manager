/**
 * Rezept, Grenzen und Palette des Sticker-Mixers — ohne Grafikmarkup.
 *
 * Der Picker hält den Entwurf und öffnet nur den Dialog. Läge das Markup in
 * diesem Modul, zöge der Picker alle Emoji-Assets in den Messenger-Chunk und
 * der Mixer wäre nicht mehr lazy. Deshalb steht das Markup in
 * `assets/twemoji` und wird nur von `stickerMixer` geladen.
 */

export const MAX_MIX_EMOJI = 3

export type MixHintergrundId = 'ohne' | 'sonne' | 'nacht' | 'minze' | 'pfirsich' | 'beere'

export interface MixHintergrund {
  id: MixHintergrundId
  labelKey: string
  /** Leer bei `ohne`: dort wird keine Fläche gezeichnet. */
  von: string
  bis: string
}

export const MIX_HINTERGRUENDE: MixHintergrund[] = [
  { id: 'ohne', labelKey: 'messenger.mixer.backgrounds.ohne', von: '', bis: '' },
  { id: 'sonne', labelKey: 'messenger.mixer.backgrounds.sonne', von: '#FDBA74', bis: '#F43F5E' },
  { id: 'nacht', labelKey: 'messenger.mixer.backgrounds.nacht', von: '#475569', bis: '#0F172A' },
  { id: 'minze', labelKey: 'messenger.mixer.backgrounds.minze', von: '#6EE7B7', bis: '#059669' },
  { id: 'pfirsich', labelKey: 'messenger.mixer.backgrounds.pfirsich', von: '#FDA4AF', bis: '#E11D48' },
  { id: 'beere', labelKey: 'messenger.mixer.backgrounds.beere', von: '#C084FC', bis: '#6D28D9' },
]

export interface MixRezept {
  /** 1 bis 3 Emoji; Duplikate sind erlaubt. */
  emojis: string[]
  hintergrund: MixHintergrundId
  funken: boolean
}

export interface MixSticker {
  id: string
  label: string
  svg: string
  mix: true
}

export const STANDARD_REZEPT: MixRezept = { emojis: [], hintergrund: 'ohne', funken: false }

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
    funken: Boolean(rezept?.funken),
  }
}

/** FNV-1a über das normalisierte Rezept: gleicher Mix, gleiche Kennung. */
export function mischerHash(rezept: MixRezept): string {
  const normal = normalisiereRezept(rezept)
  const text = `${normal.emojis.join('')}|${normal.hintergrund}|${normal.funken ? '1' : '0'}`
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
