import { describe, it, expect, beforeEach } from 'vitest'
import { useServerWallpaperStore, wallpaperMotiv } from './serverWallpaperStore'

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
    // Stabil absichtlich: Frische garantiert der Server per ETag + no-cache,
    // nicht ein angehängter Zähler (der sähe nur die eigenen Änderungen).
    const motiv = wallpaperMotiv(7, '/api/servers/7/wallpaper')
    expect(motiv.id).toBe('server-wallpaper-7')
    expect(motiv.pfad).toBe('/api/servers/7/wallpaper')
    expect(motiv.position).toBe('center 38%')
    expect(motiv.ueberlagerung).toBe('')
  })
})
