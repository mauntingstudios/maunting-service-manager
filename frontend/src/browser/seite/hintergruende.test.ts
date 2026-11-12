import { existsSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import {
  aktuellesWechselBild,
  BILD_HINTERGRUENDE,
  FARB_HINTERGRUENDE,
  HINTERGRUND_GRUPPEN,
  HINTERGRUND_OPTIONEN,
  hintergrundStil,
} from './hintergruende'

describe('Hintergruende Logik', () => {
  it('hält alle 26 Bildhintergründe mit real vorhandenen Dateien bereit', () => {
    const publicDir = resolve(import.meta.dirname, '../../../public')
    expect(BILD_HINTERGRUENDE).toHaveLength(26)
    for (const bild of BILD_HINTERGRUENDE) {
      expect(bild.pfad).toMatch(/^(\/hintergruende\/[a-z]+\.webp|\/assets\/singra\/.*\.jpg)$/)
      expect(existsSync(resolve(publicDir, bild.pfad.slice(1))), bild.pfad).toBe(true)
    }
  })

  it('wählt im Wechselmodus gezielt ein zur Jahres- und Tageszeit passendes Bild', () => {
    const winterTag = new Date(2026, 0, 15, 13, 0, 0).getTime()
    const fruehlingMorgen = new Date(2026, 3, 15, 8, 0, 0).getTime()
    const herbstAbend = new Date(2026, 9, 15, 19, 0, 0).getTime()
    const sommerTag = new Date(2026, 6, 15, 14, 0, 0).getTime()

    expect(aktuellesWechselBild(winterTag).pfad).toContain('/winter/singra-bg-day.jpg')
    expect(aktuellesWechselBild(herbstAbend).pfad).toContain('/herbst/singra-bg-evening.jpg')
    expect(aktuellesWechselBild(fruehlingMorgen).pfad).toMatch(/\/fruehling\/(singra|teams)-bg-morning\.jpg$/)

    // Im Sommer bleibt der Weltraum-/Mars-/Ozean-Katalog draußen, dafür rotieren Sommerszenen
    const sommerPfade = new Set(
      [0, 1, 2, 3, 4].map((slot) => aktuellesWechselBild(sommerTag + slot * 30 * 60 * 1000).pfad),
    )
    expect(sommerPfade.size).toBeGreaterThanOrEqual(3)
    for (const pfad of sommerPfade) {
      expect(pfad).not.toContain('mars')
      expect(pfad).not.toContain('erde')
    }
  })

  it('erzeugt passenden Hintergrundstil fuer Farben, feste Bilder und Wechselmodus', () => {
    // Farbe
    expect(hintergrundStil('schlicht', null)).toEqual({})
    expect(hintergrundStil('nacht', null)).toEqual({ background: FARB_HINTERGRUENDE.nacht })

    // Festes Bild
    const erdeStil = hintergrundStil('erde', null)
    expect(erdeStil.backgroundImage).toContain('/hintergruende/erde.webp')

    // Wechselndes Bild (nimmt direkt das zur Zeit passende Motiv)
    const zeit = new Date(2026, 0, 15, 13, 0, 0).getTime()
    const wechselStil = hintergrundStil('wechsel', null, zeit)
    expect(wechselStil.backgroundImage).toContain(aktuellesWechselBild(zeit).pfad)

    // Eigenes Bild
    const eigenStil = hintergrundStil('eigen', 'data:image/webp;base64,abc')
    expect(eigenStil.backgroundImage).toBe('url("data:image/webp;base64,abc")')
  })

  it('bietet alle Hintergrundoptionen in aufgeräumten Gruppen an', () => {
    expect(HINTERGRUND_GRUPPEN.map((g) => g.id)).toEqual([
      'automatisch',
      'jahreszeiten',
      'landschaften',
      'weltraum',
      'farben',
    ])
    expect(HINTERGRUND_OPTIONEN).toContain('wechsel')
    expect(HINTERGRUND_OPTIONEN).toContain('alpen_winter_tag')
    expect(HINTERGRUND_OPTIONEN).toContain('erde')
    expect(HINTERGRUND_OPTIONEN).toContain('schlicht')
  })
})
