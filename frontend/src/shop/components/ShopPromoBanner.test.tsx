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

  it('waehlt genau einen zufaelligen Gutschein mit Design-DNA-Backdrop und schliesst komplett', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.8)
    try {
      render(<ShopPromoBanner />)

      expect(await screen.findByText('10 % auf alle Add-ons')).toBeInTheDocument()
      expect(screen.getByText('WEEK10')).toBeInTheDocument()
      expect(screen.queryByText('FLASH25')).not.toBeInTheDocument()
      expect(screen.getByTestId('shop-promo-backdrop')).toHaveClass('bg-black/60')

      fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.promo.schliessen') }))
      expect(window.localStorage.getItem('msm_shop_promo_dismissed:WEEK10')).not.toBeNull()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('rendert Countdown, Code, manuellen Einloese-Hinweis und Kopierfunktion im Dialog', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(window.navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })
    try {
      render(<ShopPromoBanner />)

      const dialog = await screen.findByRole('dialog')
      expect(dialog).toHaveAttribute('aria-modal', 'true')
      expect(screen.getByText('Nur heute 25 % Rabatt')).toBeInTheDocument()
      expect(screen.getByText(i18n.t('shop.promo.endetIn'))).toBeInTheDocument()
      expect(screen.getByText(i18n.t('shop.promo.checkoutHinweis'))).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.promo.kopieren') }))
      expect(writeText).toHaveBeenCalledWith('FLASH25')
      expect(screen.getByRole('button', { name: i18n.t('shop.promo.kopiert') })).toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })

  it('schliesst die Promo ueber die Escape-Taste komplett und merkt den Cooldown', async () => {
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0)
    try {
      render(<ShopPromoBanner />)
      expect(await screen.findByText('FLASH25')).toBeInTheDocument()

      fireEvent.keyDown(window, { key: 'Escape' })
      expect(window.localStorage.getItem('msm_shop_promo_dismissed:FLASH25')).not.toBeNull()
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    } finally {
      spy.mockRestore()
    }
  })
})
