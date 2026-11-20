import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return { ...actual, shopCatalogApi: { getCatalog: vi.fn().mockResolvedValue([]) } }
})

import { ShopKasse } from './ShopKasse'

function zeige() {
  return render(
    <MemoryRouter initialEntries={['/shop/palworld/kasse']}>
      <Routes>
        <Route path="/shop/:spielId/kasse" element={<ShopKasse />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ShopKasse', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('verlangt eine gueltige E-Mail', () => {
    zeige()
    fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.email')), {
      target: { value: 'keine-mail' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.karte')), {
      target: { value: '4242 4242 4242 4242' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.kasse.zahlen') }))
    expect(screen.getByRole('alert')).toHaveTextContent(i18n.t('shop.kasse.emailUngueltig'))
  })

  it('schliesst die Demo-Zahlung ohne Netzwerkaufruf ab', () => {
    zeige()
    fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.email')), {
      target: { value: 'kunde@example.com' },
    })
    fireEvent.change(screen.getByLabelText(i18n.t('shop.kasse.karte')), {
      target: { value: '4242 4242 4242 4242' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.kasse.zahlen') }))
    act(() => {
      vi.advanceTimersByTime(800)
    })
    expect(screen.getByRole('status')).toHaveTextContent('MSM-DEMO-')
  })
})
