import { api, apiUrl } from './client'

export type ShopArtworkSource = 'steam' | 'custom' | 'none' | 'panorama'
export type ShopArtworkMode = 'steam' | 'custom' | 'none'

export interface ShopArtwork {
  source: ShopArtworkSource
  url: string | null
  version: string | null
}

export interface ShopPlan {
  id: number
  game_type: string
  name: string
  description: string | null
  price_cents: number
  currency: string
  billing_interval: string
  tax_rate_percent: number
  ram_included_mb: number | null
  ram_max_mb: number | null
  ram_step_mb: number | null
  price_per_ram_step_cents: number
  cpu_included: number | null
  cpu_max: number | null
  cpu_step: number
  price_per_cpu_step_cents: number
  slots_included: number | null
  slots_max: number | null
  slots_step: number
  price_per_slot_step_cents: number
  node_id: number | null
  role_id: number | null
  artwork_mode: ShopArtworkMode
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
  artwork: ShopArtwork
}

export interface ShopCatalogPlan {
  id: number
  game_type: string
  game_name: string
  game_description: string | null
  game_category: string
  supports_mods: boolean
  supports_workshop: boolean
  name: string
  description: string | null
  price_cents: number
  currency: string
  billing_interval: string
  tax_rate_percent: number
  ram_included_mb: number | null
  ram_max_mb: number | null
  ram_step_mb: number | null
  price_per_ram_step_cents: number
  cpu_included: number | null
  cpu_max: number | null
  cpu_step: number
  price_per_cpu_step_cents: number
  slots_included: number | null
  slots_max: number | null
  slots_step: number
  price_per_slot_step_cents: number
  artwork: ShopArtwork
}

export interface ShopPlanWrite {
  game_type: string
  name: string
  description?: string | null
  price_cents: number
  currency?: string
  billing_interval?: 'month'
  tax_rate_percent?: number
  ram_included_mb?: number | null
  ram_max_mb?: number | null
  ram_step_mb?: number | null
  price_per_ram_step_cents?: number
  cpu_included?: number | null
  cpu_max?: number | null
  cpu_step?: number
  price_per_cpu_step_cents?: number
  slots_included?: number | null
  slots_max?: number | null
  slots_step?: number
  price_per_slot_step_cents?: number
  node_id?: number | null
  role_id?: number | null
  artwork_mode?: ShopArtworkMode
  active?: boolean
  sort_order?: number
}

