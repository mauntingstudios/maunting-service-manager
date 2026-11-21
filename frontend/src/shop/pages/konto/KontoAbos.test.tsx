import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopOrderApi: {
      ...actual.shopOrderApi,
      listSubscriptions: vi.fn().mockResolvedValue([
        {
          id: 1,
          game_type: 'palworld',
          name: 'Palworld · Standard · 8 GB',
          status: 'active',
          billing_interval: 'month',
          monthly_gross_cents: 699,
          tax_rate_percent: 19,
          started_at: '2026-11-21T10:00:00+00:00',
          current_period_end: '2026-12-21T10:00:00+00:00',
          cancel_at_period_end: false,
        },
      ]),
      listEntitlements: vi.fn().mockResolvedValue([
        {
          id: 10,
          kind: 'server',
          label: 'Palworld · Standard · 8 GB',
          status: 'active',
          server_id: 42,
          provisioning_status: 'ready',
          provisioning_error: null,
          created_at: '2026-11-21T10:00:00+00:00',
        },
        {
          id: 11,
          kind: 'server',
          label: 'Valheim · Fehlgeschlagen',
          status: 'active',
          server_id: null,
          provisioning_status: 'failed',
          provisioning_error: 'port_conflict',
          created_at: '2026-11-21T10:01:00+00:00',
        },
        {
          id: 12,
          kind: 'role',
          label: 'KI-Paket',
          status: 'revoked',
          server_id: null,
          provisioning_status: 'revoked',
          provisioning_error: null,
          created_at: '2026-11-21T10:02:00+00:00',
        },
      ]),
    },
  }
})

import { KontoAbos } from './KontoAbos'

describe('KontoAbos', () => {
  it('verlinkt bereitgestellte Server und zeigt Fehler- sowie Widerrufsstatus', async () => {
    render(
      <MemoryRouter>
        <KontoAbos />
      </MemoryRouter>,
    )

    const link = await screen.findByRole('link', { name: 'Server öffnen' })
    expect(link).toHaveAttribute('href', '/servers/42')
    expect(screen.getByText('Bereitstellung fehlgeschlagen')).toBeInTheDocument()
    expect(screen.getByText('Widerrufen')).toBeInTheDocument()
  })
})
