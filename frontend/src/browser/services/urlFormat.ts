/**
 * Dekodiert Punycode-Labels (RFC 3492) für Domains mit Umlauten (z. B. xn--mnchen-3ya.de -> münchen.de).
 */
export function decodePunycodePart(input: string): string {
  if (!input.toLowerCase().startsWith('xn--')) return input
  const raw = input.slice(4).toLowerCase()
  let n = 128
  let i = 0
  let bias = 72
  const output: number[] = []
  const lastDelim = raw.lastIndexOf('-')
  let basicLength = 0
  if (lastDelim > 0) {
    basicLength = lastDelim
    for (let j = 0; j < basicLength; j++) output.push(raw.charCodeAt(j))
  }
  let index = basicLength > 0 ? basicLength + 1 : 0
  while (index < raw.length) {
    const oldi = i
    let w = 1
    for (let k = 36; ; k += 36) {
      if (index >= raw.length) return input
      const c = raw.charCodeAt(index++)
      const digit = c >= 48 && c <= 57 ? c - 22 : c >= 97 && c <= 122 ? c - 97 : 36
      if (digit >= 36) return input
      i += digit * w
      const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias
      if (digit < t) break
      w *= 36 - t
    }
    const outLen = output.length + 1
    let delta = Math.floor((i - oldi) / (oldi === 0 ? 700 : 2))
    delta += Math.floor(delta / outLen)
    let k = 0
    while (delta > 455) {
      delta = Math.floor(delta / 35)
      k += 36
    }
    bias = k + Math.floor((36 * delta) / (delta + 38))
    n += Math.floor(i / outLen)
    i %= outLen
    output.splice(i, 0, n)
    i++
  }
  return String.fromCodePoint(...output)
}

export function decodePunycodeHost(hostname: string): string {
  if (!hostname) return ''
  return hostname.split('.').map(decodePunycodePart).join('.')
}

/**
 * Formatiert eine Web-Adresse für die lesbare Anzeige in der Adresszeile und im Tab-Titel:
 * - Wandelt Prozent-kodierte UTF-8-Zeichen (z. B. %C3%BC -> ü, %C3%B6 -> ö, %C3%A4 -> ä, %C3%9F -> ß) lesbar um.
 * - Wandelt Punycode im Hostnamen (z. B. xn--mnchen-3ya.de -> münchen.de, xn--mller-kva.de -> müller.de) um.
 * - Lässt interne und ungültige Adressen sicher intakt.
 */
export function formatiereAdresseZurAnzeige(url: string): string {
  if (!url) return ''
  if (!url.includes('://')) {
    try {
      return decodeURI(url)
    } catch {
      return url
    }
  }
  try {
    const u = new URL(url)
    const host = decodePunycodeHost(u.hostname)
    const pfad = decodeURI(u.pathname)
    const suche = u.search ? decodeURI(u.search) : ''
    const hash = u.hash ? decodeURI(u.hash) : ''
    const port = u.port ? `:${u.port}` : ''
    return `${u.protocol}//${host}${port}${pfad}${suche}${hash}`
  } catch {
    try {
      return decodeURI(url)
    } catch {
      return url
    }
  }
}
