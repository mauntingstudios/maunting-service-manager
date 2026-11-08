/**
 * Tageszeit-Szenen und Begrüßungen: 4 Tageszeiten × je 5 Varianten. Gemeinsame
 * Quelle für `TageszeitBanner`, `TageszeitKulisse` und das Tresor-Dashboard.
 */

export type Tageszeit = 'morgen' | 'tag' | 'abend' | 'nacht'

export function tageszeit(stunde: number): Tageszeit {
  if (stunde >= 5 && stunde < 11) return 'morgen'
  if (stunde >= 11 && stunde < 17) return 'tag'
  if (stunde >= 17 && stunde < 22) return 'abend'
  return 'nacht'
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
    ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.15) 0%, rgba(14, 165, 233, 0.12) 48%, transparent 100%)',
  },
  tag: {
    id: 'teams-tag',
    pfad: '/assets/teams/teams-bg-day.jpg',
    position: 'center 45%',
    ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.15) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
  },
  abend: {
    id: 'teams-abend',
    pfad: '/assets/teams/teams-bg-evening.jpg',
    position: 'center 50%',
    ueberlagerung: 'linear-gradient(180deg, rgba(249, 115, 22, 0.16) 0%, rgba(14, 165, 233, 0.12) 50%, transparent 100%)',
  },
  nacht: {
    id: 'teams-nacht',
    pfad: '/assets/teams/teams-bg-night.jpg',
    position: 'center 40%',
    ueberlagerung: 'linear-gradient(180deg, rgba(14, 165, 233, 0.18) 0%, rgba(2, 6, 23, 0.50) 55%, transparent 100%)',
  },
}

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

export function headerHintergrundWaehlen(
  stunde: number,
  zufall?: number,
  bereich?: 'standard' | 'teams',
): HeaderHintergrundVariante {
  const zeit = tageszeit(stunde)
  if (bereich === 'teams') {
    return TEAMS_HEADER_HINTERGRUENDE[zeit]
  }
  const liste = HEADER_HINTERGRUENDE[zeit]
  const zaehler = typeof zufall === 'number' && !isNaN(zufall) ? zufall : tagesSeed()
  const index = Math.abs(Math.floor(zaehler)) % liste.length
  return liste[index]
}

/**
 * Ermittelt das primäre Tageszeit-Hintergrundbild aus Singra (exakt wie im KI-Chat).
 */
export function ermittleTageszeitBild(stunde: number = new Date().getHours()): string {
  if (stunde >= 5 && stunde < 11) return '/assets/singra/singra-bg-morning.jpg'
  if (stunde >= 11 && stunde < 17) return '/assets/singra/singra-bg-day.jpg'
  if (stunde >= 17 && stunde < 22) return '/assets/singra/singra-bg-evening.jpg'
  return '/assets/singra/singra-bg-night.jpg'
}

/**
 * Schlüssel der Begrüßung. Die Variante wird täglich einmal bestimmt, damit
 * die Zeile konsistent bleibt und trotzdem von Tag zu Tag rotiert.
 */
export function begruessungSchluessel(stunde: number, kurz: boolean, zufall?: number): string {
  const zeit = tageszeit(stunde)
  if (kurz) return `common.begruessung.${zeit}Kurz`
  const zaehler = typeof zufall === 'number' && !isNaN(zufall) ? zufall : tagesSeed()
  const variant = (Math.abs(Math.floor(zaehler)) % 5) + 1
  return `common.begruessung.${zeit}${variant}`
}
