import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

const hoisted = vi.hoisted(() => ({
  getCatalog: vi.fn(),
  listAddons: vi.fn(),
  checkAvailability: vi.fn(),
  getPublicPolicy: vi.fn(),
  getNodeStatus: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopCatalogApi: {
      getCatalog: hoisted.getCatalog,
      listAddons: hoisted.listAddons,
      checkAvailability: hoisted.checkAvailability,
      getPublicPolicy: hoisted.getPublicPolicy,
      getNodeStatus: hoisted.getNodeStatus,
    },
  }
})

import { ShopSpiel } from './ShopSpiel'
import { useShopStandortStore } from '../shopStandortStore'

const PALWORLD_PLAN = {
  id: 7,
  game_type: 'palworld',
  game_name: 'Palworld',
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
  cpu_included: 150,
  cpu_max: 300,
  cpu_step: 50,
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
    useShopStandortStore.getState().reset()
    hoisted.getCatalog.mockReset().mockResolvedValue([PALWORLD_PLAN])
    hoisted.listAddons.mockReset().mockResolvedValue([])
    hoisted.getNodeStatus.mockReset().mockResolvedValue([])
    hoisted.checkAvailability.mockReset().mockResolvedValue({
      available: true,
      reason: null,
      available_nodes: 1,
      max_ram_mb: 16384,
      max_cpu: 4,
    })
    hoisted.getPublicPolicy.mockReset().mockResolvedValue({
      default_billing_mode: 'prepaid',
      subscription_discount_percent: 12,
      refund_guarantee_days: 14,
      refund_policy_note: 'Direkt auf die ursprüngliche Zahlungsart.',
      cancel_grace_days: 7,
      auto_subdomain_enabled: false,
      auto_subdomain_zone: '',
    })
  })

  it('zeigt das Spiel und reicht Konfiguration plus Coupon/App-Return weiter', async () => {
    zeige('/shop/palworld?coupon=FLASH15&app_return=maunting://done')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Palworld' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1,5 Kerne (150 %)')).toBeInTheDocument()
    expect(screen.getAllByText(i18n.t('shop.spiel.modsInklusive')).length).toBeGreaterThan(0)
    expect(screen.getByText(i18n.t('shop.spiel.stripeHinweis'))).toBeInTheDocument()
    expect(screen.queryByText('steam_game')).toBeNull()
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

  it('waehlt Prepaid standardmaessig, zeigt keinen erfundenen RAM-Typ und aktiviert Abo-Rabatt beim Umschalten', async () => {
    zeige('/shop/palworld')
    expect(await screen.findByText(i18n.t('shop.spiel.inklusiveTitel'))).toBeInTheDocument()

    // Kein DDR5-Label solange hardware_ram_type fehlt
    expect(screen.queryByText(/DDR5/)).not.toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.spiel.ram'))).toBeInTheDocument()

    const prepaidBtn = screen.getByRole('button', {
      name: (name) => name.includes(i18n.t('shop.spiel.prepaidTitel')),
    })
    const aboBtn = screen.getByRole('button', {
      name: (name) => name.includes(i18n.t('shop.spiel.aboTitel')),
    })
    expect(prepaidBtn).toHaveAttribute('aria-pressed', 'true')
    expect(aboBtn).toHaveAttribute('aria-pressed', 'false')

    expect(
      await screen.findByText(new RegExp(i18n.t('shop.spiel.erstattungGarantie', { tage: 14 }))),
    ).toBeInTheDocument()

    fireEvent.click(aboBtn)
    expect(aboBtn).toHaveAttribute('aria-pressed', 'true')
    expect(
      screen.getByRole('button', { name: i18n.t('shop.spiel.monate', { count: 3 }) }),
    ).toBeDisabled()
    expect(
      screen.getByText(i18n.t('shop.preis.aboRabatt', { prozent: 12 })),
    ).toBeInTheDocument()
  })

  it('zeigt echten Hardware-RAM-Typ an wenn vorhanden', async () => {
    hoisted.getCatalog.mockResolvedValue([{ ...PALWORLD_PLAN, hardware_ram_type: 'DDR5 ECC' }])
    zeige('/shop/palworld')
    expect(await screen.findByText(`${i18n.t('shop.spiel.ram')} · DDR5 ECC`)).toBeInTheDocument()
  })

  it('zeigt Lifetime nur wenn konfiguriert und berechnet Einmalpreis korrekt', async () => {
    const erster = zeige('/shop/palworld')
    expect(await screen.findByText(i18n.t('shop.spiel.prepaidTitel'))).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lifetime/ })).toBeNull()
    erster.unmount()

    hoisted.getCatalog.mockResolvedValue([
      {
        ...PALWORLD_PLAN,
        lifetime_price_cents: 19900,
        ddos_game_aware: true,
        ddos_provider: 'Path.net',
      },
    ])
    zeige('/shop/palworld')
    const lifeBtn = await screen.findByRole('button', {
      name: (name) => name.includes(i18n.t('shop.spiel.lifetimeTitel')),
    })
    expect(screen.getByText('Game-Aware DDoS (Path.net)')).toBeInTheDocument()

    fireEvent.click(lifeBtn)
    expect(lifeBtn).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByRole('button', { name: i18n.t('shop.spiel.monate', { count: 3 }) })).toBeNull()
    expect(screen.getByText(i18n.t('shop.preis.keineFolgekosten'))).toBeInTheDocument()
  })

  it('zeigt Standort- & Hardware-Auswahl, maskiert leere CPU und überträgt Aufpreis samt preferredNodeId', async () => {
    hoisted.getNodeStatus.mockResolvedValue([
      {
        id: 1,
        name: 'fra-std',
        location_label: 'Frankfurt Standard',
        status: 'online',
        cpu_model: null,
        ram_type: 'DDR5',
        storage_type: 'NVMe',
        ram_free_percent: 65,
        load_level: 'low',
        accepting_orders: true,
        hardware_tier_label: 'Standard',
        shop_surcharge_cents: 0,
      },
      {
        id: 2,
        name: 'fra-perf',
        location_label: 'Frankfurt Performance',
        status: 'online',
        cpu_model: 'AMD Ryzen 9 9950X',
        ram_type: 'DDR5 ECC',
        storage_type: 'NVMe Gen5',
        ram_free_percent: 82,
        load_level: 'low',
        accepting_orders: true,
        hardware_tier_label: 'Performance',
        shop_surcharge_cents: 350,
      },
    ])
    hoisted.checkAvailability.mockResolvedValue({
      available: true,
      reason: null,
      available_nodes: 2,
      max_ram_mb: 16384,
      max_cpu: 4,
      nodes: [
        { node_id: 1, available: true, reason: null, shop_surcharge_cents: 0 },
        { node_id: 2, available: true, reason: null, shop_surcharge_cents: 350 },
      ],
    })
    useShopStandortStore.getState().setPingWerte({ 2: { ms: 16, direkt: true } })

    zeige('/shop/palworld')

    expect(await screen.findByText('Frankfurt Performance')).toBeInTheDocument()
    expect(screen.getByText('AMD Ryzen 9 9950X')).toBeInTheDocument()
    expect(screen.getByText('16 ms')).toBeInTheDocument()

    const perfBtn = screen.getByRole('button', {
      name: (name) => name.includes('Frankfurt Performance'),
    })
    fireEvent.click(perfBtn)

    await vi.waitFor(() => {
      expect(hoisted.checkAvailability).toHaveBeenLastCalledWith({
        plan_id: 7,
        ram_mb: 8192,
        cpu: 150,
        preferred_node_id: 2,
      })
    })
    expect(screen.getByText(i18n.t('shop.preis.standortAufpreis'))).toBeInTheDocument()
    expect(screen.getAllByText(/10,49/).length).toBeGreaterThanOrEqual(2)

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.spiel.weiterKasse') }))
    const kasse = screen.getByTestId('kasse')
    expect(kasse).toHaveTextContent('"preferredNodeId":2')
    expect(kasse).toHaveTextContent('"standortAufpreisCent":350')
  })
})
