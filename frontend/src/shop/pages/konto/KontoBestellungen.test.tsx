import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopOrderApi: {
      ...actual.shopOrderApi,
      listOrders: vi.fn().mockResolvedValue([
        {
          id: 123,
          number: 'MSM-2026-000123',
          status: 'paid',
          currency: 'EUR',
          billing_interval: 'month',
          months: 1,
          discount_percent: 0,
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
              kind: 'plan',
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
            },
          ],
        },
      ]),
    },
  }
})

import { KontoBestellungen } from './KontoBestellungen'

describe('KontoBestellungen', () => {
  it('zeigt die echten Bestellungen aus der Shop-API', async () => {
    render(
      <MemoryRouter>
        <KontoBestellungen />
      </MemoryRouter>,
    )
    expect(await screen.findByText('MSM-2026-000123')).toBeInTheDocument()
    expect(screen.getByText(/10,89/)).toBeInTheDocument()
  })
})
