import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { Badge, Zustandsflaeche } from '@maunting/ui'
import { shopInvoiceApi, type ShopInvoiceSummaryDto } from '@/api/shop'
import { formatEuro } from '../../preis'

export function KontoRechnungen() {
  const { t } = useTranslation()
  const [invoices, setInvoices] = useState<ShopInvoiceSummaryDto[] | null>(null)

  useEffect(() => {
    let aktiv = true
    void shopInvoiceApi
      .list()
      .then((rows) => {
        if (aktiv) setInvoices(rows)
      })
      .catch(() => {
        if (aktiv) setInvoices([])
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
      <p className="text-xs text-on-surface-variant">
        {t('shop.konto.rechnungen.xrechnungHinweis')}
      </p>
      {invoices.map((invoice) => (
        <div
          key={invoice.id}
          className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-headline text-sm font-semibold text-on-surface">
                {invoice.number}
              </p>
              <p className="mt-1 text-xs text-on-surface-variant">
                {t('shop.konto.rechnungen.datum', {
                  datum: new Date(invoice.issued_at).toLocaleDateString('de-DE'),
                })}
                {' · '}
                {t('shop.konto.rechnungen.faellig', { datum: invoice.due_date })}
              </p>
            </div>
            <div className="flex items-center gap-3">
              {invoice.type === 'credit_note' ? (
                <Badge variant="info">{t('shop.konto.rechnungen.gutschrift')}</Badge>
              ) : (
                <Badge variant={invoice.status === 'issued' ? 'success' : 'default'}>
                  {invoice.status === 'issued'
                    ? t('shop.konto.status.invoicePaid')
                    : t('shop.konto.status.invoiceVoid')}
                </Badge>
              )}
              <span className="font-headline text-sm font-bold tabular-nums text-primary">
                {invoice.type === 'credit_note' ? '−' : ''}
                {formatEuro(invoice.gross_cents)}
              </span>
            </div>
          </div>
          {invoice.type === 'credit_note' && invoice.reason && (
            <p className="mt-2 text-xs text-on-surface-variant">
              {t('shop.konto.rechnungen.grund', { grund: invoice.reason })}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <a
              href={shopInvoiceApi.pdfUrl(invoice.id)}
              download={`${invoice.number}.pdf`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-outline-variant/40 px-3 text-xs font-semibold text-on-surface hover:text-primary"
            >
              <FileText className="h-3.5 w-3.5" aria-hidden="true" />
              {t('shop.konto.rechnungen.pdf')}
            </a>
            <a
              href={shopInvoiceApi.xmlUrl(invoice.id)}
              download={`${invoice.number}.xml`}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-outline-variant/40 px-3 text-xs font-semibold text-on-surface hover:text-primary"
            >
              {t('shop.konto.rechnungen.xml')}
            </a>
          </div>
        </div>
      ))}
    </div>
  )
}
