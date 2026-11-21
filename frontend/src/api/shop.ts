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
  supports_slots?: boolean
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
  available?: boolean
  availability_reason?: string | null
  max_available_ram_mb?: number | null
  max_available_cpu?: number | null
}

export interface ShopAvailabilityResponse {
  available: boolean
  reason?: string | null
  available_nodes: number
  max_ram_mb?: number | null
  max_cpu?: number | null
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

export type ShopAddonCategory = 'ai_quota' | 'slots' | 'backups' | 'storage' | 'role'

export interface ShopAddon {
  id: number
  slug: string
  name: string
  description: string | null
  category: ShopAddonCategory
  price_cents: number
  currency: string
  billing_interval: string
  tax_rate_percent: number
  extra_slots: number | null
  extra_storage_mb: number | null
  extra_backups: number | null
  extra_ai_tokens: number | null
  role_id: number | null
  active: boolean
  sort_order: number
  created_at: string
  updated_at: string
}

export interface ShopAddonWrite {
  slug: string
  name: string
  description: string | null
  category: ShopAddonCategory
  price_cents: number
  currency: string
  billing_interval: 'month'
  tax_rate_percent: number
  extra_slots: number | null
  extra_storage_mb: number | null
  extra_backups: number | null
  extra_ai_tokens: number | null
  role_id: number | null
  active: boolean
  sort_order: number
}

export interface ShopCatalogAddon {
  id: number
  slug: string
  name: string
  description: string | null
  category: ShopAddonCategory
  price_cents: number
  currency: string
  billing_interval: string
  tax_rate_percent: number
  extra_slots: number | null
  extra_storage_mb: number | null
  extra_backups: number | null
  extra_ai_tokens: number | null
  grants_role: boolean
}

export interface ShopAddonSwitchResponse {
  subscription: ShopSubscriptionDto
  entitlement: ShopEntitlementDto
  previous_addon_id: number | null
  new_addon_id: number
  role_changed: boolean
}

export type ShopCouponDiscountType = 'percent' | 'fixed_cents'
export type ShopCouponScope = 'all' | 'plans' | 'addons'

export interface ShopCoupon {
  id: number
  code: string
  name: string
  promo_text: string | null
  discount_type: ShopCouponDiscountType
  discount_value: number
  currency: string
  scope: ShopCouponScope
  target_plan_ids: number[]
  min_gross_cents: number
  max_redemptions: number | null
  redemption_count: number
  valid_from: string | null
  valid_until: string | null
  show_badge: boolean
  show_banner: boolean
  banner_cooldown_hours: number
  stripe_coupon_id: string | null
  stripe_promotion_code_id: string | null
  active: boolean
  created_at: string
  updated_at: string
}

export interface ShopCouponWrite {
  code: string
  name: string
  promo_text: string | null
  discount_type: ShopCouponDiscountType
  discount_value: number
  currency: string
  scope: ShopCouponScope
  target_plan_ids: number[]
  min_gross_cents: number
  max_redemptions: number | null
  valid_from: string | null
  valid_until: string | null
  show_badge: boolean
  show_banner: boolean
  banner_cooldown_hours: number
  active: boolean
}

export interface ShopCouponPreviewResponse {
  valid: boolean
  code: string
  discount_type: ShopCouponDiscountType | null
  discount_value: number | null
  discount_cents: number
  final_gross_cents: number
  reason: string | null
}

export interface ShopPublicBannerPromo {
  code: string
  name: string
  promo_text: string | null
  discount_type: ShopCouponDiscountType
  discount_value: number
  scope: ShopCouponScope
  cooldown_hours: number
  valid_until: string | null
}

export interface ShopPublicBadgePromo {
  code: string
  name: string
  discount_type: ShopCouponDiscountType
  discount_value: number
  scope: ShopCouponScope
  target_plan_ids: number[]
}

export interface ShopPublicPromosResponse {
  banner: ShopPublicBannerPromo | null
  banners?: ShopPublicBannerPromo[]
  badges: ShopPublicBadgePromo[]
}

export interface ShopStatsResponse {
  total_orders: number
  paid_orders: number
  pending_orders: number
  refunded_orders: number
  paid_gross_cents: number
  paid_net_cents: number
  refunded_gross_cents: number
  active_subscriptions: number
  active_addon_subscriptions: number
  active_coupons: number
  coupon_redemptions: number
}

export interface ShopAdminManualOrderCreate {
  user_id: number
  plan_id?: number | null
  addon_id?: number | null
  months: 1 | 3 | 12
  coupon_code?: string | null
  mark_paid: boolean
  note?: string | null
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
  listAddons: () => api<ShopAddon[]>('/shop/addons'),
  createAddon: (payload: ShopAddonWrite) =>
    api<ShopAddon>('/shop/addons', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateAddon: (id: number, payload: Partial<ShopAddonWrite>) =>
    api<ShopAddon>(`/shop/addons/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteAddon: (id: number) =>
    api<void>(`/shop/addons/${id}`, { method: 'DELETE' }),
  listCoupons: () => api<ShopCoupon[]>('/shop/coupons'),
  createCoupon: (payload: ShopCouponWrite) =>
    api<ShopCoupon>('/shop/coupons', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCoupon: (id: number, payload: Partial<ShopCouponWrite>) =>
    api<ShopCoupon>(`/shop/coupons/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteCoupon: (id: number) =>
    api<void>(`/shop/coupons/${id}`, { method: 'DELETE' }),
  syncCouponStripe: (id: number) =>
    api<ShopCoupon>(`/shop/coupons/${id}/stripe-sync`, { method: 'POST' }),
}

export const shopCatalogApi = {
  getCatalog: () => api<ShopCatalogPlan[]>('/shop/catalog'),
  listAddons: (category?: ShopAddonCategory) =>
    api<ShopCatalogAddon[]>(
      category ? `/shop/catalog/addons?category=${encodeURIComponent(category)}` : '/shop/catalog/addons',
    ),
  getPromos: () => api<ShopPublicPromosResponse>('/shop/promos'),
  previewCoupon: (payload: {
    code: string
    kind?: 'plan' | 'addon'
    plan_id?: number | null
    gross_cents: number
  }) =>
    api<ShopCouponPreviewResponse>('/shop/coupons/preview', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  checkAvailability: (payload: {
    plan_id: number
    ram_mb?: number | null
    cpu?: number | null
  }) =>
    api<ShopAvailabilityResponse>('/shop/availability', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
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
  plan_id?: number | null
  addon_id?: number | null
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
  coupon_code?: string | null
  coupon_discount_cents?: number
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
  plan_id?: number | null
  addon_id?: number | null
  months: 1 | 3 | 12
  ram_mb?: number | null
  cpu?: number | null
  slots?: number | null
  coupon_code?: string | null
  buyer_name?: string | null
  buyer_street?: string | null
  buyer_postal_code?: string | null
  buyer_city?: string | null
  buyer_country?: string | null
  buyer_email?: string | null
}

export interface ShopSubscriptionDto {
  id: number
  plan_id?: number | null
  addon_id?: number | null
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
  addon_id?: number | null
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
  checkout: (
    id: number | string,
    body?: { return_url?: string; cancel_url?: string },
  ) =>
    api<{ checkout_url: string }>(`/shop/orders/${id}/checkout`, {
      method: 'POST',
      ...(body && (body.return_url || body.cancel_url)
        ? { body: JSON.stringify(body) }
        : {}),
    }),
  listSubscriptions: () => api<ShopSubscriptionDto[]>('/shop/subscriptions'),
  switchAddon: (subscriptionId: number | string, targetAddonId: number) =>
    api<ShopAddonSwitchResponse>(`/shop/subscriptions/${subscriptionId}/addon-switch`, {
      method: 'POST',
      body: JSON.stringify({ target_addon_id: targetAddonId }),
    }),
  cancelSubscription: (id: number | string) =>
    api<ShopSubscriptionDto>(`/shop/subscriptions/${id}/cancel`, {
      method: 'POST',
    }),
  listEntitlements: () => api<ShopEntitlementDto[]>('/shop/entitlements'),
  getServerSubscription: (serverId: number | string) =>
    api<ShopServerSubscriptionDto>(`/shop/servers/${serverId}/subscription`),
  getServerPlayers: (serverId: number | string) =>
    api<ShopServerPlayersDto>(`/shop/servers/${serverId}/players`),
  updateServerSlots: (serverId: number | string, slots: number) =>
    api<ShopServerSlotsResponseDto>(`/shop/servers/${serverId}/slots`, {
      method: 'POST',
      body: JSON.stringify({ slots }),
    }),
}

export interface ShopServerSubscriptionDto {
  has_subscription: boolean
  subscription: ShopSubscriptionDto | null
  entitlement: ShopEntitlementDto | null
  ram_mb: number | null
  cpu: number | null
  slots: number | null
}

export interface ShopServerPlayersDto {
  server_id: number
  protocol: string
  online: boolean
  players: number | null
  max_players: number | null
  server_name: string | null
  booked_slots: number | null
  slot_exceeded: boolean
  warning: string | null
  error: string | null
}

export interface ShopServerSlotsResponseDto {
  server_id: number
  slots: number
  previous_slots: number | null
  target_type: string
  downgrade_warning: boolean
  restart_required: boolean
  live_players: number | null
}

export interface ShopAdminOrderDto extends ShopOrderDto {
  user_id: number
  username: string | null
  entitlements: ShopEntitlementDto[]
}

export interface ShopPaymentEventDto {
  id: number
  event_id: string
  event_type: string
  order_id: number | null
  status: string
  received_at: string
}

export interface ShopReconciliationDto {
  orders_checked: number
  orders_marked_paid: number
  orders_expired: number
  invoices_issued: number
  entitlements_synced: number
  pending_orders_remaining: number
  failed_entitlements_remaining: number
  errors: string[]
}

export interface ShopRefundResponseDto {
  order: ShopOrderDto
  credit_note_number: string | null
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

export const shopAdminOpsApi = {
  getStats: () => api<ShopStatsResponse>('/shop/admin/stats'),
  listOrders: (limit = 50) =>
    api<ShopAdminOrderDto[]>(`/shop/admin/orders?limit=${limit}`),
  createManualOrder: (payload: ShopAdminManualOrderCreate) =>
    api<ShopAdminOrderDto>('/shop/admin/orders', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  refundOrder: (orderId: number, reason: string) =>
    api<ShopRefundResponseDto>(`/shop/orders/${orderId}/refund`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  syncEntitlement: (entitlementId: number) =>
    api<ShopEntitlementDto>(`/shop/entitlements/${entitlementId}/sync`, {
      method: 'POST',
    }),
  reconcile: () =>
    api<ShopReconciliationDto>('/shop/reconcile', { method: 'POST' }),
  listInvoices: (limit = 50) =>
    api<ShopInvoiceSummaryDto[]>(`/shop/admin/invoices?limit=${limit}`),
  creditInvoice: (invoiceId: number, reason: string) =>
    api<ShopInvoiceDto>(`/shop/invoices/${invoiceId}/credit`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  exportInvoicesUrl: (year?: number) =>
    year
      ? apiUrl(`/api/shop/invoices/export?year=${year}`)
      : apiUrl('/api/shop/invoices/export'),
  adminInvoicePdfUrl: (id: number) => apiUrl(`/api/shop/admin/invoices/${id}/pdf`),
  adminInvoiceXmlUrl: (id: number) => apiUrl(`/api/shop/admin/invoices/${id}/xml`),
  listWebhooks: (limit = 50) =>
    api<ShopPaymentEventDto[]>(`/shop/admin/webhooks?limit=${limit}`),
}
