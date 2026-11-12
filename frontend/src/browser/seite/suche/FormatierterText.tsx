import React from 'react'

/**
 * Wandelt gängige HTML-Entities in Klartext um.
 */
export function decodeHtmlEntities(raw: string): string {
  if (!raw) return ''
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&ndash;/g, '–')
    .replace(/&mdash;/g, '—')
}

/**
 * Parst Suchergebnis-Beschreibungen und Wissens-Texte sicher in React-Elemente.
 *
 * Suchmaschinen (wie SearXNG oder Wikipedia) heben Trefferbegriffe oft über
 * `<strong>`, `<b>` oder `<mark>` hervor. Dieser Parser wandelt sie in gestylte
 * Inline-Elemente um, dekodiert HTML-Entities und verwirft unbekannte/unsichere
 * Tags sauber, ohne je `dangerouslySetInnerHTML` zu verwenden.
 */
export function parseHtmlSnippet(raw?: string | null): React.ReactNode {
  if (!raw) return null

  // Wenn keine HTML-Tags vorhanden sind, nur Entities auflösen.
  if (!raw.includes('<')) {
    return decodeHtmlEntities(raw)
  }

  // <br>-Umbruch zu Leerzeichen vereinheitlichen, unschädliche Block-Wrapper entfernen
  const vorbreitet = raw
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<\/?(?:span|p|div|a|small|font)\b[^>]*>/gi, '')

  // Sichere Formatierungs-Tags tokenisieren
  const tagRegex = /(<\/?(?:strong|b|em|i|mark)\b[^>]*>)/gi
  const teile = vorbreitet.split(tagRegex)

  let istFett = false
  let istKursiv = false
  let istHervorgehoben = false

  const elemente: React.ReactNode[] = []

  for (let i = 0; i < teile.length; i++) {
    const teil = teile[i]
    if (!teil) continue

    const klein = teil.toLowerCase()
    if (klein.startsWith('<strong') || klein.startsWith('<b')) {
      istFett = true
      continue
    }
    if (klein === '</strong>' || klein === '</b>') {
      istFett = false
      continue
    }
    if (klein.startsWith('<em') || klein.startsWith('<i')) {
      istKursiv = true
      continue
    }
    if (klein === '</em>' || klein === '</i>') {
      istKursiv = false
      continue
    }
    if (klein.startsWith('<mark')) {
      istHervorgehoben = true
      continue
    }
    if (klein === '</mark>') {
      istHervorgehoben = false
      continue
    }

    // Unbekannte/restliche Tags überspringen
    if (teil.startsWith('<') && teil.endsWith('>')) {
      continue
    }

    const text = decodeHtmlEntities(teil)
    if (!text) continue

    let knoten: React.ReactNode = text
    if (istHervorgehoben) {
      knoten = (
        <mark key={`m-${i}`} className="rounded bg-primary/20 px-0.5 font-medium text-on-surface">
          {knoten}
        </mark>
      )
    }
    if (istKursiv) {
      knoten = (
        <em key={`i-${i}`} className="italic">
          {knoten}
        </em>
      )
    }
    if (istFett) {
      knoten = (
        <strong key={`b-${i}`} className="font-semibold text-on-surface">
          {knoten}
        </strong>
      )
    }
    elemente.push(knoten)
  }

  return <>{elemente}</>
}

/**
 * Stellt formatierte Snippet-Texte sicher und barrierefrei dar.
 */
export function FormatierterText({
  text,
  className,
}: {
  text?: string | null
  className?: string
}) {
  if (!text) return null
  return <span className={className}>{parseHtmlSnippet(text)}</span>
}
