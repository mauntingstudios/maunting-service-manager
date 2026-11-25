import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  ChevronDown,
  Download,
  ReceiptText,
  RefreshCw,
  ShoppingBag,
  Webhook,
} from 'lucide-react'
import {
  Badge,
  Button,
  Input,
  Spinner,
  Zustandsflaeche,
  buttonClasses,
} from '@maunting/ui'
import { SanitizedApiError } from '@/api/client'
import {
  shopAdminOpsApi,
  type ShopAdminOrderDto,
  type ShopInvoiceSummaryDto,
  type ShopPaymentEventDto,
  type ShopReconciliationDto,
  type ShopStatsResponse,
} from '@/api/shop'
import { formatEuro } from '@/shop/preis'
import { toast } from '@/stores/toastStore'

export type ShopSectionId = 'overview' | 'catalog' | 'orders' | 'accounting' | 'setup'

function orderStatusBadge(status: ShopAdminOrderDto['status']) {
  if (status === 'paid') return 'success' as const
  if (status === 'pending_payment') return 'warning' as const
  if (status === 'failed') return 'destructive' as const
  return 'default' as const
}

function orderStatusLabel(
  status: ShopAdminOrderDto['status'],
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return t(`settings.shop.betrieb.status.${status}`, { defaultValue: status })
}

function entitlementStatusLabel(
  status: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return t(`settings.shop.betrieb.freischaltung.${status}`, { defaultValue: status })
}

function entitlementKindLabel(
  kind: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  return t(`settings.shop.betrieb.freischaltungArt.${kind}`, { defaultValue: kind })
}

function entitlementErrorLabel(
  code: string,
  t: (key: string, opts?: Record<string, unknown>) => string,
): string {
  const translated = t(`settings.shop.betrieb.freischaltungFehler.${code}`, { defaultValue: '' })
  return translated && translated !== code ? `${translated} (${code})` : code
}

export function useShopBetriebData() {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<ShopAdminOrderDto[]>([])
  const [invoices, setInvoices] = useState<ShopInvoiceSummaryDto[]>([])
  const [webhooks, setWebhooks] = useState<ShopPaymentEventDto[]>([])
  const [stats, setStats] = useState<ShopStatsResponse | null>(null)
  const [laedt, setLaedt] = useState(true)
  const [reconcileBusy, setReconcileBusy] = useState(false)
  const [reconcileResult, setReconcileResult] = useState<ShopReconciliationDto | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const laden = useCallback(async () => {
    setLaedt(true)
    try {
      const [o, inv, wh, st] = await Promise.all([
        shopAdminOpsApi.listOrders(),
        shopAdminOpsApi.listInvoices(),
        shopAdminOpsApi.listWebhooks(),
        shopAdminOpsApi.getStats().catch(() => null),
      ])
      setOrders(Array.isArray(o) ? o : [])
      setInvoices(Array.isArray(inv) ? inv : [])
      setWebhooks(Array.isArray(wh) ? wh : [])
      setStats(st && typeof st.paid_orders === 'number' ? st : null)
    } catch {
      toast.error(t('settings.shop.betrieb.ladefehler'))
    } finally {
      setLaedt(false)
    }
  }, [t])

  useEffect(() => {
    void laden()
  }, [laden])

  const abgleichen = async () => {
    if (reconcileBusy) return
    setReconcileBusy(true)
    try {
      const res = await shopAdminOpsApi.reconcile()
      setReconcileResult(res)
      await laden()
      toast.success(t('settings.shop.betrieb.abgleichErfolg'))
    } catch (error) {
      toast.error(
        error instanceof SanitizedApiError
          ? error.message
          : t('settings.shop.betrieb.abgleichFehler'),
      )
    } finally {
      setReconcileBusy(false)
    }
  }

  const erstatten = async (orderId: number, reason: string): Promise<boolean> => {
    const grund = reason.trim()
    if (grund.length < 3) {
      toast.error(t('settings.shop.betrieb.grundKurz'))
      return false
    }
    setBusyId(`refund-${orderId}`)
    try {
      await shopAdminOpsApi.refundOrder(orderId, grund)
      await laden()
      toast.success(t('settings.shop.betrieb.refundErfolg'))
      return true
    } catch (error) {
      toast.error(
        error instanceof SanitizedApiError
          ? error.message
          : t('settings.shop.betrieb.refundFehler'),
      )
      return false
    } finally {
      setBusyId(null)
    }
  }

  const entitlementSyncen = async (entitlementId: number) => {
    setBusyId(`sync-${entitlementId}`)
    try {
      await shopAdminOpsApi.syncEntitlement(entitlementId)
      await laden()
      toast.success(t('settings.shop.betrieb.syncErfolg'))
    } catch (error) {
      toast.error(
        error instanceof SanitizedApiError
          ? error.message
          : t('settings.shop.betrieb.syncFehler'),
      )
    } finally {
      setBusyId(null)
    }
  }

  const gutschreiben = async (invoiceId: number, reason: string): Promise<boolean> => {
    const grund = reason.trim()
    if (grund.length < 3) {
      toast.error(t('settings.shop.betrieb.grundKurz'))
      return false
    }
    setBusyId(`credit-${invoiceId}`)
    try {
      await shopAdminOpsApi.creditInvoice(invoiceId, grund)
      await laden()
      toast.success(t('settings.shop.betrieb.gutschriftErfolg'))
      return true
    } catch (error) {
      toast.error(
        error instanceof SanitizedApiError
          ? error.message
          : t('settings.shop.betrieb.gutschriftFehler'),
      )
      return false
    } finally {
      setBusyId(null)
    }
  }

  return {
    orders,
    invoices,
    webhooks,
    stats,
    laedt,
    reconcileBusy,
    reconcileResult,
    busyId,
    laden,
    abgleichen,
    erstatten,
    entitlementSyncen,
    gutschreiben,
  }
}

