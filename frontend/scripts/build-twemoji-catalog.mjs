#!/usr/bin/env node
/**
 * Baut die Emoji-Grafiken für den Sticker-Mixer aus Twemoji.
 *
 * Einmalig ausführen, Ergebnis einchecken. Zur Laufzeit wird nichts geladen:
 * die Innenpfade stehen danach als String in vier generierten Modulen.
 *
 * Quelle: https://github.com/jdecked/twemoji, Tag v15.1.0
 * Grafiken: CC BY 4.0, Code: MIT.
 *
 * Aufruf:
 *   node scripts/build-twemoji-catalog.mjs
 *   TWEMOJI_DIR=/pfad/zu/twemoji/assets/svg node scripts/build-twemoji-catalog.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const TAG = 'v15.1.0'
const QUELLE = `https://cdn.jsdelivr.net/gh/jdecked/twemoji@${TAG}/assets/svg`
const AUSGABE = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'twemoji')

const KATEGORIEN = [
  {
    id: 'gesichter',
    konstante: 'GESICHTER',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣',
      '😊', '😇', '🙂', '😉', '😍', '🥰', '😘', '😜',
      '🤪', '😎', '🤩', '🥳', '😏', '😒', '😞', '🥺',
      '😢', '😭', '😡', '🤯', '😱', '🤔',
    ],
  },
  {
    id: 'tiere',
    konstante: 'TIERE',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼',
      '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🐔',
      '🐧', '🐦', '🦄', '🐝', '🦋', '🐙', '🦖', '🐉',
      '🐢', '🐳', '🦈', '🐊', '🦉', '🦕',
    ],
  },
  {
    id: 'symbole',
    konstante: 'SYMBOLE',
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
    konstante: 'ESSEN',
    emojis: [
      '☕', '🍵', '🍕', '🍔', '🍟', '🌭', '🍿', '🍺',
      '🍻', '🥂', '🍷', '🍰', '🎂', '🍩', '🍪', '🍫',
      '🍓', '🍉', '🍌', '🍎', '🌮', '🍣', '🍜', '🍦',
      '🎈', '🎆', '🎇', '🎵', '🎶', '🎮',
    ],
  },
]

/** Twemoji nennt Dateien nach Codepoints, ohne den Variantenselektor FE0F. */
function dateiname(emoji) {
  return Array.from(emoji)
    .map((zeichen) => zeichen.codePointAt(0).toString(16))
    .filter((code) => code !== 'fe0f')
    .join('-')
}

function pruefe(inner, emoji, datei) {
  const verboten = [
    [/<svg[\s>]/i, '<svg im Innenmarkup'],
    [/<use[\s>]/i, '<use>'],
    [/<image[\s>]/i, '<image>'],
    [/<style[\s>]/i, '<style>'],
    [/\sid\s*=/i, 'id-Attribut'],
    [/\son[a-z]+\s*=/i, 'Ereignis-Attribut'],
    [/<script[\s>]/i, '<script>'],
    [/(?:href|src)\s*=\s*["']?\s*(?:https?:|\/\/)/i, 'externe Adresse'],
  ]
  for (const [muster, name] of verboten) {
    if (muster.test(inner)) {
      throw new Error(`${emoji} (${datei}): ${name} ist nicht erlaubt.`)
    }
  }
}

async function lade(emoji) {
  const datei = `${dateiname(emoji)}.svg`
  const lokal = process.env.TWEMOJI_DIR ? join(process.env.TWEMOJI_DIR, datei) : null
  if (lokal) {
    return { datei, roh: readFileSync(lokal, 'utf8') }
  }
  const antwort = await fetch(`${QUELLE}/${datei}`)
  if (!antwort.ok) {
    throw new Error(`${emoji}: ${datei} nicht erreichbar (HTTP ${antwort.status}).`)
  }
  return { datei, roh: await antwort.text() }
}

function innenmarkup(roh, emoji, datei) {
  const text = roh
    .replace(/<\?xml[^>]*\?>/g, '')
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\r\n/g, '\n')
  const start = text.indexOf('>', text.indexOf('<svg'))
  const ende = text.lastIndexOf('</svg>')
  if (start < 0 || ende < 0 || ende <= start) {
    throw new Error(`${emoji} (${datei}): kein vollständiges SVG.`)
  }
  const inner = text.slice(start + 1, ende).replace(/>\s+</g, '><').trim()
  if (!inner) throw new Error(`${emoji} (${datei}): leer.`)
  pruefe(inner, emoji, datei)
  return inner
}

function modul(kategorie, eintraege) {
  const zeilen = eintraege
    .map(([emoji, inner]) => `  ${JSON.stringify(emoji)}: ${JSON.stringify(inner)},`)
    .join('\n')
  return `/**
 * GENERIERT von frontend/scripts/build-twemoji-catalog.mjs.
 * Quelle: Twemoji (jdecked/twemoji ${TAG}), Grafiken CC BY 4.0.
 * Nicht von Hand ändern.
 */

export const ${kategorie.konstante}: Record<string, string> = {
${zeilen}
}
`
}

const LIZENZ = `# Twemoji

Die Emoji-Grafiken in diesem Ordner stammen aus dem Twemoji-Projekt:

- Quelle: https://github.com/jdecked/twemoji (Tag ${TAG})
- Grafiken: Creative Commons Attribution 4.0 International (CC BY 4.0)
  https://creativecommons.org/licenses/by/4.0/
- Code: MIT

Die Dateien wurden mit \`frontend/scripts/build-twemoji-catalog.mjs\` in
Innenmarkup zerlegt. Änderungen an den Grafiken nimmt der Generator vor.
`

let gesamt = 0
const ergebnisse = []

for (const kategorie of KATEGORIEN) {
  const eintraege = []
  for (const emoji of kategorie.emojis) {
    const { datei, roh } = await lade(emoji)
    const inner = innenmarkup(roh, emoji, datei)
    gesamt += inner.length
    eintraege.push([emoji, inner])
  }
  ergebnisse.push([kategorie, eintraege])
  process.stdout.write(`${kategorie.id}: ${eintraege.length} Emoji\n`)
}

mkdirSync(AUSGABE, { recursive: true })
for (const [kategorie, eintraege] of ergebnisse) {
  writeFileSync(join(AUSGABE, `${kategorie.id}.ts`), modul(kategorie, eintraege), 'utf8')
}
writeFileSync(join(AUSGABE, 'LICENSE.md'), LIZENZ, 'utf8')

process.stdout.write(`geschrieben: ${AUSGABE} (${(gesamt / 1024).toFixed(1)} KB Markup)\n`)
