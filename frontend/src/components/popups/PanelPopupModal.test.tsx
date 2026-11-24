import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { POPUP_GUEST_STORAGE_KEY, PanelPopupCard, PanelPopupModal } from './PanelPopupModal'
import * as popupsApi from '@/api/popups'
import { useAuthStore } from '@/stores/authStore'
import i18n from '@/i18n'

vi.mock('@/api/popups', () => ({
  getActivePopup: vi.fn(),
  getPublicActivePopups: vi.fn(),
  dismissPopup: vi.fn(),
}))

describe('PanelPopupModal', () => {
  // Der Markdown-Teil lädt nach (`lazy`). Vorab geladen, damit der erste
  // Test nicht an der Umwandlung von react-markdown vorbeiwartet.
  beforeAll(async () => {
    await import('@/components/ai/AiMarkdown')
    await i18n.changeLanguage('de')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    useAuthStore.setState({ isAuthenticated: true })
  })

  it('fetches and renders non-blocking bottom-right card without stealing focus', async () => {
    vi.mocked(popupsApi.getPublicActivePopups).mockResolvedValue([
      {
        id: 1,
        title: 'Wartungsarbeiten angekündigt',
        content_markdown: 'Am Samstag finden **Wartungsarbeiten** statt.',
        audience: 'panel',
        tone: 'maintenance',
        is_active: true,
        start_at: null,
        end_at: null,
        button_text: 'Statusseite',
        button_url: 'https://status.example.com',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])

    const focusProbe = document.createElement('button')
    document.body.appendChild(focusProbe)
    focusProbe.focus()

    try {
      const { container } = render(<PanelPopupModal surface="panel" />)

      expect(await screen.findByText('Wartungsarbeiten angekündigt')).toBeInTheDocument()
      expect(await screen.findByText('Wartungsarbeiten')).toBeInTheDocument()
      const link = screen.getByRole('link', { name: 'Statusseite' })
      expect(link).toHaveAttribute('href', 'https://status.example.com')

      const region = screen.getByRole('region')
      expect(region).toHaveAttribute('data-tone', 'maintenance')
      expect(region).not.toHaveAttribute('aria-modal', 'true')
      expect(container.querySelector('.msm-modal-overlay')).toBeNull()
      expect(document.activeElement).toBe(focusProbe)
    } finally {
      focusProbe.remove()
    }
  })

  it('handles snooze dismissal and advances queue for authenticated users', async () => {
    vi.mocked(popupsApi.getPublicActivePopups).mockResolvedValue([
      {
        id: 42,
        title: 'Wichtiger Hinweis',
        content_markdown: 'Bitte beachten.',
        audience: 'all',
        tone: 'info',
        is_active: true,
        start_at: null,
        end_at: null,
        button_text: null,
        button_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 43,
        title: 'Zweiter Hinweis',
        content_markdown: 'Nächste Meldung.',
        audience: 'all',
        tone: 'promo',
        is_active: true,
        start_at: null,
        end_at: null,
        button_text: null,
        button_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    ])
    vi.mocked(popupsApi.dismissPopup).mockResolvedValue({ ok: true, mode: 'snooze' })

    render(<PanelPopupCard surface="panel" />)

    expect(await screen.findByText('Wichtiger Hinweis')).toBeInTheDocument()
    const understandBtn = screen.getByRole('button', { name: /Verstanden|Understood/i })
    fireEvent.click(understandBtn)

    await waitFor(() => {
      expect(popupsApi.dismissPopup).toHaveBeenCalledWith(42, 'snooze')
    })
    expect(await screen.findByText('Zweiter Hinweis')).toBeInTheDocument()
  })

  it('handles permanent dismissal', async () => {
    vi.mocked(popupsApi.dismissPopup).mockResolvedValue({ ok: true, mode: 'permanent' })

    render(
      <PanelPopupModal
        popup={{
          id: 42,
          title: 'Wichtiger Hinweis',
          content_markdown: 'Bitte beachten.',
          is_active: true,
          start_at: null,
          end_at: null,
          button_text: null,
          button_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }}
      />,
    )

    const permanentBtn = screen.getByRole('button', { name: /Nicht mehr anzeigen|Don't show again/i })
    fireEvent.click(permanentBtn)

    await waitFor(() => {
      expect(popupsApi.dismissPopup).toHaveBeenCalledWith(42, 'permanent')
    })
  })

  it('persists guest dismissals in localStorage on shop surface and filters them on reload', async () => {
    useAuthStore.setState({ isAuthenticated: false })
    const shopPopup = {
      id: 77,
      title: 'Frühjahrsangebot',
      content_markdown: 'Jetzt Tarife vergleichen.',
      audience: 'shop' as const,
      tone: 'promo' as const,
      is_active: true,
      start_at: null,
      end_at: null,
      button_text: 'Tarife ansehen',
      button_url: '/shop',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    vi.mocked(popupsApi.getPublicActivePopups).mockResolvedValue([shopPopup])

    const firstRender = render(<PanelPopupCard surface="shop" />)
    expect(await screen.findByText('Frühjahrsangebot')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Tarife ansehen' })).toHaveAttribute('href', '/shop')

    fireEvent.click(screen.getByRole('button', { name: /Nicht mehr anzeigen|Don't show again/i }))

    await waitFor(() => {
      expect(screen.queryByText('Frühjahrsangebot')).not.toBeInTheDocument()
    })
    expect(popupsApi.dismissPopup).not.toHaveBeenCalled()
    expect(window.localStorage.getItem(POPUP_GUEST_STORAGE_KEY)).toContain('"77"')

    firstRender.unmount()

    render(<PanelPopupCard surface="shop" />)
    await waitFor(() => {
      expect(popupsApi.getPublicActivePopups).toHaveBeenCalledTimes(2)
    })
    expect(screen.queryByText('Frühjahrsangebot')).not.toBeInTheDocument()
  })

  it('suppresses popup while a modal dialog is open unless previewing and rejects unsafe URLs', async () => {
    render(
      <>
        <div role="dialog" aria-modal="true">Modales Fenster</div>
        <PanelPopupModal
          popup={{
            id: 99,
            title: 'Unsicherer Link',
            content_markdown: 'Nur Text bleibt.',
            is_active: true,
            start_at: null,
            end_at: null,
            button_text: 'Klick',
            button_url: 'javascript:alert(1)',
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }}
        />
      </>,
    )

    expect(screen.queryByText('Unsicherer Link')).not.toBeInTheDocument()

    render(
      <PanelPopupModal
        isPreview={true}
        popup={{
          id: 99,
          title: 'Vorschau trotz Modal',
          content_markdown: 'Nur Text bleibt.',
          is_active: true,
          start_at: null,
          end_at: null,
          button_text: 'Klick',
          button_url: 'javascript:alert(1)',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }}
      />,
    )

    expect(await screen.findByText('Vorschau trotz Modal')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Klick' })).not.toBeInTheDocument()
  })
})
