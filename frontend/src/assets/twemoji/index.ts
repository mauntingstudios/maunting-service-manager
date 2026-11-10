/**
 * Die vier generierten Emoji-Module an einer Stelle.
 *
 * Wer nur die Kennungen und Kategorien braucht (etwa der Picker), nimmt
 * `services/stickerMixerTypen`; dieses Modul zieht das Markup mit und gehört
 * deshalb nur in den lazy geladenen Mixer.
 */

import { ESSEN } from './essen'
import { GESICHTER } from './gesichter'
import { SYMBOLE } from './symbole'
import { TIERE } from './tiere'

export type EmojiKategorieId = 'gesichter' | 'tiere' | 'symbole' | 'essen'

export interface EmojiKategorie {
  id: EmojiKategorieId
  labelKey: string
  grafiken: Record<string, string>
}

export const EMOJI_KATEGORIEN: EmojiKategorie[] = [
  { id: 'gesichter', labelKey: 'messenger.mixer.categories.gesichter', grafiken: GESICHTER },
  { id: 'tiere', labelKey: 'messenger.mixer.categories.tiere', grafiken: TIERE },
  { id: 'symbole', labelKey: 'messenger.mixer.categories.symbole', grafiken: SYMBOLE },
  { id: 'essen', labelKey: 'messenger.mixer.categories.essen', grafiken: ESSEN },
]

export const EMOJI_GRAFIK: Record<string, string> = {
  ...GESICHTER,
  ...TIERE,
  ...SYMBOLE,
  ...ESSEN,
}
