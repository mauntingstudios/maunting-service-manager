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

  describe('cleanupPreloadUrlParam', () => {
    it('entfernt msm_preload_retry per replaceState und erhält übrige Parameter', async () => {
      const { cleanupPreloadUrlParam, PRELOAD_URL_PARAM } = await import('./preloadSelbstheilung')
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

      const originalHref = window.location.href
      const originalSearch = window.location.search

      try {
        Object.defineProperty(window, 'location', {
          value: {
            ...window.location,
            pathname: '/servers',
            search: `?tab=details&${PRELOAD_URL_PARAM}=1`,
            hash: '#status',
            href: `http://localhost/servers?tab=details&${PRELOAD_URL_PARAM}=1#status`,
          },
          writable: true,
        })

        cleanupPreloadUrlParam()

        expect(replaceStateSpy).toHaveBeenCalledTimes(1)
        expect(replaceStateSpy).toHaveBeenCalledWith(window.history.state, '', '/servers?tab=details#status')
      } finally {
        replaceStateSpy.mockRestore()
        Object.defineProperty(window, 'location', {
          value: { ...window.location, search: originalSearch, href: originalHref },
          writable: true,
        })
      }
    })

    it('räumt zusätzlich den sessionStorage-Marker ab', async () => {
      const { cleanupPreloadUrlParam, PRELOAD_RELOAD_KEY } = await import('./preloadSelbstheilung')
      const mockStorage: Record<string, string> = { [PRELOAD_RELOAD_KEY]: 'true' }
      const storage = {
        getItem: (k: string) => mockStorage[k] ?? null,
        setItem: (k: string, v: string) => {
          mockStorage[k] = v
        },
        removeItem: (k: string) => {
          delete mockStorage[k]
        },
      } as Storage

      cleanupPreloadUrlParam(storage)
      expect(storage.getItem(PRELOAD_RELOAD_KEY)).toBeNull()
    })

    it('tut nichts, wenn msm_preload_retry nicht in der URL steht', async () => {
      const { cleanupPreloadUrlParam } = await import('./preloadSelbstheilung')
      const replaceStateSpy = vi.spyOn(window.history, 'replaceState')

      const originalHref = window.location.href
      const originalSearch = window.location.search

      try {
        Object.defineProperty(window, 'location', {
          value: {
            ...window.location,
            pathname: '/dashboard',
            search: '?view=compact',
            hash: '',
            href: 'http://localhost/dashboard?view=compact',
          },
          writable: true,
        })

        cleanupPreloadUrlParam()

        expect(replaceStateSpy).not.toHaveBeenCalled()
      } finally {
        replaceStateSpy.mockRestore()
        Object.defineProperty(window, 'location', {
          value: { ...window.location, search: originalSearch, href: originalHref },
          writable: true,
        })
      }
    })
  })
})
