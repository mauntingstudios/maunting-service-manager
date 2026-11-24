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

export function cpuZuProzent(wert: number): number {
  if (!Number.isFinite(wert) || wert <= 0) return 0
  return wert <= 32 ? Math.round(wert * 100) : Math.round(wert)
}

export function formatCpuLabel(wert: number, sprache: 'de' | 'en' = 'de'): string {
  const prozent = cpuZuProzent(wert)
  if (prozent <= 0) return '—'
  const kerne = prozent / 100
  const kerneText = kerne.toLocaleString(sprache === 'de' ? 'de-DE' : 'en-US', {
    maximumFractionDigits: 2,
  })
  const einheit =
    sprache === 'de'
      ? kerne === 1
        ? 'Kern'
        : 'Kerne'
      : kerne === 1
        ? 'Core'
        : 'Cores'
  return `${kerneText} ${einheit} (${prozent} %)`
}

export function preisAufschluesselung(
  spiel: ShopSpiel,
  konfiguration: Konfiguration,
  aboRabattProzent = 0,
): PreisAufschluesselung {
  const ramStep = spiel.ramStepGb && spiel.ramStepGb > 0 ? spiel.ramStepGb : 1
  const cpuStep = spiel.cpuStep && spiel.cpuStep > 0 ? spiel.cpuStep : 1
  const slotStep = spiel.slotStep && spiel.slotStep > 0 ? spiel.slotStep : 1
  const ramCent =
    Math.floor(Math.max(0, konfiguration.ramGb - spiel.standardRamGb) / ramStep) *
    spiel.preisProGbCent
  const cpuCent =
    Math.floor(Math.max(0, konfiguration.cpu - spiel.standardCpu) / cpuStep) *
    spiel.preisProKernCent
  const slotsCent =
    Math.floor(Math.max(0, konfiguration.slots - spiel.standardSlots) / slotStep) *
    spiel.preisProSlotCent
  const kiCent = konfiguration.kiZugang ? spiel.kiZugangCent : 0
  const standortCent = Math.max(0, Math.round(konfiguration.standortAufpreisCent ?? 0))
  const monatCent =
    spiel.grundpreisCent + ramCent + cpuCent + slotsCent + kiCent + standortCent
  const modus = konfiguration.abrechnungsModus ?? 'prepaid'
  const lifetimeBasis = spiel.lifetimePreisCent ?? null
  if (modus === 'lifetime' && lifetimeBasis !== null && lifetimeBasis > 0) {
    const gesamtCent =
      lifetimeBasis + Math.max(0, monatCent - spiel.grundpreisCent) * 12
    return {
      grundpreisCent: spiel.grundpreisCent,
      ramCent,
      cpuCent,
      slotsCent,
      kiCent,
      standortCent,
      monatCent,
      rabattProzent: 0,
      gesamtCent,
    }
  }
  let rabattProzent = RABATT_PROZENT[konfiguration.laufzeitMonate]
  if (modus === 'subscription' && konfiguration.laufzeitMonate === 1 && aboRabattProzent > 0) {
    rabattProzent = Math.min(50, rabattProzent + aboRabattProzent)
  }
  const gesamtCent = Math.round(
    monatCent * konfiguration.laufzeitMonate * (1 - rabattProzent / 100),
  )
  return {
    grundpreisCent: spiel.grundpreisCent,
    ramCent,
    cpuCent,
    slotsCent,
    kiCent,
    standortCent,
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
