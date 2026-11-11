import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoked, tauriFlag } = vi.hoisted(() => ({
  invoked: [] as { befehl: string; args: unknown }[],
  tauriFlag: { wert: false },
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (befehl: string, args: unknown) => {
    invoked.push({ befehl, args })
    if (befehl === 'konfig_aendern') {
      const felder = (args as { felder?: Record<string, unknown> })?.felder ?? {}
      return Promise.resolve({
        backend_url: null,
        eingerichtet: false,
        schild_aktiv: true,
        schild_ausnahmen: [],
        download_ordner: null,
        download_fragen: false,
        vergessen_beim_schliessen: false,
        hardwarebeschleunigung: true,
        audio_ducking_aktiv: true,
        audio_ducking_prozent: 60,
        ...felder,
      })
    }
    return Promise.resolve(null)
  },
}))

vi.mock('../services/nativ', async (importOriginal) => {
  const original = await importOriginal<typeof import('../services/nativ')>()
  return {
    ...original,
    istTauri: () => tauriFlag.wert,
  }
})

import i18n from '@/i18n'
import { getAudioSettings } from '@/lib/audioSettings'
import { useGeraetKonfig } from '../services/geraetKonfig'
import { Allgemein } from './Allgemein'

const t = (schluessel: string) => i18n.t(schluessel)

describe('Pontis Allgemein-Einstellungen (Audio-Ducking)', () => {
  beforeEach(() => {
    localStorage.clear()
    invoked.length = 0
    tauriFlag.wert = false
    useGeraetKonfig.setState({ konfig: null })
  })

  it('zeigt Audio-Ducking standardmäßig aktiviert mit 60 % und speichert lokal ohne Tauri', () => {
    render(<Allgemein />)

    const schalter = screen.getByRole('switch', { name: t('mss.audio.ducking') })
    expect(schalter).toHaveAttribute('aria-checked', 'true')

    const regler = screen.getByRole('slider', { name: t('mss.audio.duckingProzent') })
    expect(regler).toHaveValue('60')
    expect(regler).not.toBeDisabled()

    fireEvent.change(regler, { target: { value: '75' } })
    expect(getAudioSettings().audioDuckingPercent).toBe(75)

    fireEvent.click(schalter)
    expect(getAudioSettings().audioDuckingEnabled).toBe(false)
    expect(regler).toBeDisabled()
  })

  it('schreibt Ducking-Änderungen im Pontis-Desktop zusätzlich über konfig_aendern', async () => {
    tauriFlag.wert = true
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    useGeraetKonfig.setState({
      konfig: {
        backend_url: null,
        eingerichtet: false,
        schild_aktiv: true,
        schild_ausnahmen: [],
        download_ordner: null,
        download_fragen: false,
        vergessen_beim_schliessen: false,
        hardwarebeschleunigung: true,
        audio_ducking_aktiv: true,
        audio_ducking_prozent: 60,
      } as never,
    })

    render(<Allgemein />)

    const schalter = screen.getByRole('switch', { name: t('mss.audio.ducking') })
    fireEvent.click(schalter)

    await waitFor(() =>
      expect(invoked).toContainEqual({
        befehl: 'konfig_aendern',
        args: { felder: { audio_ducking_aktiv: false } },
      }),
    )

    const regler = screen.getByRole('slider', { name: t('mss.audio.duckingProzent') })
    expect(regler).toBeDisabled()

    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
  })
})
