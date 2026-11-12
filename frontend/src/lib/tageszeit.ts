/**
 * Tageszeit-Szenen und Begrüßungen: 4 Tageszeiten × je 5 Varianten. Gemeinsame
 * Quelle für `TageszeitBanner`, `TageszeitKulisse` und das Tresor-Dashboard.
 */
import { useEffect, useMemo, useState } from 'react'

export type Tageszeit = 'morgen' | 'tag' | 'abend' | 'nacht'
export type Jahreszeit = 'fruehling' | 'sommer' | 'herbst' | 'winter'

export function tageszeit(stunde: number): Tageszeit {
  if (stunde >= 5 && stunde < 11) return 'morgen'
  if (stunde >= 11 && stunde < 17) return 'tag'
  if (stunde >= 17 && stunde < 22) return 'abend'
  return 'nacht'
}

/**
 * Bestimmt die meteorologische Jahreszeit für ein Datum (Nordhalbkugel):
 * März–Mai Frühling, Juni–August Sommer, September–November Herbst, Dezember–Februar Winter.
 */
export function jahreszeit(datum: Date = new Date()): Jahreszeit {
  const monat = datum.getMonth()
  if (monat >= 2 && monat <= 4) return 'fruehling'
  if (monat >= 5 && monat <= 7) return 'sommer'
  if (monat >= 8 && monat <= 10) return 'herbst'
  return 'winter'
}

type PhaseDatei = 'morning' | 'day' | 'evening' | 'night'

const PHASE_DATEI: Record<Tageszeit, PhaseDatei> = {
  morgen: 'morning',
  tag: 'day',
  abend: 'evening',
  nacht: 'night',
}

/** Bereits erzeugte saisonale Varianten der Teams-Bergseeszene. */
const VORHANDENE_TEAMS_SAISON_BILDER = new Set<string>(['fruehling/morning'])

/**
 * Liefert das passende Hintergrundbild für Tageszeit, Motivfamilie und Jahreszeit.
 * Im Sommer bleiben die Ursprungsmotive aktiv; fehlt eine eigene Teams-Variante
 * außerhalb des Sommers, fällt Teams auf das passende saisonale Alpenmotiv zurück.
 */
export function saisonBildFuerPhase(
  zeit: Tageszeit,
  familie: 'singra' | 'teams' = 'singra',
  saison: Jahreszeit = jahreszeit(),
): string {
  const phase = PHASE_DATEI[zeit]
  if (saison === 'sommer') {
    return `/assets/${familie}/${familie}-bg-${phase}.jpg`
  }
  if (familie === 'teams' && VORHANDENE_TEAMS_SAISON_BILDER.has(`${saison}/${phase}`)) {
    return `/assets/teams/jahreszeiten/${saison}/teams-bg-${phase}.jpg`
  }
  return `/assets/singra/jahreszeiten/${saison}/singra-bg-${phase}.jpg`
}

/**
 * Alle verfügbaren saisonalen Hintergrundpfade für einen Zeitpunkt (z. B. für
 * automatische Bildwechsel im Browser).
 */
export function alleSaisonMotive(
  stunde: number = new Date().getHours(),
  datum: Date = new Date(),
): string[] {
  const zeit = tageszeit(stunde)
  const saison = jahreszeit(datum)
  const pfade = [
    saisonBildFuerPhase(zeit, 'singra', saison),
    saisonBildFuerPhase(zeit, 'teams', saison),
  ]
  if (saison === 'sommer') {
    if (zeit === 'abend') {
      pfade.push(
        '/assets/singra/daemmerung_wald.jpg',
        '/assets/singra/daemmerung_see.jpg',
        '/assets/singra/daemmerung_huegel.jpg',
        '/hintergruende/balkon.webp',
        '/hintergruende/bahnhof.webp',
      )
    } else if (zeit === 'tag' || zeit === 'morgen') {
      pfade.push(
        '/hintergruende/bergwald.webp',
        '/hintergruende/bergsee.webp',
        '/hintergruende/feld.webp',
      )
    }
  }
  return Array.from(new Set(pfade))
}

export interface HeaderHintergrundVariante {
  id: string
  pfad: string
  position: string
  ueberlagerung: string
}

/**
 * 4 Tageszeiten (Morgen, Mittag/Tag, Dämmerung/Abend, Nacht) × je 5 Varianten.
 * Jede Variante nutzt ein lokales atmosphärisches Bild aus `/assets/singra/` oder
 * `/assets/teams/` mit passendem Bildausschnitt und Lichtstimmung.
 *
 * Wichtig: `/hintergruende/*.webp` ist strikt für den Pontis-/MSM-Browser reserviert
 * und wird hier bewusst nicht verwendet.
 */
