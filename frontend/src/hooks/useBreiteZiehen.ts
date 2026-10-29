import { useRef } from 'react'

interface BreiteZiehenOptions {
  breite: number
  min: number
  max: number
  setzen: (breite: number) => void
  /** +1, wenn Ziehen nach links breiter macht (Panel rechts), sonst -1. */
  vorzeichen?: 1 | -1
}

/** Pixel-Resizer mit Pointer und Pfeiltasten — dieselbe Geste wie im Browser-Panel. */
export function useBreiteZiehen({ breite, min, max, setzen, vorzeichen = 1 }: BreiteZiehenOptions) {
  const start = useRef<{ x: number; breite: number } | null>(null)
  const begrenzen = (wert: number) => Math.max(min, Math.min(max, wert))
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      event.currentTarget.setPointerCapture(event.pointerId)
      start.current = { x: event.clientX, breite }
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (!start.current) return
      const delta = vorzeichen * (start.current.x - event.clientX)
      setzen(begrenzen(start.current.breite + delta))
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      start.current = null
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    },
    onLostPointerCapture: () => {
      start.current = null
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      event.preventDefault()
      const schritt = event.shiftKey ? 48 : 24
      const richtung = event.key === 'ArrowLeft' ? vorzeichen : -vorzeichen
      setzen(begrenzen(breite + richtung * schritt))
    },
  }
}
