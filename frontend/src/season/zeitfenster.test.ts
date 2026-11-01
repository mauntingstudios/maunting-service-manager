import { describe, expect, it } from 'vitest'

import { DEFAULT_SEASONAL_SETTINGS, normalisiereSaison } from './typen'
import { aktiveSaison, istImFenster, saisonStatus } from './zeitfenster'

function zeit(iso: string): Date {
  return new Date(iso)
}

describe('jaehrliches Saisonfenster', () => {
  it('trifft Halloween einschliesslich beider Grenzen', () => {
    expect(istImFenster('10-24T00:00', '11-01T06:00', zeit('2026-10-23T23:59:00'))).toBe(false)
    expect(istImFenster('10-24T00:00', '11-01T06:00', zeit('2026-10-24T00:00:00'))).toBe(true)
    expect(istImFenster('10-24T00:00', '11-01T06:00', zeit('2026-10-31T20:00:00'))).toBe(true)
    expect(istImFenster('10-24T00:00', '11-01T06:00', zeit('2026-11-01T06:00:00'))).toBe(true)
    expect(istImFenster('10-24T00:00', '11-01T06:00', zeit('2026-11-01T06:01:00'))).toBe(false)
  })

  it('trifft das MSM-Jubilaeum rund um den 20. Mai', () => {
    expect(istImFenster('05-18T00:00', '05-22T23:59', zeit('2026-05-17T23:59:00'))).toBe(false)
    expect(istImFenster('05-18T00:00', '05-22T23:59', zeit('2026-05-20T12:00:00'))).toBe(true)
    expect(istImFenster('05-18T00:00', '05-22T23:59', zeit('2026-05-22T23:59:00'))).toBe(true)
    expect(istImFenster('05-18T00:00', '05-22T23:59', zeit('2026-05-23T00:00:00'))).toBe(false)
  })

  it('laesst Weihnachten ueber den Jahreswechsel laufen', () => {
    expect(istImFenster('12-01T00:00', '01-06T23:59', zeit('2026-11-30T23:59:00'))).toBe(false)
    expect(istImFenster('12-01T00:00', '01-06T23:59', zeit('2026-12-24T18:00:00'))).toBe(true)
    expect(istImFenster('12-01T00:00', '01-06T23:59', zeit('2027-01-01T00:00:00'))).toBe(true)
    expect(istImFenster('12-01T00:00', '01-06T23:59', zeit('2027-01-06T23:59:00'))).toBe(true)
    expect(istImFenster('12-01T00:00', '01-06T23:59', zeit('2027-01-07T00:00:00'))).toBe(false)
  })

  it('ignoriert unsinnige Fenster, statt zufaellig zu aktivieren', () => {
    expect(istImFenster('13-01T00:00', '01-06T23:59', zeit('2026-12-24T18:00:00'))).toBe(false)
    expect(istImFenster('12-01T00:00', 'quatsch', zeit('2026-12-24T18:00:00'))).toBe(false)
  })
})

describe('aktive Saison', () => {
  it('waehlt im Mai Jubilaeum, im Oktober Halloween und im Dezember Weihnachten', () => {
    expect(aktiveSaison(DEFAULT_SEASONAL_SETTINGS, zeit('2026-05-20T12:00:00'))).toBe('birthday')
    expect(aktiveSaison(DEFAULT_SEASONAL_SETTINGS, zeit('2026-10-31T20:00:00'))).toBe('halloween')
    expect(aktiveSaison(DEFAULT_SEASONAL_SETTINGS, zeit('2026-12-24T18:00:00'))).toBe('christmas')
    expect(aktiveSaison(DEFAULT_SEASONAL_SETTINGS, zeit('2026-06-01T12:00:00'))).toBeNull()
  })

  it('respektiert den Hauptschalter und den Modus', () => {
    expect(aktiveSaison({ ...DEFAULT_SEASONAL_SETTINGS, enabled: false }, zeit('2026-10-31T20:00:00'))).toBeNull()
    expect(
      aktiveSaison(
        {
          ...DEFAULT_SEASONAL_SETTINGS,
          halloween: { ...DEFAULT_SEASONAL_SETTINGS.halloween, mode: 'off' },
        },
        zeit('2026-10-31T20:00:00'),
      ),
    ).toBeNull()
    expect(
      aktiveSaison(
        {
          ...DEFAULT_SEASONAL_SETTINGS,
          halloween: { ...DEFAULT_SEASONAL_SETTINGS.halloween, mode: 'on' },
        },
        zeit('2026-06-01T12:00:00'),
      ),
    ).toBe('halloween')
  })

  it('gibt Weihnachten Vorrang, wenn sich Fenster ueberschneiden', () => {
    expect(
      aktiveSaison(
        {
          enabled: true,
          halloween: { mode: 'on', start: '10-24T00:00', end: '11-01T06:00' },
          christmas: { mode: 'on', start: '12-01T00:00', end: '01-06T23:59' },
        },
        zeit('2026-10-31T20:00:00'),
      ),
    ).toBe('christmas')
  })
})

describe('Status fuer die Einstellungsseite', () => {
  it('unterscheidet aus, immer, aktiv und inaktiv', () => {
    expect(saisonStatus(false, DEFAULT_SEASONAL_SETTINGS.halloween, zeit('2026-10-31T20:00:00'))).toBe('aus')
    expect(
      saisonStatus(
        true,
        { ...DEFAULT_SEASONAL_SETTINGS.halloween, mode: 'on' },
        zeit('2026-06-01T12:00:00'),
      ),
    ).toBe('immer')
    expect(saisonStatus(true, DEFAULT_SEASONAL_SETTINGS.halloween, zeit('2026-10-31T20:00:00'))).toBe('aktiv')
    expect(saisonStatus(true, DEFAULT_SEASONAL_SETTINGS.halloween, zeit('2026-06-01T12:00:00'))).toBe('inaktiv')
  })
})

describe('Normalisierung der Saison-Einstellungen', () => {
  it('fuellt fehlende Felder einzeln aus dem Rueckfall', () => {
    const rueckfall = {
      enabled: false,
      birthday: { mode: 'auto' as const, start: '05-18T00:00', end: '05-22T23:59' },
      halloween: { mode: 'on' as const, start: '10-30T18:00', end: '11-02T02:00' },
      christmas: { mode: 'off' as const, start: '12-20T00:00', end: '12-27T23:59' },
    }
    expect(normalisiereSaison({ halloween: { start: '10-31T12:00' } }, rueckfall)).toEqual({
      enabled: false,
      birthday: { mode: 'auto', start: '05-18T00:00', end: '05-22T23:59' },
      halloween: { mode: 'on', start: '10-31T12:00', end: '11-02T02:00' },
      christmas: { mode: 'off', start: '12-20T00:00', end: '12-27T23:59' },
    })
  })

  it('verwirft unsinnige Modi und Fenster', () => {
    expect(
      normalisiereSaison({
        enabled: true,
        halloween: { mode: 'immer', start: '13-40T99:99', end: '11-01T06:00' },
        christmas: { mode: 'auto', start: '12-01T00:00', end: '01-06T23:59' },
      }),
    ).toEqual(DEFAULT_SEASONAL_SETTINGS)
  })

  it('liefert bei einem fremden Wert die Vorgabe', () => {
    expect(normalisiereSaison('kaputt')).toEqual(DEFAULT_SEASONAL_SETTINGS)
    expect(normalisiereSaison(null)).toEqual(DEFAULT_SEASONAL_SETTINGS)
  })
})