export const HEADER_HINTERGRUENDE: Record<Tageszeit, readonly HeaderHintergrundVariante[]> = {
  morgen: [
    {
      id: 'morgen-1',
      pfad: '/assets/singra/singra-bg-morning.jpg',
      position: 'center 35%',
      ueberlagerung: 'linear-gradient(180deg, rgba(251, 191, 36, 0.14) 0%, rgba(14, 165, 233, 0.12) 45%, transparent 100%)',
    },
    {
      id: 'morgen-2',
      pfad: '/assets/teams/teams-bg-morning.jpg',
      position: 'center 42%',
      ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.16) 0%, rgba(56, 189, 248, 0.10) 50%, transparent 100%)',
    },
    {
      id: 'morgen-3',
      pfad: '/assets/singra/singra-bg-morning.jpg',
      position: 'center 25%',
      ueberlagerung: 'linear-gradient(180deg, rgba(253, 186, 116, 0.15) 0%, rgba(14, 165, 233, 0.14) 50%, transparent 100%)',
    },
    {
      id: 'morgen-4',
      pfad: '/assets/teams/teams-bg-morning.jpg',
      position: 'center 30%',
      ueberlagerung: 'linear-gradient(180deg, rgba(251, 191, 36, 0.12) 0%, rgba(20, 184, 166, 0.12) 50%, transparent 100%)',
    },
    {
      id: 'morgen-5',
      pfad: '/assets/singra/singra-bg-morning.jpg',
      position: 'center 45%',
      ueberlagerung: 'linear-gradient(180deg, rgba(251, 191, 36, 0.15) 0%, rgba(14, 165, 233, 0.10) 50%, transparent 100%)',
    },
  ],
  tag: [
    {
      id: 'tag-1',
      pfad: '/assets/singra/singra-bg-day.jpg',
      position: 'center 50%',
      ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.16) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
    },
    {
      id: 'tag-2',
      pfad: '/assets/teams/teams-bg-day.jpg',
      position: 'center 48%',
      ueberlagerung: 'linear-gradient(180deg, rgba(34, 211, 238, 0.15) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
    },
    {
      id: 'tag-3',
      pfad: '/assets/singra/singra-bg-day.jpg',
      position: 'center 35%',
      ueberlagerung: 'linear-gradient(180deg, rgba(14, 165, 233, 0.18) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
    },
    {
      id: 'tag-4',
      pfad: '/assets/teams/teams-bg-day.jpg',
      position: 'center 45%',
      ueberlagerung: 'linear-gradient(180deg, rgba(45, 212, 191, 0.14) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
    },
    {
      id: 'tag-5',
      pfad: '/assets/singra/singra-bg-day.jpg',
      position: 'center 60%',
      ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.14) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
    },
  ],
  abend: [
    {
      id: 'abend-1',
      pfad: '/assets/singra/singra-bg-evening.jpg',
      position: 'center 50%',
      ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.18) 0%, rgba(225, 29, 72, 0.12) 48%, transparent 100%)',
    },
    {
      id: 'abend-2',
      pfad: '/assets/teams/teams-bg-evening.jpg',
      position: 'center 48%',
      ueberlagerung: 'linear-gradient(180deg, rgba(249, 115, 22, 0.16) 0%, rgba(14, 165, 233, 0.12) 50%, transparent 100%)',
    },
    {
      id: 'abend-3',
      pfad: '/assets/singra/daemmerung_wald.jpg',
      position: 'center 45%',
      ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.18) 0%, rgba(225, 29, 72, 0.12) 48%, transparent 100%)',
    },
    {
      id: 'abend-4',
      pfad: '/assets/singra/daemmerung_see.jpg',
      position: 'center 50%',
      ueberlagerung: 'linear-gradient(180deg, rgba(249, 115, 22, 0.16) 0%, rgba(14, 165, 233, 0.12) 50%, transparent 100%)',
    },
    {
      id: 'abend-5',
      pfad: '/assets/singra/daemmerung_huegel.jpg',
      position: 'center 55%',
      ueberlagerung: 'linear-gradient(180deg, rgba(217, 119, 6, 0.18) 0%, rgba(30, 41, 59, 0.35) 55%, transparent 100%)',
    },
  ],
  nacht: [
    {
      id: 'nacht-1',
      pfad: '/assets/singra/singra-bg-night.jpg',
      position: 'center 45%',
      ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.14) 0%, rgba(15, 23, 42, 0.45) 55%, transparent 100%)',
    },
    {
      id: 'nacht-2',
      pfad: '/assets/teams/teams-bg-night.jpg',
      position: 'center 40%',
      ueberlagerung: 'linear-gradient(180deg, rgba(14, 165, 233, 0.18) 0%, rgba(2, 6, 23, 0.50) 55%, transparent 100%)',
    },
    {
      id: 'nacht-3',
      pfad: '/assets/singra/singra-bg-night.jpg',
      position: 'center 30%',
      ueberlagerung: 'linear-gradient(180deg, rgba(30, 58, 138, 0.24) 0%, rgba(2, 6, 23, 0.55) 55%, transparent 100%)',
    },
    {
      id: 'nacht-4',
      pfad: '/assets/teams/teams-bg-night.jpg',
      position: 'center 25%',
      ueberlagerung: 'linear-gradient(180deg, rgba(14, 116, 144, 0.20) 0%, rgba(2, 6, 23, 0.55) 55%, transparent 100%)',
    },
    {
      id: 'nacht-5',
      pfad: '/assets/singra/singra-bg-night.jpg',
      position: 'center 55%',
      ueberlagerung: 'linear-gradient(180deg, rgba(2, 132, 199, 0.18) 0%, rgba(2, 6, 23, 0.55) 55%, transparent 100%)',
    },
  ],
}

