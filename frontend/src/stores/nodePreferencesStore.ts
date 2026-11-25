import { create } from 'zustand'
import { angemeldetesKonto, beiKontowechsel } from '@/lib/angemeldetesKonto'
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

const NODE_FAVORITES_KEY_PREFIX = 'msm:node-favorites:'
const LOG_SCOPE = 'nodePreferences'

function nodeStatusRank(status: string | undefined): number {
  const normalized = status?.toLowerCase()
  if (normalized === 'online') return 0
  if (normalized === 'offline') return 2
  return 1
}

interface NodePreferencesState {
  favoriteIds: number[]
  toggleFavorite: (nodeId: number) => void
  hydrateFavorites: (ids: number[]) => void
  resetForTests: () => void
}

const initialKonto = angemeldetesKonto()

export const useNodePreferencesStore = create<NodePreferencesState>((set, get) => ({
  favoriteIds: readFavoriteIdList(NODE_FAVORITES_KEY_PREFIX, initialKonto, LOG_SCOPE),

  toggleFavorite: (nodeId) => {
    const next = toggleFavoriteIdInList(get().favoriteIds, nodeId)
    if (!next) return
    writeFavoriteIdList(NODE_FAVORITES_KEY_PREFIX, angemeldetesKonto(), next, LOG_SCOPE)
    set({ favoriteIds: next })
    syncUiPreferencesPatch({ node_favorites: next })
  },

  hydrateFavorites: (ids) => {
    const clean = sanitizeFavoriteIdList(ids)
    writeFavoriteIdList(NODE_FAVORITES_KEY_PREFIX, angemeldetesKonto(), clean, LOG_SCOPE)
    set({ favoriteIds: clean })
  },

  resetForTests: () => {
    const konto = angemeldetesKonto()
    removeStorageKey(NODE_FAVORITES_KEY_PREFIX, konto, LOG_SCOPE)
    removeStorageKey(NODE_FAVORITES_KEY_PREFIX, null, LOG_SCOPE)
    if (konto !== null) clearUiPreferencesMigrationMarker(konto)
    set({ favoriteIds: [] })
  },
}))

beiKontowechsel((konto) => {
  useNodePreferencesStore.setState({
    favoriteIds: readFavoriteIdList(NODE_FAVORITES_KEY_PREFIX, konto, LOG_SCOPE),
  })
})

registerUiPreferencesStore(
  (prefs) => {
    useNodePreferencesStore.getState().hydrateFavorites(prefs.node_favorites)
  },
  () => ({
    node_favorites: useNodePreferencesStore.getState().favoriteIds,
  }),
)

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    const konto = angemeldetesKonto()
    if (event.key === storageKey(NODE_FAVORITES_KEY_PREFIX, konto)) {
      useNodePreferencesStore.setState({
        favoriteIds: readFavoriteIdList(NODE_FAVORITES_KEY_PREFIX, konto, LOG_SCOPE),
      })
    }
  })
}

/**
 * Sortiert Nodes stabil für Node-Übersicht und Dashboard:
 * Favoriten zuerst (intern online vor sonstig/offline), danach aktive Nodes.
 */
export function sortNodesByPriority<T extends { id: number; status: string }>(
  nodes: readonly T[],
  favoriteIds: readonly number[],
): T[] {
  if (nodes.length <= 1) return [...nodes]
  const favoriteSet = new Set(favoriteIds)

  return nodes
    .map((node, index) => ({
      node,
      index,
      favoriteRank: favoriteSet.has(node.id) ? 0 : 1,
      sRank: nodeStatusRank(node.status),
    }))
    .sort((a, b) => {
      if (a.favoriteRank !== b.favoriteRank) return a.favoriteRank - b.favoriteRank
      if (a.sRank !== b.sRank) return a.sRank - b.sRank
      return a.index - b.index
    })
    .map((entry) => entry.node)
}
