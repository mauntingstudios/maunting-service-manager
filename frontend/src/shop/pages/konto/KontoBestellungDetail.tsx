import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ArrowLeft } from 'lucide-react'
import { Badge, Zustandsflaeche } from '@maunting/ui'
import { shopApi } from '../../api/shopApi'
import type { Order } from '../../api/types'
import { ORDER_STATUS_KEY, ORDER_STATUS_VARIANT } from '../../kontoStatus'
import { formatEuro } from '../../preis'

export function KontoBestellungDetail() {
  const { id } = useParams()
  const { t } = useTranslation()
  const [order, setOrder] = useState<Order | null | undefined>(undefined)

  useEffect(() => {
    let aktiv = true
    if (!id) {
      setOrder(null)
      return
    }
    void shopApi.getOrder(id).then((row) => {
      if (aktiv) setOrder(row ?? null)
    })
    return () => {
      aktiv = false
    }
  }, [id])

  if (order === undefined) {
    return <p className="text-sm text-on-surface-variant">{t('shop.konto.laedt')}</p>
  }

  if (order === null) {
    return (
      <div>
        <Zustandsflaeche
          art="fehler"
          titel={t('shop.konto.bestellung.nichtGefunden')}
          text={t('shop.konto.bestellung.nichtGefundenText')}
        />
        <div className="mt-4 text-center">
          <Link to="/konto/bestellungen" className="text-sm font-semibold text-primary hover:underline">
            {t('shop.konto.bestellung.zurueck')}
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Link
        to="/konto/bestellungen"
        className="inline-flex items-center gap-2 text-sm font-medium text-on-surface-variant hover:text-on-surface"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden="true" />
        {t('shop.konto.bestellung.zurueck')}
      </Link>

      <div className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-headline text-lg font-bold text-on-surface">{order.nummer}</h2>
            <p className="mt-1 text-xs text-on-surface-variant">
              {new Date(order.erstelltAm).toLocaleDateString('de-DE')}
            </p>
          </div>
          <Badge variant={ORDER_STATUS_VARIANT[order.status]}>
            {t(ORDER_STATUS_KEY[order.status])}
          </Badge>
        </div>

        <div className="mt-5 space-y-2">
          {order.positionen.map((position) => (
            <div
              key={position.id}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-outline-variant/20 pb-2 text-sm last:border-0"
            >
              <span className="text-on-surface">{position.bezeichnung}</span>
              <span className="text-on-surface-variant">
                {position.menge} × {formatEuro(position.einzelpreisCent)}
              </span>
              <span className="tabular-nums text-on-surface">{formatEuro(position.gesamtCent)}</span>
            </div>
          ))}
        </div>

        <dl className="mt-4 space-y-1 border-t border-outline-variant/30 pt-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-on-surface-variant">{t('shop.konto.bestellung.netto')}</dt>
            <dd className="tabular-nums text-on-surface">{formatEuro(order.nettoCent)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-on-surface-variant">{t('shop.konto.bestellung.steuer')}</dt>
            <dd className="tabular-nums text-on-surface">{formatEuro(order.steuerCent)}</dd>
          </div>
          <div className="flex justify-between gap-3 font-semibold">
            <dt className="text-on-surface">{t('shop.konto.bestellung.brutto')}</dt>
            <dd className="tabular-nums text-primary">{formatEuro(order.bruttoCent)}</dd>
          </div>
        </dl>

        {order.rechnungId && (
          <Link
            to="/konto/rechnungen"
            className="mt-4 inline-flex text-sm font-semibold text-primary hover:underline"
          >
            {t('shop.konto.bestellung.rechnung')}
          </Link>
        )}
      </div>
    </div>
  )
}
