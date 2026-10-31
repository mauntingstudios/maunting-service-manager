import { useEffect, useState } from 'react'

/** Ein gemeinsamer Takt fuer Theme-Auswertung und Statusanzeige. */
export const SAISON_TAKT_MS = 15_000

/**
 * Haelt eine Uhr aktuell, ohne dass jede Stelle ihren eigenen Timer baut.
 * Beim Zurueckkehren aus dem Hintergrund wird sofort nachgesehen.
 */
export function useJetzt(taktMs: number = SAISON_TAKT_MS): Date {
  const [jetzt, setJetzt] = useState(() => new Date())

  useEffect(() => {
    const takt = window.setInterval(() => setJetzt(new Date()), taktMs)
    const sichtbar = () => {
      if (document.visibilityState === 'visible') setJetzt(new Date())
    }
    document.addEventListener('visibilitychange', sichtbar)
    return () => {
      window.clearInterval(takt)
      document.removeEventListener('visibilitychange', sichtbar)
    }
  }, [taktMs])

  return jetzt
}