import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

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
        },
      ]),
    },
  }
})

import { KontoRechnungen } from './KontoRechnungen'

describe('KontoRechnungen', () => {
  it('zeigt echte Rechnungen mit PDF- und XRechnung-Download', async () => {
    render(<KontoRechnungen />)

    expect(await screen.findByText('RE-2026-0009')).toBeInTheDocument()
    expect(screen.getByText(/10,89/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /PDF/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/shop/invoices/9/pdf'),
    )
    expect(screen.getByRole('link', { name: /XRechnung/ })).toHaveAttribute(
      'href',
      expect.stringContaining('/api/shop/invoices/9/xml'),
    )
  })
})
