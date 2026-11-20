import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import i18n from '@/i18n'

const hoisted = vi.hoisted(() => ({
  status: vi.fn(),
  setKeys: vi.fn(),
}))

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopStripeApi: { status: hoisted.status, setKeys: hoisted.setKeys },
  }
})

import { StripeZahlungenKarte } from './StripeZahlungenKarte'

const UNKONFIGURIERT = {
  configured: false,
  mode: 'unknown',
  secret_key_source: 'none',
  webhook_secret_source: 'none',
  publishable_key: '',
}

describe('StripeZahlungenKarte', () => {
  beforeEach(() => {
    hoisted.status.mockReset()
    hoisted.setKeys.mockReset()
    hoisted.status.mockResolvedValue(UNKONFIGURIERT)
  })

  it('zeigt den Status und speichert eingegebene Schluessel', async () => {
    hoisted.setKeys.mockResolvedValue({
      configured: true,
      mode: 'test',
      secret_key_source: 'panel',
      webhook_secret_source: 'panel',
      publishable_key: 'pk_test_public_not_real',
    })

    render(<StripeZahlungenKarte />)
    expect(
      await screen.findByText(i18n.t('settings.shop.stripe.nichtKonfiguriert')),
    ).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(i18n.t('settings.shop.stripe.secretKey')), {
      target: { value: 'sk_test_placeholder_not_real' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('settings.shop.stripe.webhookSecret')), {
      target: { value: 'whsec_test_not_real' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.shop.stripe.speichern') }))

    await waitFor(() =>
      expect(hoisted.setKeys).toHaveBeenCalledWith({
        secret_key: 'sk_test_placeholder_not_real',
        webhook_secret: 'whsec_test_not_real',
      }),
    )
    expect(await screen.findByText(i18n.t('settings.shop.stripe.konfiguriert'))).toBeInTheDocument()
  })
})
