import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

const hoisted = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  listAddons: vi.fn(),
  getPromos: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopCatalogApi: {
      getCatalog: hoisted.getCatalog,
      listAddons: hoisted.listAddons,
      getPromos: hoisted.getPromos,
    },
  }
})

import { ShopStart } from './ShopStart'

const SAMPLE_PLANS = [
  {
    id: 1,
    game_type: 'palworld',
    game_name: 'Palworld',
    game_description: 'Kreaturen sammeln und gemeinsam überleben.',
    game_category: 'Survival',
    supports_mods: true,
    supports_workshop: false,
    name: 'Palworld Standard',
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
    artwork: { source: 'steam', url: '/api/shop/artwork/palworld', version: null },
  },
  {
    id: 2,
    game_type: 'rust',
    game_name: 'Rust',
    game_description: 'PvP-Survival-Welt.',
    game_category: 'PvP',
    supports_mods: true,
    supports_workshop: true,
    name: 'Rust Starter',
    description: null,
    price_cents: 999,
    currency: 'EUR',
    billing_interval: 'month',
    tax_rate_percent: 19,
    ram_included_mb: 8192,
    ram_max_mb: 32768,
    ram_step_mb: 1024,
    price_per_ram_step_cents: 90,
    cpu_included: 2,
    cpu_max: 6,
    cpu_step: 1,
    price_per_cpu_step_cents: 150,
    slots_included: 50,
    slots_max: 200,
    slots_step: 10,
    price_per_slot_step_cents: 20,
    artwork: { source: 'none', url: null, version: null },
  },
]

const SAMPLE_ADDONS = [
  {
    id: 10,
    slug: 'ai-pro',
    name: 'Singra KI-Kontingent Pro',
    description: 'Mehr KI-Tokens direkt im Chat.',
    category: 'ai_quota' as const,
    price_cents: 499,
    currency: 'EUR',
    billing_interval: 'month',
    tax_rate_percent: 19,
    extra_slots: null,
    extra_storage_mb: null,
    extra_backups: null,
    extra_ai_tokens: 500000,
    grants_role: true,
  },
]

function zeige() {
  return render(
    <MemoryRouter>
      <ShopStart />
    </MemoryRouter>,
  )
}

describe('ShopStart', () => {
  beforeEach(() => {
    hoisted.getCatalog.mockReset().mockResolvedValue(SAMPLE_PLANS)
    hoisted.listAddons.mockReset().mockResolvedValue(SAMPLE_ADDONS)
    hoisted.getPromos.mockReset().mockResolvedValue({
      banner: null,
      banners: [],
      badges: [
        {
          code: 'ALL20',
          name: 'Sommeraktion',
          discount_type: 'percent',
          discount_value: 20,
          scope: 'all',
          target_plan_ids: [],
        },
      ],
    })
  })

  it('zeigt Hero, echte Spiele-Karten und Add-ons aus der API ohne Demo-Banner', async () => {
    zeige()
    expect(
      screen.getByRole('heading', { level: 1, name: i18n.t('shop.hero.titel') }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Palworld' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rust' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Singra KI-Kontingent Pro' })).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('shop.demo.badge'))).toBeNull()
  })

  it('filtert die Sammlung ueber Suche und Kategorie-Pills', async () => {
    zeige()
    await screen.findByRole('heading', { name: 'Palworld' })

    fireEvent.click(screen.getByRole('button', { name: 'PvP' }))
    expect(screen.getByRole('heading', { name: 'Rust' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Palworld' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.sammlung.alleKategorien') }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'palworld' } })
    expect(screen.getByRole('heading', { name: 'Palworld' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Rust' })).toBeNull()
  })

  it('zeigt einen produktiven Leerzustand wenn noch keine Tarife hinterlegt sind', async () => {
    hoisted.getCatalog.mockResolvedValue([])
    hoisted.listAddons.mockResolvedValue([])
    zeige()
    expect(
      await screen.findByText(i18n.t('shop.sammlung.keineTarifeTitel')),
    ).toBeInTheDocument()
  })
})
