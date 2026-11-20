import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Button } from '@maunting/ui'

interface ServerAboKarteProps {
  serverId: number
}

/**
 * Phase-1-Platzhalter im Serverdetail. Zeigt, wo Tarif, Slots, Upgrade und
 * Rechnungen spaeter wohnen; liest noch keine echten Bestelldaten.
 */
export function ServerAboKarte({ serverId }: ServerAboKarteProps) {
  const { t } = useTranslation()

  return (
    <section className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-headline text-lg font-bold text-on-surface">
            {t('shop.serverAbo.titel')}
          </h2>
          <p className="mt-1 text-sm text-on-surface-variant">
            {t('shop.serverAbo.untertitel', { id: serverId })}
          </p>
        </div>
        <Badge variant="warning">{t('shop.serverAbo.demo')}</Badge>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">{t('shop.serverAbo.tarif')}</dt>
          <dd className="mt-1 text-sm font-semibold text-on-surface">
            {t('shop.serverAbo.tarifName')}
          </dd>
        </div>
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">{t('shop.serverAbo.slots')}</dt>
          <dd className="mt-1 text-sm font-semibold text-on-surface">8</dd>
        </div>
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">{t('shop.serverAbo.naechsteZahlung')}</dt>
          <dd className="mt-1 text-sm font-semibold text-on-surface">—</dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled>
          {t('shop.serverAbo.upgrade')}
        </Button>
        <Link
          to="/konto/abos"
          className="inline-flex min-h-9 items-center rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
        >
          {t('shop.serverAbo.aboAnsehen')}
        </Link>
      </div>

      <p className="text-xs leading-relaxed text-on-surface-variant">
        {t('shop.serverAbo.hinweis')}
      </p>
    </section>
  )
}
