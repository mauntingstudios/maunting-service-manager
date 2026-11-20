import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Zustandsflaeche } from '@maunting/ui'
import { shopApi } from '../../api/shopApi'
import type { Entitlement, Subscription } from '../../api/types'
import { formatEuro } from '../../preis'

export function KontoAbos() {
  const { t } = useTranslation()
  const [abos, setAbos] = useState<{ subscriptions: Subscription[]; entitlements: Entitlement[] } | null>(null)

  useEffect(() => {
    let aktiv = true
    void Promise.all([shopApi.listSubscriptions(), shopApi.listEntitlements()]).then(
      ([subscriptions, entitlements]) => {
        if (aktiv) setAbos({ subscriptions, entitlements })
      },
    )
    return () => {
      aktiv = false
    }
  }, [])

  if (abos === null) {
    return <p className="text-sm text-on-surface-variant">{t('shop.konto.laedt')}</p>
  }

  if (abos.subscriptions.length === 0 && abos.entitlements.length === 0) {
    return (
      <Zustandsflaeche
        art="leer"
        titel={t('shop.konto.abos.leer')}
        text={t('shop.konto.abos.leerText')}
      />
    )
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <h2 className="font-headline text-lg font-bold text-on-surface">
          {t('shop.konto.abos.titel')}
        </h2>
        {abos.subscriptions.map((abo) => (
          <div
            key={abo.id}
            className="msm-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
          >
            <div>
              <p className="font-headline text-sm font-semibold text-on-surface">{abo.bezeichnung}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {t('shop.konto.abos.naechsteZahlung', { datum: abo.naechsteZahlung })}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={abo.status === 'active' ? 'success' : abo.status === 'past_due' ? 'warning' : 'default'}>
                {abo.status === 'active'
                  ? t('shop.konto.status.aboActive')
                  : abo.status === 'past_due'
                    ? t('shop.konto.status.aboPastDue')
                    : t('shop.konto.status.aboCancelled')}
              </Badge>
              <span className="font-headline text-sm font-bold tabular-nums text-primary">
                {formatEuro(abo.preisCent)}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <h2 className="font-headline text-lg font-bold text-on-surface">
          {t('shop.konto.abos.entitlements')}
        </h2>
        {abos.entitlements.map((entitlement) => (
          <div
            key={entitlement.id}
            className="msm-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
          >
            <div>
              <p className="font-headline text-sm font-semibold text-on-surface">
                {entitlement.bezeichnung}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {entitlement.art === 'server'
                  ? t('shop.konto.abos.artServer')
                  : entitlement.art === 'rolle'
                    ? t('shop.konto.abos.artRolle')
                    : t('shop.konto.abos.artAddon')}
              </p>
            </div>
            <Badge variant={entitlement.status === 'active' ? 'success' : 'warning'}>
              {entitlement.status === 'active'
                ? t('shop.konto.status.entitlementActive')
                : t('shop.konto.status.entitlementSuspended')}
            </Badge>
          </div>
        ))}
      </div>
    </div>
  )
}
