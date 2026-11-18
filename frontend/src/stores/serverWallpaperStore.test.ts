import { describe, it, expect, beforeEach } from 'vitest'
import {
  useServerWallpaperStore,
  versionierteWallpaperUrl,
  wallpaperMotiv,
  wallpaperNavigationsState,
} from './serverWallpaperStore'

beforeEach(() => {
  useServerWallpaperStore.setState({ activeWallpaper: null })
})

describe('serverWallpaperStore', () => {
  it('starts with panorama (no active wallpaper)', () => {
    expect(useServerWallpaperStore.getState().activeWallpaper).toBeNull()
  })

  it('sets and clears the active wallpaper', () => {
    const motiv = wallpaperMotiv(7, '/api/servers/7/wallpaper')
    useServerWallpaperStore.getState().setActiveWallpaper(motiv)
    expect(useServerWallpaperStore.getState().activeWallpaper).toEqual(motiv)
    useServerWallpaperStore.getState().clear()
    expect(useServerWallpaperStore.getState().activeWallpaper).toBeNull()
  })

  it('builds a motiv with panorama geometry and a stable URL', () => {
    const motiv = wallpaperMotiv(7, '/api/servers/7/wallpaper')
    expect(motiv.id).toBe('server-wallpaper-7')
    expect(motiv.pfad).toBe('/api/servers/7/wallpaper')
    expect(motiv.position).toBe('center 38%')
    expect(motiv.ueberlagerung).toBe('')
  })

  it('appends the content version so the browser caches immutable', () => {
    expect(versionierteWallpaperUrl('/api/servers/7/wallpaper', 'custom-12')).toBe(
      '/api/servers/7/wallpaper?v=custom-12',
    )
    expect(versionierteWallpaperUrl('/api/servers/7/wallpaper', null)).toBe(
      '/api/servers/7/wallpaper',
    )
    expect(versionierteWallpaperUrl('/api/servers/7/wallpaper')).toBe(
      '/api/servers/7/wallpaper',
    )
    const motiv = wallpaperMotiv(7, '/api/servers/7/wallpaper', 'steam-380870')
    expect(motiv.pfad).toBe('/api/servers/7/wallpaper?v=steam-380870')
  })

  it('packs the card handoff state, or nothing without a wallpaper', () => {
    expect(
      wallpaperNavigationsState({ id: 7, wallpaper_url: '/api/servers/7/wallpaper', wallpaper_version: 'custom-12' }),
    ).toEqual({ wallpaper: { serverId: 7, url: '/api/servers/7/wallpaper', version: 'custom-12' } })
    expect(wallpaperNavigationsState({ id: 7, wallpaper_url: null, wallpaper_version: null })).toBeUndefined()
    expect(wallpaperNavigationsState({ id: 7 })).toBeUndefined()
  })
})
