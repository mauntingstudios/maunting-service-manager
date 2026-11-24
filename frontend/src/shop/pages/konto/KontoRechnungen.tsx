import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { FileText } from 'lucide-react'
import { Badge, Dropdown, type DropdownOption, Zustandsflaeche } from '@maunting/ui'
import { shopInvoiceApi, type ShopInvoiceSummaryDto } from '@/api/shop'
import { formatEuro } from '../../preis'

type RechnungsTypFilter = 'all' | 'invoice' | 'credit_note'

export function KontoRechnungen() {
  const { t, i18n } = useTranslation()
  const [invoices, setInvoices] = useState<ShopInvoiceSummaryDto[] | null>(null)
  const [typFilter, setTypFilter] = useState<RechnungsTypFilter>('all')
  const [jahrFilter, setJahrFilter] = useState<string>('all')
  const datumLocale = i18n.language.startsWith('en') ? 'en-US' : 'de-DE'

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

  const jahre = useMemo(() => {
    if (!invoices) return []
    return Array.from(
      new Set(invoices.map((inv) => inv.issued_at.slice(0, 4)).filter(Boolean)),
    ).sort((a, b) => b.localeCompare(a))
  }, [invoices])

  const jahrOptionen: DropdownOption[] = useMemo(
    () => [
      { value: 'all', label: t('shop.konto.rechnungen.jahrAlle') },
      ...jahre.map((jahr) => ({ value: jahr, label: jahr })),
    ],
    [jahre, t],
  )

  const gefiltert = useMemo(() => {
    if (!invoices) return []
    return invoices.filter((invoice) => {
      if (typFilter !== 'all' && invoice.type !== typFilter) return false
      if (jahrFilter !== 'all' && !invoice.issued_at.startsWith(jahrFilter)) return false
      return true
    })
  }, [invoices, typFilter, jahrFilter])

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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-headline text-lg font-bold text-on-surface">
          {t('shop.konto.rechnungen.titel')}
        </h2>
        <Badge variant="info">{t('shop.konto.rechnungen.kontextBadge')}</Badge>
      </div>
      <p className="text-xs text-on-surface-variant">
        {t('shop.konto.rechnungen.xrechnungHinweis')}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('shop.konto.rechnungen.titel')}>
          {(
            [
              { id: 'all' as const, label: t('shop.konto.rechnungen.filterAlle') },
              { id: 'invoice' as const, label: t('shop.konto.rechnungen.filterRechnungen') },
              { id: 'credit_note' as const, label: t('shop.konto.rechnungen.filterGutschriften') },
            ]
          ).map((pill) => {
            const aktiv = typFilter === pill.id
            return (
              <button
                key={pill.id}
                type="button"
                aria-pressed={aktiv}
                onClick={() => setTypFilter(pill.id)}
                className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                  aktiv
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-outline-variant/40 bg-surface-container text-on-surface-variant hover:text-on-surface'
                }`}
              >
                {pill.label}
              </button>
            )
          })}
        </div>

        {jahre.length > 1 && (
          <Dropdown
            id="rechnungen-jahr-filter"
            value={jahrFilter}
            onChange={setJahrFilter}
            options={jahrOptionen}
            className="w-40"
            aria-label={t('shop.konto.rechnungen.jahrLabel')}
          />
        )}
      </div>

      {gefiltert.length === 0 ? (
        <p className="py-8 text-center text-sm text-on-surface-variant">
          {t('shop.konto.rechnungen.leer')}
        </p>
      ) : (
        gefiltert.map((invoice) => (
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
                    datum: new Date(invoice.issued_at).toLocaleDateString(datumLocale),
                  })}
                  {' · '}
                  {t('shop.konto.rechnungen.faellig', { datum: invoice.due_date })}
                </p>
              </div>
              <div className="flex items-center gap-3">
                {invoice.type === 'credit_note' ? (
                  <Badge variant="info">{t('shop.konto.rechnungen.gutschrift')}</Badge>
                ) : (
                  <>
                    <Badge variant="default">{t('shop.konto.rechnungen.typRechnung')}</Badge>
                    <Badge variant={invoice.status === 'issued' ? 'success' : 'default'}>
                      {invoice.status === 'issued'
                        ? t('shop.konto.status.invoicePaid')
                        : t('shop.konto.status.invoiceVoid')}
                    </Badge>
                  </>
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
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
              {invoice.order_id && invoice.order_number && (
                <Link
                  to={`/konto/bestellungen/${invoice.order_id}`}
                  className="ml-auto text-xs font-semibold text-on-surface-variant hover:text-primary hover:underline"
                >
                  {t('shop.konto.rechnungen.zurBestellung', { nummer: invoice.order_number })}
                </Link>
              )}
            </div>
          </div>
        ))
      )}
    </div>
  )
}
