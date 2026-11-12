import { existsSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import i18n from '@/i18n'
import {
  begruessungSchluessel,
  ermittleTageszeitBild,
  headerHintergrundWaehlen,
  jahreszeit,
} from './tageszeit'

describe('tageszeit', () => {
  it('liefert für jede Stunde, Variante und Kurzform einen vorhandenen Begrüßungstext', () => {
    for (const sprache of ['de', 'en']) {
      const t = i18n.getFixedT(sprache)
      for (let stunde = 0; stunde < 24; stunde++) {
        for (let zufall = 0; zufall < 5; zufall++) {
          for (const kurz of [false, true]) {
            const schluessel = begruessungSchluessel(stunde, kurz, zufall)
            const text = t(schluessel, { name: 'Maik' })
            expect(text, `${sprache}: ${schluessel}`).not.toBe(schluessel)
            expect(text).toContain('Maik')
          }
        }
      }
      expect(t('common.begruessung.ohneName')).not.toBe('common.begruessung.ohneName')
    }
  })

  it('bestimmt die meteorologische Jahreszeit zuverlässig für alle 12 Monate', () => {
    expect(jahreszeit(new Date(2026, 2, 15))).toBe('fruehling')
    expect(jahreszeit(new Date(2026, 4, 30))).toBe('fruehling')
    expect(jahreszeit(new Date(2026, 5, 1))).toBe('sommer')
    expect(jahreszeit(new Date(2026, 7, 31))).toBe('sommer')
    expect(jahreszeit(new Date(2026, 8, 1))).toBe('herbst')
    expect(jahreszeit(new Date(2026, 10, 12))).toBe('herbst')
    expect(jahreszeit(new Date(2026, 11, 1))).toBe('winter')
    expect(jahreszeit(new Date(2026, 0, 15))).toBe('winter')
    expect(jahreszeit(new Date(2026, 1, 28))).toBe('winter')
  })

  it('wählt zu jeder Stunde und Jahreszeit ein vorhandenes atmosphärisches Bild (ohne Browser-Hintergründe)', () => {
    const publicDir = resolve(import.meta.dirname, '../../public')
    const saisonDaten = [
      new Date(2026, 3, 15), // Frühling
      new Date(2026, 6, 15), // Sommer
      new Date(2026, 9, 15), // Herbst
      new Date(2026, 0, 15), // Winter
    ]

    for (const datum of saisonDaten) {
      for (let stunde = 0; stunde < 24; stunde++) {
        const standard = headerHintergrundWaehlen(stunde, 3, 'standard', datum)
        expect(standard.pfad).toMatch(/^\/assets\/(singra|teams)\//)
        expect(standard.pfad.startsWith('/hintergruende/')).toBe(false)
        expect(existsSync(resolve(publicDir, standard.pfad.slice(1))), standard.pfad).toBe(true)

        const teams = headerHintergrundWaehlen(stunde, undefined, 'teams', datum)
        expect(teams.pfad).toMatch(/^\/assets\/(singra|teams)\//)
        expect(existsSync(resolve(publicDir, teams.pfad.slice(1))), teams.pfad).toBe(true)

        const direkt = ermittleTageszeitBild(stunde, datum)
        expect(existsSync(resolve(publicDir, direkt.slice(1))), direkt).toBe(true)

        for (const bereich of ['dashboard', 'calendar', 'notes', 'docs'] as const) {
          const szene = headerHintergrundWaehlen(stunde, undefined, bereich, datum)
          expect(szene.pfad).toMatch(/^\/assets\/(singra|teams)\//)
          expect(existsSync(resolve(publicDir, szene.pfad.slice(1))), szene.pfad).toBe(true)
        }
      }
    }
  })
})