export type ShopBetriebData = ReturnType<typeof useShopBetriebData>

interface ShopOverviewSectionProps {
  data: ShopBetriebData
  stripeConfigured: boolean | null
  sellerMissingCount: number | null
  activePlanCount: number | null
  onNavigate: (tab: ShopSectionId) => void
}

export function ShopOverviewSection({
  data,
  stripeConfigured,
  sellerMissingCount,
  activePlanCount,
  onNavigate,
}: ShopOverviewSectionProps) {
  const { t } = useTranslation()
  const letzteBestellungen = data.orders.slice(0, 3)

  return (
    <div className="space-y-8">
      {data.stats && (
        <div className="grid divide-y divide-outline-variant/25 rounded-2xl border border-outline-variant/30 bg-surface-container-low/50 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
          <div className="px-5 py-4">
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.betrieb.umsatzBrutto')}
            </p>
            <p className="mt-1 font-headline text-xl font-bold tabular-nums text-on-surface">
              {formatEuro(data.stats.paid_gross_cents)}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.betrieb.bezahlteOrders')}
            </p>
            <p className="mt-1 font-headline text-xl font-bold tabular-nums text-on-surface">
              {data.stats.paid_orders} / {data.stats.total_orders}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.betrieb.aktiveAbos')}
            </p>
            <p className="mt-1 font-headline text-xl font-bold tabular-nums text-on-surface">
              {data.stats.active_subscriptions}
            </p>
          </div>
          <div className="px-5 py-4">
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.betrieb.aktiveGutscheine')}
            </p>
            <p className="mt-1 font-headline text-xl font-bold tabular-nums text-on-surface">
              {data.stats.active_coupons}
            </p>
          </div>
        </div>
      )}

      <section className="space-y-3">
        <h3 className="font-headline text-base font-semibold text-on-surface">
          {t('settings.shop.overview.checkTitel')}
        </h3>
        <div className="divide-y divide-outline-variant/25 rounded-2xl border border-outline-variant/30 bg-surface-container-low/50">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-on-surface">
                {t('settings.shop.overview.checkStripe')}
              </span>
              {stripeConfigured === null ? (
                <Spinner size="sm" />
              ) : (
                <Badge variant={stripeConfigured ? 'success' : 'warning'}>
                  {stripeConfigured
                    ? t('settings.shop.stripe.konfiguriert')
                    : t('settings.shop.stripe.nichtKonfiguriert')}
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('setup')}>
              {stripeConfigured
                ? t('settings.shop.overview.pruefen')
                : t('settings.shop.overview.einrichten')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-on-surface">
                {t('settings.shop.overview.checkSeller')}
              </span>
              {sellerMissingCount === null ? (
                <Spinner size="sm" />
              ) : (
                <Badge variant={sellerMissingCount === 0 ? 'success' : 'warning'}>
                  {sellerMissingCount === 0
                    ? t('settings.shop.seller.vollstaendig')
                    : t('settings.shop.seller.unvollstaendig')}
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('accounting')}>
              {sellerMissingCount === 0
                ? t('settings.shop.overview.pruefen')
                : t('settings.shop.overview.einrichten')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm font-medium text-on-surface">
                {t('settings.shop.overview.checkCatalog')}
              </span>
              {activePlanCount === null ? (
                <Spinner size="sm" />
              ) : (
                <Badge variant={activePlanCount > 0 ? 'success' : 'warning'}>
                  {activePlanCount > 0
                    ? t('settings.shop.overview.tarifeAktiv', { count: activePlanCount })
                    : t('settings.shop.overview.keineTarife')}
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={() => onNavigate('catalog')}>
              {t('settings.shop.overview.verwalten')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-headline text-base font-semibold text-on-surface">
            {t('settings.shop.overview.letzteBestellungen')}
          </h3>
          {data.orders.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => onNavigate('orders')}>
              {t('settings.shop.overview.alleAnzeigen')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>

        {data.laedt ? (
          <Spinner size="sm" />
        ) : letzteBestellungen.length === 0 ? (
          <Zustandsflaeche
            art="leer"
            titel={t('settings.shop.betrieb.ordersLeer')}
            text={t('settings.shop.betrieb.ordersLeerText')}
          />
        ) : (
          <div className="divide-y divide-outline-variant/25 rounded-2xl border border-outline-variant/30 bg-surface-container-low/50">
            {letzteBestellungen.map((order) => (
              <div
                key={order.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <span className="text-sm font-semibold text-on-surface">{order.number}</span>
                  <span className="ml-2 text-xs text-on-surface-variant">
                    {order.username ?? `#${order.user_id}`} · {order.created_at.slice(0, 10)}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <Badge variant={orderStatusBadge(order.status)}>
                    {orderStatusLabel(order.status, t)}
                  </Badge>
                  <span className="text-sm font-bold tabular-nums text-primary">
                    {formatEuro(order.gross_cents)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

export function ShopOrdersSection({ data }: { data: ShopBetriebData }) {
  const { t } = useTranslation()
  const [suche, setSuche] = useState('')
  const [statusFilter, setStatusFilter] = useState<'alle' | 'paid' | 'pending' | 'issue'>('alle')
  const [refundOrderId, setRefundOrderId] = useState<number | null>(null)
  const [refundReason, setRefundReason] = useState('')

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase()
    return data.orders.filter((order) => {
      if (statusFilter === 'paid' && order.status !== 'paid') return false
      if (statusFilter === 'pending' && order.status !== 'pending_payment') return false
      if (
        statusFilter === 'issue' &&
        order.status !== 'refunded' &&
        order.status !== 'failed' &&
        order.status !== 'cancelled'
      ) {
        return false
      }
      if (!q) return true
      return (
        order.number.toLowerCase().includes(q) ||
        (order.username ?? `#${order.user_id}`).toLowerCase().includes(q)
      )
    })
  }, [data.orders, suche, statusFilter])

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <ShoppingBag className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-headline text-base font-semibold text-on-surface">
              {t('settings.shop.bestellungen.titel')}
            </h3>
            <p className="mt-0.5 text-sm text-on-surface-variant">
              {t('settings.shop.bestellungen.text')}
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={data.reconcileBusy}
          onClick={() => void data.abgleichen()}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${data.reconcileBusy ? 'animate-spin' : ''}`}
            aria-hidden="true"
          />
          {t('settings.shop.betrieb.abgleichStarten')}
        </Button>
      </div>

      {data.reconcileResult && (
        <p className="rounded-xl border border-outline-variant/30 bg-surface-container px-4 py-2.5 text-xs text-on-surface-variant">
          {t('settings.shop.betrieb.abgleichErgebnis', {
            geprueft: data.reconcileResult.orders_checked,
            bezahlt: data.reconcileResult.orders_marked_paid,
            rechnungen: data.reconcileResult.invoices_issued,
            entitlements: data.reconcileResult.entitlements_synced,
          })}
        </p>
      )}

      {!data.laedt && data.orders.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full sm:max-w-xs">
            <Input
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder={t('settings.shop.betrieb.sucheBestellungen')}
              aria-label={t('settings.shop.betrieb.sucheBestellungen')}
            />
          </div>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label={t('settings.shop.bestellungen.titel')}
          >
            {(
              [
                ['alle', t('settings.shop.betrieb.filterAlle')],
                ['paid', t('settings.shop.betrieb.filterBezahlt')],
                ['pending', t('settings.shop.betrieb.filterOffen')],
                ['issue', t('settings.shop.betrieb.filterErstattet')],
              ] as const
            ).map(([wert, label]) => (
              <Button
                key={wert}
                type="button"
                variant={statusFilter === wert ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setStatusFilter(wert)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {data.laedt ? (
        <Spinner size="sm" />
      ) : data.orders.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          titel={t('settings.shop.betrieb.ordersLeer')}
          text={t('settings.shop.betrieb.ordersLeerText')}
        />
      ) : gefiltert.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          ansagen
          titel={t('settings.shop.betrieb.keineTrefferOrders')}
          text={t('settings.shop.betrieb.keineTrefferText')}
        />
      ) : (
        <div className="divide-y divide-outline-variant/25 rounded-2xl border border-outline-variant/30 bg-surface-container-low/50">
          {gefiltert.map((order) => (
            <div key={order.id} className="space-y-2.5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm">
                  <span className="font-semibold text-on-surface">{order.number}</span>
                  <span className="ml-2 text-xs text-on-surface-variant">
                    {order.username ?? `#${order.user_id}`} · {order.created_at.slice(0, 10)}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={orderStatusBadge(order.status)}>
                    {orderStatusLabel(order.status, t)}
                  </Badge>
                  <span className="text-sm font-bold tabular-nums text-primary">
                    {formatEuro(order.gross_cents)}
                  </span>
                  {order.status === 'paid' && refundOrderId !== order.id && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        setRefundOrderId(order.id)
                        setRefundReason('')
                      }}
                    >
                      {t('settings.shop.betrieb.erstatten')}
                    </Button>
                  )}
                </div>
              </div>

              {order.entitlements.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {order.entitlements.map((ent) => {
                    const statKey = ent.provisioning_status ?? ent.status
                    return (
                      <div key={ent.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                        <Badge
                          variant={
                            ent.provisioning_status === 'failed'
                              ? 'destructive'
                              : ent.status === 'active'
                                ? 'success'
                                : 'warning'
                          }
                        >
                          {entitlementKindLabel(ent.kind, t)} ·{' '}
                          {entitlementStatusLabel(statKey, t)}
                        </Badge>
                        {ent.provisioning_status === 'failed' && ent.provisioning_error && (
                          <span className="text-xs text-error">
                            {entitlementErrorLabel(ent.provisioning_error, t)}
                          </span>
                        )}
                        {ent.provisioning_status === 'failed' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={data.busyId === `sync-${ent.id}`}
                            onClick={() => void data.entitlementSyncen(ent.id)}
                          >
                            {t('settings.shop.betrieb.erneutSyncen')}
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {refundOrderId === order.id && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <div className="min-w-[14rem] flex-1">
                    <Input
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      placeholder={t('settings.shop.betrieb.grundPlatzhalter')}
                      aria-label={t('settings.shop.betrieb.grundPlatzhalter')}
                    />
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={data.busyId === `refund-${order.id}`}
                    onClick={() => {
                      void data.erstatten(order.id, refundReason).then((ok) => {
                        if (ok) {
                          setRefundOrderId(null)
                          setRefundReason('')
                        }
                      })
                    }}
                  >
                    {t('settings.shop.betrieb.erstattenBestaetigen')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRefundOrderId(null)}
                  >
                    {t('settings.shop.plans.abbrechen')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function ShopInvoicesSection({ data }: { data: ShopBetriebData }) {
  const { t } = useTranslation()
  const [suche, setSuche] = useState('')
  const [invoiceFilter, setInvoiceFilter] = useState<'alle' | 'invoice' | 'credit_note'>('alle')
  const [creditInvoiceId, setCreditInvoiceId] = useState<number | null>(null)
  const [creditReason, setCreditReason] = useState('')

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase()
    return data.invoices.filter((inv) => {
      if (invoiceFilter !== 'alle' && inv.type !== invoiceFilter) return false
      if (!q) return true
      return (
        inv.number.toLowerCase().includes(q) ||
        inv.order_number.toLowerCase().includes(q)
      )
    })
  }, [data.invoices, invoiceFilter, suche])

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">
            <ReceiptText className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-headline text-base font-semibold text-on-surface">
                {t('settings.shop.rechnungen.titel')}
              </h3>
              <Badge variant="info">{t('settings.shop.betrieb.betreiberAnsichtBadge')}</Badge>
            </div>
            <p className="mt-0.5 text-sm text-on-surface-variant">
              {t('settings.shop.rechnungen.text')}
            </p>
          </div>
        </div>
        <a
          href={shopAdminOpsApi.exportInvoicesUrl()}
          className={buttonClasses('secondary', 'sm')}
        >
          <Download className="h-3.5 w-3.5" aria-hidden="true" />
          {t('settings.shop.betrieb.pruefExport')}
        </a>
      </div>

      {!data.laedt && data.invoices.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="w-full sm:max-w-xs">
            <Input
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder={t('settings.shop.betrieb.sucheRechnungen')}
              aria-label={t('settings.shop.betrieb.sucheRechnungen')}
            />
          </div>
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label={t('settings.shop.rechnungen.titel')}
          >
            {(
              [
                ['alle', t('settings.shop.betrieb.filterAlle')],
                ['invoice', t('settings.shop.betrieb.filterRechnungen')],
                ['credit_note', t('settings.shop.betrieb.filterGutschriften')],
              ] as const
            ).map(([wert, label]) => (
              <Button
                key={wert}
                type="button"
                variant={invoiceFilter === wert ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setInvoiceFilter(wert)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>
      )}

      {data.laedt ? (
        <Spinner size="sm" />
      ) : data.invoices.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          titel={t('settings.shop.betrieb.rechnungenLeer')}
          text={t('settings.shop.betrieb.rechnungenLeerText')}
        />
      ) : gefiltert.length === 0 ? (
        <Zustandsflaeche
          art="leer"
          ansagen
          titel={t('settings.shop.betrieb.keineTrefferRechnungen')}
          text={t('settings.shop.betrieb.keineTrefferText')}
        />
      ) : (
        <div className="divide-y divide-outline-variant/25 rounded-2xl border border-outline-variant/30 bg-surface-container-low/50">
          {gefiltert.map((inv) => (
            <div key={inv.id} className="space-y-2.5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-on-surface">{inv.number}</span>
                  <span className="text-xs text-on-surface-variant">
                    {inv.order_number} · {inv.issued_at.slice(0, 10)}
                  </span>
                  <Badge variant={inv.order_number.startsWith('H-') ? 'warning' : 'default'}>
                    {inv.order_number.startsWith('H-')
                      ? t('settings.shop.betrieb.typHosterApi')
                      : inv.type === 'credit_note'
                        ? t('settings.shop.betrieb.typGutschrift')
                        : t('settings.shop.betrieb.typShopRechnung')}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={inv.status === 'issued' ? 'success' : 'default'}>
                    {t(`settings.shop.betrieb.belegStatus.${inv.status}`, {
                      defaultValue: inv.status,
                    })}
                  </Badge>
                  <span className="text-sm font-bold tabular-nums text-primary">
                    {formatEuro(inv.gross_cents)}
                  </span>
                  <a
                    href={shopAdminOpsApi.adminInvoicePdfUrl(inv.id)}
                    className={buttonClasses('ghost', 'sm')}
                  >
                    PDF
                  </a>
                  <a
                    href={shopAdminOpsApi.adminInvoiceXmlUrl(inv.id)}
                    className={buttonClasses('ghost', 'sm')}
                  >
                    XRechnung
                  </a>
                  {inv.type === 'invoice' &&
                    inv.status === 'issued' &&
                    creditInvoiceId !== inv.id && (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setCreditInvoiceId(inv.id)
                          setCreditReason('')
                        }}
                      >
                        {t('settings.shop.betrieb.gutschriftErstellen')}
                      </Button>
                    )}
                </div>
              </div>

              {creditInvoiceId === inv.id && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <div className="min-w-[14rem] flex-1">
                    <Input
                      value={creditReason}
                      onChange={(e) => setCreditReason(e.target.value)}
                      placeholder={t('settings.shop.betrieb.grundPlatzhalter')}
                      aria-label={t('settings.shop.betrieb.grundPlatzhalter')}
                    />
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    disabled={data.busyId === `credit-${inv.id}`}
                    onClick={() => {
                      void data.gutschreiben(inv.id, creditReason).then((ok) => {
                        if (ok) {
                          setCreditInvoiceId(null)
                          setCreditReason('')
                        }
                      })
                    }}
                  >
                    {t('settings.shop.betrieb.gutschriftBestaetigen')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCreditInvoiceId(null)}
                  >
                    {t('settings.shop.plans.abbrechen')}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

export function ShopWebhooksSection({ data }: { data: ShopBetriebData }) {
  const { t } = useTranslation()

  return (
    <details className="group rounded-2xl border border-outline-variant/30 bg-surface-container-low/40">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-on-surface select-none [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2.5">
          <Webhook className="h-4 w-4 text-on-surface-variant" aria-hidden="true" />
          <span>{t('settings.shop.betrieb.webhooksAufklappen')}</span>
          {!data.laedt && (
            <Badge variant="default">{data.webhooks.length}</Badge>
          )}
        </span>
        <ChevronDown
          className="h-4 w-4 text-on-surface-variant transition-transform group-open:rotate-180"
          aria-hidden="true"
        />
      </summary>

      <div className="space-y-3 border-t border-outline-variant/25 p-4">
        <p className="text-xs text-on-surface-variant">
          {t('settings.shop.webhooks.text')}
        </p>

        {data.laedt ? (
          <Spinner size="sm" />
        ) : data.webhooks.length === 0 ? (
          <Zustandsflaeche
            art="leer"
            titel={t('settings.shop.betrieb.webhooksLeer')}
            text={t('settings.shop.betrieb.webhooksLeerText')}
          />
        ) : (
          <div className="divide-y divide-outline-variant/25 rounded-xl border border-outline-variant/25 bg-surface-container/60">
            {data.webhooks.map((evt) => (
              <div
                key={evt.id}
                className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <div>
                  <span className="font-semibold text-on-surface">{evt.event_type}</span>
                  <span className="ml-2 text-on-surface-variant">{evt.event_id}</span>
                </div>
                <div className="flex items-center gap-2">
                  {evt.order_id != null && (
                    <span className="text-on-surface-variant">#{evt.order_id}</span>
                  )}
                  <Badge variant="success">{evt.status}</Badge>
                  <span className="text-on-surface-variant">{evt.received_at.slice(0, 10)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  )
}

