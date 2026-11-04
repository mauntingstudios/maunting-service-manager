/**
 * Kennzahlen der Tresor-Übersicht. Reine Funktionen über dem entschlüsselten
 * Bestand, ohne Store, Netz oder Zeitquelle von außen — dadurch prüfbar und
 * überall gleich gerechnet.
 *
 * Die Zahlen sind bewusst das, was aus den vorhandenen Daten ableitbar ist.
 * Es gibt keine erfundene Sicherheitsbewertung: „Tresor-Sicherheit“ ist die
 * Passwortqualität nach Länge und Zeichenvielfalt, gemindert um mehrfach
 * verwendete Passwörter. Gefundene Datenlecks zählen nur, wenn der
 * Sicherheitscheck tatsächlich gelaufen ist.
 */
import { istBekannteKategorie, type VaultItem } from './vaultEintrag'

const TAG = 24 * 60 * 60 * 1000

export const TRESOR_FILTER = ['alle', 'passwoerter', 'notizen', 'karten', 'dateien'] as const
export type TresorFilter = (typeof TRESOR_FILTER)[number]

/** Sammelbehälter zählen nicht als eigener Eintrag; ihr Inhalt zählt. */
const BEHAELTER = new Set(['ordner', 'album'])

export function istSichtbar(item: VaultItem): boolean {
  return istBekannteKategorie(item.category) && !item.trashedAt && !item.archivedAt
}

export function sichtbareEintraege(items: VaultItem[]): VaultItem[] {
  return items.filter(istSichtbar)
}

export function passtZumFilter(item: VaultItem, filter: TresorFilter): boolean {
  const kategorie = item.category ?? 'login'
  switch (filter) {
    case 'alle':
      return true
    case 'passwoerter':
      return kategorie === 'login' || kategorie === 'authenticator'
    case 'notizen':
      return kategorie === 'secure_note'
    case 'karten':
      return kategorie === 'zahlung'
    case 'dateien':
      return kategorie === 'datei' || kategorie === 'album' || kategorie === 'ordner'
  }
}

export function zaehleEintraege(items: VaultItem[]): number {
  return sichtbareEintraege(items).filter((item) => !BEHAELTER.has(item.category ?? 'login')).length
}

/** Wie viele sichtbare Einträge in den letzten sieben Tagen entstanden sind. */
export function dieseWoche(items: VaultItem[], jetzt = Date.now()): number {
  const grenze = jetzt - 7 * TAG
  return sichtbareEintraege(items).filter((item) => item.createdAt >= grenze && item.createdAt <= jetzt).length
}

/**
 * Passwortqualität 0–100 aus Länge (maximal 24 Zeichen zählen voll) und
 * Zeichenvielfalt. Sehr kurze oder immer gleiche Passwörter bleiben niedrig.
 */
export function passwortPunkte(passwort: string): number {
  if (!passwort) return 0
  const laenge = Math.min(passwort.length, 24) / 24
  const vielfalt = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((muster) => muster.test(passwort)).length
  let punkte = Math.round(laenge * 55 + (vielfalt / 4) * 45)
  if (/(.)\1{2,}/.test(passwort)) punkte -= 10
  if (/^(?:123|abc|qwe|pass|admin|test)/i.test(passwort)) punkte -= 15
  return Math.max(0, Math.min(100, punkte))
}

export interface TresorSicherheit {
  /** null, solange kein Passwort vorliegt — dann gibt es nichts zu bewerten. */
  prozent: number | null
  anzahl: number
  schwach: number
  mehrfach: number
}

export function tresorSicherheit(items: VaultItem[]): TresorSicherheit {
  const passwoerter = sichtbareEintraege(items).filter(
    (item) => (item.category ?? 'login') === 'login' && item.password,
  )
  if (passwoerter.length === 0) return { prozent: null, anzahl: 0, schwach: 0, mehrfach: 0 }

  const punkte = passwoerter.map((item) => passwortPunkte(item.password))
  const durchschnitt = punkte.reduce((summe, wert) => summe + wert, 0) / punkte.length

  const gezaehlt = new Map<string, number>()
  for (const item of passwoerter) gezaehlt.set(item.password, (gezaehlt.get(item.password) ?? 0) + 1)
  const mehrfach = [...gezaehlt.values()].reduce((summe, zahl) => summe + Math.max(0, zahl - 1), 0)

  // Ein geteiltes Passwort wiegt schwerer als ein einzelnes schwaches: es
  // öffnet mehrere Konten auf einmal. Abzug gedeckelt, damit die Zahl nicht
  // unter null fällt und die Anzeige ehrlich bleibt.
  const prozent = Math.max(0, Math.round(durchschnitt - Math.min(30, mehrfach * 10)))
  return {
    prozent,
    anzahl: passwoerter.length,
    schwach: punkte.filter((wert) => wert < 50).length,
    mehrfach,
  }
}

