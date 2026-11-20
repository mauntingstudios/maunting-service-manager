import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => true,
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  const plan = {
    id: 1,
    game_type: 'palworld',
    name: 'Palworld Tarif',
    description: null,
    price_cents: 699,
    currency: 'EUR',
    billing_interval: 'month',
    tax_rate_percent: 19,
    ram_included_mb: 8192,
    ram_max_mb: 16384,
    ram_step_mb: 1024,
    price_per_ram_step_cents: 90,
    cpu_included: 2,
    cpu_max: 4,
    cpu_step: 1,
    price_per_cpu_step_cents: 150,
    slots_included: 8,
    slots_max: 32,
    slots_step: 1,
    price_per_slot_step_cents: 30,
    node_id: null,
    role_id: null,
    artwork_mode: 'steam',
    active: true,
    sort_order: 0,
    created_at: '2026-11-20T00:00:00+00:00',
    updated_at: '2026-11-20T00:00:00+00:00',
    artwork: {
      source: 'steam',
      url: '/api/shop/artwork/palworld?v=steam-1623730',
      version: 'steam-1623730',
    },
  }
  return {
    ...actual,
    shopAdminApi: {
      listPlans: vi.fn().mockResolvedValue([plan]),
      createPlan: vi.fn(),
      updatePlan: vi.fn(),
      deletePlan: vi.fn(),
      uploadArtwork: vi.fn(),
      resetArtwork: vi.fn(),
    },
  }
})

vi.mock('@/api/client', () => ({
  api: vi.fn().mockResolvedValue([{ id: 'palworld', name: 'Palworld' }]),
}))

import { ShopPlansEditor } from './ShopPlansEditor'

describe('ShopPlansEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('listet Tarife und oeffnet den Editor', async () => {
    render(<ShopPlansEditor />)
    expect(await screen.findByText('Palworld Tarif')).toBeInTheDocument()
    expect(screen.getByText(/6,99/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.shop.plans.neu') }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })
})
