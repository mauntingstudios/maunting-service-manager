import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BenachrichtigungsGlocke } from './BenachrichtigungsGlocke'
import { useAuthStore } from '@/stores/authStore'
import { useToastStore } from '@/stores/toastStore'
import { api } from '@/api/client'
import i18n from '@/i18n'
import { fakeLayout } from '@/test/fakeLayout'
import { ausschalten, dienstVerfuegbar, einschalten, stand } from '@/services/hintergrunddienst'

vi.mock('@/api/client', () => ({
  api: vi.fn(),
}))

// Der Dauerdienst gibt es nur auf Android; auf dem Rechner ist er unsichtbar.
vi.mock('@/services/hintergrunddienst', () => ({
  dienstVerfuegbar: vi.fn(() => false),
  stand: vi.fn(async () => ({ aktiv: false, akkuBefreit: false, benachrichtigungenErlaubt: true })),
  einschalten: vi.fn(async () => true),
  ausschalten: vi.fn(async () => {}),
}))

function setUser(email = true, ai = true, device = true) {
  useAuthStore.setState({
    user: {
      id: 1,
      username: 'owner',
      email: 'owner@example.test',
      is_owner: true,
      is_active: true,
      email_verified: true,
      two_factor_enabled: false,
      email_notifications: email,
      ai_notifications: ai,
      device_notifications: device,
      avatar_url: '/api/auth/avatar/test.png',
      role_id: null,
      created_at: '2026-05-31T00:00:00Z',
    },
    isAuthenticated: true,
    isLoading: false,
  })
}

