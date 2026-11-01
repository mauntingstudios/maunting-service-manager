/**
 * Chunk-Selbstheilung bei Vite-Preload-Fehlern (Hardening WP2.1).
 *
 * Wenn nach einem Deployment alte Chunks nicht mehr auf dem Server liegen,
 * wirft Vite ein 'vite:preloadError'-Event. Diese Funktion lädt die Seite genau
 * einmal neu, um den neuen HTML-Stand und Chunks zu laden.
 * Tritt der Fehler ein zweites Mal in derselben Sitzung auf, wird nicht erneut
 * neu geladen (Endlosschleifen-Schutz), sondern der Fehler an die ErrorBoundary übergeben.
 */

export const PRELOAD_RELOAD_KEY = 'msm:preload-reloaded'
export const PRELOAD_URL_PARAM = 'msm_preload_retry'

export function handlePreloadError(
  event: Event,
  storage: Storage | null = typeof window !== 'undefined' ? window.sessionStorage : null,
  reloadFn?: () => void
): boolean {
  const doReload =
    reloadFn ??
    (() => {
      if (typeof window !== 'undefined') {
        const url = new URL(window.location.href)
        url.searchParams.set(PRELOAD_URL_PARAM, '1')
        window.location.href = url.toString()
      }
    })

  // 1. Prüfen, ob wir über den URL-Fallback-Parameter bereits einmal neugeladen haben
  if (typeof window !== 'undefined') {
    try {
      const params = new URLSearchParams(window.location.search)
      if (params.get(PRELOAD_URL_PARAM) === '1') {
        console.error('[vite:preloadError] Erneuter Preload-Fehler nach URL-Fallback-Reload:', event)
        return false
      }
    } catch {}
  }

  // 2. sessionStorage prüfen, falls verfügbar
  let alreadyReloaded = false
  let storageWorks = false
  if (storage) {
    try {
      alreadyReloaded = storage.getItem(PRELOAD_RELOAD_KEY) === 'true'
      storageWorks = true
    } catch {
      storageWorks = false
    }
  }

  if (storageWorks) {
    if (!alreadyReloaded) {
      try {
        storage?.setItem(PRELOAD_RELOAD_KEY, 'true')
      } catch {}
      doReload()
      return true
    }
  } else {
    // sessionStorage nicht verfügbar oder wirft: Einmaliger Reload mit URL-Marker
    doReload()
    return true
  }

  console.error('[vite:preloadError] Erneuter Preload-Fehler in dieser Sitzung:', event)
  return false
}

export function registerPreloadHandler(): void {
  if (typeof window !== 'undefined') {
    window.addEventListener('vite:preloadError', (event) => handlePreloadError(event))
  }
}