/**
 * Dedizierte Varianten für den Teams-Bereich (Morgen, Tag, Abend, Nacht in alpinen Landschaften).
 */
export const TEAMS_HEADER_HINTERGRUENDE: Record<Tageszeit, HeaderHintergrundVariante> = {
  morgen: {
    id: 'teams-morgen',
    pfad: '/assets/teams/teams-bg-morning.jpg',
    position: 'center 38%',
    ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, transparent 100%)',
  },
  tag: {
    id: 'teams-tag',
    pfad: '/assets/teams/teams-bg-day.jpg',
    position: 'center 45%',
    ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.08) 0%, rgba(15, 23, 42, 0.15) 55%, transparent 100%)',
  },
  abend: {
    id: 'teams-abend',
    pfad: '/assets/teams/teams-bg-evening.jpg',
    position: 'center 50%',
    ueberlagerung: 'linear-gradient(180deg, rgba(249, 115, 22, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, transparent 100%)',
  },
  nacht: {
    id: 'teams-nacht',
    pfad: '/assets/teams/teams-bg-night.jpg',
    position: 'center 40%',
    ueberlagerung: 'linear-gradient(180deg, rgba(14, 165, 233, 0.10) 0%, rgba(2, 6, 23, 0.35) 55%, transparent 100%)',
  },
}

/**
 * Dedizierte Varianten für das Dashboard (Harmonisierte Singra-Tageszeitlandschaft).
 */
export const DASHBOARD_HEADER_HINTERGRUENDE: Record<Tageszeit, HeaderHintergrundVariante> = {
  morgen: {
    id: 'dashboard-morgen',
    pfad: '/assets/singra/singra-bg-morning.jpg',
    position: 'center 35%',
    ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, transparent 100%)',
  },
  tag: {
    id: 'dashboard-tag',
    pfad: '/assets/singra/singra-bg-day.jpg',
    position: 'center 45%',
    ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.08) 0%, rgba(15, 23, 42, 0.15) 55%, transparent 100%)',
  },
  abend: {
    id: 'dashboard-abend',
    pfad: '/assets/singra/singra-bg-evening.jpg',
    position: 'center 50%',
    ueberlagerung: 'linear-gradient(180deg, rgba(249, 115, 22, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, transparent 100%)',
  },
  nacht: {
    id: 'dashboard-nacht',
    pfad: '/assets/singra/singra-bg-night.jpg',
    position: 'center 40%',
    ueberlagerung: 'linear-gradient(180deg, rgba(14, 165, 233, 0.10) 0%, rgba(2, 6, 23, 0.35) 55%, transparent 100%)',
  },
}

/**
 * Dedizierte Varianten für den Kalender (Harmonisierte Singra-Tageszeitlandschaft).
 */
