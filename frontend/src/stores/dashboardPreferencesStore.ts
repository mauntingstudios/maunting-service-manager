import { create } from 'zustand'
import { angemeldetesKonto, beiKontowechsel } from '@/lib/angemeldetesKonto'
import { still } from '@/lib/still'
import {
  DEFAULT_DASHBOARD_TABS,
  MAX_DASHBOARD_TABS,
  VALID_DASHBOARD_TABS,
} from '@/desktop/dashboard/dashboardWege'
import { removeStorageKey, storageKey } from '@/stores/favoriteIdsStorage'
import {
  clearUiPreferencesMigrationMarker,
  registerUiPreferencesStore,
  syncUiPreferencesPatch,
} from '@/stores/uiPreferencesSync'

const DASHBOARD_TABS_KEY_PREFIX = 'msm:dashboard-tabs:'
const LOG_SCOPE = 'dashboardPreferences'

function sanitizeTabList(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null
  if (!Array.isArray(raw)) return null
  const seen = new Set<string>()
  const result: string[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' && VALID_DASHBOARD_TABS.has(entry) && !seen.has(entry)) {
      seen.add(entry)
      result.push(entry)
      if (result.length >= MAX_DASHBOARD_TABS) break
    }
  }
  return result
}

function readDashboardTabs(konto: number | null): string[] | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(DASHBOARD_TABS_KEY_PREFIX, konto))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    return sanitizeTabList(parsed)
  } catch (err) {
    still(err, `${LOG_SCOPE}:read`)
    return null
  }
}

function writeDashboardTabs(konto: number | null, tabs: readonly string[] | null): void {
  if (typeof window === 'undefined') return
  const key = storageKey(DASHBOARD_TABS_KEY_PREFIX, konto)
  try {
    if (tabs === null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, JSON.stringify(tabs))
    }
  } catch (err) {
    still(err, `${LOG_SCOPE}:write`)
  }
}

export type TogglePinnedTabResult = 'added' | 'removed' | 'limit' | 'invalid'

interface DashboardPreferencesState {
  /** `null` bedeutet: Standard-Reiter (`DEFAULT_DASHBOARD_TABS`) werden verwendet. */
  pinnedTabs: string[] | null
  togglePinnedTab: (to: string) => TogglePinnedTabResult
  movePinnedTab: (to: string, direction: 'up' | 'down') => void
  resetToDefaults: () => void
  hydrateFromServer: (tabs: string[] | null) => void
  resetForTests: () => void
}

const initialKonto = angemeldetesKonto()

export const useDashboardPreferencesStore = create<DashboardPreferencesState>((set, get) => ({
  pinnedTabs: readDashboardTabs(initialKonto),

  togglePinnedTab: (to) => {
    if (!VALID_DASHBOARD_TABS.has(to)) return 'invalid'
    const current = get().pinnedTabs ?? [...DEFAULT_DASHBOARD_TABS]
    const exists = current.includes(to)
    if (exists) {
      const next = current.filter((entry) => entry !== to)
      writeDashboardTabs(angemeldetesKonto(), next)
      set({ pinnedTabs: next })
      syncUiPreferencesPatch({ dashboard_tabs: next })
      return 'removed'
    }
    if (current.length >= MAX_DASHBOARD_TABS) {
      return 'limit'
    }
    const next = [...current, to]
    writeDashboardTabs(angemeldetesKonto(), next)
    set({ pinnedTabs: next })
    syncUiPreferencesPatch({ dashboard_tabs: next })
    return 'added'
  },

  movePinnedTab: (to, direction) => {
    const current = [...(get().pinnedTabs ?? DEFAULT_DASHBOARD_TABS)]
    const idx = current.indexOf(to)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= current.length) return
    const [item] = current.splice(idx, 1)
    current.splice(targetIdx, 0, item)
    writeDashboardTabs(angemeldetesKonto(), current)
    set({ pinnedTabs: current })
    syncUiPreferencesPatch({ dashboard_tabs: current })
  },

  resetToDefaults: () => {
    writeDashboardTabs(angemeldetesKonto(), null)
    set({ pinnedTabs: null })
    syncUiPreferencesPatch({ dashboard_tabs: null })
  },

  hydrateFromServer: (tabs) => {
    const normalized = sanitizeTabList(tabs)
    writeDashboardTabs(angemeldetesKonto(), normalized)
    set({ pinnedTabs: normalized })
  },

  resetForTests: () => {
    const konto = angemeldetesKonto()
    removeStorageKey(DASHBOARD_TABS_KEY_PREFIX, konto, LOG_SCOPE)
    removeStorageKey(DASHBOARD_TABS_KEY_PREFIX, null, LOG_SCOPE)
    if (konto !== null) clearUiPreferencesMigrationMarker(konto)
    set({ pinnedTabs: null })
  },
}))

beiKontowechsel((konto) => {
  useDashboardPreferencesStore.setState({
    pinnedTabs: readDashboardTabs(konto),
  })
})

registerUiPreferencesStore(
  (prefs) => {
    useDashboardPreferencesStore.getState().hydrateFromServer(prefs.dashboard_tabs)
  },
  () => ({
    dashboard_tabs: useDashboardPreferencesStore.getState().pinnedTabs,
  }),
)

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    const expectedKey = storageKey(DASHBOARD_TABS_KEY_PREFIX, angemeldetesKonto())
    if (event.key === expectedKey) {
      useDashboardPreferencesStore.setState({
        pinnedTabs: readDashboardTabs(angemeldetesKonto()),
      })
    }
  })
}
