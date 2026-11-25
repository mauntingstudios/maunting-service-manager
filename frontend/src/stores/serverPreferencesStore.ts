import { create } from 'zustand'
import { angemeldetesKonto, beiKontowechsel } from '@/lib/angemeldetesKonto'
import { still } from '@/lib/still'
import {
  readFavoriteIdList,
  removeStorageKey,
  sanitizeFavoriteIdList,
  storageKey,
  toggleFavoriteIdInList,
  writeFavoriteIdList,
} from '@/stores/favoriteIdsStorage'
import {
  clearUiPreferencesMigrationMarker,
  registerUiPreferencesStore,
  syncUiPreferencesPatch,
} from '@/stores/uiPreferencesSync'
import type { Server } from '@/types'

const FAVORITES_KEY_PREFIX = 'msm:server-favorites:'
const LAST_VISITED_KEY_PREFIX = 'msm:server-last-visited:'
const RECENT_VISITED_KEY_PREFIX = 'msm:server-recent-visited:'
const MAX_RECENT_SERVERS = 5
const LOG_SCOPE = 'serverPreferences'

const ACTIVE_TRANSIENT_STATUSES = new Set([
  'starting',
  'restarting',
  'stopping',
  'installing',
  'updating',
  'queued',
])

function readLastVisitedId(konto: number | null): number | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey(LAST_VISITED_KEY_PREFIX, konto))
    if (!raw) return null
    const id = Number(raw)
    return Number.isInteger(id) && id > 0 ? id : null
  } catch (err) {
    still(err, 'serverPreferences:readLastVisited')
    return null
  }
}

function writeLastVisitedId(konto: number | null, serverId: number | null): void {
  if (typeof window === 'undefined') return
  try {
    const key = storageKey(LAST_VISITED_KEY_PREFIX, konto)
    if (serverId == null) {
      window.localStorage.removeItem(key)
    } else {
      window.localStorage.setItem(key, String(serverId))
    }
  } catch (err) {
    still(err, 'serverPreferences:writeLastVisited')
  }
}

function readRecentVisitedIds(konto: number | null, fallbackLastVisitedId: number | null): number[] {
  const fromList = readFavoriteIdList(RECENT_VISITED_KEY_PREFIX, konto, LOG_SCOPE).slice(
    0,
    MAX_RECENT_SERVERS,
  )
  if (fallbackLastVisitedId != null && fromList[0] !== fallbackLastVisitedId) {
    return [fallbackLastVisitedId, ...fromList.filter((id) => id !== fallbackLastVisitedId)].slice(
      0,
      MAX_RECENT_SERVERS,
    )
  }
  return fromList
}

function writeRecentVisitedIds(konto: number | null, ids: readonly number[]): void {
  writeFavoriteIdList(RECENT_VISITED_KEY_PREFIX, konto, ids.slice(0, MAX_RECENT_SERVERS), LOG_SCOPE)
}

function clearAccountPreferences(konto: number | null): void {
  removeStorageKey(FAVORITES_KEY_PREFIX, konto, LOG_SCOPE)
  removeStorageKey(LAST_VISITED_KEY_PREFIX, konto, LOG_SCOPE)
  removeStorageKey(RECENT_VISITED_KEY_PREFIX, konto, LOG_SCOPE)
}

function statusRank(status: string | undefined): number {
  if (status === 'running') return 0
  if (status && ACTIVE_TRANSIENT_STATUSES.has(status)) return 1
  return 2
}

interface ServerPreferencesState {
  favoriteIds: number[]
  lastVisitedId: number | null
  recentVisitedIds: number[]
  toggleFavorite: (serverId: number) => void
  hydrateFavorites: (ids: number[]) => void
  setLastVisited: (serverId: number) => void
  resetForTests: () => void
}

const initialKonto = angemeldetesKonto()
const initialLastVisitedId = readLastVisitedId(initialKonto)