describe('BenachrichtigungsGlocke', () => {
  beforeEach(() => {
    i18n.changeLanguage('de')
    vi.mocked(api).mockReset().mockResolvedValue({})
    useToastStore.setState({ toasts: [] })
    setUser(true, true, true)
    vi.mocked(dienstVerfuegbar).mockReturnValue(false)
    vi.mocked(stand).mockResolvedValue({ aktiv: false, akkuBefreit: false, benachrichtigungenErlaubt: true })
    vi.mocked(einschalten).mockClear()
    vi.mocked(einschalten).mockResolvedValue(true)
    vi.mocked(ausschalten).mockClear()
  })

  it('öffnet das Menü per Portal an body, außerhalb des Stapelkontexts der Shell', () => {
    render(<BenachrichtigungsGlocke placement="bottom" align="right" />)

    fireEvent.click(screen.getByRole('button', { name: /benachrichtigungen/i }))
    const menu = screen.getByRole('menu')
    expect(menu.parentElement).toBe(document.body)
    expect(menu.style.position).toBe('fixed')
  })

  it('schließt bei Klick daneben, nicht bei Klick ins Menü', () => {
    render(<BenachrichtigungsGlocke placement="bottom" align="right" />)
    fireEvent.click(screen.getByRole('button', { name: /benachrichtigungen/i }))
    fireEvent.mouseDown(screen.getByRole('menu'))
    expect(screen.getByRole('menu')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('toggles email and device notifications correctly', async () => {
    render(<BenachrichtigungsGlocke placement="bottom" align="right" />)

    fireEvent.click(screen.getByRole('button', { name: /benachrichtigungen/i }))
    const emailSwitch = screen.getByRole('switch', { name: 'E-Mail-Benachrichtigungen' })
    fireEvent.click(emailSwitch)

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/auth/me/notifications?enabled=false', { method: 'PATCH' })
    })

    const deviceSwitch = screen.getByRole('switch', { name: 'Geräte-Benachrichtigungen' })
    fireEvent.click(deviceSwitch)

    await waitFor(() => {
      expect(api).toHaveBeenCalledWith('/auth/me/notifications?device=false', { method: 'PATCH' })
    })
  })

  it('bietet auf dem Rechner keinen eigenen Dienst-Schalter', () => {
    render(<BenachrichtigungsGlocke placement="bottom" align="right" />)

    fireEvent.click(screen.getByRole('button', { name: /benachrichtigungen/i }))

    expect(screen.queryByRole('switch', { name: 'Auch bei geschlossener App' })).toBeNull()
    expect(screen.getByRole('switch', { name: 'Geräte-Benachrichtigungen' })).toBeInTheDocument()
  })

  it('der Geräte-Schalter startet und stoppt den Dienst auf Android', async () => {
    setUser(true, true, false)
    vi.mocked(dienstVerfuegbar).mockReturnValue(true)
    vi.mocked(stand).mockResolvedValue({ aktiv: false, akkuBefreit: true, benachrichtigungenErlaubt: true })
    render(<BenachrichtigungsGlocke placement="bottom" align="right" />)

    fireEvent.click(screen.getByRole('button', { name: /benachrichtigungen/i }))
    // Der Stand kommt aus Android, nicht aus dem Fenster.
    await waitFor(() => expect(stand).toHaveBeenCalled())
    const schalter = screen.getByRole('switch', { name: 'Geräte-Benachrichtigungen' })
    expect(schalter).not.toBeChecked()

    fireEvent.click(schalter)
    await waitFor(() => expect(einschalten).toHaveBeenCalledWith('Geräte-Benachrichtigungen'))
    await waitFor(() => expect(schalter).toBeChecked())
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/auth/me/notifications?device=true', { method: 'PATCH' }),
    )

    fireEvent.click(schalter)
    await waitFor(() => expect(ausschalten).toHaveBeenCalled())
    await waitFor(() => expect(schalter).not.toBeChecked())
  })

  it('sagt es, wenn der Dienst nicht startet', async () => {
    setUser(true, true, false)
    vi.mocked(dienstVerfuegbar).mockReturnValue(true)
    vi.mocked(einschalten).mockResolvedValue(false)
    render(<BenachrichtigungsGlocke placement="bottom" align="right" />)

    fireEvent.click(screen.getByRole('button', { name: /benachrichtigungen/i }))
    const schalter = screen.getByRole('switch', { name: 'Geräte-Benachrichtigungen' })
    fireEvent.click(schalter)

    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.message === 'Gerätebenachrichtigungen ließen sich nicht einschalten.')).toBe(true),
    )
    expect(schalter).not.toBeChecked()
  })

  it('klappt am unteren Rand nach oben, auch wenn unten gewünscht ist', () => {
    // Bis 02.10.2026 galt placement="bottom" ohne Messung, und das Menü lief unten aus dem Fenster.
    const layout = fakeLayout({
      fenster: { breite: 1024, hoehe: 768 },
      anker: { left: 980, top: 700, width: 36, height: 36 },
      popover: { width: 320, height: 250 },
    })
    try {
      render(<BenachrichtigungsGlocke placement="bottom" align="right" />)
      fireEvent.click(screen.getByRole('button', { name: /benachrichtigungen/i }))
      const menu = screen.getByRole('menu')
      expect(menu.style.top).toBe(`${700 - 8 - 250}px`)
      expect(menu.style.left).toBe(`${1016 - 320}px`)
      expect(layout.imFenster(menu)).toBe(true)
    } finally {
      layout.aufraeumen()
    }
  })

  it('klappt in der Seitenleiste oben nach unten, wenn darüber kein Platz ist', () => {
    const layout = fakeLayout({
      fenster: { breite: 1024, hoehe: 768 },
      anker: { left: 210, top: 10, width: 36, height: 36 },
      popover: { width: 320, height: 250 },
    })
    try {
      render(<BenachrichtigungsGlocke placement="top" align="sidebar" />)
      fireEvent.click(screen.getByRole('button', { name: /benachrichtigungen/i }))
      const menu = screen.getByRole('menu')
      expect(menu.style.top).toBe(`${46 + 8}px`)
      expect(menu.style.left).toBe('210px')
      expect(layout.imFenster(menu)).toBe(true)
    } finally {
      layout.aufraeumen()
    }
  })
})
