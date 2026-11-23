import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { SanitizedApiError } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'

const hoisted = vi.hoisted(() => ({
  katalog: [] as Record<string, unknown>[],
  addons: [] as Record<string, unknown>[],
  previewCoupon: vi.fn(),
  getPublicPolicy: vi.fn(),
  createOrder: vi.fn(),
  payDemo: vi.fn(),
  checkout: vi.fn(),
}))

vi.mock('@/components/app/CaptchaWidget', () => ({
  captchaSperrt: (status: string) => status !== 'verified' && status !== 'disabled',
  CaptchaWidget: ({
    onVerify,
    onStatusChange,
    scope,
  }: {
    onVerify: (token: string) => void
    onStatusChange?: (status: 'verified' | 'ready') => void
    scope?: string
  }) => (
    <button
      type="button"
      onClick={() => {
        onVerify('pow-token-7')
        onStatusChange?.('verified')
      }}
    >
      {`ALTCHA (${scope ?? 'default'})`}
    </button>
  ),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopCatalogApi: {
      getCatalog: vi.fn(async () => hoisted.katalog),
      listAddons: vi.fn(async () => hoisted.addons),
      previewCoupon: hoisted.previewCoupon,
      getPublicPolicy: hoisted.getPublicPolicy,
    },
    shopOrderApi: {
      ...actual.shopOrderApi,
      createOrder: hoisted.createOrder,
      payDemo: hoisted.payDemo,
      checkout: hoisted.checkout,
    },
  }
})

import { ShopKasse } from './ShopKasse'

const PALWORLD_PLAN = {
  id: 7,
  game_type: 'palworld',
  game_name: 'Palworld API',
  game_description: 'Testbeschreibung',
  game_category: 'Survival',
  supports_mods: true,
  supports_workshop: true,
  name: 'Standard',
  description: 'Testtarif',
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
  artwork: { source: 'none', url: null, version: null },
}

const KI_ADDON = {
  id: 12,
  slug: 'singra-pro',
  name: 'Singra KI Pro',
  description: 'KI-Paket fuer direkten Chat.',
  category: 'ai_quota',
  price_cents: 499,
  currency: 'EUR',
  billing_interval: 'month',
  tax_rate_percent: 19,
  extra_slots: null,
  extra_storage_mb: null,
  extra_backups: null,
  extra_ai_tokens: 250000,
  grants_role: true,
}

function zeige(start = '/shop/palworld/kasse') {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/shop/:spielId/kasse" element={<ShopKasse />} />
        <Route path="/shop/addon/:addonId/kasse" element={<ShopKasse />} />
      </Routes>
    </MemoryRouter>,
  )
}

function fuelleFormular() {
  fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.email')), {
    target: { value: 'kunde@example.com' },
  })
  fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.name')), {
    target: { value: 'Max Testkunde' },
  })
  fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.strasse')), {
    target: { value: 'Kundenweg 7' },
  })
  fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.plz')), {
    target: { value: '54321' },
  })
  fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.stadt')), {
    target: { value: 'Kundenstadt' },
  })
  fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.kasse.zahlen') }))
}

