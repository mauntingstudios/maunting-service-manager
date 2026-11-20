import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

const hoisted = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopSellerApi: { get: hoisted.get, set: hoisted.set },
  }
})

import { SellerDatenKarte } from './SellerDatenKarte'

const DATEN = {
  name: 'Maunting Studios Test',
  street: 'Teststrasse 1',
  postal_code: '12345',
  city: 'Teststadt',
  country: 'DE',
  email: 'rechnung@example.invalid',
  phone: '',
  vat_id: 'DE123456789',
  tax_number: '',
  iban: 'DE02120300000000202051',
  bic: 'BYLADEM1001',
  payment_terms_days: 14,
  invoice_prefix: 'RE',
  small_business: false,
  missing_fields: [] as string[],
}

describe('SellerDatenKarte', () => {
  beforeEach(() => {
    hoisted.get.mockReset()
    hoisted.set.mockReset()
  })

  it('warnt bei fehlenden Pflichtangaben', async () => {
    hoisted.get.mockResolvedValue({ ...DATEN, name: '', missing_fields: ['name'] })
    render(<SellerDatenKarte />)
    expect(
      await screen.findByText(i18n.t('settings.shop.seller.unvollstaendig')),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('settings.shop.seller.fehlend', { felder: 'name' })),
    ).toBeInTheDocument()
  })

  it('speichert die Verkaeuferdaten', async () => {
    hoisted.get.mockResolvedValue({ ...DATEN })
    hoisted.set.mockResolvedValue({ ...DATEN })
    render(<SellerDatenKarte />)

    fireEvent.click(
      await screen.findByRole('button', {
        name: i18n.t('settings.shop.seller.speichern'),
      }),
    )

    await waitFor(() => expect(hoisted.set).toHaveBeenCalledTimes(1))
    const payload = hoisted.set.mock.calls[0][0]
    expect(payload.name).toBe('Maunting Studios Test')
    expect(payload.missing_fields).toBeUndefined()
  })
})
