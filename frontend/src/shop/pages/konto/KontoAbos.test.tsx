import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  cancelSubscriptionMock,
  listSubscriptionsMock,
  listEntitlementsMock,
  purgeEntitlementNowMock,
} = vi.hoisted(() => ({
  cancelSubscriptionMock: vi.fn(),
  listSubscriptionsMock: vi.fn(),
  listEntitlementsMock: vi.fn(),
  purgeEntitlementNowMock: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopOrderApi: {
      ...actual.shopOrderApi,
      listSubscriptions: listSubscriptionsMock,
      cancelSubscription: cancelSubscriptionMock,
      listEntitlements: listEntitlementsMock,
      purgeEntitlementNow: purgeEntitlementNowMock,
    },
  }
})

import { KontoAbos } from './KontoAbos'

describe('KontoAbos', () => {
  beforeEach(() => {
    cancelSubscriptionMock.mockReset()
    purgeEntitlementNowMock.mockReset()
    listSubscriptionsMock.mockResolvedValue([
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
    ])
    listEntitlementsMock.mockResolvedValue([
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
    ])
  })

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

  it('kuendigt ein aktives Abo nach Bestaetigung zum Laufzeitende', async () => {
    cancelSubscriptionMock.mockResolvedValue({
      id: 1,
      game_type: 'palworld',
      name: 'Palworld · Standard · 8 GB',
      status: 'active',
      billing_interval: 'month',
      monthly_gross_cents: 699,
      tax_rate_percent: 19,
      started_at: '2026-11-21T10:00:00+00:00',
      current_period_end: '2026-12-21T10:00:00+00:00',
      cancel_at_period_end: true,
    })

    render(
      <MemoryRouter>
        <KontoAbos />
      </MemoryRouter>,
    )

    const btn = await screen.findByRole('button', { name: 'Zum Laufzeitende kündigen' })
    fireEvent.click(btn)

    const bestaetigen = screen.getByRole('button', { name: 'Kündigung bestätigen' })
    fireEvent.click(bestaetigen)

    await waitFor(() => {
      expect(cancelSubscriptionMock).toHaveBeenCalledWith('1')
    })
    expect(await screen.findByText('Zum Laufzeitende gekündigt')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zum Laufzeitende kündigen' })).not.toBeInTheDocument()
  })

  it('zeigt Fehler bei fehlgeschlagener Kuendigung und versteckt Knopf bei bereits gekuendigten Abos', async () => {
    cancelSubscriptionMock.mockRejectedValueOnce(new Error('network'))

    const erstesRender = render(
      <MemoryRouter>
        <KontoAbos />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Zum Laufzeitende kündigen' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kündigung bestätigen' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Kündigung konnte nicht gespeichert werden.',
    )
    erstesRender.unmount()

    listSubscriptionsMock.mockResolvedValueOnce([
      {
        id: 2,
        game_type: 'valheim',
        name: 'Valheim · Gekuendigt',
        status: 'cancelled',
        billing_interval: 'month',
        monthly_gross_cents: 699,
        tax_rate_percent: 19,
        started_at: '2026-11-21T10:00:00+00:00',
        current_period_end: '2026-12-21T10:00:00+00:00',
        cancel_at_period_end: true,
      },
    ])

    render(
      <MemoryRouter>
        <KontoAbos />
      </MemoryRouter>,
    )
    expect(await screen.findByText('Valheim · Gekuendigt')).toBeInTheDocument()
    expect(screen.getByText('Gekündigt')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Zum Laufzeitende kündigen' })).not.toBeInTheDocument()
  })

  it('erfordert Servernamen-Bestaetigung bei Sofortloeschung und zeigt Zahlungsfrist', async () => {
    listSubscriptionsMock.mockResolvedValueOnce([
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
        server_entitlement_id: 10,
        server_name: 'Mein-Palworld',
        can_immediate_delete: true,
      },
    ])
    listEntitlementsMock.mockResolvedValueOnce([
      {
        id: 10,
        kind: 'server',
        label: 'Palworld · Standard · 8 GB',
        status: 'suspended',
        server_id: 42,
        server_name: 'Mein-Palworld',
        provisioning_status: 'suspended',
        provisioning_error: null,
        purge_after: '2026-12-20T10:00:00+00:00',
        purge_reason: 'unpaid',
        can_customer_purge_now: false,
        created_at: '2026-11-21T10:00:00+00:00',
      },
    ])
    cancelSubscriptionMock.mockResolvedValueOnce({
      id: 1,
      game_type: 'palworld',
      name: 'Palworld · Standard · 8 GB',
      status: 'cancelled',
      billing_interval: 'month',
      monthly_gross_cents: 699,
      tax_rate_percent: 19,
      started_at: '2026-11-21T10:00:00+00:00',
      current_period_end: '2026-12-21T10:00:00+00:00',
      cancel_at_period_end: true,
      delete_server_on_end: true,
    })

    render(
      <MemoryRouter>
        <KontoAbos />
      </MemoryRouter>,
    )

    expect(
      await screen.findByText('Zahlungsfrist bis 2026-12-20 – danach wird der Server gelöscht'),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Zahlungsmethode prüfen' })).toHaveAttribute(
      'href',
      '/konto/zahlungsmethoden',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Zum Laufzeitende kündigen' }))
    fireEvent.click(screen.getByRole('radio', { name: /sofort unwiderruflich löschen/i }))

    const confirmBtn = screen.getByRole('button', { name: 'Kündigung bestätigen' })
    expect(confirmBtn).toBeDisabled()

    const nameInput = screen.getByLabelText(/Zur Bestätigung den exakten Servernamen/i)
    fireEvent.change(nameInput, { target: { value: 'Falsch' } })
    expect(confirmBtn).toBeDisabled()

    fireEvent.change(nameInput, { target: { value: 'Mein-Palworld' } })
    expect(confirmBtn).not.toBeDisabled()
    fireEvent.click(confirmBtn)

    await waitFor(() => {
      expect(cancelSubscriptionMock).toHaveBeenCalledWith('1', {
        deletion_mode: 'immediate',
        confirm_server_name: 'Mein-Palworld',
      })
    })
  })
})
