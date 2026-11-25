import { describe, expect, it } from 'vitest'
import {
  cpuZuProzent,
  formatCpuLabel,
  formatEuro,
  kurzzeitPreisCent,
  niedrigsterEinstiegsPreis,
  preisAufschluesselung,
  RABATT_PROZENT,
} from './preis'
import type { ShopShortDurationTierDto } from '@/api/shop'
import { standardKonfiguration, type ShopSpiel } from './typen'

const palworld: ShopSpiel = {
  id: 'palworld',
  name: 'Palworld',
  game: 'palworld',
  category: 'Survival',
  beschreibung: {
    de: 'Offene Welt mit Sammeln, Bauen und Kaempfen.',
    en: 'Open world with collecting, building and fighting.',
  },
  tags: ['Survival', 'Open World', 'Koop'],
  unterstuetztMods: true,
  unterstuetztWorkshop: true,
  motiv: 'dschungel',
  bildUrl: 'https://cdn.cloudflare.steamstatic.com/steam/apps/1623730/header.jpg',
  grundpreisCent: 699,
  ramStufenGb: [4, 8, 12, 16, 24],
  standardRamGb: 8,
  preisProGbCent: 90,
  cpuStufen: [1, 2, 4, 6],
  standardCpu: 2,
  preisProKernCent: 150,
  slotStufen: [4, 8, 16, 32],
  standardSlots: 8,
  preisProSlotCent: 30,
  kiZugangCent: 499,
}

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

  it('rechnet den Standort-Aufpreis vor Rabatten und Lifetime-Faktor ein', () => {
    const monatsPreis = preisAufschluesselung(palworld, {
      ...standardKonfiguration(palworld),
      standortAufpreisCent: 350,
    })
    expect(monatsPreis.standortCent).toBe(350)
    expect(monatsPreis.monatCent).toBe(palworld.grundpreisCent + 350)
    expect(monatsPreis.gesamtCent).toBe(palworld.grundpreisCent + 350)

    const jahresPreis = preisAufschluesselung(palworld, {
      ...standardKonfiguration(palworld),
      laufzeitMonate: 12,
      standortAufpreisCent: 350,
    })
    expect(jahresPreis.gesamtCent).toBe(Math.round((palworld.grundpreisCent + 350) * 12 * 0.8))

    const lifetimeTarif = { ...palworld, lifetimePreisCent: 10000 }
    const lifetimePreis = preisAufschluesselung(lifetimeTarif, {
      ...standardKonfiguration(lifetimeTarif),
      abrechnungsModus: 'lifetime',
      standortAufpreisCent: 350,
    })
    expect(lifetimePreis.gesamtCent).toBe(10000 + 350 * 12)
  })

  it('berechnet Kurzzeit-Laufzeiten mit Mindestpreis und Einstiegspreis', () => {
    const stufen: ShopShortDurationTierDto[] = [
      { days: 3, enabled: true, price_factor_percent: 25, min_price_cents: 199 },
      { days: 7, enabled: true, price_factor_percent: 40, min_price_cents: 299 },
      { days: 14, enabled: false, price_factor_percent: 65, min_price_cents: 499 },
    ]
    // 25% von 999 = 249.75 -> half-up 250; 25% von 500 = 125 -> Mindestpreis 199
    expect(kurzzeitPreisCent(999, stufen[0])).toBe(250)
    expect(kurzzeitPreisCent(500, stufen[0])).toBe(199)

    const ergebnis = preisAufschluesselung(
      { ...palworld, grundpreisCent: 1000, allowShortDurations: true },
      { ...standardKonfiguration(palworld), abrechnungsModus: 'prepaid', laufzeitTage: 7 },
      0,
      stufen,
    )
    expect(ergebnis.gesamtCent).toBe(400)

    const einstieg = niedrigsterEinstiegsPreis(
      { ...palworld, grundpreisCent: 1000, allowShortDurations: true },
      { shop_short_durations_enabled: true, shop_short_duration_tiers: stufen },
    )
    expect(einstieg).toEqual({ cent: 250, tage: 3 })

    const deaktiviert = niedrigsterEinstiegsPreis(
      { ...palworld, grundpreisCent: 1000, allowShortDurations: false },
      { shop_short_durations_enabled: true, shop_short_duration_tiers: stufen },
    )
    expect(deaktiviert).toEqual({ cent: 1000, tage: null })
  })

  it('rechnet konfigurierbaren Festplattenspeicher in Schritten dazu', () => {
    const tarif = {
      ...palworld,
      standardDiskGb: 25,
      diskStufenGb: [25, 35, 45],
      diskStepGb: 10,
      preisProDiskSchrittCent: 150,
    }
    const preis = preisAufschluesselung(tarif, {
      ...standardKonfiguration(tarif),
      diskGb: 45,
    })
    expect(preis.diskCent).toBe(300)
    expect(preis.monatCent).toBe(tarif.grundpreisCent + 300)
  })
})
