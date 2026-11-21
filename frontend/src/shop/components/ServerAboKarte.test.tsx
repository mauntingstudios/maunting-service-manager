import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { ServerAboKarte } from './ServerAboKarte'

const { getServerSubscriptionMock, getServerPlayersMock, updateServerSlotsMock } = vi.hoisted(() => ({
  getServerSubscriptionMock: vi.fn(),
  getServerPlayersMock: vi.fn(),
  updateServerSlotsMock: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopOrderApi: {
      ...actual.shopOrderApi,
      getServerSubscription: getServerSubscriptionMock,
      getServerPlayers: getServerPlayersMock,
      updateServerSlots: updateServerSlotsMock,
    },
  }
})

describe('ServerAboKarte', () => {
  beforeEach(() => {
    getServerSubscriptionMock.mockReset()
    getServerPlayersMock.mockReset().mockResolvedValue({
      server_id: 5,
      protocol: 'a2s',
      online: true,
      players: 5,
      max_players: 8,
      server_name: 'Palworld EU',
      booked_slots: 8,
      slot_exceeded: false,
      warning: null,
      error: null,
    })
    updateServerSlotsMock.mockReset()
    usePermissionsStore.setState({ me: null })
  })

  it('zeigt echte Abo- und Live-Spielerdaten eines Shop-Servers', async () => {
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
    expect(await screen.findByText('5 / 8 Spieler')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Abo ansehen' })).toHaveAttribute(
      'href',
      '/konto/abos',
    )
  })

  it('erlaubt berechtigten Admins eine Slot-Anpassung mit Downgrade-Warnung', async () => {
    usePermissionsStore.setState({
      me: {
        user_id: 1,
        is_owner: false,
        global_keys: ['shop.write'],
        server_keys: {},
      } as never,
    })
    getServerSubscriptionMock.mockResolvedValue({
      has_subscription: true,
      subscription: null,
      entitlement: {
        id: 9,
        kind: 'server',
        label: 'Palworld 12 Slots',
        status: 'active',
        server_id: 5,
        provisioning_status: 'active',
        provisioning_error: null,
        created_at: '2026-11-21T10:00:00+00:00',
      },
      ram_mb: 8192,
      cpu: 2,
      slots: 12,
    })
    updateServerSlotsMock.mockResolvedValue({
      server_id: 5,
      slots: 6,
      previous_slots: 12,
      target_type: 'ini',
      downgrade_warning: true,
      restart_required: true,
      live_players: 5,
    })

    render(
      <MemoryRouter>
        <ServerAboKarte serverId={5} />
      </MemoryRouter>,
    )

    const input = await screen.findByLabelText(i18n.t('shop.serverAbo.slotsAnpassen'))
    fireEvent.change(input, { target: { value: '6' } })
    expect(
      screen.getByText(i18n.t('shop.serverAbo.slotsDowngradeWarnung')),
    ).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.serverAbo.slotsSpeichern') }))
    expect(
      await screen.findByText(i18n.t('shop.serverAbo.slotsNeustart')),
    ).toBeInTheDocument()
    expect(updateServerSlotsMock).toHaveBeenCalledWith(5, 6)
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
