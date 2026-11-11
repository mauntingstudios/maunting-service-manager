/**
 * Die Ablage, aus der Wake-Word, Sprachnachrichten, Anrufe und der
 * Mikrofontest im Profil ihre Geräte holen.
 *
 * Lautsprecher und Verstärkung standen lange nur in Modulvariablen: im Panel
 * waren sie nach jedem Neuladen weg, und die Lautsprecherwahl kam überhaupt
 * nirgends an. Diese Tests halten fest, dass beides überlebt.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DUCKING_PROZENT_MAX,
  DUCKING_PROZENT_MIN,
  DUCKING_PROZENT_STANDARD,
  GAIN_MAX,
  GAIN_MIN,
  getAudioSettings,
  getAudioTrackConstraints,
  saveAudioSettings,
  subscribeAudioSettings,
  syncNativeDuckingSettings,
} from './audioSettings'

beforeEach(() => {
  localStorage.clear()
})

describe('Vorgaben', () => {
  it('hat die Filterkette an, die Verstärkung neutral und Audio-Ducking auf 60 % aktiv', () => {
    // Chromiums Filter sind der Grund, warum ein Anruf ohne Kopfhörer nicht
    // rückkoppelt. Sie dürfen nie stillschweigend aus sein.
    expect(getAudioSettings()).toEqual({
      noiseSuppression: true,
      echoCancellation: true,
      autoGainControl: true,
      preferredMicId: null,
      preferredSpeakerId: null,
      micGain: 1,
      audioDuckingEnabled: true,
      audioDuckingPercent: DUCKING_PROZENT_STANDARD,
    })
    expect(DUCKING_PROZENT_STANDARD).toBe(60)
  })
})

describe('Geräte', () => {
  it('behält Mikrofon und Lautsprecher über einen Schreib-Lese-Umlauf', () => {
    saveAudioSettings({ preferredMicId: 'mic-1', preferredSpeakerId: 'speaker-2' })
    const gelesen = getAudioSettings()
    expect(gelesen.preferredMicId).toBe('mic-1')
    expect(gelesen.preferredSpeakerId).toBe('speaker-2')
  })

  it('löscht eine Wahl, statt einen leeren Wert zu speichern', () => {
    saveAudioSettings({ preferredSpeakerId: 'speaker-2' })
    saveAudioSettings({ preferredSpeakerId: null })
    expect(getAudioSettings().preferredSpeakerId).toBeNull()
  })

  it('lässt ein nicht übergebenes Feld in Ruhe', () => {
    saveAudioSettings({ preferredMicId: 'mic-1' })
    saveAudioSettings({ noiseSuppression: false })
    expect(getAudioSettings().preferredMicId).toBe('mic-1')
  })
})

describe('Verstärkung', () => {
  it('überlebt einen Umlauf', () => {
    saveAudioSettings({ micGain: 1.5 })
    expect(getAudioSettings().micGain).toBe(1.5)
  })

  it('klemmt beim Speichern auf die Grenzen', () => {
    // Ungeklemmt stünde eine 0 im GainNode — das Mikrofon wäre lautlos, ohne
    // dass irgendwo ein Fehler auftaucht.
    saveAudioSettings({ micGain: 0 })
    expect(getAudioSettings().micGain).toBe(GAIN_MIN)

    saveAudioSettings({ micGain: 99 })
    expect(getAudioSettings().micGain).toBe(GAIN_MAX)
  })

  it('macht aus Unsinn im Speicher eine neutrale Verstärkung', () => {
    localStorage.setItem('msm_audio_mic_gain', 'lautlos')
    expect(getAudioSettings().micGain).toBe(1)
  })
})

describe('getAudioTrackConstraints', () => {
  it('baut daraus die Aufnahmebedingungen für Sprachnachricht und Anruf', () => {
    saveAudioSettings({ preferredMicId: 'mic-9', noiseSuppression: false })
    expect(getAudioTrackConstraints()).toEqual({
      deviceId: { ideal: 'mic-9' },
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: true,
      channelCount: 1,
    })
  })

  it('lässt die Gerätewahl weg, wenn keine getroffen wurde', () => {
    expect(getAudioTrackConstraints()).not.toHaveProperty('deviceId')
  })
})

describe('Audio-Ducking Einstellungen', () => {
  it('klemmt Prozentwerte auf 10..90 und bereinigt ungültige Werte', () => {
    expect(DUCKING_PROZENT_MIN).toBe(10)
    expect(DUCKING_PROZENT_MAX).toBe(90)

    saveAudioSettings({ audioDuckingPercent: 2 })
    expect(getAudioSettings().audioDuckingPercent).toBe(DUCKING_PROZENT_MIN)

    saveAudioSettings({ audioDuckingPercent: 120 })
    expect(getAudioSettings().audioDuckingPercent).toBe(DUCKING_PROZENT_MAX)

    saveAudioSettings({ audioDuckingPercent: 64.6 })
    expect(getAudioSettings().audioDuckingPercent).toBe(65)

    localStorage.setItem('msm_audio_ducking_percent', 'unsinn')
    expect(getAudioSettings().audioDuckingPercent).toBe(DUCKING_PROZENT_STANDARD)
  })

  it('speichert Ausschalten ohne die übrigen Audioeinstellungen zu verändern', () => {
    saveAudioSettings({ preferredMicId: 'mic-1', audioDuckingEnabled: false, audioDuckingPercent: 45 })
    const gelesen = getAudioSettings()
    expect(gelesen.preferredMicId).toBe('mic-1')
    expect(gelesen.audioDuckingEnabled).toBe(false)
    expect(gelesen.audioDuckingPercent).toBe(45)
  })

  it('benachrichtigt Abonnenten bei Speichern und beim nativen Sync', () => {
    const lauscher = vi.fn()
    const weg = subscribeAudioSettings(lauscher)

    saveAudioSettings({ audioDuckingPercent: 70 })
    expect(lauscher).toHaveBeenCalledTimes(1)

    syncNativeDuckingSettings(false, 35)
    expect(lauscher).toHaveBeenCalledTimes(2)
    expect(getAudioSettings().audioDuckingEnabled).toBe(false)
    expect(getAudioSettings().audioDuckingPercent).toBe(35)

    weg()
    saveAudioSettings({ audioDuckingEnabled: true })
    expect(lauscher).toHaveBeenCalledTimes(2)
  })
})
