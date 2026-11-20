import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'

vi.mock('@/api/shop', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/shop')>()
  return { ...actual, shopCatalogApi: { getCatalog: vi.fn().mockResolvedValue([]) } }
})

import { ShopSpiel } from './ShopSpiel'

function KasseZiel() {
  const location = useLocation()
  return <div data-testid="kasse">{JSON.stringify(location.state)}</div>
}

function zeige(start: string) {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/shop/:spielId" element={<ShopSpiel />} />
        <Route path="/shop/:spielId/kasse" element={<KasseZiel />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ShopSpiel', () => {
  it('zeigt das Spiel und reicht die Konfiguration an die Kasse weiter', () => {
    zeige('/shop/palworld')
    expect(screen.getByRole('heading', { level: 1, name: 'Palworld' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.spiel.weiterKasse') }))
    expect(screen.getByTestId('kasse')).toHaveTextContent('palworld')
  })

  it('aktualisiert den Gesamtpreis bei laengerer Laufzeit', () => {
    zeige('/shop/palworld')
    fireEvent.click(screen.getByRole('button', { name: i18n.t('shop.spiel.monate', { count: 12 }) }))
    expect(screen.getByText(/67,10/)).toBeInTheDocument()
  })

  it('zeigt bei unbekannter ID eine Fehlerflaeche', async () => {
    zeige('/shop/gibtesnicht')
    expect(await screen.findByText(i18n.t('shop.spiel.nichtGefundenTitel'))).toBeInTheDocument()
  })
})
