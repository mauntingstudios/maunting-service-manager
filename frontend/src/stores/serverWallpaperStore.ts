import { create } from 'zustand'
import { apiUrl } from '@/config/api'
import type { HeaderHintergrundVariante } from '@/lib/tageszeit'

/** Schlanker Wallpaper-Zustand: ServerDetail setzt das aktive Motiv, Shell rendert es.
 *
 * Kein ID-Mapping hier — die URL kommt aus der API (`wallpaper_url`).
 * `version` bricht den Browser-Cache (max-age=86400) nach Upload/Reaktivieren/Reset.
 */
interface ServerWallpaperState {
  activeWallpaper: HeaderHintergrundVariante | null
  version: number
  setActiveWallpaper: (wallpaper: HeaderHintergrundVariante | null) => void
  bumpVersion: () => void
  clear: () => void
}

export const useServerWallpaperStore = create<ServerWallpaperState>((set) => ({
  activeWallpaper: null,
  version: 0,
  setActiveWallpaper: (wallpaper) => set({ activeWallpaper: wallpaper }),
  bumpVersion: () => set((s) => ({ version: s.version + 1 })),
  clear: () => set({ activeWallpaper: null }),
}))

/** Baut das Shell-Motiv aus der API-URL (gleiche Maske/Hoehe wie das Panorama). */
export function wallpaperMotiv(serverId: number, url: string, version: number): HeaderHintergrundVariante {
  const trenner = url.includes('?') ? '&' : '?'
  return {
    id: `server-wallpaper-${serverId}`,
    pfad: apiUrl(`${url}${trenner}v=${version}`),
    position: 'center 38%',
    ueberlagerung: '',
  }
}
