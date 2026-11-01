import { describe, expect, it, vi } from 'vitest'
import { handlePreloadError, PRELOAD_RELOAD_KEY } from './preloadSelbstheilung'

describe('Vite Preload Selbstheilung (Hardening WP2.1)', () => {
  it('löst beim ersten Fehler genau einen Reload aus und setzt den sessionStorage-Schlüssel', () => {
    const mockStorage: Record<string, string> = {}
    const storage = {
      getItem: (k: string) => mockStorage[k] ?? null,
      setItem: (k: string, v: string) => {
        mockStorage[k] = v
      },
      removeItem: (k: string) => {
        delete mockStorage[k]
      },
    } as Storage

    const reloadFn = vi.fn()
    const event = new Event('vite:preloadError')

    const handledFirst = handlePreloadError(event, storage, reloadFn)
    expect(handledFirst).toBe(true)
    expect(reloadFn).toHaveBeenCalledTimes(1)
    expect(storage.getItem(PRELOAD_RELOAD_KEY)).toBe('true')

    // Zweiter Fehler: kein Reload mehr (Endlosschleifenschutz)
    const handledSecond = handlePreloadError(event, storage, reloadFn)
    expect(handledSecond).toBe(false)
    expect(reloadFn).toHaveBeenCalledTimes(1) // Bleibt bei 1
  })

  it('verhindert Reload-Schleife wenn sessionStorage wirft', () => {
    const throwingStorage = {
      getItem: () => {
        throw new DOMException('Access denied', 'SecurityError')
      },
      setItem: () => {
        throw new DOMException('Access denied', 'SecurityError')
      },
      removeItem: () => {},
    } as unknown as Storage

    const reloadFn = vi.fn()
    const event = new Event('vite:preloadError')

    // Erster Aufruf ohne URL-Parameter löst Reload aus
    const handledFirst = handlePreloadError(event, throwingStorage, reloadFn)
    expect(handledFirst).toBe(true)
    expect(reloadFn).toHaveBeenCalledTimes(1)

    // Simuliere Zustand nach Reload mit URL-Marker
    const originalSearch = window.location.search
    try {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, search: '?msm_preload_retry=1', href: 'http://localhost/?msm_preload_retry=1' },
        writable: true,
      })
      const handledAfterReload = handlePreloadError(event, throwingStorage, reloadFn)
      expect(handledAfterReload).toBe(false)
      expect(reloadFn).toHaveBeenCalledTimes(1) // Keine zweite Reload-Schleife!
    } finally {
      Object.defineProperty(window, 'location', {
        value: { ...window.location, search: originalSearch },
        writable: true,
      })
    }
  })
})
