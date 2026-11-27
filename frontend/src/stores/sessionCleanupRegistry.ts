import { still } from '@/lib/still'

type SessionCleanupFn = () => void

const cleanupFns = new Set<SessionCleanupFn>()

function scrubLegacyPlaintextStorage(): void {
  const scrubStore = (store: Storage | undefined) => {
    if (!store) return
    try {
      const keysToRemove: string[] = []
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i)
        if (
          key &&
          (key.startsWith('msm:chat_cache:') ||
            key.startsWith('msm_e2ee_identity_') ||
            key.startsWith('msm_chat_') ||
            key.includes('_priv') ||
            key.includes('privateKey') ||
            key === 'msm:gruppennamen' ||
            key === 'msm:gespraeche')
        ) {
          keysToRemove.push(key)
        }
      }
      keysToRemove.forEach((k) => store.removeItem(k))
    } catch (err) {
      still(err, 'session-scrub-storage')
    }
  }

  if (typeof localStorage !== 'undefined') {
    scrubStore(localStorage)
  }
  if (typeof sessionStorage !== 'undefined') {
    scrubStore(sessionStorage)
  }
}

/**
 * Registriert eine synchrone Aufräumfunktion für `useAuthStore.clearSession()`,
 * ohne dass `authStore` schwere Feature-Module (Vault, Docs, E2EE) statisch
 * ins Startbündel ziehen muss.
 */
export function registerSessionCleanup(fn: SessionCleanupFn): () => void {
  cleanupFns.add(fn)
  return () => {
    cleanupFns.delete(fn)
  }
}

/** Führt alle registrierten Sitzungs-Aufräumfunktionen isoliert aus und bereinigt Klartext-Reste. */
export function runSessionCleanups(): void {
  scrubLegacyPlaintextStorage()
  for (const fn of cleanupFns) {
    try {
      fn()
    } catch (err) {
      still(err, 'session-cleanup-registry')
    }
  }
}
