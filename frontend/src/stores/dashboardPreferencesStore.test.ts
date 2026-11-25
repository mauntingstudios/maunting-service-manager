import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as client from '@/api/client'
import { DEFAULT_DASHBOARD_TABS } from '@/desktop/dashboard/dashboardWege'
import { setzeAngemeldetesKonto } from '@/lib/angemeldetesKonto'
import { useDashboardPreferencesStore } from './dashboardPreferencesStore'
import { useNodePreferencesStore } from './nodePreferencesStore'
import { useServerPreferencesStore } from './serverPreferencesStore'
import { hydrateUiPreferencesFromUser, resetUiPreferencesSyncForTests } from './uiPreferencesSync'
import type { User } from '@/types'

vi.mock('@/api/client', () => ({ api: vi.fn() }))

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('dashboardPreferencesStore & uiPreferencesSync', () => {
  beforeEach(() => {
    localStorage.clear()
    setzeAngemeldetesKonto(1)
    useDashboardPreferencesStore.getState().resetForTests()
    useServerPreferencesStore.getState().resetForTests()
    useNodePreferencesStore.getState().resetForTests()
    resetUiPreferencesSyncForTests()
    vi.mocked(client.api).mockReset()
    vi.mocked(client.api).mockResolvedValue({
      server_favorites: [],
      node_favorites: [],
      dashboard_tabs: null,
    } as never)
  })

  it('verwaltet angepinnte Reiter bis zum Limit 5, erlaubt Umsortieren und Reset', () => {
    expect(useDashboardPreferencesStore.getState().pinnedTabs).toBeNull()

    expect(useDashboardPreferencesStore.getState().togglePinnedTab('/invalid-route')).toBe('invalid')
    expect(useDashboardPreferencesStore.getState().togglePinnedTab('/settings?tab=shop')).toBe('added')
    expect(useDashboardPreferencesStore.getState().togglePinnedTab('/users')).toBe('added')
    // Bereits 5 belegt (3 Standard + 2 ergänzt)
    expect(useDashboardPreferencesStore.getState().pinnedTabs).toHaveLength(5)
    expect(useDashboardPreferencesStore.getState().togglePinnedTab('/roles')).toBe('limit')

    useDashboardPreferencesStore.getState().movePinnedTab('/settings?tab=shop', 'up')
    expect(useDashboardPreferencesStore.getState().pinnedTabs).toEqual([
      '/servers',
      '/admin/nodes',
      '/settings?tab=shop',
      '/admin/ai-providers',
      '/users',
    ])

    expect(useDashboardPreferencesStore.getState().togglePinnedTab('/admin/nodes')).toBe('removed')
    expect(useDashboardPreferencesStore.getState().pinnedTabs).not.toContain('/admin/nodes')

    useDashboardPreferencesStore.getState().resetToDefaults()
    expect(useDashboardPreferencesStore.getState().pinnedTabs).toBeNull()
  })

  it('bündelt Favoriten- und Reiteränderungen im selben Tick zu einem PATCH', async () => {
    useServerPreferencesStore.getState().toggleFavorite(12)
    useNodePreferencesStore.getState().toggleFavorite(4)
    useDashboardPreferencesStore.getState().togglePinnedTab('/settings?tab=shop')

    await flushMicrotasks()

    expect(client.api).toHaveBeenCalledTimes(1)
    expect(client.api).toHaveBeenCalledWith('/auth/me/preferences', {
      method: 'PATCH',
      body: JSON.stringify({
        server_favorites: [12],
        node_favorites: [4],
        dashboard_tabs: [...DEFAULT_DASHBOARD_TABS, '/settings?tab=shop'],
      }),
    })
  })

  it('übernimmt Server-Vorlieben bei Hydrierung und trennt Konten sauber', () => {
    const user = {
      id: 1,
      username: 'ada',
      email: 'ada@example.invalid',
      is_owner: true,
      ui_preferences: {
        server_favorites: [7, 3],
        node_favorites: [2],
        dashboard_tabs: ['/settings?tab=shop', '/servers'],
      },
    } as unknown as User

    hydrateUiPreferencesFromUser(user)

    expect(useServerPreferencesStore.getState().favoriteIds).toEqual([7, 3])
    expect(useNodePreferencesStore.getState().favoriteIds).toEqual([2])
    expect(useDashboardPreferencesStore.getState().pinnedTabs).toEqual([
      '/settings?tab=shop',
      '/servers',
    ])

    setzeAngemeldetesKonto(2)
    expect(useServerPreferencesStore.getState().favoriteIds).toEqual([])
    expect(useNodePreferencesStore.getState().favoriteIds).toEqual([])
    expect(useDashboardPreferencesStore.getState().pinnedTabs).toBeNull()

    setzeAngemeldetesKonto(1)
    expect(useServerPreferencesStore.getState().favoriteIds).toEqual([7, 3])
    expect(useDashboardPreferencesStore.getState().pinnedTabs).toEqual([
      '/settings?tab=shop',
      '/servers',
    ])
  })

  it('migriert lokale Altbestände genau einmal, wenn Server ui_preferences: null liefert', async () => {
    useServerPreferencesStore.getState().toggleFavorite(9)
    await flushMicrotasks()
    vi.mocked(client.api).mockClear()
    resetUiPreferencesSyncForTests()
    localStorage.removeItem('msm:ui-prefs-migrated:1')

    const legacyUser = {
      id: 1,
      username: 'ada',
      email: 'ada@example.invalid',
      is_owner: true,
      ui_preferences: null,
    } as unknown as User

    hydrateUiPreferencesFromUser(legacyUser)
    await flushMicrotasks()

    expect(client.api).toHaveBeenCalledTimes(1)
    const [url, options] = vi.mocked(client.api).mock.calls[0]
    expect(url).toBe('/auth/me/preferences')
    expect(options?.method).toBe('PATCH')
    expect(JSON.parse(String(options?.body))).toEqual({
      server_favorites: [9],
      node_favorites: [],
      dashboard_tabs: null,
    })

    // Ein zweiter Aufruf migriert nicht erneut.
    vi.mocked(client.api).mockClear()
    hydrateUiPreferencesFromUser(legacyUser)
    await flushMicrotasks()
    expect(client.api).not.toHaveBeenCalled()
  })
})
