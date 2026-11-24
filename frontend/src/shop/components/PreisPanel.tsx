import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'
import { Button } from '@maunting/ui'
import type { ShopShortDurationTierDto } from '@/api/shop'
import { formatEuro, preisAufschluesselung } from '../preis'
import type { Konfiguration, ShopSpiel } from '../typen'
import { PreisAuszeichnung } from './PreisAuszeichnung'

interface PreisPanelProps {
  spiel: ShopSpiel
  konfiguration: Konfiguration
  onWeiter?: () => void
  verfuegbar?: boolean
  aboRabattProzent?: number
  shortDurationTiers?: ShopShortDurationTierDto[]
  erstattungTage?: number
  erstattungHinweis?: string
}

export function PreisPanel({
  spiel,
  konfiguration,
  onWeiter,
  verfuegbar = true,
  aboRabattProzent = 0,
  shortDurationTiers = [],
  erstattungTage = 0,
  erstattungHinweis = '',
}: PreisPanelProps) {
  const { t } = useTranslation()
  const preis = preisAufschluesselung(spiel, konfiguration, aboRabattProzent, shortDurationTiers)
  const istLifetime =
    (konfiguration.abrechnungsModus ?? 'prepaid') === 'lifetime' &&
    (spiel.lifetimePreisCent ?? 0) > 0
  const gewaehlteTage =
    (konfiguration.abrechnungsModus ?? 'prepaid') === 'prepaid' &&
    konfiguration.laufzeitTage != null &&
    shortDurationTiers.some((tier) => tier.enabled && tier.days === konfiguration.laufzeitTage)
      ? konfiguration.laufzeitTage
      : null

  const zeilen = [
    { label: t('shop.preis.grundpreis'), cent: preis.grundpreisCent },
    { label: t('shop.preis.ram'), cent: preis.ramCent },
    { label: t('shop.preis.cpu'), cent: preis.cpuCent },
    { label: t('shop.preis.slots'), cent: preis.slotsCent },
    { label: t('shop.preis.standortAufpreis'), cent: preis.standortCent },
    { label: t('shop.preis.ki'), cent: preis.kiCent },
  ].filter((zeile) => zeile.cent > 0)

  return (
    <aside className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/90 p-5 lg:sticky lg:top-24">
      <div>
        <h2 className="font-headline text-lg font-bold text-on-surface">
          {t('shop.kasse.zusammenfassung')}
        </h2>
        <p className="mt-1 text-sm text-on-surface-variant">{spiel.name}</p>
        {konfiguration.standortName && (
          <p className="mt-1 text-xs font-medium text-on-surface-variant">
            {t('shop.kasse.standort')}: <span className="text-on-surface">{konfiguration.standortName}</span>
          </p>
        )}
      </div>

      <dl className="space-y-2 text-sm">
        {zeilen.map((zeile) => (
          <div key={zeile.label} className="flex items-center justify-between gap-3">
            <dt className="text-on-surface-variant">{zeile.label}</dt>
            <dd className="tabular-nums text-on-surface">{formatEuro(zeile.cent)}</dd>
          </div>
        ))}
      </dl>

      {preis.rabattProzent > 0 && (
        <p className="rounded-lg border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
          {(konfiguration.abrechnungsModus ?? 'prepaid') === 'subscription' && aboRabattProzent > 0
            ? t('shop.preis.aboRabatt', { prozent: preis.rabattProzent })
            : t('shop.preis.rabatt', { prozent: preis.rabattProzent })}
        </p>
      )}

      <div className="border-t border-outline-variant/30 pt-3" aria-live="polite">
        <div className="flex items-center justify-between gap-3 text-sm text-on-surface-variant">
          <span>
            {istLifetime
              ? t('shop.spiel.lifetimeTitel')
              : gewaehlteTage != null
                ? t('shop.preis.kurzzeitPrepaid', { tage: gewaehlteTage })
                : t('shop.preis.monat')}
          </span>
          <span className="tabular-nums">
            {istLifetime ? t('shop.preis.einmalig') : formatEuro(preis.monatCent)}
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <span className="text-sm font-semibold text-on-surface">
            {t('shop.preis.gesamt')}
          </span>
          <PreisAuszeichnung variant="panel" cent={preis.gesamtCent} />
        </div>
        <p className="mt-1 text-right text-label-sm text-on-surface-variant">
          {istLifetime ? t('shop.preis.keineFolgekosten') : t('shop.preis.inklusiveSteuer')}
        </p>
      </div>

      {!verfuegbar && (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-xl border border-status-warning/40 bg-status-warning/10 p-3 text-xs text-status-warning"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div className="space-y-0.5">
            <p className="font-semibold">{t('shop.spiel.ausverkauftTitel')}</p>
            <p className="text-on-surface-variant">{t('shop.spiel.ausverkauftText')}</p>
          </div>
        </div>
      )}

      {onWeiter && (
        <Button
          variant="primary"
          size="lg"
          className="w-full"
          disabled={!verfuegbar}
          onClick={onWeiter}
        >
          {verfuegbar
            ? t('shop.spiel.weiterKasse')
            : t('shop.spiel.keineKapazitaetButton')}
        </Button>
      )}

      <p className="text-center text-label-sm leading-relaxed text-on-surface-variant">
        {t('shop.spiel.stripeHinweis')}
      </p>

      <div className="space-y-1 border-t border-outline-variant/25 pt-3 text-label-sm leading-relaxed text-on-surface-variant">
        <p>
          {(konfiguration.abrechnungsModus ?? 'prepaid') === 'prepaid'
            ? t('shop.kasse.prepaidHinweis')
            : t('shop.kasse.aboHinweis')}
        </p>
        {spiel.geschaetzteSetupSekunden != null && spiel.geschaetzteSetupSekunden > 0 && (
          <p>{t('shop.spiel.setupDauer', { sekunden: spiel.geschaetzteSetupSekunden })}</p>
        )}
        <p>{t('shop.spiel.datensicherheitHinweis')}</p>
        {erstattungTage > 0 && (
          <p className="text-on-surface">
            {t('shop.spiel.erstattungGarantie', { tage: erstattungTage })}
            {erstattungHinweis ? ` ${erstattungHinweis}` : ''}
          </p>
        )}
      </div>
    </aside>
  )
}
