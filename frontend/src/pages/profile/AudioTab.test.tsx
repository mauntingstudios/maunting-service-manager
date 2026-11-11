import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/i18n'
import { istDuckingAktiv, duckingTestReset } from '@/lib/audioDucking'
import { getAudioSettings } from '@/lib/audioSettings'
import { AudioTab } from './AudioTab'

const t = (key: string) => i18n.t(key)

describe('AudioTab', () => {
  const enumerateDevicesMock = vi.fn()
  const getUserMediaMock = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
    duckingTestReset()
    enumerateDevicesMock.mockResolvedValue([
      { deviceId: 'mic-1', kind: 'audioinput', label: 'USB Mikrofon', groupId: 'group-1', toJSON: () => ({}) },
      { deviceId: 'speaker-1', kind: 'audiooutput', label: 'Kopfhörer', groupId: 'group-2', toJSON: () => ({}) },
    ])
    getUserMediaMock.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] })

    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: enumerateDevicesMock,
        getUserMedia: getUserMediaMock,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
  })

  afterEach(() => {
    duckingTestReset()
  })

  it('rendert Mikrofon & Audio Einstellungen mit Gerätedropdown und Test-Option', async () => {
    render(<AudioTab />)

    expect(screen.getByText(t('profile.audioTitle'))).toBeInTheDocument()
    expect(screen.getByText(t('profile.audioTestStart'))).toBeInTheDocument()
    expect(screen.getByText(t('profile.audioNoiseSuppression'))).toBeInTheDocument()

    await waitFor(() => {
      expect(enumerateDevicesMock).toHaveBeenCalled()
    })
  })

  it('rendert Schalter für Signalverarbeitung (Rauschen, Echo, Pegelanpassung)', async () => {
    render(<AudioTab />)

    expect(screen.getByLabelText(t('profile.audioNoiseSuppression'))).toBeInTheDocument()
    expect(screen.getByLabelText(t('profile.audioEchoCancellation'))).toBeInTheDocument()
    expect(screen.getByLabelText(t('profile.audioAutoGain'))).toBeInTheDocument()

    await waitFor(() => {
      expect(enumerateDevicesMock).toHaveBeenCalled()
    })
  })

  it('zeigt Audio-Ducking-Schalter (an) und Prozentregler (60 %) und speichert Änderungen', async () => {
    render(<AudioTab />)
    await waitFor(() => expect(enumerateDevicesMock).toHaveBeenCalled())

    const schalter = screen.getByRole('switch', { name: t('mss.audio.ducking') })
    expect(schalter).toHaveAttribute('aria-checked', 'true')

    const regler = screen.getByRole('slider', { name: t('mss.audio.duckingProzent') })
    expect(regler).toHaveValue('60')

    fireEvent.change(regler, { target: { value: '45' } })
    expect(getAudioSettings().audioDuckingPercent).toBe(45)

    fireEvent.click(schalter)
    expect(getAudioSettings().audioDuckingEnabled).toBe(false)
    expect(regler).toBeDisabled()
  })

  it('löst beim Mikrofon-Testhören KEIN Audio-Ducking aus', async () => {
    class FakeAudioCtx {
      state = 'running'
      destination = {}
      createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() })
      createGain = () => ({ gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() })
      createAnalyser = () => ({ fftSize: 512, getFloatTimeDomainData: vi.fn(), disconnect: vi.fn() })
      close = vi.fn().mockResolvedValue(undefined)
    }
    vi.stubGlobal('AudioContext', FakeAudioCtx)

    try {
      render(<AudioTab />)
      await waitFor(() => expect(enumerateDevicesMock).toHaveBeenCalled())

      fireEvent.click(screen.getByRole('button', { name: t('profile.audioTestStart') }))
      await waitFor(() => expect(getUserMediaMock).toHaveBeenCalledTimes(1))
      expect(istDuckingAktiv()).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
