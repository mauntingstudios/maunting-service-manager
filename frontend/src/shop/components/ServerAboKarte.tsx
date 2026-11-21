import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Spinner, Zustandsflaeche } from '@maunting/ui'
import { shopOrderApi, type ShopServerSubscriptionDto } from '@/api/shop'
import { formatEuro } from '../preis'

interface ServerAboKarteProps {
  serverId: number
}

export function ServerAboKarte({ serverId }: ServerAboKarteProps) {
  const { t } = useTranslation()
  const [daten, setDaten] = useState<ShopServerSubscriptionDto | null>(null)
  const [laedt, setLaedt] = useState(true)
  const [fehler, setFehler] = useState(false)

  useEffect(() => {
    let aktiv = true
    setLaedt(true)
    setFehler(false)
    void shopOrderApi
      .getServerSubscription(serverId)
      .then((res) => {
        if (!aktiv) return
        setDaten(res)
        setLaedt(false)
      })
      .catch(() => {
        if (!aktiv) return
        setFehler(true)
        setLaedt(false)
      })
    return () => {
      aktiv = false
    }
  }, [serverId])

  if (laedt) {
    return (
      <section className="msm-card flex items-center gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
        <Spinner size="sm" />
        <span className="text-sm text-on-surface-variant">{t('shop.konto.laedt')}</span>
      </section>
    )
  }

  if (fehler) {
    return (
      <Zustandsflaeche
        art="fehler"
        titel={t('shop.serverAbo.titel')}
        text={t('shop.serverAbo.ladefehler')}
      />
    )
  }

  if (!daten || !daten.has_subscription) {
    return (
      <Zustandsflaeche
        art="leer"
        titel={t('shop.serverAbo.keinesTitel')}
        text={t('shop.serverAbo.keinesText')}
      />
    )
  }

  const abo = daten.subscription
  const ent = daten.entitlement
  const status = abo?.status ?? ent?.status ?? 'active'

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
        <div className="flex flex-wrap items-center gap-2">
          {abo?.cancel_at_period_end && abo.status !== 'cancelled' && (
            <Badge variant="warning">{t('shop.konto.abos.kuendigungVorgemerkt')}</Badge>
          )}
          <Badge
            variant={
              status === 'active'
                ? 'success'
                : status === 'past_due' || status === 'suspended'
                  ? 'warning'
                  : 'default'
            }
          >
            {status === 'active'
              ? t('shop.konto.status.aboActive')
              : status === 'past_due'
                ? t('shop.konto.status.aboPastDue')
                : status === 'suspended'
                  ? t('shop.konto.status.entitlementSuspended')
                  : t('shop.konto.status.aboCancelled')}
          </Badge>
        </div>
      </div>

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">{t('shop.serverAbo.tarif')}</dt>
          <dd className="mt-1 text-sm font-semibold text-on-surface">
            {abo?.name ?? ent?.label ?? t('shop.serverAbo.tarifName')}
          </dd>
        </div>
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">{t('shop.serverAbo.ressourcen')}</dt>
          <dd className="mt-1 text-sm font-semibold text-on-surface">
            {daten.ram_mb ? `${Math.round(daten.ram_mb / 1024)} GB RAM` : '—'}
            {daten.slots ? ` · ${daten.slots} Slots` : ''}
          </dd>
        </div>
        <div className="rounded-xl border border-outline-variant/30 bg-surface-container p-3">
          <dt className="text-xs text-on-surface-variant">{t('shop.serverAbo.naechsteZahlung')}</dt>
          <dd className="mt-1 text-sm font-semibold text-on-surface">
            {abo
              ? `${abo.current_period_end.slice(0, 10)} · ${formatEuro(abo.monthly_gross_cents)}`
              : '—'}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        <Link
          to="/konto/abos"
          className="inline-flex min-h-9 items-center rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
        >
          {t('shop.serverAbo.aboAnsehen')}
        </Link>
        <Link
          to="/konto/rechnungen"
          className="inline-flex min-h-9 items-center rounded-lg border border-outline-variant/40 px-3 text-sm font-semibold text-on-surface hover:bg-surface-container-high"
        >
          {t('shop.konto.nav.rechnungen')}
        </Link>
      </div>
    </section>
  )
}
