import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { LocalhostFreigabe } from './LocalhostFreigabe'
import * as client from '@/api/client'
import i18n from '@/i18n'
import { DEFAULT_PUBLIC_SETTINGS, usePublicSettingsStore } from '@/stores/publicSettingsStore'

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client')
  return { ...actual, api: vi.fn() }
})
vi.mock('@/hooks/usePublicLegalSettings', () => ({
  usePublicLegalSettings: () => ({ imprint_enabled: false, imprint_url: '' }),
}))

function renderSeite(token: string | null) {
  const eintrag = token === null ? '/localhost-freigabe' : `/localhost-freigabe?token=${token}`
  return render(
    <MemoryRouter initialEntries={[eintrag]}>
      <Routes>
        <Route path="/localhost-freigabe" element={<LocalhostFreigabe />} />
        <Route path="/settings" element={<div data-testid="einstellungen">Einstellungen</div>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('LocalhostFreigabe', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('de')
    vi.mocked(client.api).mockReset()
    usePublicSettingsStore.setState({ ...DEFAULT_PUBLIC_SETTINGS, isLoading: false, error: null })
  })

  it('schaltet per Einmal-Link frei und meldet Erfolg', async () => {
    vi.mocked(client.api).mockResolvedValue({ freigeschaltet: true } as never)
    renderSeite('echt-einmalig')

    fireEvent.click(screen.getByRole('button', { name: /Jetzt freischalten/i }))

    await waitFor(() => {
      expect(client.api).toHaveBeenCalledWith('/settings/localhost-connections/confirm', {
        method: 'POST',
        body: JSON.stringify({ token: 'echt-einmalig' }),
      })
    })
    await waitFor(() =>
      expect(screen.getByText(/Localhost-Verbindungen wurden freigeschaltet/i)).toBeInTheDocument(),
    )
  })

  it('meldet einen verbrauchten Link als Fehler, nicht als Erfolg', async () => {
    vi.mocked(client.api).mockRejectedValue(new Error('Dieser Freigabe-Link ist ungültig, abgelaufen oder wurde schon benutzt.'))
    renderSeite('schon-benutzt')

    fireEvent.click(screen.getByRole('button', { name: /Jetzt freischalten/i }))

    await waitFor(() =>
      expect(screen.getByText(/schon benutzt/i)).toBeInTheDocument(),
    )
    expect(screen.queryByText(/wurden freigeschaltet/i)).not.toBeInTheDocument()
  })

  it('verlangt Anmeldung, wenn die Sitzung fehlt', async () => {
    const { SanitizedApiError } = await import('@/api/client')
    vi.mocked(client.api).mockRejectedValue(new SanitizedApiError('Nicht angemeldet', { status: 401 }))
    renderSeite('ohne-sitzung')

    fireEvent.click(screen.getByRole('button', { name: /Jetzt freischalten/i }))

    await waitFor(() =>
      expect(screen.getByText(/melde dich zuerst mit deinem Admin-Konto an/i)).toBeInTheDocument(),
    )
  })

  it('ohne Token gibt es nichts zu bestätigen', async () => {
    renderSeite(null)

    fireEvent.click(screen.getByRole('button', { name: /Jetzt freischalten/i }))

    await waitFor(() =>
      expect(screen.getByText(/Kein Freigabe-Link gefunden/i)).toBeInTheDocument(),
    )
    // Der Fuß holt öffentliche Texte; die Bestätigung selbst ruft nie an.
    const pfade = vi.mocked(client.api).mock.calls.map(([pfad]) => pfad)
    expect(pfade).not.toContain('/settings/localhost-connections/confirm')
  })
})
