import type { ShopPublicPolicyDto, ShopShortDurationTierDto } from '@/api/shop'
import type {
  Konfiguration,
  LaufzeitMonate,
  LaufzeitTage,
  PreisAufschluesselung,
  ShopSpiel,
} from './typen'

export const RABATT_PROZENT: Record<LaufzeitMonate, number> = {
  1: 0,
  3: 5,
  12: 20,
}

export function kurzzeitPreisCent(
  monatCent: number,
  tier: Pick<ShopShortDurationTierDto, 'price_factor_percent' | 'min_price_cents'>,
): number {
  const anteil = Math.floor((Math.round(monatCent) * tier.price_factor_percent + 50) / 100)
  return Math.max(tier.min_price_cents, anteil)
}

export function aktiveKurzzeitStufen(
  spiel: Pick<ShopSpiel, 'allowShortDurations'>,
  policy?: Pick<
    ShopPublicPolicyDto,
    'shop_short_durations_enabled' | 'shop_short_duration_tiers'
  > | null,
): ShopShortDurationTierDto[] {
  if (!policy?.shop_short_durations_enabled || spiel.allowShortDurations === false) {
    return []
  }
  return (policy.shop_short_duration_tiers ?? [])
    .filter((tier) => tier.enabled)
    .sort((a, b) => a.days - b.days)
}

export function niedrigsterEinstiegsPreis(
  spiel: ShopSpiel,
  policy?: Pick<
    ShopPublicPolicyDto,
    'shop_short_durations_enabled' | 'shop_short_duration_tiers'
  > | null,
): { cent: number; tage: LaufzeitTage | null } {
  const stufen = aktiveKurzzeitStufen(spiel, policy)
  if (stufen.length === 0) {
    return { cent: spiel.grundpreisCent, tage: null }
  }
  let bester = {
    cent: kurzzeitPreisCent(spiel.grundpreisCent, stufen[0]),
    tage: stufen[0].days as LaufzeitTage,
  }
  for (const tier of stufen.slice(1)) {
    const wert = kurzzeitPreisCent(spiel.grundpreisCent, tier)
    if (wert < bester.cent) {
      bester = { cent: wert, tage: tier.days as LaufzeitTage }
    }
  }
  return bester
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
  shortDurationTiers: ShopShortDurationTierDto[] = [],
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
  const tage = konfiguration.laufzeitTage ?? null
  if (modus === 'prepaid' && tage != null && spiel.allowShortDurations !== false) {
    const tier = shortDurationTiers.find((t) => t.enabled && t.days === tage)
    if (tier) {
      return {
        grundpreisCent: spiel.grundpreisCent,
        ramCent,
        cpuCent,
        slotsCent,
        kiCent,
        standortCent,
        monatCent,
        rabattProzent: 0,
        gesamtCent: kurzzeitPreisCent(monatCent, tier),
      }
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

const ganzzahlFormat = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 0,
})

export function zerlegeEuro(cent: number): { euro: string; cent: string } {
  const sicher = Math.max(0, Math.round(cent))
  const euroTeil = Math.floor(sicher / 100)
  const centTeil = sicher % 100
  return {
    euro: ganzzahlFormat.format(euroTeil),
    cent: String(centTeil).padStart(2, '0'),
  }
}