export type SicherheitsStufe = 'sehrGut' | 'gut' | 'mittel' | 'schwach'

export function sicherheitsStufe(prozent: number | null): SicherheitsStufe | null {
  if (prozent == null) return null
  if (prozent >= 85) return 'sehrGut'
  if (prozent >= 65) return 'gut'
  if (prozent >= 40) return 'mittel'
  return 'schwach'
}

export type TresorSortierung = 'zuletzt' | 'alphabetisch' | 'neueste'

export function sortiereEintraege(items: VaultItem[], sortierung: TresorSortierung): VaultItem[] {
  const kopie = [...items]
  switch (sortierung) {
    case 'alphabetisch':
      return kopie.sort((a, b) => (a.service || '').localeCompare(b.service || '', 'de'))
    case 'neueste':
      return kopie.sort((a, b) => (b.createdAt ?? b.updatedAt) - (a.createdAt ?? a.updatedAt))
    case 'zuletzt':
    default:
      return kopie.sort((a, b) => (b.lastUsedAt ?? b.updatedAt) - (a.lastUsedAt ?? a.updatedAt))
  }
}

export const KATEGORIE_HINTERGRUENDE = [
  { id: 'bergsee', pfad: '/hintergruende/bergsee.webp', label: 'Bergsee & Konten' },
  { id: 'bergwald', pfad: '/hintergruende/bergwald.webp', label: 'Arbeit & Studio' },
  { id: 'sonnensystem', pfad: '/hintergruende/sonnensystem.webp', label: 'Gaming & Kosmos' },
  { id: 'ozean', pfad: '/hintergruende/ozean.webp', label: 'Finanzen & Ozean' },
  { id: 'feld', pfad: '/hintergruende/feld.webp', label: 'Persönliches & Weite' },
  { id: 'wasserfaelle', pfad: '/hintergruende/wasserfaelle.webp', label: 'Wasserfälle & Natur' },
  { id: 'erde', pfad: '/hintergruende/erde.webp', label: 'Orbit & Cloud' },
  { id: 'mars', pfad: '/hintergruende/mars.webp', label: 'Horizont & Projekte' },
] as const

export interface StandardKategorieDef {
  schluessel: 'accounts' | 'arbeit' | 'gaming' | 'finanzen' | 'persoenliches'
  i18nKey: string
  standardBild: string
  akzentFarbe: string
  suchbegriffe: RegExp
}

export const STANDARD_KATEGORIEN: StandardKategorieDef[] = [
  {
    schluessel: 'accounts',
    i18nKey: 'mss.vault.dashboard.standardKategorien.accounts',
    standardBild: '/hintergruende/erde.webp',
    akzentFarbe: 'linear-gradient(135deg, rgba(14, 165, 233, 0.28) 0%, rgba(2, 6, 23, 0.88) 100%)',
    suchbegriffe: /google|apple|microsoft|icloud|mail|proton|meta|instagram|facebook|twitter|reddit|amazon|konto|account/i,
  },
  {
    schluessel: 'arbeit',
    i18nKey: 'mss.vault.dashboard.standardKategorien.arbeit',
    standardBild: '/hintergruende/bergwald.webp',
    akzentFarbe: 'linear-gradient(135deg, rgba(16, 185, 129, 0.26) 0%, rgba(2, 6, 23, 0.88) 100%)',
    suchbegriffe: /github|gitlab|vercel|cloudflare|docker|aws|azure|hetzner|jira|linear|slack|notion|figma|server|projekt|work|arbeit|dev/i,
  },
  {
    schluessel: 'gaming',
    i18nKey: 'mss.vault.dashboard.standardKategorien.gaming',
    standardBild: '/hintergruende/sonnensystem.webp',
    akzentFarbe: 'linear-gradient(135deg, rgba(99, 102, 241, 0.30) 0%, rgba(2, 6, 23, 0.88) 100%)',
    suchbegriffe: /steam|discord|epic|riot|playstation|xbox|nintendo|ubisoft|ea|battlenet|blizzard|twitch|minecraft|game|gaming/i,
  },
  {
    schluessel: 'finanzen',
    i18nKey: 'mss.vault.dashboard.standardKategorien.finanzen',
    standardBild: '/hintergruende/ozean.webp',
    akzentFarbe: 'linear-gradient(135deg, rgba(6, 182, 212, 0.28) 0%, rgba(2, 6, 23, 0.88) 100%)',
    suchbegriffe: /revolut|paypal|stripe|klarna|wise|sparkasse|ing|dkb|n26|comdirect|trade|scalable|bank|visa|mastercard|finanz/i,
  },
  {
    schluessel: 'persoenliches',
    i18nKey: 'mss.vault.dashboard.standardKategorien.persoenliches',
    standardBild: '/hintergruende/bergsee.webp',
    akzentFarbe: 'linear-gradient(135deg, rgba(245, 158, 11, 0.24) 0%, rgba(2, 6, 23, 0.88) 100%)',
    suchbegriffe: /notiz|privat|familie|gesundheit|reise|wohnung|vertrag|id|ausweis|persoenlich|personal/i,
  },
]

