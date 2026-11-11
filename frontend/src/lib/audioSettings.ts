/**
 * Zentrales Audio- und Mikrofoneinstellungs-Modul.
 *
 * Einheitliche Konfiguration für WebRTC-Audioverarbeitung:
 * - Rauschunterdrückung (noiseSuppression)
 * - Echounterdrückung (echoCancellation)
 * - Automatische Pegelanpassung (autoGainControl)
 * - Bevorzugtes Eingabegerät (deviceId)
 * - Bevorzugtes Ausgabegerät (sinkId) und Software-Eingangsverstärkung
 *
 * Wird projektweit sowohl vom Wake-Word / Sprachassistenten als auch von der
 * Messenger-Sprachaufnahme, den Anrufen und dem Profil-Mikrofontest genutzt.
 */

import { still } from './still'

/** Grenzen der Software-Verstärkung. Gleich denen in `audioGeraete.ts`. */
export const GAIN_MIN = 0.25
export const GAIN_MAX = 4

/** Standard-Absenkung für Hintergrundmedien bei aktiver Mikrofonnutzung (%). */
export const DUCKING_PROZENT_STANDARD = 60
export const DUCKING_PROZENT_MIN = 10
export const DUCKING_PROZENT_MAX = 90
export const DUCKING_SCHRITT = 5

export interface AudioSettings {
  noiseSuppression: boolean
  echoCancellation: boolean
  autoGainControl: boolean
  preferredMicId: string | null
  preferredSpeakerId: string | null
  /** Software-Eingangsverstärkung, 1 = neutral. Bereits geklemmt. */
  micGain: number
  /** Hintergrundaudio leiser regeln, solange MSM aktiv ins Mikrofon spricht. */
  audioDuckingEnabled: boolean
  /** Stärke der Hintergrund-Absenkung in Prozent (10..90). */
  audioDuckingPercent: number
}

const STORAGE_KEYS = {
  noiseSuppression: 'msm_audio_noise_suppression',
  echoCancellation: 'msm_audio_echo_cancellation',
  autoGainControl: 'msm_audio_auto_gain',
  preferredMicId: 'msm_preferred_mic_id',
  preferredSpeakerId: 'msm_preferred_speaker_id',
  micGain: 'msm_audio_mic_gain',
  audioDuckingEnabled: 'msm_audio_ducking_enabled',
  audioDuckingPercent: 'msm_audio_ducking_percent',
} as const

const VORGABE: AudioSettings = {
  noiseSuppression: true,
  echoCancellation: true,
  autoGainControl: true,
  preferredMicId: null,
  preferredSpeakerId: null,
  micGain: 1,
  audioDuckingEnabled: true,
  audioDuckingPercent: DUCKING_PROZENT_STANDARD,
}

const abonnenten = new Set<() => void>()

function klemmeGain(roh: number): number {
  if (!Number.isFinite(roh)) return 1
  return Math.min(GAIN_MAX, Math.max(GAIN_MIN, roh))
}

function klemmeDuckingProzent(roh: number): number {
  if (!Number.isFinite(roh)) return DUCKING_PROZENT_STANDARD
  return Math.min(DUCKING_PROZENT_MAX, Math.max(DUCKING_PROZENT_MIN, Math.round(roh)))
}

export function getAudioSettings(): AudioSettings {
  try {
    const micId = localStorage.getItem(STORAGE_KEYS.preferredMicId)
    const speakerId = localStorage.getItem(STORAGE_KEYS.preferredSpeakerId)
    const gainRoh = localStorage.getItem(STORAGE_KEYS.micGain)
    const duckingProzentRoh = localStorage.getItem(STORAGE_KEYS.audioDuckingPercent)
    const noiseSuppression = localStorage.getItem(STORAGE_KEYS.noiseSuppression) !== 'false'
    const echoCancellation = localStorage.getItem(STORAGE_KEYS.echoCancellation) !== 'false'
    const autoGainControl = localStorage.getItem(STORAGE_KEYS.autoGainControl) !== 'false'
    const audioDuckingEnabled = localStorage.getItem(STORAGE_KEYS.audioDuckingEnabled) !== 'false'

    return {
      noiseSuppression,
      echoCancellation,
      autoGainControl,
      preferredMicId: micId && micId.trim() ? micId.trim() : null,
      preferredSpeakerId: speakerId && speakerId.trim() ? speakerId.trim() : null,
      micGain: gainRoh === null ? 1 : klemmeGain(Number(gainRoh)),
      audioDuckingEnabled,
      audioDuckingPercent:
        duckingProzentRoh === null || duckingProzentRoh.trim() === ''
          ? DUCKING_PROZENT_STANDARD
          : klemmeDuckingProzent(Number(duckingProzentRoh)),
    }
  } catch (err) {
    still(err, 'audioSettings.getAudioSettings')
    return { ...VORGABE }
  }
}

