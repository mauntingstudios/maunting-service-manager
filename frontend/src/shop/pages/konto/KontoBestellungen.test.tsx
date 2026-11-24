import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listOrdersMock, getOrderMock } = vi.hoisted(() => ({
  listOrdersMock: vi.fn(),
  getOrderMock: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopOrderApi: {
      ...actual.shopOrderApi,
      listOrders: listOrdersMock,
      getOrder: getOrderMock,
    },
  }
})

import i18n from '@/i18n'
import { KontoBestellungDetail } from './KontoBestellungDetail'
import { KontoBestellungen } from './KontoBestellungen'

const BEISPIEL_ORDER = {
  id: 123,
  number: 'MSM-2026-000123',
  status: 'fulfilled' as const,
  currency: 'EUR',
  billing_interval: 'month',
  months: 3,
  discount_percent: 10,
  net_cents: 915,
  tax_cents: 174,
  gross_cents: 1089,
  payment_provider: 'demo',
  payment_reference: 'demo-MSM-2026-000123',
  created_at: '2026-11-20T10:00:00+00:00',
  paid_at: '2026-11-20T10:00:05+00:00',
  items: [
    {
      id: 1,
      kind: 'plan' as const,
      game_type: 'palworld',
      name: 'Palworld · Standard · 8 GB · 8 Slots',
      quantity: 1,
      unit_price_cents: 699,
      tax_rate_percent: 19,
      net_cents: 915,
      tax_cents: 174,
      gross_cents: 1089,
      ram_mb: 8192,
      cpu: 2,
      slots: 8,
      node_surcharge_cents: 250,
    },
  ],
}

describe('KontoBestellungen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    listOrdersMock.mockReset().mockResolvedValue([BEISPIEL_ORDER])
    getOrderMock.mockReset().mockResolvedValue(BEISPIEL_ORDER)
  })

  it('zeigt die echten Bestellungen aus der Shop-API samt Rabatt-Hinweis', async () => {
    render(
      <MemoryRouter>
        <KontoBestellungen />
      </MemoryRouter>,
    )
    expect(await screen.findByText('MSM-2026-000123')).toBeInTheDocument()
    expect(screen.getByText(/10,89/)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.konto.bestellungen.rabatt', { prozent: 10 }))).toBeInTheDocument()
  })

  it('zeigt in KontoBestellungDetail Timeline, Standort-Aufpreis und Rabatt', async () => {
    render(
      <MemoryRouter initialEntries={['/konto/bestellungen/123']}>
        <Routes>
          <Route path="/konto/bestellungen/:id" element={<KontoBestellungDetail />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(await screen.findByText('MSM-2026-000123')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.konto.bestellung.schrittErstellt'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.konto.bestellung.schrittBezahlt'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.konto.bestellung.schrittBereitgestellt'))).toBeInTheDocument()
    expect(screen.getByText(/Standort-Aufpreis/)).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.konto.bestellung.rabattHinweis', { prozent: 10 }))).toBeInTheDocument()
    expect(screen.getByRole('link', { name: i18n.t('shop.konto.bestellung.zuAbos') })).toHaveAttribute(
      'href',
      '/konto/abos',
    )
  })
})
