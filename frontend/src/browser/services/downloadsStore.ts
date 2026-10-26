/**
 * Persistente Download-Verwaltung für Maunting Pontis.
 *
 * Downloads werden lokal über die sichere `ablage` (localStorage mit Quota-Schutz)
 * bis zu einer Obergrenze von 500 Einträgen gespeichert. Rust lädt in die Quarantäne,
 * meldet Fortschritt (`download_fortschritt`), lässt den Virenschutz prüfen und
 * legt die Datei dann ab.
 *
 * Beim Neustart werden unterbrochene Ladevorgänge (Status 'start' oder 'pruefung')
 * automatisch auf 'abgebrochen' gesetzt, damit keine hängenden Spinner entstehen.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { ablage } from './ablage'
import { type DownloadKategorie, kategorieFuerDatei } from './downloadKategorien'
import type { DownloadStand, TabEreignis } from './nativ'

/** Stände, nach denen sich nichts mehr ändert. */
export const ABSCHLUSS: ReadonlySet<DownloadStand> = new Set(['fertig', 'blockiert', 'fehler', 'speicher', 'abgebrochen'])

/** Höchstens so viele Downloads werden dauerhaft vorgehalten. */
export const DOWNLOADS_MAX = 500

export interface Download {
  /** Eindeutige Kennung für React-Keys und persistente Verweise. */
  id: string
  /** Laufnummer der Sitzung zur Zuordnung nativer IPC-Ereignisse. */
  nr: number
  url: string
  datei: string | null
  stand: DownloadStand
  zeit: number
  /** Klassifizierte Dateikategorie für Filter. */
  kategorie: DownloadKategorie
  /** Ob die Datei auf der Festplatte noch auffindbar ist. */
  existiert?: boolean
  /** Empfangene Bytes (letzte Fortschrittsmeldung). */
  empfangen: number | null
  /** Gesamtlänge; null bei unbekannter Länge. */
  gesamt: number | null
  /** Geglättete Rate in Bytes je Sekunde; null ohne brauchbare Messung. */
  bytesProSekunde: number | null
  /** Ungefähre Restzeit in Sekunden; null ohne brauchbare Rate. */
  restSekunden: number | null
  /** Wann sich die Bytezahl zuletzt erhöht hat (ms seit 1970). */
  letzteBytesZeit: number | null
}

export type DownloadEreignis = Extract<TabEreignis, { art: 'download' | 'download_fortschritt' }>

export interface DownloadsZustand {
  downloads: Download[]
  /** Neue Downloads seit dem letzten Blick in die Liste. */
  neu: number
  ereignis: (e: DownloadEreignis) => void
  gesehen: () => void
  leeren: () => void
  loeschen: (kennung: number | string) => void
  existenzSetzen: (kennung: number | string, existiert: boolean) => void
  fertigeDateien: () => string[]
}

function neuerEintrag(e: Extract<TabEreignis, { art: 'download' }>): Download {
  const dateiOderName = e.datei || e.url
  return {
    id: `dl-${Date.now()}-${e.nr}-${Math.random().toString(36).slice(2, 7)}`,
    nr: e.nr,
    url: e.url,
    datei: e.datei,
    stand: e.stand,
    zeit: Date.now(),
    kategorie: kategorieFuerDatei(dateiOderName),
    existiert: true,
    empfangen: null,
    gesamt: null,
    bytesProSekunde: null,
    restSekunden: null,
    letzteBytesZeit: null,
  }
}

export const useDownloadsStore = create<DownloadsZustand>()(
  persist(
    (set, get) => ({
      downloads: [],
      neu: 0,

      ereignis: (e) =>
        set((s) => {
          // Laufende Downloads nach Nummer suchen
          let index = s.downloads.findIndex((d) => d.nr === e.nr && !ABSCHLUSS.has(d.stand))
          if (index < 0 && e.art === 'download' && e.stand !== 'start') {
            index = s.downloads.findIndex((d) => d.nr === e.nr)
          }

          if (e.art === 'download_fortschritt') {
            if (index < 0) return s
            const ziel = s.downloads[index]
            if (ABSCHLUSS.has(ziel.stand)) return s
            const waechst = e.empfangen > (ziel.empfangen ?? -1)
            const downloads = [...s.downloads]
            downloads[index] = {
              ...ziel,
              empfangen: e.empfangen,
              gesamt: e.gesamt,
              bytesProSekunde: e.bytes_pro_sekunde,
              restSekunden: e.rest_sekunden,
              letzteBytesZeit: waechst ? Date.now() : (ziel.letzteBytesZeit ?? Date.now()),
            }
            return { downloads }
          }

          if (index < 0) {
            // Neuer Download; auf DOWNLOADS_MAX begrenzen
            const aktualisiert = [neuerEintrag(e), ...s.downloads].slice(0, DOWNLOADS_MAX)
            return {
              downloads: aktualisiert,
              neu: s.neu + 1,
            }
          }

          const downloads = [...s.downloads]
          const bestehend = downloads[index]
          const neueDatei = e.datei ?? bestehend.datei
          downloads[index] = {
            ...bestehend,
            stand: e.stand,
            datei: neueDatei,
            kategorie: neueDatei ? kategorieFuerDatei(neueDatei) : bestehend.kategorie,
          }
          return { downloads }
        }),

      gesehen: () => set({ neu: 0 }),

      leeren: () =>
        set((s) => ({
          downloads: s.downloads.filter((d) => !ABSCHLUSS.has(d.stand)),
        })),

      loeschen: (kennung: number | string) =>
        set((s) => ({
          downloads: s.downloads.filter((d) => d.id !== kennung && d.nr !== kennung),
        })),

      existenzSetzen: (kennung: number | string, existiert: boolean) =>
        set((s) => ({
          downloads: s.downloads.map((d) =>
            d.id === kennung || d.nr === kennung ? { ...d, existiert } : d,
          ),
        })),

      fertigeDateien: () => {
        const { downloads } = get()
        return downloads
          .filter((d) => d.stand === 'fertig' && Boolean(d.datei))
          .map((d) => d.datei as string)
      },
    }),
    {
      name: 'msb:downloads',
      version: 1,
      storage: ablage,
      partialize: (s) => ({
        downloads: s.downloads.slice(0, DOWNLOADS_MAX),
      }),
      merge: (gespeichert, aktuell) => {
        const raw = gespeichert as Partial<DownloadsZustand> | undefined
        if (!raw || !Array.isArray(raw.downloads)) return aktuell
        // Unvollendete Alt-Downloads beim Einlesen als abgebrochen markieren
        const bereinigt: Download[] = raw.downloads.map((d) => {
          const fertig = ABSCHLUSS.has(d.stand)
          const dateiOderName = d.datei || d.url || ''
          return {
            ...d,
            stand: fertig ? d.stand : 'abgebrochen',
            kategorie: d.kategorie || kategorieFuerDatei(dateiOderName),
            existiert: d.existiert ?? true,
          }
        })
        return {
          ...aktuell,
          downloads: bereinigt.slice(0, DOWNLOADS_MAX),
          neu: 0,
        }
      },
    },
  ),
)
