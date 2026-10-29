/**
 * Was jemand gerade tut — an einer Stelle.
 *
 * Der Server speichert nur den Schlüssel, nie einen deutschen Satz. Damit
 * bleibt die Anzeige in der App-Sprache, und eine neue Seite braucht genau
 * einen Eintrag hier statt einer Änderung an drei Stellen.
 *
 * Reihenfolge zählt: der erste Treffer gewinnt. Die letzte Zeile ist der
 * Rückfall für alles, was keine eigene Aktivität hat.
 */

export type PraesenzAktivitaet =
  | 'ki'
  | 'chat'
  | 'server'
  | 'kalender'
  | 'notizen'
  | 'tresor'
  | 'einstellungen'
  | 'verlauf'
  | 'lesezeichen'
  | 'downloads'
  | 'panel'

interface Eintrag {
  key: PraesenzAktivitaet
  /** Für die Spielzeit je Bereich (`recordActivityTime`). */
  kategorie: string
  pfad: RegExp
}

export const AKTIVITAETEN: readonly Eintrag[] = [
  { key: 'ki', kategorie: 'ai_chat', pfad: /^\/ai(?:[/?]|$)/ },
  { key: 'chat', kategorie: 'general', pfad: /^\/(?:chat|social)(?:[/?]|$)/ },
  { key: 'server', kategorie: 'server_admin', pfad: /^\/servers(?:[/?]|$)/ },
  { key: 'kalender', kategorie: 'general', pfad: /^\/(?:calendar|kalender)(?:[/?]|$)/ },
  { key: 'notizen', kategorie: 'general', pfad: /^\/(?:notes|notizen)(?:[/?]|$)/ },
  { key: 'tresor', kategorie: 'general', pfad: /^\/(?:vault|tresor)(?:[/?]|$)/ },
  {
    key: 'einstellungen',
    kategorie: 'general',
    pfad: /^\/(?:settings|profile|einstellungen)(?:[/?]|$)/,
  },
  { key: 'verlauf', kategorie: 'general', pfad: /^\/verlauf(?:[/?]|$)/ },
  { key: 'lesezeichen', kategorie: 'general', pfad: /^\/lesezeichen(?:[/?]|$)/ },
  { key: 'downloads', kategorie: 'general', pfad: /^\/downloads(?:[/?]|$)/ },
]

/** Die Aktivität zu einem Pfad; ohne Treffer das Panel. */
export function aktivitaetFuerPfad(pfad: string): { key: PraesenzAktivitaet; kategorie: string } {
  const treffer = AKTIVITAETEN.find((eintrag) => eintrag.pfad.test(pfad))
  return treffer
    ? { key: treffer.key, kategorie: treffer.kategorie }
    : { key: 'panel', kategorie: 'general' }
}

/** Der i18n-Schlüssel zu einem Aktivitätsschlüssel; unbekannte bleiben leer. */
export function aktivitaetTextKey(key: string | null | undefined): string | null {
  if (!key) return null
  const bekannt = AKTIVITAETEN.some((eintrag) => eintrag.key === key) || key === 'panel'
  return bekannt ? `presence.aktivitaet.${key}` : null
}

/** Der fertige Text in der App-Sprache; `null`, wenn der Schlüssel unbekannt ist. */
export function aktivitaetText(
  key: string | null | undefined,
  t: (schluessel: string) => string,
): string | null {
  const schluessel = aktivitaetTextKey(key)
  return schluessel ? t(schluessel) : null
}
