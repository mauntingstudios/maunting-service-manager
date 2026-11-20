import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge, Zustandsflaeche } from '@maunting/ui'
import { shopApi } from '../../api/shopApi'
import type { Invoice } from '../../api/types'
import { INVOICE_STATUS_KEY, INVOICE_STATUS_VARIANT } from '../../kontoStatus'
import { formatEuro } from '../../preis'

export function KontoRechnungen() {
  const { t } = useTranslation()
  const [invoices, setInvoices] = useState<Invoice[] | null>(null)

  useEffect(() => {
    let aktiv = true
    void shopApi.listInvoices().then((rows) => {
      if (aktiv) setInvoices(rows)
    })
    return () => {
      aktiv = false
    }
  }, [])

  if (invoices === null) {
    return <p className="text-sm text-on-surface-variant">{t('shop.konto.laedt')}</p>
  }

  if (invoices.length === 0) {
    return (
      <Zustandsflaeche
        art="leer"
        titel={t('shop.konto.rechnungen.leer')}
        text={t('shop.konto.rechnungen.leerText')}
      />
    )
  }

  return (
    <div className="space-y-3">
      <h2 className="font-headline text-lg font-bold text-on-surface">
        {t('shop.konto.rechnungen.titel')}
      </h2>
      {invoices.map((invoice) => (
        <div
          key={invoice.id}
          className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-headline text-sm font-semibold text-on-surface">{invoice.nummer}</p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {invoice.datum} · {invoice.leistungszeitraum}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant={INVOICE_STATUS_VARIANT[invoice.status]}>
                {t(INVOICE_STATUS_KEY[invoice.status])}
              </Badge>
              <span className="font-headline text-sm font-bold tabular-nums text-primary">
                {formatEuro(invoice.bruttoCent)}
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs text-on-surface-variant">
            {t('shop.konto.rechnungen.pdfFolgt')}
          </p>
        </div>
      ))}
    </div>
  )
}
