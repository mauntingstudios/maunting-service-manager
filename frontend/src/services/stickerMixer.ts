/**
 * Baut aus einem Rezept ein selbsttragendes Sticker-SVG.
 *
 * Das Ergebnis reist als `sticker_attachment` im verschlüsselten Payload, wie
 * die handgezeichneten Sticker aus `stickerCatalog`. Der Empfänger braucht
 * dadurch keine Emoji-Assets und keine zweite Darstellung: was hier steht, ist
 * überall dasselbe Bild.
 *
 * Alles ist deterministisch. Gleiches Rezept ergibt denselben String und
 * dieselbe Kennung; es gibt keine Zufallswerte in Layout oder Effekt.
 */

import { EMOJI_GRAFIK } from '@/assets/twemoji'

import {
  MIX_HINTERGRUENDE,
  normalisiereRezept,
  rezeptId,
  type MixRezept,
  type MixSticker,
} from './stickerMixerTypen'

export {
  MAX_MIX_EMOJI,
  MIX_HINTERGRUENDE,
  MIX_KATEGORIEN,
  STANDARD_REZEPT,
  istBekanntesEmoji,
  mischerHash,
  normalisiereRezept,
  rezeptId,
} from './stickerMixerTypen'
export type {
  MixHintergrund,
  MixHintergrundId,
  MixKategorie,
  MixRezept,
  MixSticker,
} from './stickerMixerTypen'

interface Lage {
  cx: number
  cy: number
  scale: number
  drehung: number
}

/**
 * Feste Plätze je Anzahl. Twemoji zeichnet in einem 36er-Kasten; der Sticker
 * ist 128 Einheiten breit. Die Rotationen sind bewusst ungleich, damit zwei
 * Emoji wie aufgeklebt wirken und nicht wie eine Tabelle.
 */
const LAGEN: Record<number, Lage[]> = {
  1: [{ cx: 64, cy: 64, scale: 2.6, drehung: 0 }],
  2: [
    { cx: 45, cy: 70, scale: 1.95, drehung: -8 },
    { cx: 85, cy: 58, scale: 1.95, drehung: 8 },
  ],
  3: [
    { cx: 64, cy: 44, scale: 1.55, drehung: 0 },
    { cx: 43, cy: 86, scale: 1.55, drehung: -10 },
    { cx: 86, cy: 84, scale: 1.55, drehung: 10 },
  ],
}

const FUNKEN: { x: number; y: number; scale: number; drehung: number }[] = [
  { x: 24, y: 30, scale: 0.55, drehung: 0 },
  { x: 104, y: 38, scale: 0.4, drehung: 15 },
  { x: 98, y: 100, scale: 0.5, drehung: -10 },
  { x: 30, y: 98, scale: 0.35, drehung: 20 },
  { x: 112, y: 72, scale: 0.3, drehung: 0 },
]

const FUNKE_PFAD =
  'M0 -7 L1.8 -1.8 L7 0 L1.8 1.8 L0 7 L-1.8 1.8 L-7 0 L-1.8 -1.8 Z'

/** Zwei Nachkommastellen reichen und halten den String über Läufe gleich. */
function zahl(wert: number): string {
  return String(Math.round(wert * 100) / 100)
}

function funkenSvg(): string {
  const sterne = FUNKEN.map(
    (funke) =>
      `<g transform="translate(${funke.x} ${funke.y}) rotate(${funke.drehung}) scale(${funke.scale})"><path d="${FUNKE_PFAD}"/></g>`,
  ).join('')
  return `<g fill="#FEF3C7" opacity="0.95">${sterne}</g>`
}

function emojiGruppe(emoji: string, lage: Lage): string {
  const innen = EMOJI_GRAFIK[emoji]
  if (!innen) return ''
  const tx = lage.cx - 18 * lage.scale
  const ty = lage.cy - 18 * lage.scale
  return `<g transform="rotate(${lage.drehung} 64 64) translate(${zahl(tx)} ${zahl(ty)}) scale(${zahl(lage.scale)})">${innen}</g>`
}

/**
 * Die Kennung des Verlaufs hängt nur am Hintergrund, nicht am Rezept. Zwei
 * Sticker mit demselben Hintergrund teilen damit dieselbe Definition; eine
 * Kollision im Dokument ändert nichts, weil die Stops gleich sind.
 */
function hintergrundSvg(id: string, von: string, bis: string): string[] {
  return [
    `<defs><linearGradient id="mx-bg-${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${von}"/><stop offset="1" stop-color="${bis}"/></linearGradient></defs>`,
    `<rect x="6" y="6" width="116" height="116" rx="34" fill="url(#mx-bg-${id})" stroke="#FFFFFF" stroke-width="4"/>`,
    '<ellipse cx="46" cy="38" rx="30" ry="20" fill="#FFFFFF" opacity="0.16"/>',
  ]
}

export function baueSticker(rezept: MixRezept): MixSticker | null {
  const normal = normalisiereRezept(rezept)
  if (!normal.emojis.length) return null

  const hintergrund = MIX_HINTERGRUENDE.find((eintrag) => eintrag.id === normal.hintergrund)
  const teile: string[] = []
  if (hintergrund && hintergrund.id !== 'ohne') {
    teile.push(...hintergrundSvg(hintergrund.id, hintergrund.von, hintergrund.bis))
  }

  const lagen = LAGEN[normal.emojis.length] ?? LAGEN[3]
  normal.emojis.forEach((emoji, index) => {
    teile.push(emojiGruppe(emoji, lagen[index]))
  })

  if (normal.funken) teile.push(funkenSvg())

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" aria-hidden="true" focusable="false">${teile.join('')}</svg>`

  return {
    id: rezeptId(normal),
    label: normal.emojis.join(''),
    svg,
    mix: true,
  }
}
