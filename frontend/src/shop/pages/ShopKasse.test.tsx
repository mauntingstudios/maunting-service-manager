import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { SanitizedApiError } from '@/api/client'
import { useAuthStore } from '@/stores/authStore'

const hoisted = vi.hoisted(() => ({
  katalog: [] as Record<string, unknown>[],
  createOrder: vi.fn(),
  payDemo: vi.fn(),
  checkout: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopCatalogApi: { getCatalog: vi.fn(async () => hoisted.katalog) },
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
  game_category: 'steam_game',
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

function zeige() {
  return render(
    <MemoryRouter initialEntries={['/shop/palworld/kasse']}>
      <Routes>
        <Route path="/shop/:spielId/kasse" element={<ShopKasse />} />
      </Routes>
    </MemoryRouter>,
  )
}

function fuelleFormular() {
  fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.email')), {
    target: { value: 'kunde@example.com' },
  })
  fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.karte')), {
    target: { value: '4242 4242 4242 4242' },
  })
  fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.kasse.zahlen') }))
}

describe('ShopKasse', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    hoisted.katalog = []
    hoisted.createOrder.mockReset()
    hoisted.payDemo.mockReset()
    hoisted.checkout.mockReset()
    useAuthStore.setState({ isAuthenticated: false, user: null, isLoading: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('verlangt eine gueltige E-Mail', () => {
    zeige()
    fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.email')), {
      target: { value: 'keine-mail' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.karte')), {
      target: { value: '4242 4242 4242 4242' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.kasse.zahlen') }))
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('shop.kasse.emailUngueltig'))
  })

  it('schliesst die Demo-Zahlung ohne Netzwerkaufruf ab', () => {
    zeige()
    fuelleFormular()
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(screen.getByRole('status')).toHaveTextContent('MSM-DEMO-')
    expect(hoisted.createOrder).not.toHaveBeenCalled()
  })

  it('legt fuer angemeldete Kunden eine echte Bestellung an', async () => {
    vi.useRealTimers()
    hoisted.katalog = [PALWORLD_PLAN]
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

    zeige()
    // Erst wenn der Katalog da ist, zeigt die Kasse den API-Namen.
    expect(await screen.findByText('Palworld API')).toBeInTheDocument()

    fuelleFormular()

    expect(await screen.findByText('MSM-2026-000042')).toBeInTheDocument()
    expect(hoisted.createOrder).toHaveBeenCalledWith({
      plan_id: 7,
      months: 1,
      ram_mb: 8192,
      cpu: 2,
      slots: 8,
    })
    expect(hoisted.checkout).toHaveBeenCalledWith(42)
    expect(hoisted.payDemo).toHaveBeenCalledWith(42)
  })
})
