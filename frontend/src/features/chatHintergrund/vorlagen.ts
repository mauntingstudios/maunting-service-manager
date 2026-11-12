import { Compass, Flower2, Layers, Leaf, Moon, RotateCcw, Snowflake, Sparkles, Sun, SunMoon, Sunrise, Sunset } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { LucideIcon } from 'lucide-react'

/**
 * Der Katalog der Hintergründe — die **einzige** Stelle, an der eine Vorlage
 * beschrieben steht.
 *
 * Vorher gab es jede Vorlage zweimal: einmal als Vorschaukachel im
 * Einstellungsfenster und einmal als echte Schicht im Chat. Zwei Fassungen
 * desselben Farbverlaufs sind zwei Wahrheiten darüber, wie „Deep Petrol"
 * aussieht — wer eine davon ändert, ändert die Vorschau oder den Chat, nie
 * beides. Darum steht hier `klassen`/`stil` einmal, und sowohl die Kachel als
 * auch die Schicht zeichnen daraus (siehe `HintergrundFlaeche`).
 *
 * Eine neue Vorlage ist damit ein Eintrag in dieser Liste, sonst nichts:
 * Auswahlfenster und Chat kennen sie beide sofort.
 */
export type HintergrundVorlageId =
  | 'cyber'
  | 'petrol'
  | 'midnight'
  | 'minimal'
  | 'dynamic_time'
  | 'singra_morning'
  | 'singra_day'
  | 'singra_evening'
  | 'singra_night'
  | 'singra_spring_morning'
  | 'singra_spring_day'
  | 'singra_spring_evening'
  | 'singra_spring_night'
  | 'singra_autumn_morning'
  | 'singra_autumn_day'
  | 'singra_autumn_evening'
  | 'singra_autumn_night'
  | 'singra_winter_morning'
  | 'singra_winter_day'
  | 'singra_winter_evening'
  | 'singra_winter_night'

/** Die Vorlagen plus „eigenes Bild" — alles, was als Hintergrund stehen kann. */
export type HintergrundId = HintergrundVorlageId | 'custom'

export interface HintergrundVorlage {
  id: HintergrundVorlageId
  /**
   * i18n-Schlüssel, keine fertigen Sätze: der Katalog wird beim Laden des
   * Moduls ausgewertet, ein `t()` von dort stünde nach jedem Sprachwechsel
   * in der alten Sprache.
   *
   * Der Namensraum heisst weiterhin `social.wallpaper.*`. Die Texte sind
   * dieselben geblieben; ein Umzug in `chat.hintergrund.*` hätte nur
   * Übersetzungen verschoben und die alten Schlüssel zu Karteileichen
   * gemacht (siehe `locales/retiredKeys.test.ts`).
   */
  nameKey: string
  hinweisKey: string
  /** Das Zeichen auf der Auswahlkachel. */
  icon: LucideIcon
  /**
   * Die Farbe des Zeichens auf der Kachel. Nur gesetzt, wo sie vom
   * Üblichen abweicht — „Schlicht dunkel" trägt bewusst kein Primärgrün,
   * die Kachel soll aussehen wie das, was sie verspricht.
   */
  iconKlassen?: string
  /** Die Fläche selbst, absolut über dem Chatbereich liegend. */
  klassen: string
  /** Was sich nicht als Klasse schreiben lässt — heute nur das Datenraster. */
  stil?: CSSProperties
  /** Ob die Vorlage ein Bild verwendet */
  bildUrl?: string
}

