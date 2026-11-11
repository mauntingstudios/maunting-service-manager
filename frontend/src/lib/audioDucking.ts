import { invoke } from '@tauri-apps/api/core'

import { getAudioSettings, subscribeAudioSettings } from './audioSettings'
import { still } from './still'

const LAUTSTAERKE_TOLERANZ = 0.01

const belegungen = new Map<symbol, string>()
const registrierteMedien = new Set<HTMLMediaElement>()
const geduellteMedien = new Map<HTMLMediaElement, { original: number; erwartet: number }>()

let istInitialisiert = false
let aboAbmelden: (() => void) | null = null
let testProbeAktiv = false
let testProbeToken = 0
let letzterIpcZustand: { an: boolean; prozent: number } | null = null

function istTauriUmgebung(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function klemmeLautstaerke(wert: number): number {
  if (!Number.isFinite(wert)) return 1
  return Math.min(1, Math.max(0, Math.round(wert * 10000) / 10000))
}

function istDuckingExempt(element: HTMLMediaElement): boolean {
  if (element.dataset?.msmDuckExempt === 'true') return true
  if (typeof element.closest === 'function' && element.closest('[data-msm-duck-exempt="true"]')) {
    return true
  }
  return false
}

function setzeElementLautstaerke(element: HTMLMediaElement, lautstaerke: number): void {
  try {
    element.volume = klemmeLautstaerke(lautstaerke)
  } catch (err) {
    still(err, 'audioDucking.setVolume')
  }
}

function sammleAlleMedien(): HTMLMediaElement[] {
  const ergebnis = new Set<HTMLMediaElement>(registrierteMedien)
  if (typeof document !== 'undefined') {
    for (const el of document.querySelectorAll('audio, video')) {
      ergebnis.add(el as HTMLMediaElement)
    }
  }
  return Array.from(ergebnis)
}

function mediumAbdaempfen(element: HTMLMediaElement, faktor: number): void {
  if (istDuckingExempt(element)) return
  const eintrag = geduellteMedien.get(element)
  if (!eintrag) {
    const original = klemmeLautstaerke(element.volume)
    const ziel = klemmeLautstaerke(original * faktor)
    geduellteMedien.set(element, { original, erwartet: ziel })
    setzeElementLautstaerke(element, ziel)
    return
  }
  // Hat der Nutzer waehrenddessen selbst am Regler gedreht, ueberschreiben wir ihn nicht.
  if (Math.abs(element.volume - eintrag.erwartet) > LAUTSTAERKE_TOLERANZ) return
  const ziel = klemmeLautstaerke(eintrag.original * faktor)
  eintrag.erwartet = ziel
  setzeElementLautstaerke(element, ziel)
}

function mediumWiederherstellen(element: HTMLMediaElement): void {
  const eintrag = geduellteMedien.get(element)
  if (!eintrag) return
  if (Math.abs(element.volume - eintrag.erwartet) <= LAUTSTAERKE_TOLERANZ) {
    setzeElementLautstaerke(element, eintrag.original)
  }
  geduellteMedien.delete(element)
}

function alleWiederherstellen(): void {
  for (const element of Array.from(geduellteMedien.keys())) {
    mediumWiederherstellen(element)
  }
  geduellteMedien.clear()
}

function nativeDuckingSenden(an: boolean, prozent: number): void {
  if (!istTauriUmgebung()) {
    letzterIpcZustand = null
    return
  }
  if (!an && !letzterIpcZustand) return
  if (letzterIpcZustand && letzterIpcZustand.an === an && letzterIpcZustand.prozent === prozent) {
    return
  }
  letzterIpcZustand = an ? { an, prozent } : null
  void invoke('ducking', { an, prozent }).catch((err) => {
    still(err, 'audioDucking.invoke')
  })
}

function effektivAktiv(): boolean {
  if (testProbeAktiv) return true
  if (belegungen.size === 0) return false
  return getAudioSettings().audioDuckingEnabled
}

function aktualisiereZustand(): void {
  const settings = getAudioSettings()
  const aktiv = testProbeAktiv || (belegungen.size > 0 && settings.audioDuckingEnabled)

  if (aktiv) {
    const faktor = Math.max(0, Math.min(1, (100 - settings.audioDuckingPercent) / 100))
    for (const element of sammleAlleMedien()) {
      mediumAbdaempfen(element, faktor)
    }
    nativeDuckingSenden(true, settings.audioDuckingPercent)
  } else {
    alleWiederherstellen()
    nativeDuckingSenden(false, settings.audioDuckingPercent)
  }
}

function onMediaPlay(ereignis: Event): void {
  const ziel = ereignis.target
  if (!ziel || typeof HTMLMediaElement === 'undefined') return
  if (!(ziel instanceof HTMLMediaElement)) return
  if (!effektivAktiv()) return
  const { audioDuckingPercent } = getAudioSettings()
  const faktor = Math.max(0, Math.min(1, (100 - audioDuckingPercent) / 100))
  mediumAbdaempfen(ziel, faktor)
}

function sicherstellenInitialisiert(): void {
  if (istInitialisiert) return
  istInitialisiert = true
  if (typeof document !== 'undefined') {
    document.addEventListener('play', onMediaPlay, true)
  }
  aboAbmelden = subscribeAudioSettings(() => {
    aktualisiereZustand()
  })
}

/**
 * Meldet eine aktive Mikrofonquelle an und regelt Hintergrundaudio entsprechend
 * der Benutzereinstellung herunter. Die zurueckgegebene Funktion gibt die Belegung
 * idempotent wieder frei.
 */
export function duckingBelegen(quelle: string): () => void {
  sicherstellenInitialisiert()
  const token = Symbol(quelle)
  belegungen.set(token, quelle)
  aktualisiereZustand()

  return () => {
    if (!belegungen.delete(token)) return
    aktualisiereZustand()
  }
}

/** Gibt alle offenen Belegungen einer benannten Quelle sofort wieder frei. */
export function duckingFreigeben(quelle: string): void {
  let geaendert = false
  for (const [token, eintrag] of Array.from(belegungen.entries())) {
    if (eintrag === quelle) {
      belegungen.delete(token)
      geaendert = true
    }
  }
  if (geaendert) {
    aktualisiereZustand()
  }
}

export function istDuckingAktiv(): boolean {
  return effektivAktiv()
}

export function aktiveDuckingQuellen(): string[] {
  return Array.from(new Set(belegungen.values()))
}

/**
 * Registriert frei erzeugte `Audio`-Instanzen (z. B. Sprachnachrichten im Messenger),
 * die nicht im DOM eingehaengt sind, fuer automatisches Ducking und Wiederherstellung.
 */
export function registriereDuckerbaresMedium(element: HTMLMediaElement): () => void {
  sicherstellenInitialisiert()
  registrierteMedien.add(element)
  if (effektivAktiv()) {
    const { audioDuckingPercent } = getAudioSettings()
    const faktor = Math.max(0, Math.min(1, (100 - audioDuckingPercent) / 100))
    mediumAbdaempfen(element, faktor)
  }
  return () => {
    registrierteMedien.delete(element)
    mediumWiederherstellen(element)
  }
}

/**
 * Senkt das System- und Hintergrundaudio voruebergehend mit dem konfigurierten
 * Prozentwert ab (auch bei aktuell deaktiviertem Auto-Ducking), um die Einstellung zu testen.
 */
export async function testDuckingStarten(dauerMs = 3000): Promise<void> {
  sicherstellenInitialisiert()
  const eigenerToken = ++testProbeToken
  testProbeAktiv = true
  aktualisiereZustand()
  try {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, dauerMs)
    })
  } finally {
    if (testProbeToken === eigenerToken) {
      testProbeAktiv = false
      aktualisiereZustand()
    }
  }
}

/** Setzt internen Zustand und DOM-Horcher fuer Tests sauber zurueck. */
export function duckingTestReset(): void {
  belegungen.clear()
  testProbeAktiv = false
  testProbeToken += 1
  alleWiederherstellen()
  registrierteMedien.clear()
  letzterIpcZustand = null
  if (typeof document !== 'undefined') {
    document.removeEventListener('play', onMediaPlay, true)
  }
  if (aboAbmelden) {
    aboAbmelden()
    aboAbmelden = null
  }
  istInitialisiert = false
}
