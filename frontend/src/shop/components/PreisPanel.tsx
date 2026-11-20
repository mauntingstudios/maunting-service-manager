import { useTranslation } from 'react-i18next'
import { Button } from '@maunting/ui'
import { formatEuro, preisAufschluesselung } from '../preis'
import type { Konfiguration, ShopSpiel } from '../typen'

interface PreisPanelProps {
  spiel: ShopSpiel
  konfiguration: Konfiguration
  onWeiter?: () => void
}

export function PreisPanel({ spiel, konfiguration, onWeiter }: PreisPanelProps) {
  const { t } = useTranslation()
  const preis = preisAufschluesselung(spiel, konfiguration)

  const zeilen = [
    { label: t('shop.preis.grundpreis'), cent: preis.grundpreisCent },
    { label: t('shop.preis.ram'), cent: preis.ramCent },
    { label: t('shop.preis.cpu'), cent: preis.cpuCent },
    { label: t('shop.preis.slots'), cent: preis.slotsCent },
    { label: t('shop.preis.ki'), cent: preis.kiCent },
  ].filter((zeile) => zeile.cent > 0)

  return (
    <aside className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/90 p-5 lg:sticky lg:top-24">
      <div>
        <h2 className="font-headline text-lg font-bold text-on-surface">
          {t('shop.kasse.zusammenfassung')}
        </h2>
        <p className="mt-1 text-sm text-on-surface-variant">{spiel.name}</p>
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
          {t('shop.preis.rabatt', { prozent: preis.rabattProzent })}
        </p>
      )}

      <div className="border-t border-outline-variant/30 pt-3" aria-live="polite">
        <div className="flex items-center justify-between gap-3 text-sm text-on-surface-variant">
          <span>{t('shop.preis.monat')}</span>
          <span className="tabular-nums">{formatEuro(preis.monatCent)}</span>
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <span className="text-sm font-semibold text-on-surface">
            {t('shop.preis.gesamt')}
          </span>
          <span className="font-headline text-2xl font-extrabold tabular-nums text-primary">
            {formatEuro(preis.gesamtCent)}
          </span>
        </div>
        <p className="mt-1 text-right text-label-sm text-on-surface-variant">
          {t('shop.preis.inklusiveSteuer')}
        </p>
      </div>

      {onWeiter && (
        <Button variant="primary" size="lg" className="w-full" onClick={onWeiter}>
          {t('shop.spiel.weiterKasse')}
        </Button>
      )}

      <p className="text-center text-label-sm leading-relaxed text-on-surface-variant">
        {t('shop.spiel.demoHinweis')}
      </p>
    </aside>
  )
}
