import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { useAuthStore } from '@/stores/authStore'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'
import { SHOP_IS_BETA, ShopKopf } from './ShopKopf'

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => false,
}))

describe('ShopKopf', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    usePublicSettingsStore.setState({ shop_enabled: true, branding: undefined })
    useAuthStore.setState({ isAuthenticated: false, user: null })
  })

  it('zeigt das Beta-Badge neben dem Shop-Namen an', () => {
    render(
      <MemoryRouter>
        <ShopKopf />
      </MemoryRouter>,
    )

    const link = screen.getByRole('link', { name: i18n.t('shop.kopf.startseite') })
    expect(link).toHaveTextContent('MSM Shop')
    if (SHOP_IS_BETA) {
      expect(link).toHaveTextContent(i18n.t('shop.betaBadge'))
    }
  })
})
