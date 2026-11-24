import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Badge, Zustandsflaeche } from '@maunting/ui'
import { shopApi } from '../../api/shopApi'
import type { Order } from '../../api/types'
import { ORDER_STATUS_KEY, ORDER_STATUS_VARIANT } from '../../kontoStatus'
import { formatEuro } from '../../preis'

export function KontoBestellungen() {
  const { t, i18n } = useTranslation()
  const [orders, setOrders] = useState<Order[] | null>(null)
  const datumLocale = i18n.language.startsWith('en') ? 'en-US' : 'de-DE'

  useEffect(() => {
    let aktiv = true
    void shopApi
      .listOrders()
      .then((rows) => {
        if (aktiv) setOrders(rows)
      })
      .catch(() => {
        if (aktiv) setOrders([])
      })
    return () => {
      aktiv = false
    }
  }, [])

  if (orders === null) {
    return <p className="text-sm text-on-surface-variant">{t('shop.konto.laedt')}</p>
  }

  if (orders.length === 0) {
    return (
      <Zustandsflaeche
        art="leer"
        titel={t('shop.konto.bestellungen.leer')}
        text={t('shop.konto.bestellungen.leerText')}
      />
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="font-headline text-lg font-bold text-on-surface">
        {t('shop.konto.bestellungen.titel')}
      </h2>
      {orders.map((order) => {
        const zusammenfassung = order.positionen.map((p) => p.bezeichnung).join(' · ')
        return (
          <Link
            key={order.id}
            to={`/konto/bestellungen/${order.id}`}
            className="msm-card block rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4 transition-colors hover:border-primary/40"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-headline text-sm font-semibold text-on-surface">{order.nummer}</p>
                  {order.positionen.length > 0 && (
                    <span className="text-xs text-on-surface-variant">
                      · {t('shop.konto.bestellungen.artikelAnzahl', { count: order.positionen.length })}
                    </span>
                  )}
                </div>
                {zusammenfassung && (
                  <p className="mt-1 truncate text-xs text-on-surface-variant">{zusammenfassung}</p>
                )}
                <p className="mt-1 text-xs text-on-surface-variant">
                  {t('shop.konto.bestellungen.datum', {
                    datum: new Date(order.erstelltAm).toLocaleDateString(datumLocale),
                  })}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                {(order.rabattProzent ?? 0) > 0 && (
                  <Badge variant="info">
                    {t('shop.konto.bestellungen.rabatt', { prozent: order.rabattProzent })}
                  </Badge>
                )}
                <Badge variant={ORDER_STATUS_VARIANT[order.status]}>
                  {t(ORDER_STATUS_KEY[order.status])}
                </Badge>
                <span className="font-headline text-sm font-bold tabular-nums text-primary">
                  {formatEuro(order.bruttoCent)}
                </span>
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
