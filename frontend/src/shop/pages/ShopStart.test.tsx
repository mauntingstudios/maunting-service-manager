import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

const hoisted = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  listAddons: vi.fn(),
  getPromos: vi.fn(),
  getNodeStatus: vi.fn(),
  pingNode: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopCatalogApi: {
      getCatalog: hoisted.getCatalog,
      listAddons: hoisted.listAddons,
      getPromos: hoisted.getPromos,
      getNodeStatus: hoisted.getNodeStatus,
      pingNode: hoisted.pingNode,
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
    game_category: 'steam_game',
    supports_mods: false,
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
    cpu_included: 150,
    cpu_max: 300,
    cpu_step: 50,
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
    game_category: 'steam_game',
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
    cpu_included: 200,
    cpu_max: 600,
    cpu_step: 100,
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
    slug: 'pro-paket',
    name: 'Singra & Tresor Pro',
    description: 'Mehr KI-Tokens und Tresorspeicher direkt ueber deine Rolle.',
    category: 'role' as const,
    price_cents: 799,
    currency: 'EUR',
    billing_interval: 'month',
    tax_rate_percent: 19,
    extra_slots: null,
    extra_storage_mb: null,
    extra_backups: null,
    extra_ai_tokens: null,
    grants_role: true,
    role_benefits: {
      role_name: 'Pro-Kunde',
      vault_quota_bytes: 50 * 1024 * 1024 * 1024,
      ai_daily_tokens: null,
      ai_weekly_tokens: null,
      ai_monthly_tokens: 500000,
      ai_realtime_minutes: 60,
      ai_dictation_minutes: null,
      ai_model_count: 3,
    },
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
    hoisted.getNodeStatus.mockReset().mockResolvedValue([])
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

  it('zeigt Hero, echte Spiele-Karten ohne steam_game-Enum und rollenbasierte Add-ons', async () => {
    zeige()
    expect(
      screen.getByRole('heading', { level: 1, name: i18n.t('shop.hero.titel') }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Palworld' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rust' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Singra & Tresor Pro' })).toBeInTheDocument()
    expect(screen.getByText(/50 GB Tresorspeicher inklusive/)).toBeInTheDocument()
    expect(screen.getByText(/500\.000 KI-Tokens im Monat/)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.hero.statusTitel'))).toBeInTheDocument()
    expect(screen.getAllByText(i18n.t('shop.shortcuts.konto.titel')).length).toBeGreaterThan(0)
    expect(screen.getByText(i18n.t('shop.katalogBand.titel', { count: 2 }))).toBeInTheDocument()
    expect(screen.queryByText('steam_game')).toBeNull()
    expect(screen.queryByText(i18n.t('shop.demo.badge'))).toBeNull()
  })

  it('filtert die Sammlung ueber Suche und Filter-Tabs', async () => {
    zeige()
    await screen.findByRole('heading', { name: 'Palworld' })

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.sammlung.mitMods') }))
    expect(screen.getByRole('heading', { name: 'Rust' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Palworld' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.sammlung.alleSpiele') }))
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

  it('kennzeichnet nicht verfuegbare Tarife mit kontrastreichem Ausverkauft-Badge', async () => {
    hoisted.getCatalog.mockResolvedValue([
      { ...SAMPLE_PLANS[0], available: false, availability_reason: 'insufficient_node_cpu' },
    ])
    zeige()
    const badges = await screen.findAllByText(i18n.t('shop.karte.ausverkauft'))
    expect(badges.length).toBeGreaterThan(0)
    expect(badges.some((el) => el.className.includes('bg-background/95'))).toBe(true)
  })

  it('zeigt Live-Node-Auslastung ohne interne IPs im Shop', async () => {
    hoisted.getNodeStatus.mockResolvedValue([
      {
        id: 1,
        name: 'eu-fra-01',
        location_label: 'Frankfurt DE · RZ 2',
        status: 'online',
        cpu_model: 'AMD EPYC 7763',
        ram_type: 'DDR5 ECC',
        storage_type: 'NVMe SSD',
        ram_free_percent: 64,
        load_level: 'low',
        accepting_orders: true,
      },
    ])
    zeige()
    expect(await screen.findByText('Frankfurt DE · RZ 2')).toBeInTheDocument()
    expect(screen.getByText('DDR5 ECC')).toBeInTheDocument()
    expect(screen.getByText('NVMe SSD')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.nodeStatus.ramFreiProzent', { percent: 64 }))).toBeInTheDocument()
  })

  it('filtert nach Plattformen und misst Node-Ping samt DDoS-Schutz', async () => {
    hoisted.getCatalog.mockResolvedValue([
      { ...SAMPLE_PLANS[0], platforms: ['pc', 'ps5', 'xbox', 'crossplay'] },
      { ...SAMPLE_PLANS[1], platforms: ['pc'] },
    ])
    hoisted.getNodeStatus.mockResolvedValue([
      {
        id: 1,
        name: 'eu-fra-01',
        location_label: 'Frankfurt DE',
        status: 'online',
        cpu_model: 'AMD Ryzen 9 7950X3D',
        ram_type: 'DDR5',
        storage_type: 'NVMe',
        ram_free_percent: 72,
        load_level: 'low',
        accepting_orders: true,
        ddos_provider: 'Famesystems Game-DDoS',
        ddos_game_aware: true,
      },
    ])
    hoisted.pingNode.mockResolvedValue({
      node_id: 1,
      status: 'online',
      server_agent_rtt_ms: 14,
      timestamp_ms: 1700000000000,
    })

    zeige()
    expect(await screen.findByText('Game-Aware DDoS (Famesystems Game-DDoS)')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'PS5' }))
    expect(screen.getByRole('heading', { name: 'Palworld' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Rust' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.nodeStatus.pingTesten') }))
    expect(await screen.findByText(/14 ms/)).toBeInTheDocument()
  })
})
