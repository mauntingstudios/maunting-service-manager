import { shopOrderApi, type ShopSubscriptionDto } from '@/api/shop'
import type {
  Entitlement,
  Order,
  PaymentMethod,
  ShopSettings,
  Subscription,
} from './types'

export interface ShopApi {
  listOrders(): Promise<Order[]>
  getOrder(id: string): Promise<Order | undefined>
  listSubscriptions(): Promise<Subscription[]>
  cancelSubscription(id: string): Promise<Subscription>
  listEntitlements(): Promise<Entitlement[]>
  listPaymentMethods(): Promise<PaymentMethod[]>
  getSettings(): Promise<ShopSettings>
}

function subscriptionAusApi(dto: ShopSubscriptionDto): Subscription {
  return {
    id: String(dto.id),
    bezeichnung: dto.name,
    status: dto.status,
    intervall: 'month',
    naechsteZahlung: dto.current_period_end.slice(0, 10),
    preisCent: dto.monthly_gross_cents,
    cancelAtPeriodEnd: dto.cancel_at_period_end,
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

// Zahlungsmethoden sind bis zur Stripe-Anbindung Demo-Daten.
const MOCK_PAYMENT_METHODS: PaymentMethod[] = [
  {
    id: 'pm-1',
    art: 'card',
    bezeichnung: 'Visa •••• 4242',
    standard: true,
  },
]

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
  cancelSubscription: async (id) =>
    subscriptionAusApi(await shopOrderApi.cancelSubscription(id)),
  listEntitlements: async () =>
    (await shopOrderApi.listEntitlements()).map((dto) => ({
      id: String(dto.id),
      art: dto.kind === 'role' ? 'rolle' : dto.kind,
      bezeichnung: dto.label,
      status: dto.status,
      serverId: dto.server_id ?? undefined,
      provisioningStatus: dto.provisioning_status,
    })),
  listPaymentMethods: async () => MOCK_PAYMENT_METHODS,
  getSettings: async () => MOCK_SETTINGS,
}
