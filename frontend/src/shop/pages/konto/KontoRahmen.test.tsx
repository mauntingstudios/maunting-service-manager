import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { KontoRahmen } from './KontoRahmen'

describe('KontoRahmen', () => {
  beforeEach(() => {
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
    usePublicSettingsStore.setState({ shop_enabled: false })
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
})
