import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, ReceiptText, RefreshCw, ShoppingBag, Webhook } from 'lucide-react'
import { Badge, Button, Input, Spinner, Zustandsflaeche } from '@maunting/ui'
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

function orderStatusBadge(status: ShopAdminOrderDto['status']) {
  if (status === 'paid') return 'success' as const
  if (status === 'pending_payment') return 'warning' as const
  if (status === 'failed') return 'destructive' as const
  return 'default' as const
}

export function ShopBetriebKarten() {
  const { t } = useTranslation()
  const [orders, setOrders] = useState<ShopAdminOrderDto[]>([])
  const [invoices, setInvoices] = useState<ShopInvoiceSummaryDto[]>([])
  const [webhooks, setWebhooks] = useState<ShopPaymentEventDto[]>([])
  const [stats, setStats] = useState<ShopStatsResponse | null>(null)
  const [laedt, setLaedt] = useState(true)
  const [reconcileBusy, setReconcileBusy] = useState(false)
  const [reconcileResult, setReconcileResult] = useState<ShopReconciliationDto | null>(null)
  const [refundOrderId, setRefundOrderId] = useState<number | null>(null)
  const [refundReason, setRefundReason] = useState('')
  const [creditInvoiceId, setCreditInvoiceId] = useState<number | null>(null)
  const [creditReason, setCreditReason] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)

  const laden = async () => {
    setLaedt(true)
    try {
      const [o, inv, wh, st] = await Promise.all([
        shopAdminOpsApi.listOrders(),
        shopAdminOpsApi.listInvoices(),
        shopAdminOpsApi.listWebhooks(),
        shopAdminOpsApi.getStats().catch(() => null),
      ])
      setOrders(o)
      setInvoices(inv)
      setWebhooks(wh)
      setStats(st && typeof st.paid_orders === 'number' ? st : null)
    } catch {
      toast.error(t('settings.shop.betrieb.ladefehler'))
    } finally {
      setLaedt(false)
    }
  }

  useEffect(() => {
    void laden()
  }, [])

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

  const erstatten = async (orderId: number) => {
    const grund = refundReason.trim()
    if (grund.length < 3) {
      toast.error(t('settings.shop.betrieb.grundKurz'))
      return
    }
    setBusyId(`refund-${orderId}`)
    try {
      await shopAdminOpsApi.refundOrder(orderId, grund)
      setRefundOrderId(null)
      setRefundReason('')
      await laden()
      toast.success(t('settings.shop.betrieb.refundErfolg'))
    } catch (error) {
      toast.error(
        error instanceof SanitizedApiError
          ? error.message
          : t('settings.shop.betrieb.refundFehler'),
      )
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

  const gutschreiben = async (invoiceId: number) => {
    const grund = creditReason.trim()
    if (grund.length < 3) {
      toast.error(t('settings.shop.betrieb.grundKurz'))
      return
    }
    setBusyId(`credit-${invoiceId}`)
    try {
      await shopAdminOpsApi.creditInvoice(invoiceId, grund)
      setCreditInvoiceId(null)
      setCreditReason('')
      await laden()
      toast.success(t('settings.shop.betrieb.gutschriftErfolg'))
    } catch (error) {
      toast.error(
        error instanceof SanitizedApiError
          ? error.message
          : t('settings.shop.betrieb.gutschriftFehler'),
      )
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="space-y-6">
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4">
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.betrieb.umsatzBrutto')}
            </p>
            <p className="mt-1 font-headline text-xl font-bold text-on-surface">
              {formatEuro(stats.paid_gross_cents)}
            </p>
          </div>
          <div className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4">
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.betrieb.bezahlteOrders')}
            </p>
            <p className="mt-1 font-headline text-xl font-bold text-on-surface">
              {stats.paid_orders} / {stats.total_orders}
            </p>
          </div>
          <div className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4">
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.betrieb.aktiveAbos')}
            </p>
            <p className="mt-1 font-headline text-xl font-bold text-on-surface">
              {stats.active_subscriptions}
            </p>
          </div>
          <div className="msm-card rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-4">
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.betrieb.aktiveGutscheine')}
            </p>
            <p className="mt-1 font-headline text-xl font-bold text-on-surface">
              {stats.active_coupons}
            </p>
          </div>
        </div>
      )}

      <section className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
              <ShoppingBag className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-headline text-base font-semibold text-on-surface">
                {t('settings.shop.bestellungen.titel')}
              </h3>
              <p className="text-xs text-on-surface-variant">
                {t('settings.shop.bestellungen.text')}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={reconcileBusy}
            onClick={() => void abgleichen()}
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            {t('settings.shop.betrieb.abgleichStarten')}
          </Button>
        </div>

        {reconcileResult && (
          <p className="rounded-xl border border-outline-variant/30 bg-surface-container p-3 text-xs text-on-surface-variant">
            {t('settings.shop.betrieb.abgleichErgebnis', {
              geprueft: reconcileResult.orders_checked,
              bezahlt: reconcileResult.orders_marked_paid,
              rechnungen: reconcileResult.invoices_issued,
              entitlements: reconcileResult.entitlements_synced,
            })}
          </p>
        )}

        {laedt ? (
          <Spinner size="sm" />
        ) : orders.length === 0 ? (
          <Zustandsflaeche
            art="leer"
            titel={t('settings.shop.betrieb.ordersLeer')}
            text={t('settings.shop.betrieb.ordersLeerText')}
          />
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <div
                key={order.id}
                className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface-container p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold text-on-surface">{order.number}</span>
                    <span className="ml-2 text-xs text-on-surface-variant">
                      {order.username ?? `#${order.user_id}`} · {order.created_at.slice(0, 10)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={orderStatusBadge(order.status)}>{order.status}</Badge>
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
                    {order.entitlements.map((ent) => (
                      <div key={ent.id} className="flex items-center gap-1.5 text-xs">
                        <Badge
                          variant={
                            ent.provisioning_status === 'failed'
                              ? 'destructive'
                              : ent.status === 'active'
                                ? 'success'
                                : 'warning'
                          }
                        >
                          {ent.kind}: {ent.provisioning_status ?? ent.status}
                        </Badge>
                        {ent.provisioning_status === 'failed' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busyId === `sync-${ent.id}`}
                            onClick={() => void entitlementSyncen(ent.id)}
                          >
                            {t('settings.shop.betrieb.erneutSyncen')}
                          </Button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {refundOrderId === order.id && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Input
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      placeholder={t('settings.shop.betrieb.grundPlatzhalter')}
                      aria-label={t('settings.shop.betrieb.grundPlatzhalter')}
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busyId === `refund-${order.id}`}
                      onClick={() => void erstatten(order.id)}
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

      <section className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
              <ReceiptText className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h3 className="font-headline text-base font-semibold text-on-surface">
                {t('settings.shop.rechnungen.titel')}
              </h3>
              <p className="text-xs text-on-surface-variant">
                {t('settings.shop.rechnungen.text')}
              </p>
            </div>
          </div>
          <a
            href={shopAdminOpsApi.exportInvoicesUrl()}
            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-outline-variant/40 px-3 text-sm font-medium text-on-surface hover:bg-surface-container-high"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            {t('settings.shop.betrieb.pruefExport')}
          </a>
        </div>

        {laedt ? (
          <Spinner size="sm" />
        ) : invoices.length === 0 ? (
          <Zustandsflaeche
            art="leer"
            titel={t('settings.shop.betrieb.rechnungenLeer')}
            text={t('settings.shop.betrieb.rechnungenLeerText')}
          />
        ) : (
          <div className="space-y-3">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                className="space-y-2 rounded-xl border border-outline-variant/30 bg-surface-container p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    <span className="font-semibold text-on-surface">{inv.number}</span>
                    <span className="ml-2 text-xs text-on-surface-variant">
                      {inv.order_number} · {inv.issued_at.slice(0, 10)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={inv.status === 'issued' ? 'success' : 'default'}>
                      {inv.type === 'credit_note'
                        ? t('settings.shop.betrieb.typGutschrift')
                        : inv.status}
                    </Badge>
                    <span className="text-sm font-bold tabular-nums text-primary">
                      {formatEuro(inv.gross_cents)}
                    </span>
                    <a
                      href={shopAdminOpsApi.adminInvoicePdfUrl(inv.id)}
                      className="rounded-md border border-outline-variant/40 px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-high"
                    >
                      PDF
                    </a>
                    <a
                      href={shopAdminOpsApi.adminInvoiceXmlUrl(inv.id)}
                      className="rounded-md border border-outline-variant/40 px-2.5 py-1 text-xs font-medium text-on-surface hover:bg-surface-container-high"
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
                    <Input
                      value={creditReason}
                      onChange={(e) => setCreditReason(e.target.value)}
                      placeholder={t('settings.shop.betrieb.grundPlatzhalter')}
                      aria-label={t('settings.shop.betrieb.grundPlatzhalter')}
                    />
                    <Button
                      variant="destructive"
                      size="sm"
                      disabled={busyId === `credit-${inv.id}`}
                      onClick={() => void gutschreiben(inv.id)}
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

      <section className="msm-card space-y-4 rounded-2xl border border-outline-variant/30 bg-surface-container-low/80 p-5">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/15 text-primary">
            <Webhook className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <h3 className="font-headline text-base font-semibold text-on-surface">
              {t('settings.shop.webhooks.titel')}
            </h3>
            <p className="text-xs text-on-surface-variant">
              {t('settings.shop.webhooks.text')}
            </p>
          </div>
        </div>

        {laedt ? (
          <Spinner size="sm" />
        ) : webhooks.length === 0 ? (
          <Zustandsflaeche
            art="leer"
            titel={t('settings.shop.betrieb.webhooksLeer')}
            text={t('settings.shop.betrieb.webhooksLeerText')}
          />
        ) : (
          <div className="space-y-2">
            {webhooks.map((evt) => (
              <div
                key={evt.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-outline-variant/30 bg-surface-container px-3 py-2 text-xs"
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
      </section>
    </div>
  )
}
