import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ShopTab } from './ShopTab'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return {
    ...actual,
    api: vi.fn(async (pfad: string) => {
      if (pfad.includes('/shop/stripe/status')) {
        return {
          configured: false,
          mode: 'unknown',
          secret_key_source: 'none',
          webhook_secret_source: 'none',
          publishable_key: '',
        }
      }
      if (pfad.includes('/shop/seller')) {
        return {
          name: '',
          street: '',
          postal_code: '',
          city: '',
          country: 'DE',
          email: '',
          phone: '',
          vat_id: '',
          tax_number: '',
          iban: '',
          bic: '',
          payment_terms_days: 14,
          invoice_prefix: 'RE',
          small_business: false,
          missing_fields: ['name'],
        }
      }
      return []
    }),
  }
})

describe('ShopTab', () => {
  beforeEach(() => {
    usePublicSettingsStore.setState({ shop_enabled: true })
  })

  it('zeigt den Demo-Status und alle vorbereiteten Bereiche', async () => {
    render(<ShopTab />)
    expect(screen.getByRole('heading', { name: i18n.t('settings.shop.titel') })).toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.shop.demo'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.shop.zahlungen.titel'))).toBeInTheDocument()
    expect(await screen.findByText(i18n.t('settings.shop.stripe.nichtKonfiguriert'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.shop.rechnungen.titel'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.shop.addons.titel'))).toBeInTheDocument()
    expect(await screen.findByText(i18n.t('settings.shop.plans.leer'))).toBeInTheDocument()
  })
})
