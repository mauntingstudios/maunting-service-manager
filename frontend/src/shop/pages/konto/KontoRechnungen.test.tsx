import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return {
    ...actual,
    shopInvoiceApi: {
      ...actual.shopInvoiceApi,
      list: vi.fn().mockResolvedValue([
        {
          id: 9,
          number: 'RE-2026-0009',
          order_id: 42,
          order_number: 'MSM-2026-000042',
          type: 'invoice',
          status: 'issued',
          issued_at: '2026-11-20T10:00:00+00:00',
          due_date: '2026-12-04',
          currency: 'EUR',
          buyer_reference: 'MSM-2026-000042',
          net_cents: 915,
          tax_cents: 174,
          gross_cents: 1089,
          reference_invoice_id: null,
          reason: null,
        },
        {
          id: 4,
          number: 'GS-2025-0003',
          order_id: 12,
          order_number: 'MSM-2025-000012',
          type: 'credit_note',
          status: 'issued',
          issued_at: '2025-05-10T10:00:00+00:00',
          due_date: '2025-05-24',
          currency: 'EUR',
          buyer_reference: 'MSM-2025-000012',
          net_cents: 500,
          tax_cents: 95,
          gross_cents: 595,
          reference_invoice_id: 3,
          reason: 'Kulanz',
        },
      ]),
    },
  }
})

import i18n from '@/i18n'
import { KontoRechnungen } from './KontoRechnungen'

describe('KontoRechnungen', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
  })

  it('zeigt echte Rechnungen mit PDF- und XRechnung-Download sowie Typ- und Jahresfilter', async () => {
    render(
      <MemoryRouter>
        <KontoRechnungen />
      </MemoryRouter>,
    )

    expect(await screen.findByText('RE-2026-0009')).toBeInTheDocument()
    expect(screen.getByText('GS-2025-0003')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.konto.rechnungen.kontextBadge'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('shop.konto.rechnungen.typRechnung'))).toBeInTheDocument()
    expect(screen.getByText(/10,89/)).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /PDF/ })[0]).toHaveAttribute(
      'href',
      expect.stringContaining('/api/shop/invoices/9/pdf'),
    )
    expect(screen.getAllByRole('link', { name: /XRechnung/ })[0]).toHaveAttribute(
      'href',
      expect.stringContaining('/api/shop/invoices/9/xml'),
    )
    expect(screen.getByRole('link', { name: /MSM-2026-000042/ })).toHaveAttribute(
      'href',
      '/konto/bestellungen/42',
    )

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.konto.rechnungen.filterGutschriften') }))
    expect(screen.queryByText('RE-2026-0009')).toBeNull()
    expect(screen.getByText('GS-2025-0003')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.konto.rechnungen.filterAlle') }))
    const jahrBtn = screen.getByRole('button', { name: i18n.t('shop.konto.rechnungen.jahrLabel') })
    fireEvent.click(jahrBtn)
    fireEvent.click(await screen.findByRole('option', { name: '2026' }))
    expect(screen.getByText('RE-2026-0009')).toBeInTheDocument()
    expect(screen.queryByText('GS-2025-0003')).toBeNull()
  })
})