export const useServerPreferencesStore = create<ServerPreferencesState>((set, get) => ({
  favoriteIds: readFavoriteIdList(FAVORITES_KEY_PREFIX, initialKonto, LOG_SCOPE),
  lastVisitedId: initialLastVisitedId,
  recentVisitedIds: readRecentVisitedIds(initialKonto, initialLastVisitedId),

  toggleFavorite: (serverId) => {
    const next = toggleFavoriteIdInList(get().favoriteIds, serverId)
    if (!next) return
    writeFavoriteIdList(FAVORITES_KEY_PREFIX, angemeldetesKonto(), next, LOG_SCOPE)
    set({ favoriteIds: next })
    syncUiPreferencesPatch({ server_favorites: next })
  },

  hydrateFavorites: (ids) => {
    const clean = sanitizeFavoriteIdList(ids)
    writeFavoriteIdList(FAVORITES_KEY_PREFIX, angemeldetesKonto(), clean, LOG_SCOPE)
    set({ favoriteIds: clean })
  },

  setLastVisited: (serverId) => {
    if (!Number.isInteger(serverId) || serverId <= 0) return
    const currentRecent = get().recentVisitedIds
    if (get().lastVisitedId === serverId && currentRecent[0] === serverId) return
    const nextRecent = [serverId, ...currentRecent.filter((id) => id !== serverId)].slice(
      0,
      MAX_RECENT_SERVERS,
    )
    const konto = angemeldetesKonto()
    writeLastVisitedId(konto, serverId)
    writeRecentVisitedIds(konto, nextRecent)
    set({ lastVisitedId: serverId, recentVisitedIds: nextRecent })
  },

  resetForTests: () => {
    const konto = angemeldetesKonto()
    clearAccountPreferences(konto)
    clearAccountPreferences(null)
    if (konto !== null) clearUiPreferencesMigrationMarker(konto)
    set({ favoriteIds: [], lastVisitedId: null, recentVisitedIds: [] })
  },
}))

beiKontowechsel((konto) => {
  const nextLastVisitedId = readLastVisitedId(konto)
  useServerPreferencesStore.setState({
    favoriteIds: readFavoriteIdList(FAVORITES_KEY_PREFIX, konto, LOG_SCOPE),
    lastVisitedId: nextLastVisitedId,
    recentVisitedIds: readRecentVisitedIds(konto, nextLastVisitedId),
  })
})

registerUiPreferencesStore(
  (prefs) => {
    useServerPreferencesStore.getState().hydrateFavorites(prefs.server_favorites)
  },
  () => ({
    server_favorites: useServerPreferencesStore.getState().favoriteIds,
  }),
)

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    const konto = angemeldetesKonto()
    if (event.key === storageKey(FAVORITES_KEY_PREFIX, konto)) {
      useServerPreferencesStore.setState({
        favoriteIds: readFavoriteIdList(FAVORITES_KEY_PREFIX, konto, LOG_SCOPE),
      })
    }
  })
}

/**
 * Sortiert Server stabil für Dashboard, Serverliste und Server-Wechsler:
 * Favoriten zuerst (intern aktiv vor gestoppt), danach der bzw. die zuletzt
 * geöffneten Server (auch wenn sie gestoppt sind), dann laufende und aktive
 * Übergänge, schließlich die übrigen gestoppten Server.
 */
export function sortServersByPriority(
  servers: readonly Server[],
  favoriteIds: readonly number[],
  lastVisitedId: number | null,
  recentVisitedIds?: readonly number[],
): Server[] {
  if (servers.length <= 1) return [...servers]
  const favoriteSet = new Set(favoriteIds)
  const effectiveRecentIds =
    recentVisitedIds && recentVisitedIds.length > 0
      ? recentVisitedIds
      : lastVisitedId != null
        ? [lastVisitedId]
        : []
  const recentRankMap = new Map<number, number>()
  effectiveRecentIds.forEach((id, idx) => {
    if (!recentRankMap.has(id)) recentRankMap.set(id, idx)
  })

  return servers
    .map((server, index) => {
      const isFavorite = favoriteSet.has(server.id)
      const recentRank = recentRankMap.get(server.id) ?? Number.POSITIVE_INFINITY
      const isRecent = recentRank < Number.POSITIVE_INFINITY
      const sRank = statusRank(server.status)

      let tier = 3 + sRank // 3 = running, 4 = transient, 5 = stopped/other
      if (isFavorite && isRecent) {
        tier = 0
      } else if (isFavorite) {
        tier = 1
      } else if (isRecent) {
        tier = 2
      }

      return { server, index, tier, recentRank, sRank }
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier
      if (a.recentRank !== b.recentRank) return a.recentRank - b.recentRank
      if (a.sRank !== b.sRank) return a.sRank - b.sRank
      return a.index - b.index
    })
    .map((entry) => entry.server)
}
