import { describe, expect, it } from 'vitest'
import {
  cpuZuProzent,
  formatCpuLabel,
  formatEuro,
  preisAufschluesselung,
  RABATT_PROZENT,
} from './preis'
import { SHOP_SPIELE } from './mockKatalog'
import { standardKonfiguration } from './typen'

const palworld = SHOP_SPIELE[0]

describe('Shop-Preislogik', () => {
  it('berechnet den Standardpreis ohne Aufschlaege', () => {
    const preis = preisAufschluesselung(palworld, standardKonfiguration(palworld))
    expect(preis.ramCent).toBe(0)
    expect(preis.cpuCent).toBe(0)
    expect(preis.slotsCent).toBe(0)
    expect(preis.kiCent).toBe(0)
    expect(preis.gesamtCent).toBe(palworld.grundpreisCent)
  })

  it('rechnet RAM, CPU, Slots und KI-Zugang dazu', () => {
    const preis = preisAufschluesselung(palworld, {
      ...standardKonfiguration(palworld),
      ramGb: palworld.standardRamGb + 4,
      cpu: palworld.standardCpu + 2,
      slots: palworld.standardSlots + 8,
      kiZugang: true,
    })
    expect(preis.ramCent).toBe(4 * palworld.preisProGbCent)
    expect(preis.cpuCent).toBe(2 * palworld.preisProKernCent)
    expect(preis.slotsCent).toBe(8 * palworld.preisProSlotCent)
    expect(preis.kiCent).toBe(palworld.kiZugangCent)
    expect(preis.monatCent).toBe(
      palworld.grundpreisCent +
        preis.ramCent +
        preis.cpuCent +
        preis.slotsCent +
        preis.kiCent,
    )
  })

  it('wendet Schrittgroessen bei Prozent-CPU korrekt an', () => {
    const tarif = {
      ...palworld,
      standardCpu: 150,
      cpuStufen: [150, 200, 250, 300],
      cpuStep: 50,
      preisProKernCent: 150,
    }
    const preis = preisAufschluesselung(tarif, {
      ...standardKonfiguration(tarif),
      cpu: 250,
    })
    expect(preis.cpuCent).toBe(2 * 150)
  })

  it('wandelt Kerne und Prozentwerte lesbar um', () => {
    expect(cpuZuProzent(1)).toBe(100)
    expect(cpuZuProzent(2)).toBe(200)
    expect(cpuZuProzent(150)).toBe(150)
    expect(formatCpuLabel(1, 'de')).toBe('1 Kern (100 %)')
    expect(formatCpuLabel(150, 'de')).toBe('1,5 Kerne (150 %)')
    expect(formatCpuLabel(150, 'en')).toBe('1.5 Cores (150 %)')
  })

  it('wendet den Laufzeitrabatt auf die Gesamtsumme an', () => {
    const basis = preisAufschluesselung(palworld, standardKonfiguration(palworld))
    const jahr = preisAufschluesselung(palworld, {
      ...standardKonfiguration(palworld),
      laufzeitMonate: 12,
    })
    expect(jahr.rabattProzent).toBe(RABATT_PROZENT[12])
    expect(jahr.gesamtCent).toBe(Math.round(basis.monatCent * 12 * 0.8))
  })

  it('formatiert Euro deutsch', () => {
    expect(formatEuro(699)).toContain('6,99')
  })
})
