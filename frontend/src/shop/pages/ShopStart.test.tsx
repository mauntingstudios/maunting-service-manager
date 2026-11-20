import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return { ...actual, shopCatalogApi: { getCatalog: vi.fn().mockResolvedValue([]) } }
})

import { ShopStart } from './ShopStart'

function zeige() {
  return render(
    <MemoryRouter>
      <ShopStart />
    </MemoryRouter>,
  )
}

describe('ShopStart', () => {
  it('zeigt Hero und alle Demo-Spiele', () => {
    zeige()
    expect(screen.getByRole('heading', { level: 1, name: i18n.t('shop.hero.titel') })).toBeInTheDocument()
    const karten = screen
      .getAllByRole('link')
      .filter((link) => link.getAttribute('href')?.startsWith('/shop/'))
    expect(karten).toHaveLength(10)
  })

  it('filtert die Sammlung ueber die Suche', () => {
    zeige()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'rust' } })
    expect(screen.getByRole('heading', { name: 'Rust' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Palworld' })).toBeNull()
  })

  it('zeigt einen Leerzustand ohne Treffer', () => {
    zeige()
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'gibtesnicht' } })
    expect(screen.getByText(i18n.t('shop.sammlung.leerTitel'))).toBeInTheDocument()
  })
})
