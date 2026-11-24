import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

const hoisted = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  listAddons: vi.fn(),
  getPromos: vi.fn(),
  getNodeStatus: vi.fn(),
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

  it('zeigt Storefront mit DVD-Karten (variant=poster), kompakter TrustSection und Add-ons', async () => {
    zeige()
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Palworld' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Palworld' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Rust' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Singra & Tresor Pro' })).toBeInTheDocument()
    expect(screen.getByText(/50 GB Tresorspeicher inklusive/)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.trust.prepaidWert'))).toBeInTheDocument()
    // Keine veraltete Landingpage-Node-Auslastungsliste
    expect(screen.queryByRole('heading', { name: i18n.t('shop.nodeStatus.titel') })).toBeNull()
    // Steam-DVD-Cover nutzt ?variant=poster
    const imgs = document.querySelectorAll('img[src*="variant=poster"]')
    expect(imgs.length).toBeGreaterThanOrEqual(1)
    // Vollflächige Hitbox direkt unter <article>
    const palworldLink = screen.getByRole('link', { name: 'Palworld' })
    expect(palworldLink.parentElement?.tagName).toBe('ARTICLE')
    expect(palworldLink.className).toContain('inset-0')
  })

  it('oeffnet das Plattform-Dropdown auf DVD-Karten per Hover/Klick und schliesst per Escape', async () => {
    hoisted.getCatalog.mockResolvedValue([
      { ...SAMPLE_PLANS[0], platforms: ['pc', 'ps5', 'xbox', 'crossplay'] },
      { ...SAMPLE_PLANS[1], platforms: ['pc'] },
    ])

    zeige()
    const trigger = await screen.findByRole('button', {
      name: i18n.t('shop.karte.plattformenLabel'),
    })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.mouseEnter(trigger.parentElement!)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('PS5')
    expect(tooltip).toHaveTextContent('Xbox')

    fireEvent.keyDown(trigger.parentElement!, { key: 'Escape' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'PS5' }))
    expect(screen.getByRole('heading', { level: 3, name: 'Palworld' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Rust' })).toBeNull()
  })

  it('rendert Hero-Pause-Toggle, Filter-Tabs und Trustpilot-/Discord-Karten', async () => {
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
    const neuFilterBtn = await screen.findByRole('button', { name: i18n.t('shop.katalog.badgeNeu') })
    fireEvent.click(neuFilterBtn)
    expect(screen.getByRole('heading', { level: 3, name: 'Rust' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Palworld' })).toBeNull()

    const toggleBtn = screen.getByRole('button', { name: i18n.t('shop.hero.rotationPausieren') })
    fireEvent.click(toggleBtn)
    expect(
      screen.getByRole('button', { name: i18n.t('shop.hero.rotationFortsetzen') }),
    ).toBeInTheDocument()

    expect(screen.getByRole('link', { name: /Trustpilot/i })).toHaveAttribute(
      'href',
      'https://www.trustpilot.com/review/example.de',
    )
    expect(screen.getByRole('link', { name: /Discord/i })).toHaveAttribute(
      'href',
      'https://discord.gg/maunting',
    )
  })

  it('filtert die Sammlung ueber Suche und Mod-Filter', async () => {
    zeige()
    await screen.findByRole('heading', { level: 3, name: 'Palworld' })

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.sammlung.mitMods') }))
    expect(screen.getByRole('heading', { level: 3, name: 'Rust' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Palworld' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.sammlung.alleSpiele') }))
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'palworld' } })
    expect(screen.getByRole('heading', { level: 3, name: 'Palworld' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 3, name: 'Rust' })).toBeNull()
  })

  it('kennzeichnet gemischte vs partielle DDoS-Abdeckung ehrlich und klappt > 8 Spiele auf', async () => {
    const vieleSpiele = Array.from({ length: 10 }, (_, idx) => ({
      ...SAMPLE_PLANS[0],
      id: idx + 1,
      game_type: `spiel_${idx + 1}`,
      game_name: `Game ${String(idx + 1).padStart(2, '0')}`,
      name: `Plan ${idx + 1}`,
      is_featured: idx < 2,
      pinned_in_hero: idx === 9,
      promo_highlight_text: idx === 9 ? 'Update 2.0' : null,
    }))
    hoisted.getCatalog.mockResolvedValue(vieleSpiele)
    hoisted.getNodeStatus.mockResolvedValue([
      {
        id: 1,
        name: 'eu-1',
        location_label: 'Frankfurt',
        status: 'online',
        cpu_model: null,
        ram_type: 'DDR5',
        storage_type: 'NVMe',
        ram_free_percent: 80,
        load_level: 'low',
        accepting_orders: true,
        ddos_provider: 'Path.net',
        ddos_game_aware: true,
      },
      {
        id: 2,
        name: 'us-2',
        location_label: 'New York',
        status: 'online',
        cpu_model: null,
        ram_type: 'DDR5',
        storage_type: 'NVMe',
        ram_free_percent: 70,
        load_level: 'low',
        accepting_orders: true,
        ddos_provider: null,
        ddos_game_aware: false,
      },
    ])

    zeige()
    expect(await screen.findByText(i18n.t('shop.trust.ddosPartialTitel'))).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: i18n.t('shop.sammlung.alleAnzeigen', { count: 10 }) }),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('shop.sammlung.alleAnzeigen', { count: 10 }) }),
    )
    expect(screen.getByRole('heading', { level: 3, name: 'Game 08' })).toBeInTheDocument()
  })

  it('zeigt typografische Preisauszeichnung bei aktiven Kurzzeit-Tarifen', async () => {
    hoisted.getCatalog.mockResolvedValue([
      {
        ...SAMPLE_PLANS[0],
        price_cents: 1000,
        allow_short_durations: true,
      },
    ])
    hoisted.getPublicPolicy.mockResolvedValue({
      default_billing_mode: 'prepaid',
      subscription_discount_percent: 0,
      refund_guarantee_days: 0,
      refund_policy_note: '',
      cancel_grace_days: 7,
      auto_subdomain_enabled: false,
      auto_subdomain_zone: '',
      shop_short_durations_enabled: true,
      shop_short_duration_tiers: [
        { days: 3, enabled: true, price_factor_percent: 25, min_price_cents: 199 },
        { days: 7, enabled: true, price_factor_percent: 40, min_price_cents: 299 },
        { days: 14, enabled: true, price_factor_percent: 65, min_price_cents: 499 },
      ],
    })

    zeige()
    await screen.findByRole('heading', { level: 3, name: 'Palworld' })
    expect(screen.getAllByText(/2,50 €/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('/ 3 Tage').length).toBeGreaterThanOrEqual(2)
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
      expect(document.querySelector('a[href="/#shop-standorte"]')).toBeNull()
      expect(screen.getByRole('link', { name: i18n.t('shop.kopf.spiele') })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: i18n.t('shop.kopf.addons') })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: i18n.t('shop.kopf.news') })).toBeInTheDocument()
      expect(
        screen.getByRole('link', { name: i18n.t('shop.kopf.dashboard') }),
      ).toBeInTheDocument()
    } finally {
      usePublicSettingsStore.setState({ shop_enabled: prevShopEnabled })
      useAuthStore.setState(prevAuth)
    }
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
  })
})
