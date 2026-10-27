// @vitest-environment node
/**
 * Die Unterschrift der Gruppenblöcke.
 *
 * Zwei Mitglieder einer Gruppe, die ihre Geräte nie freigegeben haben, kennen
 * sich gegenseitig nicht. Ihre Signaturen sind damit nicht prüfbar — und ein
 * Name, den nur der Server prüfen lässt, wäre für sie unsichtbar. Der Block
 * gilt deshalb, solange der Schreibende nach den Gruppenrechten berechtigt
 * ist. Eine **bekannte** Gerät mit falscher Signatur bleibt eine Fälschung.
 */

import { describe, expect, it, vi } from 'vitest'

const beleg = vi.hoisted(() => ({
  art: 'geprueft' as 'geprueft' | 'gefaelscht' | 'unsigniert',
  behauptet: 7,
  vonKonto: 7,
}))
const verzeichnis = vi.hoisted(() => new Map<string, string>())

vi.mock('./nutzlastSignatur', () => ({
  pruefeNutzlast: vi.fn(async () => ({ art: beleg.art, vonKonto: beleg.vonKonto, behauptet: beleg.behauptet })),
}))
vi.mock('./e2eeGeraet', () => ({
  signaturSchluesselVon: vi.fn(async (konto: number, geraet: string) =>
    verzeichnis.get(`${konto}:${geraet}`) ?? null,
  ),
}))

import { pruefeGruppenSignatur } from './gruppenSignatur'

const ROH = { von_konto: 7, von_geraet: 'geraet-a', sig: 'sig' }

describe('Die Signatur eines Gruppenblocks', () => {
  it('erkennt eine echte Unterschrift', async () => {
    beleg.art = 'geprueft'
    const ergebnis = await pruefeGruppenSignatur(ROH, 'group:1')
    expect(ergebnis).toEqual({ art: 'geprueft', vonKonto: 7 })
  })

  it('nimmt ein unbekanntes Gerät an', async () => {
    beleg.art = 'gefaelscht'
    verzeichnis.clear()
    const ergebnis = await pruefeGruppenSignatur(ROH, 'group:1')
    expect(ergebnis).toEqual({ art: 'unbekanntesGeraet', vonKonto: 7 })
  })

  it('weist ein bekanntes Gerät mit falscher Signatur ab', async () => {
    beleg.art = 'gefaelscht'
    verzeichnis.set('7:geraet-a', 'oeffentlicher-schluessel')
    const ergebnis = await pruefeGruppenSignatur(ROH, 'group:1')
    expect(ergebnis).toEqual({ art: 'gefaelscht', vonKonto: 7 })
  })

  it('weist eine fehlende Unterschrift ab', async () => {
    beleg.art = 'unsigniert'
    const ergebnis = await pruefeGruppenSignatur(ROH, 'group:1')
    expect(ergebnis).toEqual({ art: 'gefaelscht', vonKonto: 0 })
  })
})
