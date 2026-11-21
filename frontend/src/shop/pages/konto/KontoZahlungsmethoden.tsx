import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { CreditCard } from 'lucide-react'

export function KontoZahlungsmethoden() {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <h2 className="font-headline text-lg font-bold text-on-surface">
        {t('shop.konto.zahlungsmethoden.titel')}
      </h2>
      <section className="msm-card space-y-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
            <CreditCard className="h-4 w-4" aria-hidden="true" />
          </span>
          <p className="font-headline text-sm font-semibold text-on-surface">
            {t('shop.konto.zahlungsmethoden.stripeTitel')}
          </p>
        </div>
        <p className="text-sm leading-relaxed text-on-surface-variant">
          {t('shop.konto.zahlungsmethoden.stripeHinweis')}
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link
            to="/konto/abos"
            className="inline-flex min-h-9 items-center rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
          >
            {t('shop.konto.nav.abos')}
          </Link>
          <Link
            to="/konto/rechnungen"
            className="inline-flex min-h-9 items-center rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
          >
            {t('shop.konto.nav.rechnungen')}
          </Link>
        </div>
      </section>
    </div>
  )
}
