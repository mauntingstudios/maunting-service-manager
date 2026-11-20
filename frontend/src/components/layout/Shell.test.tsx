import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import i18n from '@/i18n'
import { Shell } from './Shell'
import { useAuthStore } from '@/stores/authStore'
import { usePermissionsStore } from '@/stores/permissionsStore'
import { useServerWallpaperStore, wallpaperMotiv } from '@/stores/serverWallpaperStore'
import { PrivacyNoticeVisibilityContext } from '@/components/app/PrivacyNoticeVisibility'

// Stabilize Shell.test.tsx timeout (VAL-REL-005):
// Shell renders VersionFooter → useVersion (fetches GitHub API) and
// usePublicLegalSettings (fetches /api/system/legal). In jsdom 29, fetch
// is available and makes real HTTP requests that hang the test.
// Mocking these modules makes the test deterministic without weakening
// the assertion (privacy footer link, no impressum).
vi.mock('@/services/versionService', () => ({
  getCachedVersion: () => 'v1.0.0',
  getVersion: () => Promise.resolve('v1.0.0'),
  DEFAULT_VERSION: 'v1.0.0',
}))

vi.mock('@/api/legal', () => ({
  getPublicLegalSettings: () =>
    Promise.resolve({ imprint_enabled: false, imprint_url: '' }),
}))

vi.mock('@/browser/MessengerHintergrund', () => ({
  MessengerHintergrund: () => <span data-testid="queue-background" />,
}))

