/** Erlaubt nur absolute http(s)-URLs; blockiert javascript:, data: und aehnliche Schemata. */
export function isSafeHttpUrl(url: string | null | undefined): url is string {
  if (!url) return false
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:'
  } catch {
    return false
  }
}

/** Erlaubt nur app-interne Pfade; blockiert protokollrelative URLs wie `//evil.example`. */
export function isSafeRelativePath(path: string | null | undefined): path is string {
  if (!path) return false
  return path.startsWith('/') && !path.startsWith('//') && !path.includes('\\')
}

/** Nur 409-Antworten mit dem Code `stripe_not_configured` duerfen in den Demo-Zahlungsweg fallen. */
export function istStripeNichtKonfiguriert(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const e = error as { status?: unknown; code?: unknown }
  return e.status === 409 && e.code === 'stripe_not_configured'
}
