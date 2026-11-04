import { useEffect } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'

/**
 * Hält den inneren Fensterrahmen passend zur äußeren Form.
 *
 * Windows rundet das Fenster selbst (DWM). Der Inhalt muss dieselbe Rundung
 * tragen, solange das Fenster schwebt, und eckig werden, sobald es maximiert
 * ist. Der Test- und Web-Betrieb bleibt unberührt.
 */
export function useFensterRahmen(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('__TAURI_INTERNALS__' in window) && !('__TAURI__' in window)) return
    if (/android/i.test(navigator.userAgent)) return

    const fenster = getCurrentWindow()
    let abgebrochen = false

    const setzen = async () => {
      try {
        const maximiert = await fenster.isMaximized()
        if (!abgebrochen) document.documentElement.toggleAttribute('data-maximiert', maximiert)
      } catch {
        // Kein Fensterzustand erreichbar: die Rundung bleibt einfach stehen.
      }
    }

    void setzen()
    let abhoeren: (() => void) | null = null
    void fenster
      .onResized(() => void setzen())
      .then((unlisten) => {
        if (abgebrochen) unlisten()
        else abhoeren = unlisten
      })
      .catch(() => undefined)

    return () => {
      abgebrochen = true
      abhoeren?.()
      document.documentElement.removeAttribute('data-maximiert')
    }
  }, [])
}