export interface Sammlung {
  id: string
  name: string
  anzahl: number
  neuester: VaultItem | null
  titelbild?: string
  akzentFarbe?: string
  istStandard?: boolean
  standardSchluessel?: StandardKategorieDef['schluessel']
}

/**
 * Top-Ordner mit Inhalt. Unterordner erscheinen als eigene Sammlung, so wie
 * sie im Tresor liegen; die Auswahl zeigt danach genau ihren Inhalt.
 */
export function sammlungen(items: VaultItem[], jetzt = Date.now()): Sammlung[] {
  const sichtbar = sichtbareEintraege(items)
  return sichtbar
    .filter((item) => item.category === 'ordner')
    .map((ordner, idx) => {
      const inhalt = sichtbar.filter((item) => item.ordner === ordner.id)
      const neuester = inhalt.reduce<VaultItem | null>(
        (bisher, item) => (!bisher || item.updatedAt > bisher.updatedAt ? item : bisher),
        null,
      )
      const gespeichertesBild =
        typeof ordner.extra?.titelbild === 'string' && ordner.extra.titelbild.trim().length > 0
          ? ordner.extra.titelbild
          : KATEGORIE_HINTERGRUENDE[idx % KATEGORIE_HINTERGRUENDE.length].pfad
      return {
        id: ordner.id,
        name: ordner.service,
        anzahl: inhalt.length,
        neuester,
        titelbild: gespeichertesBild,
      }
    })
    .sort((a, b) => (b.neuester?.updatedAt ?? jetzt) - (a.neuester?.updatedAt ?? jetzt))
}

export function zuletztVerwendet(items: VaultItem[], anzahl = 5): VaultItem[] {
  return sortiereEintraege(
    sichtbareEintraege(items).filter((item) => !BEHAELTER.has(item.category ?? 'login')),
    'zuletzt',
  ).slice(0, anzahl)
}

/** Freigegebene Geräte zählen; wartende Geräte haben noch keinen Zugang. */
export function geraeteMitZugang(geraete: { is_approved?: boolean }[] | null): number | null {
  if (!geraete) return null
  return geraete.filter((geraet) => geraet.is_approved !== false).length
}

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
 * Jede Variante nutzt ein lokales Hintergrundbild aus `/hintergruende/` mit
 * passendem Bildausschnitt und atmosphärischer Lichtstimmung.
 */
