import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

const hoisted = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  listAddons: vi.fn(),
  checkAvailability: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopCatalogApi: {
      getCatalog: hoisted.getCatalog,
      listAddons: hoisted.listAddons,
      checkAvailability: hoisted.checkAvailability,
    },
  }
})

import { ShopSpiel } from './ShopSpiel'

const PALWORLD_PLAN = {
  id: 7,
  game_type: 'palworld',
  game_name: 'Palworld',
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

function KasseZiel() {
  const location = useLocation()
  return (
    <div data-testid="kasse">
      {location.search}|{JSON.stringify(location.state)}
    </div>
  )
}

function zeige(start: string) {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/shop/:spielId" element={<ShopSpiel />} />
        <Route path="/shop/:spielId/kasse" element={<KasseZiel />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ShopSpiel', () => {
  beforeEach(() => {
    hoisted.getCatalog.mockReset().mockResolvedValue([PALWORLD_PLAN])
    hoisted.listAddons.mockReset().mockResolvedValue([])
    hoisted.checkAvailability.mockReset().mockResolvedValue({
      available: true,
      reason: null,
      available_nodes: 1,
      max_ram_mb: 16384,
      max_cpu: 4,
    })
  })

  it('zeigt das Spiel und reicht Konfiguration plus Coupon/App-Return weiter', async () => {
    zeige('/shop/palworld?coupon=FLASH15&app_return=maunting://done')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Palworld' }),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.spiel.weiterKasse') }))
    const ziel = screen.getByTestId('kasse')
    expect(ziel).toHaveTextContent('palworld')
    expect(ziel).toHaveTextContent('coupon=FLASH15')
    expect(ziel).toHaveTextContent('app_return=maunting%3A%2F%2Fdone')
  })

  it('aktualisiert den Gesamtpreis bei laengerer Laufzeit', async () => {
    zeige('/shop/palworld')
    await screen.findByRole('heading', { level: 1, name: 'Palworld' })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.spiel.monate', { count: 12 }) }))
    expect(screen.getByText(/67,10/)).toBeInTheDocument()
  })

  it('zeigt bei unbekannter ID eine Fehlerflaeche', async () => {
    zeige('/shop/gibtesnicht')
    expect(await screen.findByText(i18n.t('shop.spiel.nichtGefundenTitel'))).toBeInTheDocument()
  })

  it('sperrt den Checkout bei fehlender Node-Kapazitaet (Ausverkauft-Schutz)', async () => {
    hoisted.checkAvailability.mockResolvedValue({
      available: false,
      reason: 'insufficient_node_ram',
      available_nodes: 0,
      max_ram_mb: 2048,
      max_cpu: 1,
    })
    zeige('/shop/palworld')
    expect(
      await screen.findByText(i18n.t('shop.spiel.ausverkauftTitel')),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: i18n.t('shop.spiel.keineKapazitaetButton') }),
    ).toBeDisabled()
  })
})