export const shopAdminApi = {
  listPlans: () => api<ShopPlan[]>('/shop/plans'),
  createPlan: (payload: ShopPlanWrite) =>
    api<ShopPlan>('/shop/plans', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updatePlan: (id: number, payload: Partial<ShopPlanWrite>) =>
    api<ShopPlan>(`/shop/plans/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deletePlan: (id: number) =>
    api<void>(`/shop/plans/${id}`, { method: 'DELETE' }),
  uploadArtwork: (id: number, file: File) => {
    const formular = new FormData()
    formular.append('file', file)
    return api<ShopPlan>(`/shop/plans/${id}/artwork`, {
      method: 'POST',
      body: formular,
    })
  },
  resetArtwork: (id: number) =>
    api<ShopPlan>(`/shop/plans/${id}/artwork`, { method: 'DELETE' }),
}

export const shopCatalogApi = {
  getCatalog: () => api<ShopCatalogPlan[]>('/shop/catalog'),
}

export type ShopOrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'cancelled'
  | 'refunded'
  | 'failed'

export interface ShopOrderItemDto {
  id: number
  kind: 'plan' | 'addon'
  game_type: string
  name: string
  quantity: number
  unit_price_cents: number
  tax_rate_percent: number
  net_cents: number
  tax_cents: number
  gross_cents: number
  ram_mb: number | null
  cpu: number | null
  slots: number | null
}

export interface ShopOrderDto {
  id: number
  number: string
  status: ShopOrderStatus
  currency: string
  billing_interval: string
  months: number
  discount_percent: number
  net_cents: number
  tax_cents: number
  gross_cents: number
  payment_provider: string
  payment_reference: string | null
  created_at: string
  paid_at: string | null
  items: ShopOrderItemDto[]
}

export interface ShopOrderCreate {
  plan_id: number
  months: 1 | 3 | 12
  ram_mb?: number | null
  cpu?: number | null
  slots?: number | null
  buyer_name?: string | null
  buyer_street?: string | null
  buyer_postal_code?: string | null
  buyer_city?: string | null
  buyer_country?: string | null
  buyer_email?: string | null
}

export interface ShopSubscriptionDto {
  id: number
  game_type: string
  name: string
  status: 'active' | 'past_due' | 'cancelled'
  billing_interval: string
  monthly_gross_cents: number
  tax_rate_percent: number
  started_at: string
  current_period_end: string
  cancel_at_period_end: boolean
}

export interface ShopEntitlementDto {
  id: number
  kind: 'server' | 'role' | 'addon'
  label: string
  status: 'active' | 'suspended' | 'revoked'
  server_id: number | null
  provisioning_status: string | null
  provisioning_error: string | null
  created_at: string
}

export const shopOrderApi = {
  listOrders: () => api<ShopOrderDto[]>('/shop/orders'),
  getOrder: (id: number | string) => api<ShopOrderDto>(`/shop/orders/${id}`),
  createOrder: (payload: ShopOrderCreate) =>
    api<ShopOrderDto>('/shop/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  payDemo: (id: number | string) =>
    api<ShopOrderDto>(`/shop/orders/${id}/demo-pay`, { method: 'POST' }),
  checkout: (id: number | string) =>
    api<{ checkout_url: string }>(`/shop/orders/${id}/checkout`, {
      method: 'POST',
    }),
  listSubscriptions: () => api<ShopSubscriptionDto[]>('/shop/subscriptions'),
  cancelSubscription: (id: number | string) =>
    api<ShopSubscriptionDto>(`/shop/subscriptions/${id}/cancel`, {
      method: 'POST',
    }),
  listEntitlements: () => api<ShopEntitlementDto[]>('/shop/entitlements'),
}

export type ShopStripeMode = 'test' | 'live' | 'unknown'
export type ShopKeySource = 'env' | 'panel' | 'none'

export interface ShopStripeStatusDto {
  configured: boolean
  mode: ShopStripeMode
  secret_key_source: ShopKeySource
  webhook_secret_source: ShopKeySource
  publishable_key: string
}

export interface ShopStripeKeysUpdate {
  secret_key?: string
  webhook_secret?: string
  publishable_key?: string
}

export const shopStripeApi = {
  status: () => api<ShopStripeStatusDto>('/shop/stripe/status'),
  setKeys: (payload: ShopStripeKeysUpdate) =>
    api<ShopStripeStatusDto>('/shop/stripe/keys', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
}

export interface ShopInvoiceLineDto {
  position: number
  description: string
  quantity: number
  unit_code: string
  unit_price_cents: number
  line_net_cents: number
  tax_rate_percent: number
  tax_category: 'S' | 'E'
}

export interface ShopInvoiceSummaryDto {
  id: number
  number: string
  order_id: number
  order_number: string
  type: 'invoice' | 'credit_note'
  status: 'issued' | 'void'
  issued_at: string
  due_date: string
  currency: string
  buyer_reference: string
  net_cents: number
  tax_cents: number
  gross_cents: number
  reference_invoice_id: number | null
  reason: string | null
}

export interface ShopInvoiceDto extends ShopInvoiceSummaryDto {
  seller_name: string
  seller_vat_id: string | null
  buyer_name: string
  buyer_email: string
  lines: ShopInvoiceLineDto[]
}

export const shopInvoiceApi = {
  list: () => api<ShopInvoiceSummaryDto[]>('/shop/invoices'),
  get: (id: number | string) => api<ShopInvoiceDto>(`/shop/invoices/${id}`),
  pdfUrl: (id: number | string) => apiUrl(`/api/shop/invoices/${id}/pdf`),
  xmlUrl: (id: number | string) => apiUrl(`/api/shop/invoices/${id}/xml`),
}

export interface ShopSellerSettingsDto {
  name: string
  street: string
  postal_code: string
  city: string
  country: string
  email: string
  phone: string
  vat_id: string
  tax_number: string
  iban: string
  bic: string
  payment_terms_days: number
  invoice_prefix: string
  small_business: boolean
  missing_fields: string[]
}

export const shopSellerApi = {
  get: () => api<ShopSellerSettingsDto>('/shop/seller'),
  set: (payload: Partial<Omit<ShopSellerSettingsDto, 'missing_fields'>>) =>
    api<ShopSellerSettingsDto>('/shop/seller', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
}
