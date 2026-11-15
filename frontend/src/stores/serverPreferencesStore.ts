import { create } from 'zustand'
import { angemeldetesKonto, beiKontowechsel } from '@/lib/angemeldetesKonto'
import { still } from '@/lib/still'
import type { Server } from '@/types'

const FAVORITES_KEY_PREFIX = 'msm:server-favorites:'
const LAST_VISITED_KEY_PREFIX = 'msm:server-last-visited:'

const ACTIVE_TRANSIENT_STATUSES = new Set([
  'starting',
  'restarting',
  'stopping',
  'installing',
  'updating',
  'queued',
])

function storageKey(prefix: string, konto: number | null): string {
  return `${prefix}${konto ?? 'anon'}`
}

function readFavoriteIds(konto: number | null): number[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(storageKey(FAVORITES_KEY_PREFIX, konto))
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return Array.from(
      new Set(
        parsed.filter(
          (id): id is number => typeof id === 'number' && Number.isInteger(id) && id > 0,
        ),
      ),
    )
  } catch (err) {
    still(err, 'serverPreferences:readFavorites')
    return []
  }
}

function writeFavoriteIds(konto: number | null, ids: readonly number[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(storageKey(FAVORITES_KEY_PREFIX, konto), JSON.stringify(ids))
  } catch (err) {
    still(err, 'serverPreferences:writeFavorites')
  }
}

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

function clearAccountPreferences(konto: number | null): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey(FAVORITES_KEY_PREFIX, konto))
    window.localStorage.removeItem(storageKey(LAST_VISITED_KEY_PREFIX, konto))
  } catch (err) {
    still(err, 'serverPreferences:clear')
  }
}

function statusRank(status: string | undefined): number {
  if (status === 'running') return 0
  if (status && ACTIVE_TRANSIENT_STATUSES.has(status)) return 1
  return 2
}

interface ServerPreferencesState {
  favoriteIds: number[]
  lastVisitedId: number | null
  toggleFavorite: (serverId: number) => void
  setLastVisited: (serverId: number) => void
  resetForTests: () => void
}

const initialKonto = angemeldetesKonto()

export const useServerPreferencesStore = create<ServerPreferencesState>((set, get) => ({
  favoriteIds: readFavoriteIds(initialKonto),
  lastVisitedId: readLastVisitedId(initialKonto),

  toggleFavorite: (serverId) => {
    if (!Number.isInteger(serverId) || serverId <= 0) return
    const current = get().favoriteIds
    const next = current.includes(serverId)
      ? current.filter((id) => id !== serverId)
      : [...current, serverId]
    writeFavoriteIds(angemeldetesKonto(), next)
    set({ favoriteIds: next })
  },

  setLastVisited: (serverId) => {
    if (!Number.isInteger(serverId) || serverId <= 0) return
    if (get().lastVisitedId === serverId) return
    writeLastVisitedId(angemeldetesKonto(), serverId)
    set({ lastVisitedId: serverId })
  },

  resetForTests: () => {
    const konto = angemeldetesKonto()
    clearAccountPreferences(konto)
    clearAccountPreferences(null)
    set({ favoriteIds: [], lastVisitedId: null })
  },
}))

beiKontowechsel((konto) => {
  useServerPreferencesStore.setState({
    favoriteIds: readFavoriteIds(konto),
    lastVisitedId: readLastVisitedId(konto),
  })
})

/**
 * Sortiert Server stabil für Dashboard und Serverliste:
 * Favoriten zuerst (intern aktiv vor gestoppt), danach der zuletzt geöffnete
 * Server (auch wenn er gestoppt ist), dann laufende und aktive Übergänge,
 * schließlich die übrigen gestoppten Server.
 */
export function sortServersByPriority(
  servers: readonly Server[],
  favoriteIds: readonly number[],
  lastVisitedId: number | null,
): Server[] {
  if (servers.length <= 1) return [...servers]
  const favoriteSet = new Set(favoriteIds)

  return servers
    .map((server, index) => {
      const isFavorite = favoriteSet.has(server.id)
      const isLastVisited = lastVisitedId != null && server.id === lastVisitedId
      const sRank = statusRank(server.status)

      let tier = 3 + sRank // 3 = running, 4 = transient, 5 = stopped/other
      if (isFavorite && isLastVisited) {
        tier = 0
      } else if (isFavorite) {
        tier = 1
      } else if (isLastVisited) {
        tier = 2
      }

      return { server, index, tier, sRank }
    })
    .sort((a, b) => {
      if (a.tier !== b.tier) return a.tier - b.tier
      if (a.sRank !== b.sRank) return a.sRank - b.sRank
      return a.index - b.index
    })
    .map((entry) => entry.server)
}
