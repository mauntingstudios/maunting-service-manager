import type { TFunction } from 'i18next'

import { docsErrorCode } from '@/api/docs'

/**
 * Wo der Fehler auftrat — bestimmt den Rückfalltext (Befund 28).
 * `export` ergänzt die fünf Plan-Kontexte, weil ein Export weder Liste
 * noch Änderung ist und einen eigenen Rückfalltext verdient.
 */
export type DocsFehlerKontext = 'create' | 'list' | 'update' | 'upload' | 'share' | 'export'

const KONTEXT_SCHLUESSEL: Record<DocsFehlerKontext, string> = {
  create: 'docs.fehler.create',
  list: 'docs.fehler.list',
  update: 'docs.fehler.update',
  upload: 'docs.fehler.upload',
  share: 'docs.fehler.share',
  export: 'docs.fehler.export',
}

export interface DocsFehlerInfo {
  text: string
  code: string | null
}

/**
 * Einzige Stelle, die Server-Codes in Anzeigetexte übersetzt: Meldet der
 * Server einen bekannten Code, gilt dessen Text — sonst der zum Kontext
 * passende Rückfalltext. Text und Code bleiben zusammen, damit eine Anzeige
 * den Titel aus demselben Befund wählen kann.
 */
export function docsFehlerInfo(
  t: TFunction,
  error: unknown,
  kontext: DocsFehlerKontext,
): DocsFehlerInfo {
  const rueckfall = t(KONTEXT_SCHLUESSEL[kontext])
  const code = docsErrorCode(error)
  return {
    text: code ? t(`docs.errors.${code}`, { defaultValue: rueckfall }) : rueckfall,
    code,
  }
}

export function docsFehlermeldung(
  t: TFunction,
  error: unknown,
  kontext: DocsFehlerKontext,
): string {
  return docsFehlerInfo(t, error, kontext).text
}
