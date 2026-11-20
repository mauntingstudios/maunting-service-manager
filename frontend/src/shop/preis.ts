import type {
  Konfiguration,
  LaufzeitMonate,
  PreisAufschluesselung,
  ShopSpiel,
} from './typen'

export const RABATT_PROZENT: Record<LaufzeitMonate, number> = {
  1: 0,
  3: 5,
  12: 20,
}

export function preisAufschluesselung(
  spiel: ShopSpiel,
  konfiguration: Konfiguration,
): PreisAufschluesselung {
  const ramCent =
    Math.max(0, konfiguration.ramGb - spiel.standardRamGb) * spiel.preisProGbCent
  const cpuCent =
    Math.max(0, konfiguration.cpu - spiel.standardCpu) * spiel.preisProKernCent
  const slotsCent =
    Math.max(0, konfiguration.slots - spiel.standardSlots) * spiel.preisProSlotCent
  const kiCent = konfiguration.kiZugang ? spiel.kiZugangCent : 0
  const monatCent = spiel.grundpreisCent + ramCent + cpuCent + slotsCent + kiCent
  const rabattProzent = RABATT_PROZENT[konfiguration.laufzeitMonate]
  const gesamtCent = Math.round(
    monatCent * konfiguration.laufzeitMonate * (1 - rabattProzent / 100),
  )
  return {
    grundpreisCent: spiel.grundpreisCent,
    ramCent,
    cpuCent,
    slotsCent,
    kiCent,
    monatCent,
    rabattProzent,
    gesamtCent,
  }
}

const euroFormat = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
})

export function formatEuro(cent: number): string {
  return euroFormat.format(cent / 100)
}
