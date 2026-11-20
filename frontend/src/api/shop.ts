import { api } from './client'

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
