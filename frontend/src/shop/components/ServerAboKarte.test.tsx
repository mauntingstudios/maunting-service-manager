import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ServerAboKarte } from './ServerAboKarte'

const { getServerSubscriptionMock } = vi.hoisted(() => ({
  getServerSubscriptionMock: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopOrderApi: {
      ...actual.shopOrderApi,
      getServerSubscription: getServerSubscriptionMock,
    },
  }
})

describe('ServerAboKarte', () => {
  beforeEach(() => {
    getServerSubscriptionMock.mockReset()
  })

  it('zeigt echte Abo- und Ressourcendaten eines Shop-Servers', async () => {
    getServerSubscriptionMock.mockResolvedValue({
      has_subscription: true,
      subscription: {
        id: 1,
        game_type: 'palworld',
        name: 'Palworld · Starter · 8 GB',
        status: 'active',
        billing_interval: 'month',
        monthly_gross_cents: 699,
        tax_rate_percent: 19,
        started_at: '2026-11-21T10:00:00+00:00',
        current_period_end: '2026-12-21T10:00:00+00:00',
        cancel_at_period_end: false,
      },
      entitlement: null,
      ram_mb: 8192,
      cpu: 2,
      slots: 8,
    })

    render(
      <MemoryRouter>
        <ServerAboKarte serverId={5} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Palworld · Starter · 8 GB')).toBeInTheDocument()
    expect(screen.getByText(/8 GB RAM/)).toBeInTheDocument()
    expect(screen.getByText(/2026-12-21/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abo ansehen' })).toHaveAttribute(
      'href',
      '/konto/abos',
    )
  })

  it('zeigt einen Leerzustand fuer manuell angelegte Server', async () => {
    getServerSubscriptionMock.mockResolvedValue({
      has_subscription: false,
      subscription: null,
      entitlement: null,
      ram_mb: null,
      cpu: null,
      slots: null,
    })

    render(
      <MemoryRouter>
        <ServerAboKarte serverId={6} />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Kein Shop-Abo verknüpft')).toBeInTheDocument()
  })

  it('zeigt eine Fehlermeldung wenn das Laden scheitert', async () => {
    getServerSubscriptionMock.mockRejectedValue(new Error('network'))

    render(
      <MemoryRouter>
        <ServerAboKarte serverId={7} />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('Abo-Daten konnten nicht geladen werden.'),
    ).toBeInTheDocument()
  })
})
