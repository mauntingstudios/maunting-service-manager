import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (befehl: string, args: unknown) => invokeMock(befehl, args),
}))

import { saveAudioSettings } from './audioSettings'
import {
  aktiveDuckingQuellen,
  duckingBelegen,
  duckingFreigeben,
  duckingTestReset,
  istDuckingAktiv,
  registriereDuckerbaresMedium,
  testDuckingStarten,
} from './audioDucking'

describe('audioDucking Koordinator', () => {
  beforeEach(() => {
    localStorage.clear()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    invokeMock.mockClear()
    duckingTestReset()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    duckingTestReset()
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  it('beginnt inaktiv und senkt DOM- und registrierte Medien auf 40 % bei 60 % Absenkung', () => {
    expect(istDuckingAktiv()).toBe(false)
    expect(aktiveDuckingQuellen()).toEqual([])

    const domAudio = document.createElement('audio')
    domAudio.volume = 0.8
    const domVideo = document.createElement('video')
    domVideo.volume = 0.5
    document.body.append(domAudio, domVideo)

    const sprachNotiz = document.createElement('audio')
    sprachNotiz.volume = 1
    const abmeldenMedium = registriereDuckerbaresMedium(sprachNotiz)

    const frei = duckingBelegen('ai-voice')
    expect(istDuckingAktiv()).toBe(true)
    expect(aktiveDuckingQuellen()).toEqual(['ai-voice'])
    expect(domAudio.volume).toBeCloseTo(0.32, 3)
    expect(domVideo.volume).toBeCloseTo(0.2, 3)
    expect(sprachNotiz.volume).toBeCloseTo(0.4, 3)

    // Idempotentes zweites Freigeben schadet nicht
    frei()
    frei()

    expect(istDuckingAktiv()).toBe(false)
    expect(domAudio.volume).toBeCloseTo(0.8, 3)
    expect(domVideo.volume).toBeCloseTo(0.5, 3)
    expect(sprachNotiz.volume).toBeCloseTo(1, 3)
    abmeldenMedium()
  })

  it('hält Referenzzählung über überlappende Mikrofonquellen stabil', () => {
    const media = document.createElement('audio')
    media.volume = 1
    document.body.append(media)

    const freiEins = duckingBelegen('call')
    const freiZwei = duckingBelegen('ai-dictation')
    expect(media.volume).toBeCloseTo(0.4, 3)

    freiEins()
    expect(istDuckingAktiv()).toBe(true)
    expect(aktiveDuckingQuellen()).toEqual(['ai-dictation'])
    expect(media.volume).toBeCloseTo(0.4, 3)

    freiZwei()
    expect(istDuckingAktiv()).toBe(false)
    expect(media.volume).toBeCloseTo(1, 3)
  })

  it('verschont Kommunikationsaudio mit data-msm-duck-exempt="true" direkt oder über Elternknoten', () => {
    const huelle = document.createElement('div')
    huelle.dataset.msmDuckExempt = 'true'
    const callAudio = document.createElement('audio')
    callAudio.volume = 0.9
    huelle.append(callAudio)

    const kiAudio = document.createElement('audio')
    kiAudio.volume = 0.95
    kiAudio.dataset.msmDuckExempt = 'true'

    const musik = document.createElement('audio')
    musik.volume = 1

    document.body.append(huelle, kiAudio, musik)

    const frei = duckingBelegen('call')
    expect(callAudio.volume).toBeCloseTo(0.9, 3)
    expect(kiAudio.volume).toBeCloseTo(0.95, 3)
    expect(musik.volume).toBeCloseTo(0.4, 3)
    frei()
  })

  it('ducked während aktiver Belegung neu startende Medien beim play-Ereignis automatisch', () => {
    const frei = duckingBelegen('browser-voice-search')
    const spaeter = document.createElement('video')
    spaeter.volume = 0.7
    document.body.append(spaeter)

    spaeter.dispatchEvent(new Event('play', { bubbles: false }))
    expect(spaeter.volume).toBeCloseTo(0.28, 3)

    frei()
    expect(spaeter.volume).toBeCloseTo(0.7, 3)
  })

  it('überschreibt beim Wiederherstellen keine manuell geänderte Lautstärke', () => {
    const video = document.createElement('video')
    video.volume = 0.8
    document.body.append(video)

    const frei = duckingBelegen('messenger-voice-note')
    expect(video.volume).toBeCloseTo(0.32, 3)

    // Benutzer regelt währenddessen manuell auf 0.65
    video.volume = 0.65
    frei()
    expect(video.volume).toBeCloseTo(0.65, 3)
  })

  it('reagiert live auf Deaktivierung und geänderte Prozentwerte ohne Kaskadierung', () => {
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    const media = document.createElement('audio')
    media.volume = 0.8
    document.body.append(media)

    const frei = duckingBelegen('ai-voice')
    expect(media.volume).toBeCloseTo(0.32, 3)
    expect(invokeMock).toHaveBeenCalledWith('ducking', { an: true, prozent: 60 })

    // Prozent live auf 75 % erhöhen -> 0.8 * 0.25 = 0.20 (nicht 0.32 * 0.25!)
    saveAudioSettings({ audioDuckingPercent: 75 })
    expect(media.volume).toBeCloseTo(0.2, 3)
    expect(invokeMock).toHaveBeenCalledWith('ducking', { an: true, prozent: 75 })

    // Live ausschalten -> stellt sofort wieder her
    saveAudioSettings({ audioDuckingEnabled: false })
    expect(media.volume).toBeCloseTo(0.8, 3)
    expect(invokeMock).toHaveBeenCalledWith('ducking', { an: false, prozent: 75 })

    // Wieder einschalten -> dämpft wieder mit 75 %
    saveAudioSettings({ audioDuckingEnabled: true })
    expect(media.volume).toBeCloseTo(0.2, 3)
    expect(invokeMock).toHaveBeenCalledWith('ducking', { an: true, prozent: 75 })

    frei()
    expect(invokeMock).toHaveBeenCalledWith('ducking', { an: false, prozent: 75 })
    duckingFreigeben('ai-voice')
  })

  it('testDuckingStarten prüft eingestellten Prozentwert auch bei ausgeschaltetem Auto-Ducking und stellt zurück', async () => {
    vi.useFakeTimers()
    ;(window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}
    saveAudioSettings({ audioDuckingEnabled: false, audioDuckingPercent: 50 })

    const lauf = testDuckingStarten(3000)
    expect(invokeMock).toHaveBeenCalledWith('ducking', { an: true, prozent: 50 })

    await vi.advanceTimersByTimeAsync(3000)
    await lauf
    expect(invokeMock).toHaveBeenLastCalledWith('ducking', { an: false, prozent: 50 })
  })
})