export const CALENDAR_HEADER_HINTERGRUENDE: Record<Tageszeit, HeaderHintergrundVariante> = {
  morgen: {
    id: 'calendar-morgen',
    pfad: '/assets/singra/singra-bg-morning.jpg',
    position: 'center 35%',
    ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, transparent 100%)',
  },
  tag: {
    id: 'calendar-tag',
    pfad: '/assets/singra/singra-bg-day.jpg',
    position: 'center 45%',
    ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.08) 0%, rgba(15, 23, 42, 0.15) 55%, transparent 100%)',
  },
  abend: {
    id: 'calendar-abend',
    pfad: '/assets/singra/singra-bg-evening.jpg',
    position: 'center 50%',
    ueberlagerung: 'linear-gradient(180deg, rgba(249, 115, 22, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, transparent 100%)',
  },
  nacht: {
    id: 'calendar-nacht',
    pfad: '/assets/singra/singra-bg-night.jpg',
    position: 'center 40%',
    ueberlagerung: 'linear-gradient(180deg, rgba(14, 165, 233, 0.10) 0%, rgba(2, 6, 23, 0.35) 55%, transparent 100%)',
  },
}

/**
 * Dedizierte Varianten für Notizen (Harmonisierte Singra-Tageszeitlandschaft).
 */
export const NOTES_HEADER_HINTERGRUENDE: Record<Tageszeit, HeaderHintergrundVariante> = {
  morgen: {
    id: 'notes-morgen',
    pfad: '/assets/singra/singra-bg-morning.jpg',
    position: 'center 35%',
    ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, transparent 100%)',
  },
  tag: {
    id: 'notes-tag',
    pfad: '/assets/singra/singra-bg-day.jpg',
    position: 'center 45%',
    ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.08) 0%, rgba(15, 23, 42, 0.15) 55%, transparent 100%)',
  },
  abend: {
    id: 'notes-abend',
    pfad: '/assets/singra/singra-bg-evening.jpg',
    position: 'center 50%',
    ueberlagerung: 'linear-gradient(180deg, rgba(249, 115, 22, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, transparent 100%)',
  },
  nacht: {
    id: 'notes-nacht',
    pfad: '/assets/singra/singra-bg-night.jpg',
    position: 'center 40%',
    ueberlagerung: 'linear-gradient(180deg, rgba(14, 165, 233, 0.10) 0%, rgba(2, 6, 23, 0.35) 55%, transparent 100%)',
  },
}

/**
 * Dedizierte Varianten für Maunting Docs (Harmonisierte Singra-Tageszeitlandschaft).
 */
export const DOCS_HEADER_HINTERGRUENDE: Record<Tageszeit, HeaderHintergrundVariante> = {
  morgen: {
    id: 'docs-morgen',
    pfad: '/assets/singra/singra-bg-morning.jpg',
    position: 'center 35%',
    ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, transparent 100%)',
  },
  tag: {
    id: 'docs-tag',
    pfad: '/assets/singra/singra-bg-day.jpg',
    position: 'center 45%',
    ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.08) 0%, rgba(15, 23, 42, 0.15) 55%, transparent 100%)',
  },
  abend: {
    id: 'docs-abend',
    pfad: '/assets/singra/singra-bg-evening.jpg',
    position: 'center 50%',
    ueberlagerung: 'linear-gradient(180deg, rgba(249, 115, 22, 0.12) 0%, rgba(14, 165, 233, 0.08) 50%, transparent 100%)',
  },
  nacht: {
    id: 'docs-nacht',
    pfad: '/assets/singra/singra-bg-night.jpg',
    position: 'center 40%',
    ueberlagerung: 'linear-gradient(180deg, rgba(14, 165, 233, 0.10) 0%, rgba(2, 6, 23, 0.35) 55%, transparent 100%)',
  },
}

export type HintergrundBereich =
  | 'standard'
  | 'teams'
  | 'dashboard'
  | 'calendar'
  | 'notes'
  | 'docs'
  | 'suche'

/**
 * Berechnet einen tagesbasierten Seed, der innerhalb eines Kalendertags konstant
 * bleibt. So wechselt das atmosphärische Motiv verlässlich jeden Tag, ohne bei jedem
 * Neuladen oder Seitenwechsel zu springen.
 */
export function tagesSeed(datum: Date = new Date()): number {
  const start = new Date(datum.getFullYear(), 0, 0)
  const diff = datum.getTime() - start.getTime()
  const tagDesJahres = Math.floor(diff / (1000 * 60 * 60 * 24))
  return datum.getFullYear() * 366 + tagDesJahres
}

function saisonalisieren(
  variante: HeaderHintergrundVariante,
  zeit: Tageszeit,
  saison: Jahreszeit,
): HeaderHintergrundVariante {
  if (saison === 'sommer') return variante
  const familie = variante.pfad.includes('/teams/') ? 'teams' : 'singra'
  return {
    ...variante,
    id: `${variante.id}-${saison}`,
    pfad: saisonBildFuerPhase(zeit, familie, saison),
  }
}

