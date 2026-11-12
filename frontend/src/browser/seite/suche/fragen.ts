/**
 * Themenbezug der Folgefragen und verwandten Suchanfragen.
 *
 * Die Vorschläge der Metasuche enthalten auch Einträge zum bloßen Fragewort
 * („Wann – Rechtschreibung, Bedeutung …“ bei „Wann kommt GTA 6?“). Ohne
 * Prüfung stünden sie als „Weitere Fragen zum Thema“ neben der Antwort.
 * Deshalb gilt: ein Vorschlag gehört zum Thema, wenn er ein Inhaltswort der
 * Anfrage aufgreift. Fragewörter und Funktionswörter tragen kein Thema.
 */

const STOPPWOERTER = new Set([
  // Deutsche Frage- und Funktionswörter
  'wann', 'kommt', 'kommen', 'kam', 'was', 'wie', 'wo', 'wer', 'warum', 'wieso', 'weshalb',
  'welche', 'welcher', 'welches', 'ist', 'sind', 'war', 'waren', 'wird', 'werden', 'hat',
  'haben', 'hatte', 'hatten', 'kann', 'können', 'koennen', 'soll', 'sollen', 'muss',
  'müssen', 'muessen', 'darf', 'dürfen', 'duerfen', 'der', 'die', 'das', 'den', 'dem',
  'des', 'ein', 'eine', 'einen', 'einer', 'eines', 'und', 'oder', 'aber', 'für', 'fuer',
  'von', 'vom', 'zu', 'zum', 'zur', 'mit', 'nach', 'bei', 'seit', 'über', 'ueber', 'unter',
  'durch', 'gegen', 'ohne', 'um', 'im', 'in', 'am', 'an', 'auf', 'aus', 'als', 'auch',
  'noch', 'schon', 'nur', 'sehr', 'mehr', 'viel', 'viele', 'man', 'ich', 'du', 'er', 'sie',
  'es', 'wir', 'ihr', 'mich', 'dich', 'sich', 'mir', 'dir', 'uns', 'euch', 'mein', 'dein',
  'sein', 'unser', 'euer', 'gibt', 'geben', 'machen', 'mache', 'koche', 'backe', 'baue',
  'installiere', 'funktioniert', 'kostet', 'bitte', 'danke',
  // Englische Frage- und Funktionswörter
  'when', 'what', 'how', 'where', 'who', 'why', 'which', 'is', 'are', 'was', 'were',
  'will', 'would', 'does', 'do', 'did', 'has', 'have', 'had', 'can', 'could', 'should',
  'shall', 'may', 'might', 'must', 'the', 'a', 'an', 'and', 'or', 'but', 'for', 'of',
  'to', 'in', 'on', 'at', 'by', 'with', 'from', 'into', 'about', 'as', 'it', 'its',
  'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'we', 'they', 'me', 'him',
  'her', 'us', 'them', 'my', 'your', 'his', 'our', 'their', 'be', 'been', 'being',
  'get', 'got', 'please', 'thanks',
])

function worteAus(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Inhaltswörter einer Anfrage: ohne Frage-/Funktionswörter, Ziffern zählen mit. */
export function themaworte(begriff: string): string[] {
  const inhalt = worteAus(begriff).filter(
    (w) => (w.length >= 3 || /\d/.test(w)) && !STOPPWOERTER.has(w),
  )
  return Array.from(new Set(inhalt))
}

/** Ohne Inhaltswörter gibt es kein Thema, an dem sich ein Vorschlag messen ließe. */
export function passtZumThema(text: string, worte: string[]): boolean {
  if (worte.length === 0) return true
  const menge = new Set(worteAus(text))
  return worte.some((w) => menge.has(w))
}

/**
 * Fragen zum Thema aus den Suchvorschlägen und den Titeln der Top-Treffer.
 * Jede Frage startet eine neue Suche; eine Antwort wird nicht mehr aus einem
 * beliebigen Treffer danebengelegt.
 */
export function kontextFragen(
  begriff: string,
  vorschlaege: string[],
  treffer: { titel: string }[],
): string[] {
  const worte = themaworte(begriff)
  const gesehen = new Set<string>([begriff.trim().toLowerCase()])
  const fragen: string[] = []

  const aufnehmen = (roh: string) => {
    const text = (roh || '').trim()
    if (!text || fragen.length >= 4) return
    const klein = text.toLowerCase()
    if (gesehen.has(klein) || !passtZumThema(text, worte)) return
    gesehen.add(klein)
    fragen.push(text.endsWith('?') ? text : text.charAt(0).toUpperCase() + text.slice(1))
  }

  for (const v of vorschlaege) aufnehmen(v)
  for (const tr of treffer.slice(0, 5)) {
    const teile = tr.titel.trim().split(/\s+[–—|-]\s+|\s+:\s+/)
    aufnehmen(teile[0]?.trim() || tr.titel)
  }
  return fragen
}

/** Verwandte Suchanfragen, gefiltert auf das Thema der Anfrage. */
export function verwandteSuchen(begriff: string, vorschlaege: string[]): string[] {
  const worte = themaworte(begriff)
  const gesehen = new Set<string>([begriff.trim().toLowerCase()])
  const liste: string[] = []
  for (const v of vorschlaege) {
    const text = (v || '').trim()
    const klein = text.toLowerCase()
    if (!text || gesehen.has(klein) || !passtZumThema(text, worte)) continue
    gesehen.add(klein)
    liste.push(text)
    if (liste.length >= 8) break
  }
  return liste
}