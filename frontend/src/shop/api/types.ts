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
  standortAufpreisCent?: number
}

export interface Order {
  id: string
  nummer: string
  status: OrderStatus
  erstelltAm: string
  bezahltAm?: string | null
  spielId: string
  positionen: OrderItem[]
  nettoCent: number
  steuerCent: number
  bruttoCent: number
  rabattProzent?: number
  monate?: number
  rechnungId?: string
}

export type SubscriptionDeletionMode =
  | 'grace_period'
  | 'end_of_period_immediate'
  | 'immediate'

export interface Subscription {
  id: string
  addonId?: number | null
  bezeichnung: string
  status: 'active' | 'past_due' | 'cancelled'
  intervall: 'month'
  billingMode?: 'prepaid' | 'subscription' | 'lifetime'
  naechsteZahlung: string
  preisCent: number
  cancelAtPeriodEnd?: boolean
  deleteServerOnEnd?: boolean
  serverEntitlementId?: number | null
  serverName?: string | null
  canImmediateDelete?: boolean
}

export interface GraceBackup {
  id: number
  name: string
  sizeMb: number | null
  createdAt: string
  encrypted: boolean
  downloadable: boolean
}

export interface Entitlement {
  id: string
  art: 'server' | 'rolle' | 'addon'
  bezeichnung: string
  status: 'active' | 'suspended' | 'revoked'
  serverId?: number
  serverName?: string | null
  provisioningStatus?: string | null
  purgeAfter?: string | null
  purgeReason?: string | null
  purgedAt?: string | null
  canCustomerPurgeNow?: boolean
  pausedAt?: string | null
  pauseDaysUsed?: number
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