export const HINTERGRUND_VORLAGEN: readonly HintergrundVorlage[] = [
  {
    id: 'dynamic_time',
    nameKey: 'social.wallpaper.dynamicTime',
    hinweisKey: 'social.wallpaper.dynamicTimeHint',
    icon: SunMoon,
    klassen: 'object-cover object-center',
  },
  {
    id: 'singra_morning',
    nameKey: 'social.wallpaper.singraMorning',
    hinweisKey: 'social.wallpaper.singraMorningHint',
    icon: Sunrise,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/singra-bg-morning.jpg',
  },
  {
    id: 'singra_day',
    nameKey: 'social.wallpaper.singraDay',
    hinweisKey: 'social.wallpaper.singraDayHint',
    icon: Sun,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/singra-bg-day.jpg',
  },
  {
    id: 'singra_evening',
    nameKey: 'social.wallpaper.singraEvening',
    hinweisKey: 'social.wallpaper.singraEveningHint',
    icon: Sunset,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/singra-bg-evening.jpg',
  },
  {
    id: 'singra_night',
    nameKey: 'social.wallpaper.singraNight',
    hinweisKey: 'social.wallpaper.singraNightHint',
    icon: Moon,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/singra-bg-night.jpg',
  },
  {
    id: 'singra_spring_morning',
    nameKey: 'social.wallpaper.singraSpringMorning',
    hinweisKey: 'social.wallpaper.singraSpringMorningHint',
    icon: Flower2,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/fruehling/singra-bg-morning.jpg',
  },
  {
    id: 'singra_spring_day',
    nameKey: 'social.wallpaper.singraSpringDay',
    hinweisKey: 'social.wallpaper.singraSpringDayHint',
    icon: Flower2,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/fruehling/singra-bg-day.jpg',
  },
  {
    id: 'singra_spring_evening',
    nameKey: 'social.wallpaper.singraSpringEvening',
    hinweisKey: 'social.wallpaper.singraSpringEveningHint',
    icon: Flower2,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/fruehling/singra-bg-evening.jpg',
  },
  {
    id: 'singra_spring_night',
    nameKey: 'social.wallpaper.singraSpringNight',
    hinweisKey: 'social.wallpaper.singraSpringNightHint',
    icon: Flower2,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/fruehling/singra-bg-night.jpg',
  },
  {
    id: 'singra_autumn_morning',
    nameKey: 'social.wallpaper.singraAutumnMorning',
    hinweisKey: 'social.wallpaper.singraAutumnMorningHint',
    icon: Leaf,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/herbst/singra-bg-morning.jpg',
  },
  {
    id: 'singra_autumn_day',
    nameKey: 'social.wallpaper.singraAutumnDay',
    hinweisKey: 'social.wallpaper.singraAutumnDayHint',
    icon: Leaf,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/herbst/singra-bg-day.jpg',
  },
  {
    id: 'singra_autumn_evening',
    nameKey: 'social.wallpaper.singraAutumnEvening',
    hinweisKey: 'social.wallpaper.singraAutumnEveningHint',
    icon: Leaf,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/herbst/singra-bg-evening.jpg',
  },
  {
    id: 'singra_autumn_night',
    nameKey: 'social.wallpaper.singraAutumnNight',
    hinweisKey: 'social.wallpaper.singraAutumnNightHint',
    icon: Leaf,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/herbst/singra-bg-night.jpg',
  },
  {
    id: 'singra_winter_morning',
    nameKey: 'social.wallpaper.singraWinterMorning',
    hinweisKey: 'social.wallpaper.singraWinterMorningHint',
    icon: Snowflake,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/winter/singra-bg-morning.jpg',
  },
  {
    id: 'singra_winter_day',
    nameKey: 'social.wallpaper.singraWinterDay',
    hinweisKey: 'social.wallpaper.singraWinterDayHint',
    icon: Snowflake,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/winter/singra-bg-day.jpg',
  },
  {
    id: 'singra_winter_evening',
    nameKey: 'social.wallpaper.singraWinterEvening',
    hinweisKey: 'social.wallpaper.singraWinterEveningHint',
    icon: Snowflake,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/winter/singra-bg-evening.jpg',
  },
  {
    id: 'singra_winter_night',
    nameKey: 'social.wallpaper.singraWinterNight',
    hinweisKey: 'social.wallpaper.singraWinterNightHint',
    icon: Snowflake,
    klassen: 'object-cover object-center',
    bildUrl: '/assets/singra/jahreszeiten/winter/singra-bg-night.jpg',
  },
  {
    id: 'cyber',
    nameKey: 'social.wallpaper.cyber',
    hinweisKey: 'social.wallpaper.cyberHint',
    icon: Layers,
    klassen: 'opacity-20',
    stil: {
      backgroundImage: 'radial-gradient(#06b6d4 1.2px, transparent 1.2px)',
      backgroundSize: '16px 16px',
    },
  },
  {
    id: 'petrol',
    nameKey: 'social.wallpaper.petrol',
    hinweisKey: 'social.wallpaper.petrolHint',
    icon: Compass,
    klassen: 'bg-gradient-to-br from-[#06181d] via-[#092228] to-[#040e11]',
  },
  {
    id: 'midnight',
    nameKey: 'social.wallpaper.midnight',
    hinweisKey: 'social.wallpaper.midnightHint',
    icon: Sparkles,
    klassen: 'bg-gradient-to-br from-[#0c1322] via-[#090e1a] to-[#040810]',
  },
  {
    id: 'minimal',
    nameKey: 'social.wallpaper.minimal',
    hinweisKey: 'social.wallpaper.minimalHint',
    icon: RotateCcw,
    iconKlassen: 'bg-surface-container-highest text-on-surface-variant',
    klassen: 'bg-surface-container-lowest',
  },
]

/** Welche Vorlage steht, wenn niemand etwas gewählt hat. */
export const STANDARD_VORLAGE: HintergrundVorlageId = 'dynamic_time'
export const STANDARD_VORLAGE_KI: HintergrundVorlageId = 'dynamic_time'

export const MESSENGER_VORLAGEN_IDS: readonly HintergrundVorlageId[] = [
  'dynamic_time',
  'singra_morning',
  'singra_day',
  'singra_evening',
  'singra_night',
  'singra_spring_morning',
  'singra_spring_day',
  'singra_spring_evening',
  'singra_spring_night',
  'singra_autumn_morning',
  'singra_autumn_day',
  'singra_autumn_evening',
  'singra_autumn_night',
  'singra_winter_morning',
  'singra_winter_day',
  'singra_winter_evening',
  'singra_winter_night',
]

export const KI_VORLAGEN_IDS: readonly HintergrundVorlageId[] = [
  'dynamic_time',
  'singra_morning',
  'singra_day',
  'singra_evening',
  'singra_night',
  'singra_spring_morning',
  'singra_spring_day',
  'singra_spring_evening',
  'singra_spring_night',
  'singra_autumn_morning',
  'singra_autumn_day',
  'singra_autumn_evening',
  'singra_autumn_night',
  'singra_winter_morning',
  'singra_winter_day',
  'singra_winter_evening',
  'singra_winter_night',
]

export function vorlageMitId(id: HintergrundId): HintergrundVorlage | undefined {
  return HINTERGRUND_VORLAGEN.find((vorlage) => vorlage.id === id)
}
