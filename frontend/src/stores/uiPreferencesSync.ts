/**
 * Zentrale Koordination der geräteübergreifenden UI-Vorlieben (Server-/Node-Favoriten
 * und angepinnte Dashboard-Reiter) über `PATCH /api/auth/me/preferences`.
 *
 * Bewusst als zyklusfreies Blatt gestaltet: weder `authStore` noch die
 * Präferenz-Stores müssen sich gegenseitig importieren.
 */
import { api } from '@/api/client'
import { angemeldetesKonto } from '@/lib/angemeldetesKonto'
import { still } from '@/lib/still'
import type { UiPreferences, User } from '@/types'

const MIGRATION_MARKER_PREFIX = 'msm:ui-prefs-migrated:'

type Hydrator = (prefs: UiPreferences) => void
type LocalSnapshotReader = () => Partial<UiPreferences>

const hydrators = new Set<Hydrator>()
const snapshotReaders = new Set<LocalSnapshotReader>()

let updateCachedUserPrefs: ((prefs: UiPreferences) => void) | null = null
let pendingPatch: Partial<UiPreferences> = {}
let scheduledFlush = false
const migratedAccounts = new Set<number>()

function migrationMarkerKey(userId: number): string {
  return `${MIGRATION_MARKER_PREFIX}${userId}`
}

function hasMigrated(userId: number): boolean {
  if (migratedAccounts.has(userId)) return true
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(migrationMarkerKey(userId)) !== null
  } catch (err) {
    still(err, 'uiPreferences:readMarker')
    return false
  }
}

function markMigrated(userId: number): void {
  migratedAccounts.add(userId)
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(migrationMarkerKey(userId), '1')
  } catch (err) {
    still(err, 'uiPreferences:writeMarker')
  }
}

export function clearUiPreferencesMigrationMarker(userId: number): void {
  migratedAccounts.delete(userId)
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(migrationMarkerKey(userId))
  } catch (err) {
    still(err, 'uiPreferences:clearMarker')
  }
}

export function setUiPreferencesUserUpdater(updater: (prefs: UiPreferences) => void): void {
  updateCachedUserPrefs = updater
}

export function registerUiPreferencesStore(
  hydrate: Hydrator,
  readLocal: LocalSnapshotReader,
): () => void {
  hydrators.add(hydrate)
  snapshotReaders.add(readLocal)
  return () => {
    hydrators.delete(hydrate)
    snapshotReaders.delete(readLocal)
  }
}

function applyHydration(prefs: UiPreferences): void {
  for (const hydrate of hydrators) {
    hydrate(prefs)
  }
}

async function flushPendingPatch(): Promise<void> {
  scheduledFlush = false
  const konto = angemeldetesKonto()
  const patch = pendingPatch
  pendingPatch = {}
  if (konto === null || Object.keys(patch).length === 0) return

  try {
    const saved = await api<UiPreferences>('/auth/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    })
    if (angemeldetesKonto() !== konto) return
    markMigrated(konto)
    if (saved && typeof saved === 'object') {
      updateCachedUserPrefs?.(saved)
    }
  } catch (err) {
    still(err, 'uiPreferences:save')
  }
}

export function syncUiPreferencesPatch(patch: Partial<UiPreferences>): void {
  const konto = angemeldetesKonto()
  if (konto === null) return
  pendingPatch = { ...pendingPatch, ...patch }
  if (scheduledFlush) return
  scheduledFlush = true
  queueMicrotask(() => {
    void flushPendingPatch()
  })
}

export function hydrateUiPreferencesFromUser(user: User | null): void {
  if (!user) return
  if (user.ui_preferences != null) {
    markMigrated(user.id)
    applyHydration(user.ui_preferences)
    return
  }

  // Nur wenn `/auth/me` explizit `ui_preferences: null` liefert (nicht in minimalen
  // Test-Mocks mit `undefined`) und lokal bereits Altbestände liegen, einmalig übernehmen.
  if (user.ui_preferences !== null || hasMigrated(user.id)) return

  let localSnapshot: Partial<UiPreferences> = {}
  for (const readLocal of snapshotReaders) {
    localSnapshot = { ...localSnapshot, ...readLocal() }
  }
  const hasNonEmptyLocal =
    (localSnapshot.server_favorites?.length ?? 0) > 0 ||
    (localSnapshot.node_favorites?.length ?? 0) > 0 ||
    localSnapshot.dashboard_tabs != null

  if (!hasNonEmptyLocal) return
  markMigrated(user.id)
  syncUiPreferencesPatch(localSnapshot)
}

export function resetUiPreferencesSyncForTests(): void {
  pendingPatch = {}
  scheduledFlush = false
  migratedAccounts.clear()
}
