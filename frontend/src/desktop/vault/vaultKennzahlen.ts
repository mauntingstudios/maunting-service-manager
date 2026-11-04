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
  { id: 'accounts', pfad: '/tresor-kategorien/accounts.webp', label: 'Accounts & Logins' },
  { id: 'arbeit', pfad: '/tresor-kategorien/arbeit.webp', label: 'Arbeit & Projekte' },
  { id: 'gaming', pfad: '/tresor-kategorien/gaming.webp', label: 'Gaming' },
  { id: 'finanzen', pfad: '/tresor-kategorien/finanzen.webp', label: 'Finanzen & Karten' },
  { id: 'persoenliches', pfad: '/tresor-kategorien/persoenliches.webp', label: 'Persönliches' },
  { id: 'server', pfad: '/tresor-kategorien/server.webp', label: 'Server & Infrastruktur' },
  { id: 'entwicklung', pfad: '/tresor-kategorien/entwicklung.webp', label: 'Entwicklung & Code' },
  { id: 'studio', pfad: '/tresor-kategorien/studio.webp', label: 'Studio & Produktion' },
  { id: 'reisen', pfad: '/tresor-kategorien/reisen.webp', label: 'Reisen & Unterwegs' },
  { id: 'shopping', pfad: '/tresor-kategorien/shopping.webp', label: 'Shopping & Handel' },
  { id: 'smarthome', pfad: '/tresor-kategorien/smarthome.webp', label: 'Smart Home & Wohnen' },
  { id: 'medien', pfad: '/tresor-kategorien/medien.webp', label: 'Medien & Audio' },
  { id: 'krypto', pfad: '/tresor-kategorien/krypto.webp', label: 'Krypto & Netzwerk' },
  { id: 'dokumente', pfad: '/tresor-kategorien/dokumente.webp', label: 'Verträge & Dokumente' },
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
    standardBild: '/tresor-kategorien/accounts.webp',
    akzentFarbe: 'linear-gradient(135deg, rgba(14, 165, 233, 0.28) 0%, rgba(2, 6, 23, 0.88) 100%)',
    suchbegriffe: /google|apple|microsoft|icloud|mail|proton|meta|instagram|facebook|twitter|reddit|amazon|konto|account/i,
  },
  {
    schluessel: 'arbeit',
    i18nKey: 'mss.vault.dashboard.standardKategorien.arbeit',
    standardBild: '/tresor-kategorien/arbeit.webp',
    akzentFarbe: 'linear-gradient(135deg, rgba(16, 185, 129, 0.26) 0%, rgba(2, 6, 23, 0.88) 100%)',
    suchbegriffe: /github|gitlab|vercel|cloudflare|docker|aws|azure|hetzner|jira|linear|slack|notion|figma|server|projekt|work|arbeit|dev/i,
  },
  {
    schluessel: 'gaming',
    i18nKey: 'mss.vault.dashboard.standardKategorien.gaming',
    standardBild: '/tresor-kategorien/gaming.webp',
    akzentFarbe: 'linear-gradient(135deg, rgba(99, 102, 241, 0.30) 0%, rgba(2, 6, 23, 0.88) 100%)',
    suchbegriffe: /steam|discord|epic|riot|playstation|xbox|nintendo|ubisoft|ea|battlenet|blizzard|twitch|minecraft|game|gaming/i,
  },
  {
    schluessel: 'finanzen',
    i18nKey: 'mss.vault.dashboard.standardKategorien.finanzen',
    standardBild: '/tresor-kategorien/finanzen.webp',
    akzentFarbe: 'linear-gradient(135deg, rgba(6, 182, 212, 0.28) 0%, rgba(2, 6, 23, 0.88) 100%)',
    suchbegriffe: /revolut|paypal|stripe|klarna|wise|sparkasse|ing|dkb|n26|comdirect|trade|scalable|bank|visa|mastercard|finanz/i,
  },
  {
    schluessel: 'persoenliches',
    i18nKey: 'mss.vault.dashboard.standardKategorien.persoenliches',
    standardBild: '/tresor-kategorien/persoenliches.webp',
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
 * Eigene Ordner haben standardmäßig kein Hintergrundbild — erst wenn der
 * Nutzer eines auswählt oder hochlädt, wird `titelbild` gesetzt.
 */
export function sammlungen(items: VaultItem[], jetzt = Date.now()): Sammlung[] {
  const sichtbar = sichtbareEintraege(items)
  return sichtbar
    .filter((item) => item.category === 'ordner')
    .map((ordner) => {
      const inhalt = sichtbar.filter((item) => item.ordner === ordner.id)
      const neuester = inhalt.reduce<VaultItem | null>(
        (bisher, item) => (!bisher || item.updatedAt > bisher.updatedAt ? item : bisher),
        null,
      )
      const gespeichertesBild =
        typeof ordner.extra?.titelbild === 'string' && ordner.extra.titelbild.trim().length > 0
          ? ordner.extra.titelbild
          : undefined
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
