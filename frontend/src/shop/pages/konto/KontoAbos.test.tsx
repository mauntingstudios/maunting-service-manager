import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SanitizedApiError } from '@/api/client'

const {
  cancelSubscriptionMock,
  listSubscriptionsMock,
  listEntitlementsMock,
  purgeEntitlementNowMock,
  pauseEntitlementMock,
  resumeEntitlementMock,
  extendSubscriptionMock,
  checkoutMock,
  payDemoMock,
  listEntitlementBackupsMock,
} = vi.hoisted(() => ({
  cancelSubscriptionMock: vi.fn(),
  listSubscriptionsMock: vi.fn(),
  listEntitlementsMock: vi.fn(),
  purgeEntitlementNowMock: vi.fn(),
  pauseEntitlementMock: vi.fn(),
  resumeEntitlementMock: vi.fn(),
  extendSubscriptionMock: vi.fn(),
  checkoutMock: vi.fn(),
  payDemoMock: vi.fn(),
  listEntitlementBackupsMock: vi.fn(),
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
      pauseEntitlement: pauseEntitlementMock,
      resumeEntitlement: resumeEntitlementMock,
      extendSubscription: extendSubscriptionMock,
      checkout: checkoutMock,
      payDemo: payDemoMock,
      listEntitlementBackups: listEntitlementBackupsMock,
    },
  }
})

import { KontoAbos } from './KontoAbos'

