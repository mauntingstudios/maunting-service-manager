import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useAuthStore } from './stores/authStore'
import { usePublicSettingsStore } from './stores/publicSettingsStore'

vi.mock('@/pages/Login', () => ({
  Login: () => <div data-testid="login-page">Login</div>,
}))
vi.mock('@/pages/SetupWizard', () => ({
  SetupWizard: () => <div data-testid="setup-wizard">SetupWizard</div>,
}))
vi.mock('@/shop/ShopWeiche', () => ({
  ShopWeiche: () => <div data-testid="shop-weiche">ShopWeiche</div>,
}))
vi.mock('./components/SupportWidgetLoader', () => ({
  SupportWidgetLoader: () => null,
}))
vi.mock('./season/SaisonDeko', () => ({
  SaisonDeko: () => null,
}))
vi.mock('@/components/app/PrivacyAcknowledgementNotice', () => ({
  PrivacyAcknowledgementNotice: () => null,
}))
vi.mock('./lib/offlineSync', () => ({
  initOfflineSync: () => () => {},
}))
vi.mock('./lib/preloadSelbstheilung', () => ({
  cleanupPreloadUrlParam: vi.fn(),
}))
vi.mock('./hooks/useKontoBundNachholen', () => ({
  useKontoBundNachholen: vi.fn(),
}))

import App from './App'

describe('Paket 2A: App startup setup-status resilience', () => {
  beforeEach(() => {
    localStorage.clear()
    useAuthStore.setState({ user: null, isAuthenticated: false, isLoading: false })
    vi.spyOn(useAuthStore.getState(), 'checkAuth').mockResolvedValue(undefined)
    vi.spyOn(usePublicSettingsStore.getState(), 'refresh').mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('bricht ein ewig haengendes /auth/setup-status nach 4s ab und bleibt nicht im Loader stecken', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )

    expect(screen.getByText('Maunting Service Manager')).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100)
    })
    vi.useRealTimers()

    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
  })

  it('faengt HTTP 500 bei /auth/setup-status ab ohne im Loader zu haengen', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })),
    )

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )

    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    expect(localStorage.getItem('msm_setup_completed')).toBeNull()
  })

  it('rendert bei gesetztem msm_setup_completed sofort die Routen und revalidiert im Hintergrund', async () => {
    localStorage.setItem('msm_setup_completed', '1')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ setup_required: true, email_configured: false }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    )

    render(
      <MemoryRouter initialEntries={['/login']}>
        <App />
      </MemoryRouter>,
    )

    // Wenn der Server wider Erwarten setup_required: true meldet, greift der SetupWizard und das Flag wird gelöscht.
    expect(await screen.findByTestId('setup-wizard')).toBeInTheDocument()
    expect(localStorage.getItem('msm_setup_completed')).toBeNull()
  })
})
