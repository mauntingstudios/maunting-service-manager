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
  getPublicPolicy: vi.fn(),
  listPublicNews: vi.fn(),
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
      getPublicPolicy: hoisted.getPublicPolicy,
    },
  }
})

vi.mock('@/api/news', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/news')>()
  return {
    ...actual,
    newsApi: {
      ...actual.newsApi,
      listPublic: hoisted.listPublicNews,
    },
  }
})

import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { ShopKopf } from '../ShopKopf'
import { ShopStart } from './ShopStart'
import { useShopStandortStore } from '../shopStandortStore'

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
    useShopStandortStore.getState().reset()
    hoisted.getCatalog.mockReset().mockResolvedValue(SAMPLE_PLANS)
    hoisted.listAddons.mockReset().mockResolvedValue(SAMPLE_ADDONS)
    hoisted.getNodeStatus.mockReset().mockResolvedValue([])
    hoisted.listPublicNews.mockReset().mockResolvedValue({ items: [], total: 0 })
    hoisted.getPublicPolicy.mockReset().mockResolvedValue({
      default_billing_mode: 'prepaid',
      subscription_discount_percent: 0,
      refund_guarantee_days: 0,
      refund_policy_note: '',
      cancel_grace_days: 7,
      auto_subdomain_enabled: false,
      auto_subdomain_zone: '',
      pause_freeze_max_days_per_90d: 0,
      shop_checkout_captcha_enabled: false,
      shop_trustpilot_enabled: false,
      shop_trustpilot_url: '',
      shop_discord_invite_url: '',
    })
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

  it('zeigt Storefront 2.0 mit Hero, TrustSection und rollenbasierten Add-ons', async () => {
    zeige()
    expect(
      screen.getByRole('heading', { level: 1, name: i18n.t('shop.hero.titel') }),
    ).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Palworld' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Rust' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Singra & Tresor Pro' })).toBeInTheDocument()
    expect(screen.getByText(/50 GB Tresorspeicher inklusive/)).toBeInTheDocument()
    expect(screen.getByText(/500\.000 KI-Tokens im Monat/)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.hero.dockTitel'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.trust.prepaidWert'))).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('shop.trust.trustpilotTitel'))).toBeNull()
    expect(screen.queryByText('steam_game')).toBeNull()
    expect(screen.queryByText(i18n.t('shop.demo.badge'))).toBeNull()
  })

  it('rendert Hero-Pause-Toggle, kuratierte Schienen ab 2 Spielen und konfigurierte Trust-Links', async () => {
    hoisted.getCatalog.mockResolvedValue([
      { ...SAMPLE_PLANS[0], is_featured: true, is_bestseller: true, recent_order_count: 8 },
      { ...SAMPLE_PLANS[1], is_featured: true, is_bestseller: true, is_new: true },
    ])
    hoisted.getPublicPolicy.mockResolvedValue({
      default_billing_mode: 'prepaid',
      subscription_discount_percent: 10,
      refund_guarantee_days: 14,
      refund_policy_note: '',
      cancel_grace_days: 7,
      auto_subdomain_enabled: false,
      auto_subdomain_zone: '',
      pause_freeze_max_days_per_90d: 0,
      shop_checkout_captcha_enabled: false,
      shop_trustpilot_enabled: true,
      shop_trustpilot_url: 'https://www.trustpilot.com/review/example.de',
      shop_discord_invite_url: 'https://discord.gg/maunting',
    })

    zeige()
    expect(
      await screen.findByRole('heading', { name: i18n.t('shop.katalog.meistgemietetTitel') }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: i18n.t('shop.katalog.empfohlenTitel') }),
    ).toBeInTheDocument()
    // Neu im Katalog hat nur 1 passendes Spiel (< 2), bleibt daher ausgeblendet
    expect(screen.queryByRole('heading', { name: i18n.t('shop.katalog.neuTitel') })).toBeNull()

    // Pause/Play-Steuerung im Hero ohne aria-pressed
    const toggleBtn = screen.getByRole('button', { name: i18n.t('shop.hero.rotationPausieren') })
    expect(toggleBtn).not.toHaveAttribute('aria-pressed')
    fireEvent.click(toggleBtn)
    expect(
      screen.getByRole('button', { name: i18n.t('shop.hero.rotationFortsetzen') }),
    ).toBeInTheDocument()

    // Konfigurierte externe Trustpilot- & Discord-Karten erscheinen
    const trustLink = screen.getByRole('link', { name: /Trustpilot/i })
    expect(trustLink).toHaveAttribute('href', 'https://www.trustpilot.com/review/example.de')
    const discordLink = screen.getByRole('link', { name: /Discord/i })
    expect(discordLink).toHaveAttribute('href', 'https://discord.gg/maunting')
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
    expect(screen.getByText('Game-Aware DDoS · Famesystems Game-DDoS')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.trust.ddosSpotlightTitelGameAware'))).toBeInTheDocument()
    expect(screen.getByText('Famesystems Game-DDoS')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'PS5' }))
    expect(screen.getByRole('heading', { name: 'Palworld' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Rust' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.nodeStatus.pingTesten') }))
    expect((await screen.findAllByText(/14 ms/)).length).toBeGreaterThanOrEqual(2)
  })

  it('rendert ShopNewsTeaser bei veroeffentlichten Beitraegen und blendet leeren Add-ons-Kasten aus', async () => {
    hoisted.listAddons.mockResolvedValue([])
    hoisted.listPublicNews.mockResolvedValue({
      total: 1,
      items: [
        {
          id: 7,
          slug: 'palworld-update-05',
          title: 'Palworld Crossplay-Update',
          summary: 'Volle Unterstützung für dedizierte Crossplay-Welten.',
          content_markdown: 'Details …',
          category: 'game_update',
          related_game_type: 'palworld',
          sources: [],
          cover_url: null,
          is_published: true,
          is_pinned: false,
          published_at: '2026-11-24T01:00:00Z',
          author_display_name: 'Redaktion',
          created_at: '2026-11-24T01:00:00Z',
          updated_at: '2026-11-24T01:00:00Z',
        },
      ],
    })

    zeige()
    expect(
      await screen.findByRole('heading', { name: i18n.t('shop.newsTeaser.titel') }),
    ).toBeInTheDocument()
    expect(screen.getByText('Palworld Crossplay-Update')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('shop.addons.leerText'))).toBeNull()
  })

  it('rendert ShopKopf ohne DE/EN-Switcher und ohne Support-Button', () => {
    const prevShopEnabled = usePublicSettingsStore.getState().shop_enabled
    const prevAuth = {
      isAuthenticated: useAuthStore.getState().isAuthenticated,
      user: useAuthStore.getState().user,
    }
    try {
      usePublicSettingsStore.setState({ shop_enabled: true })
      useAuthStore.setState({
        isAuthenticated: true,
        user: {
          id: 1,
          username: 'tester',
          email: 'tester@example.com',
          role: 'admin',
        } as ReturnType<typeof useAuthStore.getState>['user'],
      })

      render(
        <MemoryRouter>
          <ShopKopf />
        </MemoryRouter>,
      )
      expect(screen.queryByRole('button', { name: 'DE' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'EN' })).toBeNull()
      expect(screen.queryByText(i18n.t('shop.kopf.support'))).toBeNull()
      expect(screen.queryByText(i18n.t('shop.kopf.kiChat'))).toBeNull()
      expect(screen.getByRole('link', { name: i18n.t('shop.kopf.news') })).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: i18n.t('shop.kopf.dashboard') }),
      ).toBeInTheDocument()
    } finally {
      usePublicSettingsStore.setState({ shop_enabled: prevShopEnabled })
      useAuthStore.setState(prevAuth)
    }
  })

  it('merkt gewaehlten Standort und Ping-Werte im Standort-Store', async () => {
    hoisted.getNodeStatus.mockResolvedValue([
      {
        id: 5,
        name: 'eu-fra-perf',
        location_label: 'Frankfurt Performance',
        status: 'online',
        cpu_model: null,
        ram_type: 'DDR5 ECC',
        storage_type: 'NVMe SSD',
        ram_free_percent: 80,
        load_level: 'low',
        accepting_orders: true,
        hardware_tier_label: 'Performance',
        shop_surcharge_cents: 350,
      },
    ])
    hoisted.pingNode.mockResolvedValue({
      node_id: 5,
      status: 'online',
      server_agent_rtt_ms: 19,
      timestamp_ms: 1700000000000,
    })

    zeige()
    expect(await screen.findByText('Frankfurt Performance')).toBeInTheDocument()
    expect(screen.getByText('Performance')).toBeInTheDocument()
    expect(screen.getByText(/\+3,50/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.nodeStatus.pingTesten') }))
    expect((await screen.findAllByText(/19 ms/)).length).toBeGreaterThanOrEqual(2)
    expect(useShopStandortStore.getState().pingMsByNodeId[5]?.ms).toBe(19)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.nodeStatus.standortWaehlen') }))
    expect(useShopStandortStore.getState().ausgewaehlteNodeId).toBe(5)
    expect(
      screen.getByRole('button', { name: i18n.t('shop.nodeStatus.standortAusgewaehlt') }),
    ).toHaveAttribute('aria-pressed', 'true')
  })
})
