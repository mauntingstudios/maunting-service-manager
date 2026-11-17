import { describe, it, expect, beforeEach } from 'vitest'
import { useServerWallpaperStore, wallpaperMotiv } from './serverWallpaperStore'

beforeEach(() => {
  useServerWallpaperStore.setState({ activeWallpaper: null, version: 0 })
})

describe('serverWallpaperStore', () => {
  it('starts with panorama (no active wallpaper)', () => {
    expect(useServerWallpaperStore.getState().activeWallpaper).toBeNull()
  })

  it('sets and clears the active wallpaper', () => {
    const motiv = wallpaperMotiv(7, '/api/servers/7/wallpaper', 0)
    useServerWallpaperStore.getState().setActiveWallpaper(motiv)
    expect(useServerWallpaperStore.getState().activeWallpaper).toEqual(motiv)
    useServerWallpaperStore.getState().clear()
    expect(useServerWallpaperStore.getState().activeWallpaper).toBeNull()
  })

  it('bumps the cache version', () => {
    useServerWallpaperStore.getState().bumpVersion()
    useServerWallpaperStore.getState().bumpVersion()
    expect(useServerWallpaperStore.getState().version).toBe(2)
  })

  it('builds a cache-busted motiv with panorama geometry', () => {
    const motiv = wallpaperMotiv(7, '/api/servers/7/wallpaper', 3)
    expect(motiv.id).toBe('server-wallpaper-7')
    expect(motiv.pfad).toContain('/api/servers/7/wallpaper?v=3')
    expect(motiv.position).toBe('center 38%')
    expect(motiv.ueberlagerung).toBe('')
  })
})
