import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

vi.mock('@/hooks/useHasPermission', () => ({
  useHasPermission: () => true,
}))

const { createCouponMock, listCouponsMock, listPlansMock, syncStripeMock } = vi.hoisted(
  () => ({
    createCouponMock: vi.fn(),
    listCouponsMock: vi.fn(),
    listPlansMock: vi.fn(),
    syncStripeMock: vi.fn(),
  }),
)

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopAdminApi: {
      listPlans: listPlansMock,
      listCoupons: listCouponsMock,
      createCoupon: createCouponMock,
      updateCoupon: vi.fn(),
      deleteCoupon: vi.fn(),
      syncCouponStripe: syncStripeMock,
    },
  }
})

import { ShopCouponsEditor } from './ShopCouponsEditor'

describe('ShopCouponsEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listPlansMock.mockResolvedValue([])
    listCouponsMock.mockResolvedValue([
      {
        id: 2,
        code: 'SOMMER30',
        name: 'Sommer-Aktion',
        promo_text: '30 % auf alle Gameserver',
        discount_type: 'percent',
        discount_value: 30,
        currency: 'EUR',
        scope: 'all',
        target_plan_ids: [],
        min_gross_cents: 0,
        max_redemptions: 100,
        redemption_count: 4,
        valid_from: null,
        valid_until: null,
        show_badge: true,
        show_banner: true,
        banner_cooldown_hours: 6,
        stripe_coupon_id: null,
        stripe_promotion_code_id: null,
        active: true,
        created_at: '2026-11-21T00:00:00+00:00',
        updated_at: '2026-11-21T00:00:00+00:00',
      },
    ])
    createCouponMock.mockResolvedValue({})
    syncStripeMock.mockResolvedValue({})
  })

  it('listet Gutscheine, triggert Stripe-Sync und legt neuen Code an', async () => {
    render(<ShopCouponsEditor />)
    expect(await screen.findByText('SOMMER30')).toBeInTheDocument()
    expect(screen.getByText('-30 %')).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('settings.shop.coupons.stripeSync') }),
    )
    await waitFor(() => {
      expect(syncStripeMock).toHaveBeenCalledWith(2)
    })

    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('settings.shop.coupons.neu') }),
    )
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.shop.coupons.abschnittBasis'))).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('settings.shop.coupons.abschnittBedingungen')),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('settings.shop.coupons.abschnittDarstellung')),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('settings.shop.coupons.stripeAutoHinweis')),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(i18n.t('settings.shop.coupons.code')), {
      target: { value: 'HERBST15' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('settings.shop.coupons.name')), {
      target: { value: 'Herbst-Rabatt' },
    })
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('settings.shop.coupons.speichern') }),
    )

    await waitFor(() => {
      expect(createCouponMock).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'HERBST15',
          name: 'Herbst-Rabatt',
          discount_type: 'percent',
          discount_value: 10,
        }),
      )
    })
  })
})