export const HEADER_HINTERGRUENDE: Record<Tageszeit, readonly HeaderHintergrundVariante[]> = {
  morgen: [
    {
      id: 'morgen-1',
      pfad: '/hintergruende/bergsee.webp',
      position: 'center 35%',
      ueberlagerung: 'linear-gradient(180deg, rgba(251, 191, 36, 0.14) 0%, rgba(14, 165, 233, 0.12) 45%, transparent 100%)',
    },
    {
      id: 'morgen-2',
      pfad: '/hintergruende/feld.webp',
      position: 'center 42%',
      ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.16) 0%, rgba(56, 189, 248, 0.10) 50%, transparent 100%)',
    },
    {
      id: 'morgen-3',
      pfad: '/hintergruende/wasserfaelle.webp',
      position: 'center 30%',
      ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.16) 0%, rgba(16, 185, 129, 0.10) 50%, transparent 100%)',
    },
    {
      id: 'morgen-4',
      pfad: '/hintergruende/bergwald.webp',
      position: 'center 28%',
      ueberlagerung: 'linear-gradient(180deg, rgba(251, 191, 36, 0.12) 0%, rgba(20, 184, 166, 0.12) 50%, transparent 100%)',
    },
    {
      id: 'morgen-5',
      pfad: '/hintergruende/ozean.webp',
      position: 'center 38%',
      ueberlagerung: 'linear-gradient(180deg, rgba(253, 186, 116, 0.15) 0%, rgba(14, 165, 233, 0.14) 50%, transparent 100%)',
    },
  ],
  tag: [
    {
      id: 'tag-1',
      pfad: '/hintergruende/bergsee.webp',
      position: 'center 50%',
      ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.16) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
    },
    {
      id: 'tag-2',
      pfad: '/hintergruende/wasserfaelle.webp',
      position: 'center 48%',
      ueberlagerung: 'linear-gradient(180deg, rgba(34, 211, 238, 0.15) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
    },
    {
      id: 'tag-3',
      pfad: '/hintergruende/ozean.webp',
      position: 'center 52%',
      ueberlagerung: 'linear-gradient(180deg, rgba(14, 165, 233, 0.18) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
    },
    {
      id: 'tag-4',
      pfad: '/hintergruende/bergwald.webp',
      position: 'center 45%',
      ueberlagerung: 'linear-gradient(180deg, rgba(45, 212, 191, 0.14) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
    },
    {
      id: 'tag-5',
      pfad: '/hintergruende/feld.webp',
      position: 'center 55%',
      ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.14) 0%, rgba(15, 23, 42, 0.25) 55%, transparent 100%)',
    },
  ],
  abend: [
    {
      id: 'abend-1',
      pfad: '/hintergruende/mars.webp',
      position: 'center 45%',
      ueberlagerung: 'linear-gradient(180deg, rgba(245, 158, 11, 0.18) 0%, rgba(225, 29, 72, 0.12) 48%, transparent 100%)',
    },
    {
      id: 'abend-2',
      pfad: '/hintergruende/bergsee.webp',
      position: 'center 62%',
      ueberlagerung: 'linear-gradient(180deg, rgba(249, 115, 22, 0.16) 0%, rgba(14, 165, 233, 0.12) 50%, transparent 100%)',
    },
    {
      id: 'abend-3',
      pfad: '/hintergruende/feld.webp',
      position: 'center 65%',
      ueberlagerung: 'linear-gradient(180deg, rgba(217, 119, 6, 0.18) 0%, rgba(30, 41, 59, 0.35) 55%, transparent 100%)',
    },
    {
      id: 'abend-4',
      pfad: '/hintergruende/ozean.webp',
      position: 'center 64%',
      ueberlagerung: 'linear-gradient(180deg, rgba(244, 63, 94, 0.14) 0%, rgba(14, 165, 233, 0.14) 50%, transparent 100%)',
    },
    {
      id: 'abend-5',
      pfad: '/hintergruende/bergwald.webp',
      position: 'center 60%',
      ueberlagerung: 'linear-gradient(180deg, rgba(234, 88, 12, 0.15) 0%, rgba(15, 23, 42, 0.35) 55%, transparent 100%)',
    },
  ],
  nacht: [
    {
      id: 'nacht-1',
      pfad: '/hintergruende/sonnensystem.webp',
      position: 'center 45%',
      ueberlagerung: 'linear-gradient(180deg, rgba(56, 189, 248, 0.14) 0%, rgba(15, 23, 42, 0.45) 55%, transparent 100%)',
    },
    {
      id: 'nacht-2',
      pfad: '/hintergruende/erde.webp',
      position: 'center 40%',
      ueberlagerung: 'linear-gradient(180deg, rgba(14, 165, 233, 0.18) 0%, rgba(2, 6, 23, 0.50) 55%, transparent 100%)',
    },
    {
      id: 'nacht-3',
      pfad: '/hintergruende/bergsee.webp',
      position: 'center 25%',
      ueberlagerung: 'linear-gradient(180deg, rgba(30, 58, 138, 0.24) 0%, rgba(2, 6, 23, 0.55) 55%, transparent 100%)',
    },
    {
      id: 'nacht-4',
      pfad: '/hintergruende/bergwald.webp',
      position: 'center 22%',
      ueberlagerung: 'linear-gradient(180deg, rgba(14, 116, 144, 0.20) 0%, rgba(2, 6, 23, 0.55) 55%, transparent 100%)',
    },
    {
      id: 'nacht-5',
      pfad: '/hintergruende/ozean.webp',
      position: 'center 25%',
      ueberlagerung: 'linear-gradient(180deg, rgba(2, 132, 199, 0.18) 0%, rgba(2, 6, 23, 0.55) 55%, transparent 100%)',
    },
  ],
}

export function headerHintergrundWaehlen(stunde: number, zufall: number): HeaderHintergrundVariante {
  const zeit = tageszeit(stunde)
  const liste = HEADER_HINTERGRUENDE[zeit]
  const index = Math.abs(Math.floor(zufall)) % liste.length
  return liste[index]
}

/**
 * Schlüssel der Begrüßung. Die Variante wird einmal je Sitzung gewählt, damit
 * die Zeile nicht bei jedem Neuzeichnen springt.
 */
export function begruessungSchluessel(stunde: number, kurz: boolean, zufall: number): string {
  const zeit = tageszeit(stunde)
  if (kurz) return `mss.vault.dashboard.begruessung.${zeit}Kurz`
  const variant = (Math.abs(Math.floor(zufall)) % 5) + 1
  return `mss.vault.dashboard.begruessung.${zeit}${variant}`
}
