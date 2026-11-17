import { create } from 'zustand'
import { apiUrl } from '@/config/api'
import type { HeaderHintergrundVariante } from '@/lib/tageszeit'

/** Schlanker Wallpaper-Zustand: ServerDetail setzt das aktive Motiv, Shell und
 * MSS-Dashboard rendern es.
 *
 * Kein ID-Mapping hier — die URL kommt aus der API (`wallpaper_url`).
 * Frische garantiert der Server per ETag + `no-cache`: Web und MSS fragen bei
 * jedem Aufruf an und bekommen 304, solange sich nichts geaendert hat. Ein
 * lokaler Versionszaehler saehe nur die eigenen Aenderungen und liesse jeden
 * anderen Client auf dem alten Bild sitzen.
 */
interface ServerWallpaperState {
  activeWallpaper: HeaderHintergrundVariante | null
  setActiveWallpaper: (wallpaper: HeaderHintergrundVariante | null) => void
  clear: () => void
}

export const useServerWallpaperStore = create<ServerWallpaperState>((set) => ({
  activeWallpaper: null,
  setActiveWallpaper: (wallpaper) => set({ activeWallpaper: wallpaper }),
  clear: () => set({ activeWallpaper: null }),
}))

/** Baut das Shell-Motiv aus der API-URL (gleiche Maske/Hoehe wie das Panorama). */
export function wallpaperMotiv(serverId: number, url: string): HeaderHintergrundVariante {
  return {
    id: `server-wallpaper-${serverId}`,
    pfad: apiUrl(url),
    position: 'center 38%',
    ueberlagerung: '',
  }
}
