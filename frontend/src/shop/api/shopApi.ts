import { shopOrderApi } from '@/api/shop'
import type {
  Entitlement,
  Invoice,
  Order,
  PaymentMethod,
  ShopSettings,
  Subscription,
} from './types'

export interface ShopApi {
  listOrders(): Promise<Order[]>
  getOrder(id: string): Promise<Order | undefined>
  listInvoices(): Promise<Invoice[]>
  listSubscriptions(): Promise<Subscription[]>
  listEntitlements(): Promise<Entitlement[]>
  listPaymentMethods(): Promise<PaymentMethod[]>
  getSettings(): Promise<ShopSettings>
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

// Rechnungen und Zahlungsmethoden sind bis zur Stripe-Anbindung Demo-Daten.
const MOCK_INVOICES: Invoice[] = [
  {
    id: 'inv-1001',
    nummer: 'RE-2026-0001',
    status: 'paid',
    datum: '2026-11-02',
    leistungszeitraum: '02.11.2026 – 01.12.2026',
    empfaenger: 'Beispielkunde',
    positionen: [
      {
        bezeichnung: 'Palworld · 8 GB · 8 Slots',
        menge: 1,
        einzelpreisCent: 699,
        steuersatzProzent: 19,
        gesamtCent: 699,
      },
      {
        bezeichnung: 'KI-Zugang',
        menge: 1,
        einzelpreisCent: 499,
        steuersatzProzent: 19,
        gesamtCent: 499,
      },
    ],
    nettoCent: 1007,
    steuerCent: 191,
    bruttoCent: 1198,
    pdfVerfuegbar: false,
  },
  {
    id: 'inv-1002',
    nummer: 'RE-2026-0002',
    status: 'open',
    datum: '2026-11-18',
    leistungszeitraum: '18.11.2026 – 17.12.2026',
    empfaenger: 'Beispielkunde',
    positionen: [
      {
        bezeichnung: 'Valheim · 4 GB · 8 Slots',
        menge: 1,
        einzelpreisCent: 499,
        steuersatzProzent: 19,
        gesamtCent: 499,
      },
    ],
    nettoCent: 419,
    steuerCent: 80,
    bruttoCent: 499,
    pdfVerfuegbar: false,
  },
]

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
  listInvoices: async () => MOCK_INVOICES,
  listSubscriptions: async () =>
    (await shopOrderApi.listSubscriptions()).map((dto) => ({
      id: String(dto.id),
      bezeichnung: dto.name,
      status: dto.status,
      intervall: 'month',
      naechsteZahlung: dto.current_period_end.slice(0, 10),
      preisCent: dto.monthly_gross_cents,
    })),
  listEntitlements: async () =>
    (await shopOrderApi.listEntitlements()).map((dto) => ({
      id: String(dto.id),
      art: dto.kind === 'role' ? 'rolle' : dto.kind,
      bezeichnung: dto.label,
      status: dto.status === 'active' ? 'active' : 'suspended',
    })),
  listPaymentMethods: async () => MOCK_PAYMENT_METHODS,
  getSettings: async () => MOCK_SETTINGS,
}
