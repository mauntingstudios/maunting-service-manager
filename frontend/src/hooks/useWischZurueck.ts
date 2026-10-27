/**
 * Wischen vom Rand geht eine Seite zurück.
 *
 * Am Telefon ist der Zurück-Pfeil oben links weit weg vom Daumen. Auf Android
 * gibt es dafür die Systemgeste — sie geht im WebView einen Verlaufsschritt
 * zurück und beendet die App, wenn keiner da ist. Der offene Chat legt deshalb
 * einen an (`useZurueckSchliesst`), und zusätzlich erkennt diese Geste den
 * Wisch vom Rand selbst.
 *
 * Zwei Grenzen, die hier stehen müssen:
 *
 * * In Pontis läuft bereits eine Randgeste am Fenster (`__msbZurueck`). Zwei
 *   würden doppelt auslösen — dort schweigt diese.
 * * Was den Inhalt berührt, gehört dem Inhalt. Über Dialogen, Menüs und
 *   Eingabefeldern passiert nichts; die Blase ignoriert ihrerseits Wische, die
 *   in der Randzone beginnen.
 */

import { useEffect, useRef } from 'react'

import { RAND_ZONE_PX, erkenneRandgeste } from '@/lib/gesten'

/** Felder und Flächen, denen eine waagerechte Bewegung gehört. */
const FREMD = 'input, textarea, select, [contenteditable="true"], [role="dialog"], [aria-modal="true"], [data-ankerfenster]'

function fremderBereich(ziel: EventTarget | null): boolean {
  return ziel instanceof Element && Boolean(ziel.closest(FREMD))
}

export function useWischZurueck(aktiv: boolean, onZurueck: () => void): void {
  const zurueck = useRef(onZurueck)
  zurueck.current = onZurueck

  useEffect(() => {
    if (!aktiv || typeof window === 'undefined') return
    // Pontis hat seine eigene Randgeste am Fenster.
    if (window.__msbZurueck) return

    let start: { x: number; y: number; zeit: number } | null = null

    const beiStart = (e: TouchEvent) => {
      start = null
      if (e.touches.length !== 1) return
      const t = e.touches[0]
      if (t.clientX > RAND_ZONE_PX && t.clientX < window.innerWidth - RAND_ZONE_PX) return
      if (fremderBereich(e.target)) return
      start = { x: t.clientX, y: t.clientY, zeit: Date.now() }
    }

    const beiEnde = (e: TouchEvent) => {
      const begonnen = start
      start = null
      if (!begonnen || e.changedTouches.length !== 1) return
      const t = e.changedTouches[0]
      if (
        erkenneRandgeste(
          begonnen.x,
          t.clientX - begonnen.x,
          t.clientY - begonnen.y,
          Date.now() - begonnen.zeit,
          window.innerWidth,
        )
      ) {
        zurueck.current()
      }
    }

    const beiAbbruch = () => {
      start = null
    }

    window.addEventListener('touchstart', beiStart, { passive: true })
    window.addEventListener('touchend', beiEnde, { passive: true })
    window.addEventListener('touchcancel', beiAbbruch, { passive: true })
    return () => {
      window.removeEventListener('touchstart', beiStart)
      window.removeEventListener('touchend', beiEnde)
      window.removeEventListener('touchcancel', beiAbbruch)
    }
  }, [aktiv])
}
