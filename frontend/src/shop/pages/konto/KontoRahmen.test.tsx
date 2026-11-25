import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listOrdersMock, listSubscriptionsMock, listInvoicesMock } = vi.hoisted(() => ({
  listOrdersMock: vi.fn(),
  listSubscriptionsMock: vi.fn(),
  listInvoicesMock: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopOrderApi: {
      ...actual.shopOrderApi,
      listOrders: listOrdersMock,
      listSubscriptions: listSubscriptionsMock,
    },
    shopInvoiceApi: {
      ...actual.shopInvoiceApi,
      list: listInvoicesMock,
    },
  }
})

import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { KontoProfil } from './KontoProfil'
import { KontoRahmen } from './KontoRahmen'

describe('KontoRahmen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    listOrdersMock.mockReset().mockResolvedValue([])
    listSubscriptionsMock.mockReset().mockResolvedValue([])
    listInvoicesMock.mockReset().mockResolvedValue([])
    useAuthStore.setState({
      isAuthenticated: true,
      user: {
        id: 2,
        username: 'shopkunde',
        email: 'shop@example.com',
        is_owner: false,
      } as never,
    })
    usePermissionsStore.setState({ me: null })
    usePublicSettingsStore.setState({ shop_enabled: false, social_enabled: false, vault_enabled: false })
  })

  it('zeigt Profil-Tab, Direktlink zum KI-Chat bei Berechtigung und versteckt Shop-Link wenn deaktiviert', () => {
    usePermissionsStore.setState({
      me: {
        user_id: 2,
        is_owner: false,
        global_keys: ['ai.chat.use'],
        server_keys: {},
      } as never,
    })

    render(
      <MemoryRouter initialEntries={['/konto/bestellungen']}>
        <Routes>
          <Route path="/konto" element={<KontoRahmen />}>
            <Route path="bestellungen" element={<div data-testid="inhalt" />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.getByText('shopkunde')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: i18n.t('shop.konto.nav.profil') })).toHaveAttribute(
      'href',
      '/konto/profil',
    )
    expect(screen.getByRole('link', { name: i18n.t('shop.kopf.kiChat') })).toHaveAttribute(
      'href',
      '/ai',
    )
    expect(screen.queryByRole('link', { name: i18n.t('shop.konto.zurueck') })).toBeNull()
  })

  it('rendert /konto/profil ohne doppelte H1 und blendet leere Shop-Tabs im Self-Hosted-Modus aus', async () => {
    render(
      <MemoryRouter initialEntries={['/konto/profil']}>
        <Routes>
          <Route path="/konto" element={<KontoRahmen />}>
            <Route path="profil" element={<KontoProfil />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    await waitFor(() => expect(listOrdersMock).toHaveBeenCalled())
    const h1s = screen.getAllByRole('heading', { level: 1 })
    expect(h1s).toHaveLength(1)
    expect(h1s[0]).toHaveTextContent('shopkunde')
    expect(screen.getByRole('link', { name: i18n.t('shop.konto.nav.profil') })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: i18n.t('shop.konto.nav.bestellungen') })).toBeNull()
    expect(screen.queryByRole('link', { name: i18n.t('shop.konto.nav.abos') })).toBeNull()
  })

  it('zeigt Shop-Tabs trotz deaktiviertem Shop sobald bestehende Belege vorliegen', async () => {
    listOrdersMock.mockResolvedValueOnce([{ id: 1, number: 'MSM-2026-1' }])

    render(
      <MemoryRouter initialEntries={['/konto/profil']}>
        <Routes>
          <Route path="/konto" element={<KontoRahmen />}>
            <Route path="profil" element={<div />} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    expect(
      await screen.findByRole('link', { name: i18n.t('shop.konto.nav.bestellungen') }),
    ).toBeInTheDocument()
    expect(screen.getByRole('link', { name: i18n.t('shop.konto.nav.abos') })).toBeInTheDocument()
  })

  it('verankert die Zurueck-Leiste am unteren Rand auch bei kurzen Leerzustaenden', () => {
    usePublicSettingsStore.setState({ shop_enabled: true })

    const { container } = render(
      <MemoryRouter initialEntries={['/konto/rechnungen']}>
        <Routes>
          <Route path="/konto" element={<KontoRahmen />}>
            <Route path="rechnungen" element={<div>Leer</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    )

    const section = container.querySelector('section')
    expect(section).toHaveClass('flex', 'flex-1', 'flex-col')

    const backLink = screen.getByRole('link', { name: i18n.t('shop.konto.zurueck') })
    expect(backLink.parentElement).toHaveClass('mt-auto')
  })
})