describe('ShopKasse', () => {
  beforeEach(() => {
    hoisted.katalog = [PALWORLD_PLAN]
    hoisted.addons = [KI_ADDON]
    hoisted.previewCoupon.mockReset()
    hoisted.createOrder.mockReset()
    hoisted.payDemo.mockReset()
    hoisted.checkout.mockReset()
    hoisted.getPublicPolicy.mockReset().mockResolvedValue({
      default_billing_mode: 'prepaid',
      subscription_discount_percent: 12,
      refund_guarantee_days: 14,
      refund_policy_note: '',
      cancel_grace_days: 7,
      auto_subdomain_enabled: false,
      auto_subdomain_zone: '',
      pause_freeze_max_days_per_90d: 0,
      shop_checkout_captcha_enabled: false,
    })
    useAuthStore.setState({ isAuthenticated: false, user: null, isLoading: false })
  })

  it('fordert nicht angemeldete Gaeste zur Anmeldung statt Fake-Demo auf', async () => {
    zeige()
    expect(await screen.findByText('Palworld API')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.kasse.anmeldungTitel'))).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: i18n.t('shop.kopf.anmelden') }),
    ).toHaveAttribute('href', '/login?redirect=%2Fshop%2Fpalworld%2Fkasse')
  })

  it('verlangt eine gueltige E-Mail von angemeldeten Nutzern', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 1, username: 'kunde', is_owner: false } as never,
      isLoading: false,
    })
    zeige()
    expect(await screen.findByText('Palworld API')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.email')), {
      target: { value: 'keine-mail' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.kasse.zahlen') }))
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('shop.kasse.emailUngueltig'))
  })

  it('legt fuer angemeldete Kunden Bestellung an, prueft Handoff-Coupon und App-Return', async () => {
    hoisted.previewCoupon.mockResolvedValue({
      valid: true,
      code: 'SAVE10',
      discount_type: 'percent',
      discount_value: 10,
      discount_cents: 70,
      final_gross_cents: 629,
      reason: null,
    })
    hoisted.createOrder.mockResolvedValue({ id: 42, number: 'MSM-2026-000042' })
    hoisted.checkout.mockRejectedValue(
      new SanitizedApiError('Stripe ist nicht konfiguriert', { status: 409 }),
    )
    hoisted.payDemo.mockResolvedValue({ id: 42, number: 'MSM-2026-000042' })
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 1, username: 'kunde', is_owner: false } as never,
      isLoading: false,
    })

    zeige('/shop/palworld/kasse?coupon=SAVE10&app_return=maunting://checkout/done')
    expect(await screen.findByText('Palworld API')).toBeInTheDocument()
    expect(await screen.findByText(/-0,70\s*€/)).toBeInTheDocument()

    fuelleFormular()

    expect(await screen.findByText('MSM-2026-000042')).toBeInTheDocument()
    expect(hoisted.createOrder).toHaveBeenCalledWith({
      plan_id: 7,
      months: 1,
      billing_mode: 'prepaid',
      ram_mb: 8192,
      cpu: 2,
      slots: 8,
      coupon_code: 'SAVE10',
      buyer_name: 'Max Testkunde',
      buyer_street: 'Kundenweg 7',
      buyer_postal_code: '54321',
      buyer_city: 'Kundenstadt',
      buyer_country: 'DE',
      buyer_email: 'kunde@example.com',
    })
    expect(hoisted.checkout).toHaveBeenCalledWith(42, {
      return_url: 'maunting://checkout/done',
    })
    expect(hoisted.payDemo).toHaveBeenCalledWith(42)
    expect(
      screen.getByRole('link', { name: i18n.t('shop.kasse.zurueckApp') }),
    ).toHaveAttribute('href', 'maunting://checkout/done')
  })

  it('unterstuetzt den direkten Checkout eines eigenstaendigen Add-ons', async () => {
    hoisted.createOrder.mockResolvedValue({ id: 88, number: 'MSM-2026-000088' })
    hoisted.checkout.mockRejectedValue(
      new SanitizedApiError('Stripe ist nicht konfiguriert', { status: 409 }),
    )
    hoisted.payDemo.mockResolvedValue({ id: 88, number: 'MSM-2026-000088' })
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 1, username: 'kunde', is_owner: false } as never,
      isLoading: false,
    })

    zeige('/shop/addon/12/kasse')
    expect(await screen.findByText('Singra KI Pro')).toBeInTheDocument()

    fuelleFormular()
    expect(await screen.findByText('MSM-2026-000088')).toBeInTheDocument()
    expect(hoisted.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        addon_id: 12,
        months: 1,
      }),
    )
  })

  it('erzwingt DIS-ALTCHA im Checkout wenn vom Betreiber aktiviert', async () => {
    hoisted.getPublicPolicy.mockResolvedValue({
      default_billing_mode: 'prepaid',
      subscription_discount_percent: 0,
      refund_guarantee_days: 0,
      refund_policy_note: '',
      cancel_grace_days: 7,
      auto_subdomain_enabled: false,
      auto_subdomain_zone: '',
      pause_freeze_max_days_per_90d: 0,
      shop_checkout_captcha_enabled: true,
    })
    hoisted.createOrder.mockResolvedValue({ id: 91, number: 'MSM-2026-000091' })
    hoisted.checkout.mockRejectedValue(
      new SanitizedApiError('Stripe ist nicht konfiguriert', { status: 409 }),
    )
    hoisted.payDemo.mockResolvedValue({ id: 91, number: 'MSM-2026-000091' })
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 1, username: 'kunde', is_owner: false } as never,
      isLoading: false,
    })

    zeige('/shop/palworld/kasse')
    const captchaBtn = await screen.findByRole('button', { name: 'ALTCHA (shop)' })
    fireEvent.click(captchaBtn)
    fuelleFormular()

    expect(await screen.findByText('MSM-2026-000091')).toBeInTheDocument()
    expect(hoisted.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        plan_id: 7,
        captcha_token: 'pow-token-7',
      }),
    )
  })
})
