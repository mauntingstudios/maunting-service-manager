import { SanitizedApiError } from '@/api/client'
import {
  shopOrderApi,
  type ShopEntitlementDto,
  type ShopSubscriptionDto,
} from '@/api/shop'
import type {
  Entitlement,
  GraceBackup,
  Order,
  PaymentMethod,
  ShopSettings,
  Subscription,
  SubscriptionDeletionMode,
} from './types'

export interface CancelSubscriptionOptions {
  deletionMode?: SubscriptionDeletionMode
  confirmServerName?: string
}

export interface ShopApi {
  listOrders(): Promise<Order[]>
  getOrder(id: string): Promise<Order | undefined>
  listSubscriptions(): Promise<Subscription[]>
  cancelSubscription(id: string, options?: CancelSubscriptionOptions): Promise<Subscription>
  extendSubscription?(
    id: string,
    months?: 1 | 3 | 12,
  ): Promise<{ orderNumber: string; checkoutUrl?: string }>
  listEntitlements(): Promise<Entitlement[]>
  listEntitlementBackups?(id: string): Promise<GraceBackup[]>
  entitlementBackupDownloadUrl?(entitlementId: string, backupId: number): string
  purgeEntitlementNow(id: string, confirmServerName: string): Promise<Entitlement>
  pauseEntitlement?(id: string): Promise<Entitlement>
  resumeEntitlement?(id: string): Promise<Entitlement>
  listPaymentMethods(): Promise<PaymentMethod[]>
  getSettings(): Promise<ShopSettings>
}

function subscriptionAusApi(dto: ShopSubscriptionDto): Subscription {
  return {
    id: String(dto.id),
    bezeichnung: dto.name,
    status: dto.status,
    intervall: 'month',
    billingMode: dto.billing_mode ?? 'subscription',
    naechsteZahlung: dto.current_period_end.slice(0, 10),
    preisCent: dto.monthly_gross_cents,
    cancelAtPeriodEnd: dto.cancel_at_period_end,
    deleteServerOnEnd: dto.delete_server_on_end ?? false,
    serverEntitlementId: dto.server_entitlement_id ?? null,
    serverName: dto.server_name ?? null,
    canImmediateDelete: dto.can_immediate_delete ?? false,
  }
}

function entitlementAusApi(dto: ShopEntitlementDto): Entitlement {
  return {
    id: String(dto.id),
    art: dto.kind === 'role' ? 'rolle' : dto.kind,
    bezeichnung: dto.label,
    status: dto.status,
    serverId: dto.server_id ?? undefined,
    serverName: dto.server_name ?? null,
    provisioningStatus: dto.provisioning_status,
    purgeAfter: dto.purge_after ?? null,
    purgeReason: dto.purge_reason ?? null,
    purgedAt: dto.purged_at ?? null,
    canCustomerPurgeNow: dto.can_customer_purge_now ?? false,
    pausedAt: dto.paused_at ?? null,
    pauseDaysUsed: dto.pause_days_used ?? 0,
  }
}

function orderAusApi(dto: Awaited<ReturnType<typeof shopOrderApi.getOrder>>): Order {
  return {
    id: String(dto.id),
    nummer: dto.number,
    status: dto.status,
    erstelltAm: dto.created_at,
    spielId: dto.items[0]?.game_type ?? '',
    positionen: dto.items.map((item) => ({
      id: String(item.id),
      kind: item.kind,
      bezeichnung: item.name,
      menge: item.quantity,
      einzelpreisCent: item.unit_price_cents,
      steuersatzProzent: item.tax_rate_percent,
      gesamtCent: item.gross_cents,
    })),
    nettoCent: dto.net_cents,
    steuerCent: dto.tax_cents,
    bruttoCent: dto.gross_cents,
  }
}

const MOCK_SETTINGS: ShopSettings = {
  shopEnabled: true,
  waehrung: 'EUR',
  stripeModus: 'test',
  stripeKonfiguriert: false,
  rechnungsPraefix: 'RE',
  steuersatzProzent: 19,
}

export const shopApi: ShopApi = {
  listOrders: async () => (await shopOrderApi.listOrders()).map(orderAusApi),
  getOrder: async (id) => {
    try {
      return orderAusApi(await shopOrderApi.getOrder(id))
    } catch {
      return undefined
    }
  },
  listSubscriptions: async () =>
    (await shopOrderApi.listSubscriptions()).map(subscriptionAusApi),
  cancelSubscription: async (id, options) => {
    const mode = options?.deletionMode ?? 'grace_period'
    if (mode === 'grace_period') {
      return subscriptionAusApi(await shopOrderApi.cancelSubscription(id))
    }
    return subscriptionAusApi(
      await shopOrderApi.cancelSubscription(id, {
        deletion_mode: mode,
        ...(options?.confirmServerName
          ? { confirm_server_name: options.confirmServerName }
          : {}),
      }),
    )
  },
  listEntitlements: async () =>
    (await shopOrderApi.listEntitlements()).map(entitlementAusApi),
  extendSubscription: async (id, months = 1) => {
    const order = await shopOrderApi.extendSubscription(id, months)
    try {
      const stripe = await shopOrderApi.checkout(order.id)
      return { orderNumber: order.number, checkoutUrl: stripe.checkout_url }
    } catch (error) {
      if (!(error instanceof SanitizedApiError) || error.status !== 409) {
        throw error
      }
    }
    const paid = await shopOrderApi.payDemo(order.id)
    return { orderNumber: paid.number }
  },
  listEntitlementBackups: async (id) =>
    (await shopOrderApi.listEntitlementBackups(id)).map((row) => ({
      id: row.id,
      name: row.name,
      sizeMb: row.size_mb,
      createdAt: row.created_at,
      encrypted: row.encrypted,
      downloadable: row.downloadable,
    })),
  entitlementBackupDownloadUrl: (entitlementId, backupId) =>
    shopOrderApi.entitlementBackupDownloadUrl(entitlementId, backupId),
  purgeEntitlementNow: async (id, confirmServerName) =>
    entitlementAusApi(await shopOrderApi.purgeEntitlementNow(id, confirmServerName)),
  pauseEntitlement: async (id) =>
    entitlementAusApi(await shopOrderApi.pauseEntitlement(id)),
  resumeEntitlement: async (id) =>
    entitlementAusApi(await shopOrderApi.resumeEntitlement(id)),
  listPaymentMethods: async () => [],
  getSettings: async () => MOCK_SETTINGS,
}