export function saveAudioSettings(settings: Partial<AudioSettings>): void {
  try {
    if (settings.noiseSuppression !== undefined) {
      localStorage.setItem(STORAGE_KEYS.noiseSuppression, String(settings.noiseSuppression))
    }
    if (settings.echoCancellation !== undefined) {
      localStorage.setItem(STORAGE_KEYS.echoCancellation, String(settings.echoCancellation))
    }
    if (settings.autoGainControl !== undefined) {
      localStorage.setItem(STORAGE_KEYS.autoGainControl, String(settings.autoGainControl))
    }
    if (settings.preferredMicId !== undefined) {
      if (settings.preferredMicId) {
        localStorage.setItem(STORAGE_KEYS.preferredMicId, settings.preferredMicId)
      } else {
        localStorage.removeItem(STORAGE_KEYS.preferredMicId)
      }
    }
    if (settings.preferredSpeakerId !== undefined) {
      if (settings.preferredSpeakerId) {
        localStorage.setItem(STORAGE_KEYS.preferredSpeakerId, settings.preferredSpeakerId)
      } else {
        localStorage.removeItem(STORAGE_KEYS.preferredSpeakerId)
      }
    }
    if (settings.micGain !== undefined) {
      localStorage.setItem(STORAGE_KEYS.micGain, String(klemmeGain(settings.micGain)))
    }
    if (settings.audioDuckingEnabled !== undefined) {
      localStorage.setItem(STORAGE_KEYS.audioDuckingEnabled, String(settings.audioDuckingEnabled))
    }
    if (settings.audioDuckingPercent !== undefined) {
      localStorage.setItem(
        STORAGE_KEYS.audioDuckingPercent,
        String(klemmeDuckingProzent(settings.audioDuckingPercent)),
      )
    }
  } catch (err) {
    still(err, 'audioSettings.saveAudioSettings')
  }

  for (const lauscher of Array.from(abonnenten)) {
    try {
      lauscher()
    } catch (err) {
      still(err, 'audioSettings.subscriber')
    }
  }
}

export function subscribeAudioSettings(lauscher: () => void): () => void {
  abonnenten.add(lauscher)
  return () => {
    abonnenten.delete(lauscher)
  }
}

/**
 * Übernimmt native Konfigurationswerte (MSS / Pontis) beim Start oder Nachladen
 * in den einheitlichen Frontend-Audio-Speicher und informiert laufende Koordinatoren.
 */
export function syncNativeDuckingSettings(enabled?: boolean, percent?: number): void {
  const patch: Partial<AudioSettings> = {}
  if (typeof enabled === 'boolean') {
    patch.audioDuckingEnabled = enabled
  }
  if (typeof percent === 'number' && Number.isFinite(percent)) {
    patch.audioDuckingPercent = percent
  }
  if (Object.keys(patch).length > 0) {
    saveAudioSettings(patch)
  }
}

export function getAudioTrackConstraints(): MediaTrackConstraints {
  const settings = getAudioSettings()
  return {
    ...(settings.preferredMicId ? { deviceId: { ideal: settings.preferredMicId } } : {}),
    echoCancellation: settings.echoCancellation,
    noiseSuppression: settings.noiseSuppression,
    autoGainControl: settings.autoGainControl,
    channelCount: 1,
  }
}
