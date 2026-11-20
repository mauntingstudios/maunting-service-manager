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

const MOCK_ORDERS: Order[] = [
  {
    id: 'ord-1001',
    nummer: 'MSM-2026-1001',
    status: 'fulfilled',
    erstelltAm: '2026-11-02T10:15:00+00:00',
    spielId: 'palworld',
    positionen: [
      {
        id: 'pos-1',
        kind: 'plan',
        bezeichnung: 'Palworld · 8 GB · 8 Slots',
        menge: 1,
        einzelpreisCent: 699,
        steuersatzProzent: 19,
        gesamtCent: 699,
      },
      {
        id: 'pos-2',
        kind: 'addon',
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
    rechnungId: 'inv-1001',
  },
  {
    id: 'ord-1002',
    nummer: 'MSM-2026-1002',
    status: 'pending_payment',
    erstelltAm: '2026-11-18T08:40:00+00:00',
    spielId: 'valheim',
    positionen: [
      {
        id: 'pos-3',
        kind: 'plan',
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
  },
  {
    id: 'ord-1003',
    nummer: 'MSM-2026-1003',
    status: 'cancelled',
    erstelltAm: '2026-10-12T14:05:00+00:00',
    spielId: 'rust',
    positionen: [
      {
        id: 'pos-4',
        kind: 'plan',
        bezeichnung: 'Rust · 8 GB · 16 Slots',
        menge: 1,
        einzelpreisCent: 999,
        steuersatzProzent: 19,
        gesamtCent: 999,
      },
    ],
    nettoCent: 839,
    steuerCent: 160,
    bruttoCent: 999,
  },
]

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

const MOCK_SUBSCRIPTIONS: Subscription[] = [
  {
    id: 'sub-1',
    bezeichnung: 'Palworld · 8 GB · 8 Slots',
    status: 'active',
    intervall: 'month',
    naechsteZahlung: '2026-12-02',
    preisCent: 699,
  },
  {
    id: 'sub-2',
    bezeichnung: 'KI-Zugang',
    status: 'active',
    intervall: 'month',
    naechsteZahlung: '2026-12-02',
    preisCent: 499,
  },
]

const MOCK_ENTITLEMENTS: Entitlement[] = [
  {
    id: 'ent-1',
    art: 'server',
    bezeichnung: 'Palworld-Server',
    status: 'active',
    serverId: 42,
  },
  {
    id: 'ent-2',
    art: 'rolle',
    bezeichnung: 'KI-Zugang',
    status: 'active',
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

/**
 * Phase 1: reine Mock-API. Keine Netzwerkaufrufe, keine Zahlung, keine
 * Provisionierung. `httpShopApi` kommt in Phase 2 an dieselbe Schnittstelle.
 */
export const mockShopApi: ShopApi = {
  listOrders: async () => MOCK_ORDERS,
  getOrder: async (id) => MOCK_ORDERS.find((order) => order.id === id),
  listInvoices: async () => MOCK_INVOICES,
  listSubscriptions: async () => MOCK_SUBSCRIPTIONS,
  listEntitlements: async () => MOCK_ENTITLEMENTS,
  listPaymentMethods: async () => MOCK_PAYMENT_METHODS,
  getSettings: async () => MOCK_SETTINGS,
}

export const shopApi: ShopApi = mockShopApi
