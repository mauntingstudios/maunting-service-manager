import { create } from 'zustand'
import { apiUrl } from '@/config/api'
import type { HeaderHintergrundVariante } from '@/lib/tageszeit'

/** Schlanker Wallpaper-Zustand: ServerDetail setzt das aktive Motiv, Shell und
 * MSS-Dashboard rendern es.
 *
 * Kein ID-Mapping hier — URL und Inhalts-Version kommen aus der API
 * (`wallpaper_url`, `wallpaper_version`). Neuer Inhalt bedeutet eine neue
 * Version und damit eine neue URL; versionierte Antworten cached der Browser
 * als immutable und malt sie ohne jede Anfrage. Unversionierte Anfragen
 * sichern ETag + `no-cache` ab.
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

/** Hängt die Inhalts-Version an die Bild-URL (`?v=`), wenn es eine gibt. */
export function versionierteWallpaperUrl(url: string, version?: string | null): string {
  if (!version) return apiUrl(url)
  const trenner = url.includes('?') ? '&' : '?'
  return apiUrl(`${url}${trenner}v=${version}`)
}

/** Baut das Shell-Motiv aus der API-URL (gleiche Maske/Hoehe wie das Panorama). */
export function wallpaperMotiv(serverId: number, url: string, version?: string | null): HeaderHintergrundVariante {
  return {
    id: `server-wallpaper-${serverId}`,
    pfad: versionierteWallpaperUrl(url, version),
    position: 'center 38%',
    ueberlagerung: '',
  }
}

/** Was eine Serverkarte der Detailseite im Navigations-State mitgibt, damit
 * der Kopf das Titelbild sofort aus dem Cache malt statt auf fetchAll zu warten. */
export interface WallpaperNavigationsState {
  wallpaper: { serverId: number; url: string; version: string | null }
}

/** Baut den Mitgabe-State — `undefined` ohne Titelbild (Panorama). */
export function wallpaperNavigationsState(server: {
  id: number
  wallpaper_url?: string | null
  wallpaper_version?: string | null
}): WallpaperNavigationsState | undefined {
  if (!server.wallpaper_url) return undefined
  return {
    wallpaper: {
      serverId: server.id,
      url: server.wallpaper_url,
      version: server.wallpaper_version ?? null,
    },
  }
}