describe('Shell', () => {
  it('hält das Gerätepostfach auch außerhalb des Messengers offen', () => {
    render(
      <MemoryRouter initialEntries={['/servers']}>
        <Routes><Route path="/servers" element={<Shell />} /></Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('queue-background')).toBeInTheDocument()
  })

  const renderShell = (path = '/audit') => render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<Shell />}>
          <Route index element={<div>Dashboard</div>} />
          <Route path="dashboard" element={<div>Dashboard</div>} />
          <Route path="audit" element={<div>Audit</div>} />
          <Route path="admin/audit" element={<div>Audit</div>} />
          <Route path="docs" element={<div>Hilfe</div>} />
          <Route path="docs/*" element={<div>Hilfe</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  )

  it('zeigt statt der Seitenleiste die Kopfleiste und rückt nichts ein', () => {
    // Die Seitenleiste ist ersatzlos entfallen; die Navigation wohnt in der
    // Kopfleiste. Es darf kein Seitenstreifen mehr da sein, für den der Inhalt
    // Platz ließe.
    renderShell()
    expect(document.querySelector('aside.msm-sidebar')).toBeNull()
    expect(document.querySelector('header.msm-topbar')).not.toBeNull()
    const haupt = screen.getByRole('main')
    expect(haupt.className).not.toMatch(/lg:ml-\d+/)
  })

  it('zeigt auf Dashboard-Routen die Reiterzeile der Server-Verwaltung', () => {
    renderShell('/dashboard')
    expect(screen.getByRole('tablist', { name: i18n.t('mss.dashboard.bereiche') })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: i18n.t('nav.dashboard') })).toHaveAttribute('aria-selected', 'true')
  })

  it('legt auf Dashboard-Routen das Bild hinter Kopfleiste und Reiter', () => {
    // Wie in der MSS-App beginnt die Szene an der Oberkante; läge die
    // Reiterzeile auf flachem Grund, läse sie sich als dunkler Balken.
    const { container } = renderShell('/')
    const wurzel = container.firstElementChild as HTMLElement
    const bild = Array.from(wurzel.querySelectorAll<HTMLElement>(':scope > [aria-hidden="true"]'))
      .find((element) => element.style.backgroundImage.includes('/assets/'))
    expect(bild).toBeDefined()
  })

  it('trägt auf Verwaltungsseiten genau ein Bild statt zweier', () => {
    // Die Hülle trägt das Bild; ein zweites aus dem Seiten-Atlas läge als
    // dunklere Doppelung darüber.
    const { container } = renderShell('/admin/audit')
    const bilder = Array.from(container.querySelectorAll<HTMLElement>('[aria-hidden="true"]'))
      .filter((element) => element.style.backgroundImage.includes('/assets/'))
    expect(bilder).toHaveLength(1)
    expect(bilder[0].parentElement).toBe(container.firstElementChild)
  })

  it('renders the privacy footer link without an impressum link', () => {
    renderShell()

    expect(screen.getByRole('link', { name: 'Datenschutz' })).toHaveAttribute('href', '/privacy')
    expect(screen.queryByText(/Impressum/i)).toBeNull()
    const disBadge = screen.getByRole('link', { name: /Defensive Integration Shield/i })
    expect(disBadge.closest('footer')).not.toBeNull()
  })

  it('does not render Powered by DIS while the privacy notice is open', () => {
    render(
      <PrivacyNoticeVisibilityContext.Provider value>
        <MemoryRouter initialEntries={['/audit']}>
          <Routes>
            <Route path="/" element={<Shell />}>
              <Route path="audit" element={<div>Audit</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </PrivacyNoticeVisibilityContext.Provider>,
    )

    expect(screen.queryByRole('link', { name: /Defensive Integration Shield/i })).toBeNull()
  })

  // jsdom rechnet kein Layout, deshalb prüft diese Probe die Ursache statt der
  // Wirkung: Sobald die Wurzel oder `main` wieder einen Scroll-Container
  // aufmacht, richten sich `.msm-topbar` und die Klebeelemente der Seiten an
  // einem Kasten aus, der sich nie bewegt — sie kleben dann nirgends mehr.
  it('macht weder die Wurzel noch main zum Scroll-Container', () => {
    renderShell()

    const wurzel = document.querySelector('div.min-h-screen')
    expect(wurzel).not.toBeNull()
    expect(wurzel).toHaveClass('overflow-x-clip')
    expect(wurzel).not.toHaveClass('overflow-x-hidden')

    const inhalt = screen.getByRole('main')
    expect(inhalt.className).not.toMatch(/\boverflow-(auto|scroll|hidden|x-auto|y-auto)\b/)
  })

  it('legt auf Standardseiten die Tageszeit-Szene hinter den Inhalt', () => {
    // Nodes, Benutzer, Rollen, Audit, Einstellungen, Blueprints und die
    // Panel-Seiten brachten bis 09.11.2026 keinen eigenen Hintergrund mit.
    // Die Huelle traegt ihn jetzt fuer alle Seiten, die keine eigene Buehne haben.
    const { container } = renderShell('/audit')
    const bild = Array.from(container.querySelectorAll<HTMLElement>('main [aria-hidden="true"]'))
      .find((element) => element.style.backgroundImage.includes('/assets/'))
    expect(bild).toBeDefined()
  })

  it('laesst Hilfe ohne Szenenbild', () => {
    const { container } = renderShell('/docs')
    const bild = Array.from(container.querySelectorAll<HTMLElement>('main [aria-hidden="true"]'))
      .find((element) => element.style.backgroundImage.includes('/assets/'))
    expect(bild).toBeUndefined()
  })

  it('blendet die Kopfzeile im offenen Chat aus', () => {
    // Am Handy beginnt der Chat damit ganz oben; der Chat-Kopf trägt den
    // Zurück-Pfeil. In der Liste ist die Leiste wieder da.
    const zeige = (pfad: string) =>
      render(
        <MemoryRouter initialEntries={[pfad]}>
          <Routes>
            <Route path="/chat" element={<Shell />}>
              <Route index element={<div>Chat</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      )

    const mitChat = zeige('/chat?userId=7')
    expect(screen.queryByRole('banner')).toBeNull()
    mitChat.unmount()

    zeige('/chat')
    expect(screen.getByRole('button', { name: i18n.t('mss.app.menueOeffnen') })).toBeInTheDocument()
  })

  it('öffnet das Menü-Blatt, schließt mit Escape und gibt den Fokus zurück', async () => {
    useAuthStore.setState({ user: { username: 'owner', email: 'owner@example.invalid', is_owner: true } as never })
    usePermissionsStore.setState({ me: { is_owner: true, role_id: null, role_name: null, global_keys: [], server_keys: {} }, isLoading: false, error: null })
    renderShell()
    const trigger = screen.getByRole('button', { name: i18n.t('mss.app.menueOeffnen') })
    trigger.focus()
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: i18n.t('shell.mainNavigation') })).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: i18n.t('shell.mainNavigation') })).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('rendert auf Server-Detailseiten das aktive Server-Titelbild statt des Panoramas', () => {
    useServerWallpaperStore.setState({
      activeWallpaper: wallpaperMotiv(42, '/api/servers/42/wallpaper', 'steam-1'),
    })
    try {
      const { container } = render(
        <MemoryRouter initialEntries={['/servers/42']}>
          <Routes>
            <Route path="/" element={<Shell />}>
              <Route path="servers/:id" element={<div>ServerDetail</div>} />
            </Route>
          </Routes>
        </MemoryRouter>,
      )
      const wurzel = container.firstElementChild as HTMLElement
      const hintergrund = Array.from(wurzel.querySelectorAll<HTMLElement>(':scope > [aria-hidden="true"]'))
        .find((element) => element.style.backgroundImage.includes('/api/servers/42/wallpaper'))
      expect(hintergrund).toBeDefined()
      expect(hintergrund?.style.backgroundImage).toContain('v=steam-1')
    } finally {
      useServerWallpaperStore.getState().clear()
    }
  })
})
