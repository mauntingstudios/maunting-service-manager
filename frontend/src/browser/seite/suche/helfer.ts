/** Kleine Anzeigehelfer der Suchseite. */

export function host(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return url
  }
}

export function pfad(url: string): string {
  try {
    const u = new URL(url)
    const teile = u.pathname.split('/').filter(Boolean)
    return teile.length ? ' › ' + teile.slice(0, 3).join(' › ') : ''
  } catch {
    return ''
  }
}

export function datumText(iso: string | undefined, sprache: string): string {
  if (!iso) return ''
  const zeit = new Date(iso)
  if (Number.isNaN(zeit.getTime())) return ''
  // Regionen wie „at“ und „ch“ sind keine Sprachcodes; dann gilt Deutsch.
  for (const code of [sprache, 'de', 'en']) {
    try {
      return new Intl.DateTimeFormat(code, { dateStyle: 'medium' }).format(zeit)
    } catch {
      // nächster Versuch
    }
  }
  return ''
}

export function bildaufloesung(breite?: number, hoehe?: number): string {
  return breite && hoehe ? `${breite} × ${hoehe}` : ''
}

export function bildformat(url: string | undefined): string {
  if (!url) return ''
  const treffer = /\.(jpe?g|png|webp|gif|avif)(?:[?#]|$)/i.exec(url)
  if (!treffer) return ''
  return treffer[1].toUpperCase().replace('JPG', 'JPEG')
}

/** Erkennt Logos, Wappen, Embleme und Vektorgrafiken anhand von URL oder Kontext. */
export function istLogoOderGrafik(url?: string | null, titelOderText?: string): boolean {
  if (!url) return false
  const klein = url.toLowerCase()
  if (
    klein.endsWith('.svg') ||
    klein.includes('.svg/') ||
    klein.includes('.svg.png') ||
    klein.includes('/svg') ||
    /logo|icon|wappen|symbol|emblem|flagge|flag\b|coat_of_arms|signet|insignia|crest|seal\b|brand|trademark/i.test(klein)
  ) {
    return true
  }
  if (titelOderText && /logo|wappen|emblem|signet|symbol|insignia|crest/i.test(titelOderText)) {
    return true
  }
  return false
}

