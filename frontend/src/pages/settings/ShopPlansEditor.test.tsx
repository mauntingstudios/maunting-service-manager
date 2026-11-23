import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => true,
}))

const { listPlansMock, updatePlanMock } = vi.hoisted(() => ({
  listPlansMock: vi.fn(),
  updatePlanMock: vi.fn(),
}))

const SAMPLE_PLAN = {
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
  artwork_mode: 'steam' as const,
  active: true,
  sort_order: 0,
  created_at: '2026-11-20T00:00:00+00:00',
  updated_at: '2026-11-20T00:00:00+00:00',
  artwork: {
    source: 'steam' as const,
    url: '/api/shop/artwork/palworld?v=steam-1623730',
    version: 'steam-1623730',
  },
}

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopAdminApi: {
      listPlans: listPlansMock,
      createPlan: vi.fn(),
      updatePlan: updatePlanMock,
      deletePlan: vi.fn(),
      uploadArtwork: vi.fn(),
      resetArtwork: vi.fn(),
    },
  }
})

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return {
    ...actual,
    api: vi.fn().mockResolvedValue([{ id: 'palworld', name: 'Palworld' }]),
  }
})

import { ShopPlansEditor } from './ShopPlansEditor'

describe('ShopPlansEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listPlansMock.mockResolvedValue([SAMPLE_PLAN])
    updatePlanMock.mockResolvedValue({ ...SAMPLE_PLAN, active: false })
  })

  it('listet Tarife im Regal mit Coverbild und oeffnet den 3-Tab-Editor', async () => {
    const { container } = render(<ShopPlansEditor />)
    expect(await screen.findByText('Palworld Tarif')).toBeInTheDocument()
    expect(screen.getByText(/6,99/)).toBeInTheDocument()

    // Coverbild des Spiels im Produkt-Regal
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', expect.stringContaining('/api/shop/artwork/palworld'))

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.shop.plans.neu') }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText(i18n.t('settings.shop.plans.lifetimePreis'))).toBeInTheDocument()
    expect(
      screen.getByRole('switch', { name: i18n.t('settings.shop.plans.allowGameSwitch') }),
    ).toBeInTheDocument()

    // Dialog-Tabs wechseln (Ressourcen & Bilder)
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.shop.plans.tabRessourcen') }))
    expect(screen.getByLabelText(i18n.t('settings.shop.plans.ramIncluded'))).toBeVisible()

    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.shop.plans.tabBilder') }))
    expect(screen.getByLabelText(i18n.t('settings.shop.plans.artwork'))).toBeVisible()
  })

  it('schaltet Produkte direkt im Regal aktiv/ausgeblendet und wechselt zur Listenansicht', async () => {
    render(<ShopPlansEditor />)
    expect(await screen.findByText('Palworld Tarif')).toBeInTheDocument()

    const regalSwitch = screen.getByRole('switch', {
      name: `Palworld Tarif: ${i18n.t('settings.shop.plans.imRegal')}`,
    })
    fireEvent.click(regalSwitch)

    await waitFor(() => {
      expect(updatePlanMock).toHaveBeenCalledWith(1, { active: false })
    })

    // Umschalten auf kompakte Listenansicht
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('settings.shop.plans.ansichtListe') }),
    )
    expect(
      screen.getByRole('button', { name: i18n.t('settings.shop.plans.ansichtListe') }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
