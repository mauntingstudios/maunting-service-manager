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
      if (pfad === '/shop/plans') {
        return [
          {
            id: 1,
            game_type: 'palworld',
            name: 'Palworld Tarif',
            description: null,
            price_cents: 699,
            currency: 'EUR',
            billing_interval: 'month',
            tax_rate_percent: 19,
            ram_included_mb: 8192,
            ram_max_mb: 16384,
            ram_step_mb: 1024,
            price_per_ram_step_cents: 90,
            cpu_included: 200,
            cpu_max: 400,
            cpu_step: 50,
            price_per_cpu_step_cents: 150,
            slots_included: 8,
            slots_max: 32,
            slots_step: 1,
            price_per_slot_step_cents: 30,
            node_id: null,
            role_id: null,
            artwork_mode: 'steam',
            active: true,
            sort_order: 0,
            created_at: '2026-11-20T00:00:00+00:00',
            updated_at: '2026-11-20T00:00:00+00:00',
            artwork: {
              source: 'steam',
              url: '/api/shop/artwork/palworld?v=steam-1623730',
              version: 'steam-1623730',
            },
          },
        ]
      }
      if (pfad === '/system/games') {
        return [{ id: 'palworld', name: 'Palworld' }]
      }
      if (pfad.includes('/shop/admin/stats')) {
        return {
          total_orders: 1,
          paid_orders: 1,
          pending_orders: 0,
          refunded_orders: 0,
          paid_gross_cents: 699,
          paid_net_cents: 587,
          refunded_gross_cents: 0,
          active_subscriptions: 1,
          active_addon_subscriptions: 0,
          active_coupons: 0,
          coupon_redemptions: 0,
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

  it('strukturiert den Shop in 5 klare Tabs und deckt Uebersicht, Sortiment, Bestellungen, Buchhaltung und Einrichtung ab', async () => {
    render(<ShopTab />)

    expect(screen.getByRole('heading', { name: i18n.t('settings.shop.titel') })).toBeInTheDocument()

    // Alle 5 Haupt-Tabs vorhanden
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      i18n.t('settings.shop.tabs.overview'),
      i18n.t('settings.shop.tabs.catalog'),
      i18n.t('settings.shop.tabs.orders'),
      i18n.t('settings.shop.tabs.accounting'),
      i18n.t('settings.shop.tabs.setup'),
    ])

    // 1. Übersicht: Einrichtungsstatus + letzte Bestellungen
    expect(await screen.findByText(i18n.t('settings.shop.stripe.nichtKonfiguriert'))).toBeInTheDocument()
    expect(await screen.findByText(i18n.t('settings.shop.seller.unvollstaendig'))).toBeInTheDocument()
    expect(await screen.findByText(i18n.t('settings.shop.overview.tarifeAktiv', { count: 1 }))).toBeInTheDocument()
    expect(await screen.findByText('MSM-2026-000007')).toBeInTheDocument()

    // 2. Sortiment: Sub-Tabs + Produkt-Regal
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.shop.tabs.catalog') }))
    expect(screen.getByRole('tab', { name: i18n.t('settings.shop.catalogTabs.plans') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('settings.shop.catalogTabs.addons') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('settings.shop.catalogTabs.coupons') })).toBeInTheDocument()
    expect(await screen.findByText('Palworld Tarif')).toBeInTheDocument()

    // 3. Bestellungen: Liste + Stripe-Abgleich
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.shop.tabs.orders') }))
    expect(await screen.findByText('MSM-2026-000007')).toBeInTheDocument()
    expect(
      screen.getAllByText(i18n.t('settings.shop.betrieb.status.paid')).length,
    ).toBeGreaterThanOrEqual(2)
    expect(
      screen.getByText(
        `${i18n.t('settings.shop.betrieb.freischaltungArt.server')} · ${i18n.t('settings.shop.betrieb.freischaltung.ready')}`,
      ),
    ).toBeInTheDocument()

    fireEvent.click(
      screen.getByRole('button', { name: i18n.t('settings.shop.betrieb.abgleichStarten') }),
    )
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/shop/reconcile', { method: 'POST' })
    })

    // 4. Rechnungen & Buchhaltung: Rechnungen + Filter + Export + Verkäuferdaten
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.shop.tabs.accounting') }))
    expect(await screen.findByText('RE-2026-0003')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.shop.betrieb.betreiberAnsichtBadge'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('settings.shop.betrieb.typShopRechnung'))).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: i18n.t('settings.shop.betrieb.pruefExport') }),
    ).toHaveAttribute('href', expect.stringContaining('/api/shop/invoices/export'))

    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.shop.betrieb.filterGutschriften') }))
    expect(screen.queryByText('RE-2026-0003')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('settings.shop.betrieb.filterAlle') }))
    expect(screen.getByText('RE-2026-0003')).toBeInTheDocument()
    expect(await screen.findByText(i18n.t('settings.shop.seller.titel'))).toBeInTheDocument()

    // 5. Einrichtung & Regeln: Stripe + Löschfristen + aufklappbare Webhooks
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.shop.tabs.setup') }))
    expect(await screen.findByText(i18n.t('settings.shop.stripe.nichtKonfiguriert'))).toBeInTheDocument()

    const graceInput = screen.getByLabelText(i18n.t('settings.shop.lifecycle.cancelGraceDays'))
    fireEvent.change(graceInput, { target: { value: '14' } })
    const discountInput = screen.getByLabelText(
      i18n.t('settings.shop.lifecycle.subscriptionDiscountPercent'),
    )
    fireEvent.change(discountInput, { target: { value: '12' } })
    const refundDaysInput = screen.getByLabelText(
      i18n.t('settings.shop.lifecycle.refundGuaranteeDays'),
    )
    fireEvent.change(refundDaysInput, { target: { value: '14' } })
    fireEvent.click(
      screen.getByRole('switch', { name: i18n.t('settings.shop.lifecycle.autoSubdomainEnabled') }),
    )
    const zoneInput = screen.getByLabelText(
      i18n.t('settings.shop.lifecycle.autoSubdomainZone'),
    )
    fireEvent.change(zoneInput, { target: { value: 'play.example.gg' } })
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
      expect(apiMock).toHaveBeenCalledWith(
        '/shop/admin/lifecycle-settings',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"subscription_discount_percent":12'),
        }),
      )
      expect(apiMock).toHaveBeenCalledWith(
        '/shop/admin/lifecycle-settings',
        expect.objectContaining({
          method: 'PUT',
          body: expect.stringContaining('"auto_subdomain_zone":"play.example.gg"'),
        }),
      )
    })

    // Technisches Webhook-Protokoll lässt sich aufklappen
    fireEvent.click(screen.getByText(i18n.t('settings.shop.betrieb.webhooksAufklappen')))
    expect(await screen.findByText('evt_test_99')).toBeInTheDocument()
  })

  it('zeigt den gespeicherten Freischaltungsfehler bei fehlgeschlagenen Server-Entitlements an', async () => {
    const baseMock = apiMock.getMockImplementation()
    apiMock.mockImplementation(async (pfad: string, init?: RequestInit) => {
      if (pfad.includes('/shop/admin/orders')) {
        return [
          {
            id: 99,
            number: 'MSM-2026-000099',
            status: 'paid',
            gross_cents: 699,
            currency: 'EUR',
            payment_provider: 'stripe',
            payment_reference: 'cs_99',
            created_at: '2026-11-21T10:00:00+00:00',
            paid_at: '2026-11-21T10:00:05+00:00',
            items: [],
            user_id: 2,
            username: 'user1',
            entitlements: [
              {
                id: 42,
                kind: 'server',
                label: 'Palworld',
                status: 'active',
                server_id: null,
                provisioning_status: 'failed',
                provisioning_error: 'insufficient_node_ram',
                created_at: '2026-11-21T10:00:05+00:00',
              },
            ],
          },
        ]
      }
      return baseMock ? baseMock(pfad, init) : []
    })

    render(<ShopTab />)
    fireEvent.click(screen.getByRole('tab', { name: i18n.t('settings.shop.tabs.orders') }))

    expect(await screen.findByText('MSM-2026-000099')).toBeInTheDocument()
    expect(
      screen.getByText(
        `${i18n.t('settings.shop.betrieb.freischaltungArt.server')} · ${i18n.t('settings.shop.betrieb.freischaltung.failed')}`,
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        `${i18n.t('settings.shop.betrieb.freischaltungFehler.insufficient_node_ram')} (insufficient_node_ram)`,
      ),
    ).toBeInTheDocument()
  })
})
