import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'

const api = vi.hoisted(() => ({
  getOwnInfo: vi.fn(),
  setOwnInfo: vi.fn(),
}))
const meldung = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))

vi.mock('@/api/social', () => api)
vi.mock('@/stores/toastStore', () => ({ toast: meldung }))

import { InfoKarte } from './InfoKarte'

beforeEach(() => {
  vi.clearAllMocks()
  api.setOwnInfo.mockResolvedValue({ text: 'x', visibility: 'friends', expires_at: null })
  api.getOwnInfo.mockResolvedValue(null)
})

describe('InfoKarte', () => {
  it('lädt die eigene Info und zeigt sie in der Vorschau', async () => {
    api.getOwnInfo.mockResolvedValue({
      text: 'Im Feierabend',
      visibility: 'friends',
      expires_at: new Date(Date.now() + 3 * 3600_000).toISOString(),
    })

    render(<InfoKarte />)

    const feld = await screen.findByLabelText(i18n.t('social.info.fieldLabel'))
    expect(feld).toHaveValue('Im Feierabend')
    // Einmal im Feld, einmal in der Vorschau.
    expect(screen.getAllByText('Im Feierabend').length).toBeGreaterThanOrEqual(1)
    // Kein festes Datum: „Läuft in 3 Stunden ab“ reicht.
    expect(screen.getByText(i18n.t('social.info.expiresHours', { count: 3 }))).toBeInTheDocument()
  })

  it('speichert Text, Sichtbarkeit und Dauer', async () => {
    render(<InfoKarte />)
    const feld = await screen.findByLabelText(i18n.t('social.info.fieldLabel'))

    fireEvent.change(feld, { target: { value: 'Unterwegs' } })
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${i18n.t('social.info.save')}$`) }))

    await waitFor(() =>
      expect(api.setOwnInfo).toHaveBeenCalledWith({
        text: 'Unterwegs',
        visibility: 'friends',
        dauer_sekunden: 0,
      }),
    )
    expect(meldung.success).toHaveBeenCalledWith(i18n.t('social.info.saved'))
  })

  it('stellt die Sichtbarkeit um', async () => {
    render(<InfoKarte />)
    await screen.findByLabelText(i18n.t('social.info.fieldLabel'))

    fireEvent.change(screen.getByLabelText(i18n.t('social.info.fieldLabel')), {
      target: { value: 'Für alle sichtbar' },
    })
    fireEvent.click(screen.getByRole('button', { name: i18n.t('social.info.visibility.label') }))
    fireEvent.click(screen.getByRole('option', { name: i18n.t('social.info.visibility.public') }))
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${i18n.t('social.info.save')}$`) }))

    await waitFor(() =>
      expect(api.setOwnInfo).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'public' }),
      ),
    )
  })

  it('entfernt die Info', async () => {
    api.getOwnInfo.mockResolvedValue({ text: 'Alt', visibility: 'friends', expires_at: null })

    render(<InfoKarte />)
    await screen.findByDisplayValue('Alt')

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${i18n.t('social.info.remove')}$`) }))

    await waitFor(() =>
      expect(api.setOwnInfo).toHaveBeenCalledWith({
        text: '',
        visibility: 'friends',
        dauer_sekunden: 0,
      }),
    )
    expect(meldung.success).toHaveBeenCalledWith(i18n.t('social.info.removed'))
  })

  it('bleibt bei einer unvollständigen Antwort bedienbar', async () => {
    // Die Profilseite darf nicht abreißen, nur weil ein Feld fehlt.
    api.getOwnInfo.mockResolvedValue({} as never)
    render(<InfoKarte />)
    expect(await screen.findByLabelText(i18n.t('social.info.fieldLabel'))).toBeInTheDocument()
  })
})