export function headerHintergrundWaehlen(
  stunde: number,
  zufall?: number,
  bereich?: HintergrundBereich,
  datum: Date = new Date(),
): HeaderHintergrundVariante {
  const zeit = tageszeit(stunde)
  const saison = jahreszeit(datum)
  if (bereich === 'teams') return saisonalisieren(TEAMS_HEADER_HINTERGRUENDE[zeit], zeit, saison)
  if (bereich === 'dashboard') return saisonalisieren(DASHBOARD_HEADER_HINTERGRUENDE[zeit], zeit, saison)
  if (bereich === 'calendar') return saisonalisieren(CALENDAR_HEADER_HINTERGRUENDE[zeit], zeit, saison)
  if (bereich === 'notes') return saisonalisieren(NOTES_HEADER_HINTERGRUENDE[zeit], zeit, saison)
  if (bereich === 'docs') return saisonalisieren(DOCS_HEADER_HINTERGRUENDE[zeit], zeit, saison)
  const liste = HEADER_HINTERGRUENDE[zeit]
  const zaehler = typeof zufall === 'number' && !isNaN(zufall) ? zufall : tagesSeed(datum)
  const index = Math.abs(Math.floor(zaehler)) % liste.length
  return saisonalisieren(liste[index], zeit, saison)
}

/**
 * Zentraler React-Hook für tageszeit-, jahreszeit- und bereichsabhängige Hintergrundbilder.
 *
 * Aktualisiert sich minütlich bei Stunden- oder Jahreszeitwechseln (z. B. Dämmerung / Abend / Monatswechsel)
 * und bleibt innerhalb eines Tages durch den Tages-Seed stabil.
 */
export function useTageszeitMotiv(
  bereich: HintergrundBereich = 'standard',
  datum?: Date,
): HeaderHintergrundVariante {
  const [jetzt, setJetzt] = useState(() => datum ?? new Date())

  useEffect(() => {
    if (datum) return
    const timer = window.setInterval(() => {
      const aktuell = new Date()
      setJetzt((prev) =>
        prev.getHours() !== aktuell.getHours()
        || prev.getDate() !== aktuell.getDate()
        || prev.getMonth() !== aktuell.getMonth()
          ? aktuell
          : prev,
      )
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [datum])

  const stunde = (datum ?? jetzt).getHours()
  const seed = tagesSeed(datum ?? jetzt)
  const monat = (datum ?? jetzt).getMonth()
  return useMemo(
    () => headerHintergrundWaehlen(stunde, seed, bereich, datum ?? jetzt),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stunde, seed, monat, bereich],
  )
}

/**
 * Ermittelt das primäre Tageszeit- und Jahreszeit-Hintergrundbild aus Singra.
 */
export function ermittleTageszeitBild(
  stunde: number = new Date().getHours(),
  datum: Date = new Date(),
): string {
  return saisonBildFuerPhase(tageszeit(stunde), 'singra', jahreszeit(datum))
}

/** Live-Bildpfad nach Tageszeit und Jahreszeit für Chat/KI (`dynamic_time`). */
export function useTageszeitBild(aktiv: boolean = true): string {
  const [jetzt, setJetzt] = useState(() => new Date())

  useEffect(() => {
    if (!aktiv) return
    const timer = window.setInterval(() => {
      const aktuell = new Date()
      setJetzt((prev) =>
        prev.getHours() !== aktuell.getHours() || prev.getMonth() !== aktuell.getMonth()
          ? aktuell
          : prev,
      )
    }, 60_000)
    return () => window.clearInterval(timer)
  }, [aktiv])

  return ermittleTageszeitBild(jetzt.getHours(), jetzt)
}

/**
 * Schlüssel der Begrüßung. Die Variante wird täglich einmal bestimmt, damit
 * die Zeile konsistent bleibt und trotzdem von Tag zu Tag rotiert.
 */
export function begruessungSchluessel(stunde: number, kurz: boolean = false, zufall?: number): string {
  const zeit = tageszeit(stunde)
  if (kurz) return `common.begruessung.${zeit}Kurz`
  const zaehler = typeof zufall === 'number' && !isNaN(zufall) ? zufall : tagesSeed()
  const variant = (Math.abs(Math.floor(zaehler)) % 5) + 1
  return `common.begruessung.${zeit}${variant}`
}
