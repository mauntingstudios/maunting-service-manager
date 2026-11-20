export type OrderStatus =
  | 'draft'
  | 'pending_payment'
  | 'paid'
  | 'fulfilled'
  | 'failed'
  | 'cancelled'
  | 'refunded'

export interface Plan {
  id: string
  name: string
  spielId: string
  ramGb: number
  cpu: number
  slots: number
  preisCent: number
  intervall: 'month'
}

export interface Addon {
  id: string
  name: string
  beschreibung: string
  preisCent: number
  intervall: 'month'
}

export interface OrderItem {
  id: string
  kind: 'plan' | 'addon'
  bezeichnung: string
  menge: number
  einzelpreisCent: number
  steuersatzProzent: number
  gesamtCent: number
}

export interface Order {
  id: string
  nummer: string
  status: OrderStatus
  erstelltAm: string
  spielId: string
  positionen: OrderItem[]
  nettoCent: number
  steuerCent: number
  bruttoCent: number
  rechnungId?: string
}

export interface Subscription {
  id: string
  bezeichnung: string
  status: 'active' | 'past_due' | 'cancelled'
  intervall: 'month'
  naechsteZahlung: string
  preisCent: number
}

export interface Entitlement {
  id: string
  art: 'server' | 'rolle' | 'addon'
  bezeichnung: string
  status: 'active' | 'suspended'
  serverId?: number
}

export interface PaymentMethod {
  id: string
  art: 'card' | 'sepa'
  bezeichnung: string
  standard: boolean
}

export interface ShopSettings {
  shopEnabled: boolean
  waehrung: 'EUR'
  stripeModus: 'test' | 'live'
  stripeKonfiguriert: boolean
  rechnungsPraefix: string
  steuersatzProzent: number
}
