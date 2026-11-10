/**
 * Die Emoji-Palette und der gemeinsame Typ für Sticker-Motive.
 *
 * Die 60 System-Sticker liegen als PNGs unter `public/stickers`; ihr Katalog
 * steht in `systemStickers.ts` und wird aus dem Manifest erzeugt.
 */

/**
 * Die Gestalt, die Picker und Mixer an `onSticker` übergeben.
 *
 * `svg` trägt einen gebauten Mixer-Sticker, `bild` ein eingebettetes Bild
 * (Foto-Sticker). System-Sticker reisen nur mit ihrer Kennung; die Blase
 * schlägt sie im festen Katalog nach.
 */
export interface StickerMotiv {
  id: string
  label: string
  svg?: string
  bild?: string
  mix?: boolean
}

export interface EmojiCategory {
  category: string
  emojis: string[]
}

export const CATEGORIZED_EMOJIS: EmojiCategory[] = [
  {
    category: 'Smileys & Gefühle',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
      '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰',
      '😘', '😋', '😛', '😜', '🤪', '😎', '🤩', '🥳',
      '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣',
      '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠',
      '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨',
      '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥',
      '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧',
      '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐',
    ],
  },
  {
    category: 'Gesten & Menschen',
    emojis: [
      '👍', '👎', '👊', '✊', '🤛', '🤜', '👏', '🙌',
      '👐', '🤲', '🤝', '🙏', '✌️', '🤞', '🤟', '🤘',
      '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👋',
      '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✍️',
      '💅', '🤳', '💪', '🦾', '🧠', '🫀', '👀', '👁️',
      '🧑‍💻', '👨‍💻', '👩‍💻', '🕵️', '🧙', '🦸', '🦹', '🤖',
    ],
  },
  {
    category: 'Sicherheit & Tech',
    emojis: [
      '🛡️', '🔒', '🔓', '🔏', '🔐', '🔑', '🗝️', '⚙️',
      '⚡', '💡', '🔥', '✨', '🌟', '💥', '💯', '💢',
      '🖥️', '💻', '⌨️', '🖱️', '📱', '📡', '🛰️', '🕹️',
      '🚀', '🛸', '🎯', '💾', '💿', '📀', '🔌', '🔋',
      '💬', '💭', '🗯️', '📢', '🔔', '🔕', '🎵', '🎶',
    ],
  },
  {
    category: 'Aktivität & Essen',
    emojis: [
      '🎮', '☕', '🍵', '🍕', '🍔', '🍟', '🌭', '🍿',
      '🍺', '🍻', '🥂', '🍷', '🏆', '🥇', '🥈', '🥉',
      '⚽', '🏀', '🏈', '⚾', '🎾', '🏐', '🎳', '🎲',
      '🎉', '🎊', '🎈', '🎁', '🎪', '🎨', '🏖️', '🏝️',
    ],
  },
]
