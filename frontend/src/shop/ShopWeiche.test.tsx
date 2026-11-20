import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ShopWeiche } from './ShopWeiche'
import { usePublicSettingsStore } from '@/stores/publicSettingsStore'

function zeige(start: string) {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/" element={<ShopWeiche />}>
          <Route index element={<div data-testid="shop-start" />} />
          <Route path="shop/:id" element={<div data-testid="shop-detail" />} />
        </Route>
        <Route path="/dashboard" element={<div data-testid="dashboard" />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('ShopWeiche', () => {
  beforeEach(() => {
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    usePublicSettingsStore.setState({ shop_enabled: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('zeigt den Shop, wenn er aktiv ist', () => {
    zeige('/shop/rust')
    expect(screen.getByTestId('shop-detail')).toBeInTheDocument()
  })

  it('leitet auf /dashboard, wenn der Shop abgeschaltet ist', () => {
    usePublicSettingsStore.setState({ shop_enabled: false })
    zeige('/shop/rust')
    expect(screen.getByTestId('dashboard')).toBeInTheDocument()
  })
})
