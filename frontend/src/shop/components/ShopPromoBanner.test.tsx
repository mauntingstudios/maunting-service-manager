import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

const hoisted = vi.hoisted(() => ({
  getPromos: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopCatalogApi: {
      ...actual.shopCatalogApi,
      getPromos: hoisted.getPromos,
    },
  }
})

import { ShopPromoBanner } from './ShopPromoBanner'

describe('ShopPromoBanner', () => {
  beforeEach(() => {
    window.localStorage.clear()
    usePublicSettingsStore.setState({ shop_enabled: true })
    hoisted.getPromos.mockReset().mockResolvedValue({
      banner: {
        code: 'FLASH25',
        name: 'Flash Sale',
        promo_text: 'Nur heute 25 % Rabatt',
        discount_type: 'percent',
        discount_value: 25,
        scope: 'all',
        cooldown_hours: 6,
        valid_until: new Date(Date.now() + 3_600_000).toISOString(),
      },
      banners: [
        {
          code: 'FLASH25',
          name: 'Flash Sale',
          promo_text: 'Nur heute 25 % Rabatt',
          discount_type: 'percent',
          discount_value: 25,
          scope: 'all',
          cooldown_hours: 6,
          valid_until: new Date(Date.now() + 3_600_000).toISOString(),
        },
        {
          code: 'WEEK10',
          name: 'Wochen-Promo',
          promo_text: '10 % auf alle Add-ons',
          discount_type: 'percent',
          discount_value: 10,
          scope: 'addons',
          cooldown_hours: 6,
          valid_until: null,
        },
      ],
      badges: [],
    })
  })

  it('zeigt Flash-Sale Countdown und erlaubt das Durchschalten mehrerer Promos', async () => {
    render(<ShopPromoBanner />)

    expect(await screen.findByText('Nur heute 25 % Rabatt')).toBeInTheDocument()
    expect(screen.getByText('FLASH25')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.promo.endetIn'))).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.promo.naechste') }))
    expect(screen.getByText('10 % auf alle Add-ons')).toBeInTheDocument()
    expect(screen.getByText('WEEK10')).toBeInTheDocument()
  })

  it('blendet Banner nach Klick auf Schliessen im Cooldown aus', async () => {
    render(<ShopPromoBanner />)
    expect(await screen.findByText('FLASH25')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.promo.schliessen') }))
    expect(window.localStorage.getItem('msm_shop_promo_dismissed:FLASH25')).not.toBeNull()
    expect(screen.getByText('WEEK10')).toBeInTheDocument()
  })
})