describe('KontoAbos', () => {
  beforeEach(() => {
    cancelSubscriptionMock.mockReset()
    purgeEntitlementNowMock.mockReset()
    pauseEntitlementMock.mockReset()
    resumeEntitlementMock.mockReset()
    extendSubscriptionMock.mockReset()
    checkoutMock.mockReset()
    payDemoMock.mockReset()
    listEntitlementBackupsMock.mockReset().mockResolvedValue([])
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

  it('unterstuetzt 1-Klick-Verlaengerung bei Prepaid und Welt-Backup-Download in der Schonfrist', async () => {
    listSubscriptionsMock.mockResolvedValueOnce([
      {
        id: 1,
        game_type: 'palworld',
        name: 'Palworld · Standard · 8 GB',
        status: 'active',
        billing_interval: 'month',
        billing_mode: 'prepaid',
        monthly_gross_cents: 699,
        tax_rate_percent: 19,
        started_at: '2026-11-21T10:00:00+00:00',
        current_period_end: '2026-12-21T10:00:00+00:00',
        cancel_at_period_end: false,
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
        purge_reason: 'cancelled',
        created_at: '2026-11-21T10:00:00+00:00',
      },
    ])
    extendSubscriptionMock.mockResolvedValueOnce({ id: 99, number: 'MSM-2026-000099' })
    checkoutMock.mockRejectedValueOnce(
      new SanitizedApiError('Kein Stripe', { status: 409, code: 'stripe_not_configured' }),
    )
    payDemoMock.mockResolvedValueOnce({ id: 99, number: 'MSM-2026-000099' })
    listEntitlementBackupsMock.mockResolvedValueOnce([
      {
        id: 77,
        name: 'pre_update_backup.tar.gz',
        size_mb: 120,
        created_at: '2026-11-21T12:00:00+00:00',
        encrypted: false,
        downloadable: true,
      },
    ])

    render(
      <MemoryRouter>
        <KontoAbos />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Prepaid')).toBeInTheDocument()
    const extendBtn = screen.getByRole('button', { name: 'Um 1 Monat verlängern' })
    fireEvent.click(extendBtn)

    await waitFor(() => {
      expect(extendSubscriptionMock).toHaveBeenCalledWith('1', 1)
    })
    expect(await screen.findByText('Laufzeit erfolgreich um 1 Monat verlängert.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Welt-Backup laden' }))
    expect(await screen.findByText(/pre_update_backup\.tar\.gz/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Backup laden' })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/shop/entitlements/10/backups/77/download'),
    )
  })

  it('unterstuetzt Lifetime, Server-Pause, Fortsetzen und Spiel-Wechsel-Link', async () => {
    listSubscriptionsMock.mockResolvedValueOnce([
      {
        id: 2,
        game_type: 'palworld',
        name: 'Palworld Lifetime',
        status: 'active',
        billing_interval: 'month',
        billing_mode: 'lifetime',
        monthly_gross_cents: 0,
        tax_rate_percent: 19,
        started_at: '2026-11-21T10:00:00+00:00',
        current_period_end: '2126-11-21T10:00:00+00:00',
        cancel_at_period_end: false,
      },
    ])
    const activeEnt = {
      id: 11,
      kind: 'server' as const,
      label: 'Palworld Lifetime',
      status: 'active' as const,
      server_id: 42,
      server_name: 'Mein-Palworld',
      provisioning_status: 'ready',
      provisioning_error: null,
      paused_at: null,
      pause_days_used: 0,
      created_at: '2026-11-21T10:00:00+00:00',
    }
    listEntitlementsMock.mockResolvedValueOnce([activeEnt])
    pauseEntitlementMock.mockResolvedValueOnce({
      ...activeEnt,
      paused_at: '2026-11-22T12:00:00+00:00',
    })
    resumeEntitlementMock.mockResolvedValueOnce({
      ...activeEnt,
      paused_at: null,
      pause_days_used: 3,
    })

    render(
      <MemoryRouter>
        <KontoAbos />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Lifetime')).toBeInTheDocument()
    expect(screen.getByText('Zeitlich unbegrenzt')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Um 1 Monat verlängern' })).not.toBeInTheDocument()

    expect(screen.getByRole('link', { name: 'Spiel wechseln' })).toHaveAttribute(
      'href',
      '/servers/42?action=switch',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Server pausieren' }))
    await waitFor(() => {
      expect(pauseEntitlementMock).toHaveBeenCalledWith('11')
    })
    expect(await screen.findByText('Pausiert')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Fortsetzen' }))
    await waitFor(() => {
      expect(resumeEntitlementMock).toHaveBeenCalledWith('11')
    })
    expect(await screen.findByText('3 Pausentage in diesem Zeitraum angerechnet')).toBeInTheDocument()
  })

  it('oeffnet den Bestaetigungsdialog fuer Jetzt sofort loeschen mit Servernamen-Pruefung', async () => {
    listSubscriptionsMock.mockResolvedValueOnce([])
    listEntitlementsMock.mockResolvedValueOnce([
      {
        id: 21,
        kind: 'server',
        label: 'Palworld · Schonfrist',
        status: 'suspended',
        server_id: 99,
        server_name: 'Mein-Testserver',
        provisioning_status: 'suspended',
        provisioning_error: null,
        purge_after: '2026-12-20T10:00:00+00:00',
        purge_reason: 'cancelled',
        can_customer_purge_now: true,
        created_at: '2026-11-21T10:00:00+00:00',
      },
    ])
    purgeEntitlementNowMock.mockResolvedValueOnce({
      id: 21,
      kind: 'server',
      label: 'Palworld · Schonfrist',
      status: 'revoked',
      server_id: null,
      server_name: 'Mein-Testserver',
      provisioning_status: 'purged',
      provisioning_error: null,
      purged_at: '2026-11-24T12:00:00+00:00',
      can_customer_purge_now: false,
      created_at: '2026-11-21T10:00:00+00:00',
    })

    render(
      <MemoryRouter>
        <KontoAbos />
      </MemoryRouter>,
    )

    fireEvent.click(await screen.findByRole('button', { name: 'Jetzt sofort löschen' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toBeInTheDocument()

    const bestaetigen = screen.getByRole('button', { name: 'Server endgültig löschen' })
    expect(bestaetigen).toBeDisabled()

    fireEvent.change(screen.getByLabelText(/Zur Bestätigung den exakten Servernamen/i), {
      target: { value: 'Mein-Testserver' },
    })
    expect(bestaetigen).not.toBeDisabled()
    fireEvent.click(bestaetigen)

    await waitFor(() => {
      expect(purgeEntitlementNowMock).toHaveBeenCalledWith('21', 'Mein-Testserver')
    })
    expect(await screen.findByText('Endgültig gelöscht')).toBeInTheDocument()
  })
})
