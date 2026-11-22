import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { ShopTab } from './ShopTab'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

const { apiMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
}))

vi.mock('@/api/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/client')>()
  return {
    ...actual,
    api: apiMock,
  }
})

describe('ShopTab', () => {
  beforeEach(() => {
    usePublicSettingsStore.setState({ shop_enabled: true })
    apiMock.mockImplementation(async (pfad: string, init?: RequestInit) => {
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
      if (pfad.includes('/shop/admin/orders')) {
        return [
          {
            id: 7,
            number: 'MSM-2026-000007',
            status: 'paid',
            currency: 'EUR',
            billing_interval: 'month',
            months: 1,
            discount_percent: 0,
            net_cents: 587,
            tax_cents: 112,
            gross_cents: 699,
            payment_provider: 'stripe',
            payment_reference: 'cs_7',
            created_at: '2026-11-21T10:00:00+00:00',
            paid_at: '2026-11-21T10:00:05+00:00',
            items: [],
            user_id: 2,
            username: 'user1',
            entitlements: [
              {
                id: 9,
                kind: 'server',
                label: 'Palworld',
                status: 'active',
                server_id: 5,
                provisioning_status: 'ready',
                provisioning_error: null,
                created_at: '2026-11-21T10:00:05+00:00',
              },
            ],
          },
        ]
      }
      if (pfad.includes('/shop/admin/invoices')) {
        return [
          {
            id: 3,
            number: 'RE-2026-0003',
            order_id: 7,
            order_number: 'MSM-2026-000007',
            type: 'invoice',
            status: 'issued',
            issued_at: '2026-11-21T10:00:05+00:00',
            due_date: '2026-12-05',
            currency: 'EUR',
            buyer_reference: 'MSM-2026-000007',
            net_cents: 587,
            tax_cents: 112,
            gross_cents: 699,
            reference_invoice_id: null,
            reason: null,
          },
        ]
      }
      if (pfad.includes('/shop/admin/webhooks')) {
        return [
          {
            id: 1,
            event_id: 'evt_test_99',
            event_type: 'checkout.session.completed',
            order_id: 7,
            status: 'processed',
            received_at: '2026-11-21T10:00:05+00:00',
          },
        ]
      }
      if (pfad.includes('/shop/admin/lifecycle-settings')) {
        if (init?.method === 'PUT') {
          return JSON.parse(String(init.body ?? '{}'))
        }
        return {
          cancel_grace_days: 7,
          unpaid_auto_delete_enabled: true,
          unpaid_delete_days: 30,
          allow_customer_immediate_delete: true,
          dunning_reminder_days: [7, 4, 1],
        }
      }
      if (pfad.includes('/shop/reconcile') && init?.method === 'POST') {
        return {
          orders_checked: 1,
          orders_marked_paid: 0,
          orders_expired: 0,
          invoices_issued: 0,
          entitlements_synced: 0,
          pending_orders_remaining: 0,
          failed_entitlements_remaining: 0,
          errors: [],
        }
      }
      return []
    })
  })

  it('zeigt echte Bestellungen, Rechnungen mit Export, Webhooks und Abgleich-Aktion', async () => {
    render(<ShopTab />)

    expect(screen.getByRole('heading', { name: i18n.t('settings.shop.titel') })).toBeInTheDocument()
    expect(await screen.findByText(i18n.t('settings.shop.stripe.nichtKonfiguriert'))).toBeInTheDocument()
    expect(await screen.findByText('MSM-2026-000007')).toBeInTheDocument()
    expect(await screen.findByText('RE-2026-0003')).toBeInTheDocument()
    expect(await screen.findByText('evt_test_99')).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: i18n.t('settings.shop.betrieb.pruefExport') }),
    ).toHaveAttribute('href', expect.stringContaining('/api/shop/invoices/export'))

    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('settings.shop.betrieb.abgleichStarten') }),
    )
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/shop/reconcile', { method: 'POST' })
    })

    const graceInput = screen.getByLabelText(i18n.t('settings.shop.lifecycle.cancelGraceDays'))
    fireEvent.change(graceInput, { target: { value: '14' } })
    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('settings.shop.lifecycle.speichern') }),
    )
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith(
        '/shop/admin/lifecycle-settings',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"cancel_grace_days":14'),
        }),
      )
    })
  })
})
