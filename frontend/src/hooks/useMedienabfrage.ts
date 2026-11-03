import { useEffect, useState } from 'react'

/**
 * Ob eine CSS-Medienabfrage gerade zutrifft, reaktiv.
 *
 * Zwei Stellen brauchen dieselbe Frage: das Panel entscheidet damit, ob es
 * angedockt oder als Overlay liegt; der Baum schließt sein Overlay, sobald das
 * Fenster breit genug ist. Ohne den Wechsel bliebe ein `treeOffen` stehen und
 * der Baum wäre auf dem Desktop doppelt gemountet.
 */
export function useMedienabfrage(query: string): boolean {
  const lesen = () =>
    typeof window !== 'undefined' && !!window.matchMedia?.(query).matches
  const [passt, setPasst] = useState(lesen)
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const frage = window.matchMedia(query)
    const horchen = () => setPasst(frage.matches)
    horchen()
    frage.addEventListener('change', horchen)
    return () => frage.removeEventListener('change', horchen)
  }, [query])
  return passt
}
