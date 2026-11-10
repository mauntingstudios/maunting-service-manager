#!/usr/bin/env node
/**
 * Baut den System-Sticker-Katalog aus dem Manifest in `public/stickers`.
 *
 * Die Bilder liegen als 256er PNGs unter `public/stickers/<thema>/`. Dieses
 * Skript erzeugt daraus stabile Kennungen, die Themenliste und die Zuordnung
 * für die Anzeige. Ergebnis einchecken; zur Laufzeit wird nichts gelesen.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const WURZEL = join(dirname(fileURLToPath(import.meta.url)), '..')
const MANIFEST = join(WURZEL, 'public', 'stickers', 'manifest.json')
const AUSGABE = join(WURZEL, 'src', 'services', 'systemStickers.ts')

const THEMEN = [
  { id: 'emotes', labelKey: 'messenger.stickerThemes.emotes' },
  { id: 'love', labelKey: 'messenger.stickerThemes.love' },
  { id: 'food', labelKey: 'messenger.stickerThemes.food' },
  { id: 'gaming', labelKey: 'messenger.stickerThemes.gaming' },
  { id: 'technology', labelKey: 'messenger.stickerThemes.technology' },
  { id: 'cars_travel', labelKey: 'messenger.stickerThemes.carsTravel' },
]

const themenIds = new Set(THEMEN.map((thema) => thema.id))

function liesManifest() {
  const roh = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  if (!Array.isArray(roh) || roh.length === 0) {
    throw new Error('manifest.json ist leer oder kein Array.')
  }
  const eintraege = roh
    .map((eintrag) => ({
      index: Number(eintrag.index),
      category: String(eintrag.category || ''),
      filename: String(eintrag.filename || ''),
    }))
    .filter((eintrag) => eintrag.filename.endsWith('.png'))
  for (const eintrag of eintraege) {
    if (!themenIds.has(eintrag.category)) {
      throw new Error(`Unbekanntes Thema: ${eintrag.category}`)
    }
    if (!Number.isFinite(eintrag.index)) {
      throw new Error(`Ungültiger Index bei ${eintrag.filename}`)
    }
  }
  if (eintraege.length !== 60) {
    throw new Error(`Erwartet 60 Sticker, gefunden ${eintraege.length}.`)
  }
  return eintraege.sort((a, b) => a.index - b.index)
}

/** `01_hello_wave.png` → `hello-wave`. */
function kennung(dateiname) {
  const basis = dateiname.split('/').pop().replace(/\.png$/i, '')
  return basis.replace(/^\d+_/, '').replace(/_/g, '-')
}

function namensSchluessel(slug) {
  return slug.replace(/-([a-z0-9])/g, (_, zeichen) => zeichen.toUpperCase())
}

const eintraege = liesManifest()
const proThema = new Map(THEMEN.map((thema) => [thema.id, 0]))
const sticker = eintraege.map((eintrag) => {
  const nummer = (proThema.get(eintrag.category) ?? 0) + 1
  proThema.set(eintrag.category, nummer)
  const slug = kennung(eintrag.filename)
  return {
    id: `sys-${eintrag.category}-${slug}`,
    theme: eintrag.category,
    nummer,
    bild: `/stickers/${eintrag.filename}`,
    datei: eintrag.filename,
    nameKey: `messenger.stickerNames.${namensSchluessel(slug)}`,
  }
})

const kopf = `/**
 * GENERIERT von frontend/scripts/build-system-sticker-catalog.mjs.
 * Quelle: public/stickers/manifest.json und die PNGs daneben.
 * Nicht von Hand ändern.
 */

export const STICKER_THEMES = ${JSON.stringify(THEMEN, null, 2)} as const

export type StickerThemeId = (typeof STICKER_THEMES)[number]['id']

export interface SystemSticker {
  id: string
  theme: StickerThemeId
  /** Reihenfolge innerhalb des Themas, beginnend bei 1. */
  nummer: number
  /** Pfad im öffentlichen Ordner; kein Nutzerinhalt, fest im Programm. */
  bild: string
  datei: string
  /** Name in der App-Sprache, unter messenger.stickerNames.*. */
  nameKey: string
}

export const SYSTEM_STICKERS: SystemSticker[] = ${JSON.stringify(sticker, null, 2)}

const NACH_KENNUNG = new Map(SYSTEM_STICKERS.map((eintrag) => [eintrag.id, eintrag]))

export function systemSticker(id: string): SystemSticker | undefined {
  return NACH_KENNUNG.get(id)
}
`

writeFileSync(AUSGABE, kopf, 'utf8')
process.stdout.write(`geschrieben: ${AUSGABE} (${sticker.length} Sticker, ${THEMEN.length} Themen)\n`)
